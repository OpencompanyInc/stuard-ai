"""
Folder Limiter — controls which directories the Stuard agent may read/write.

Rules are **session-scoped** and held in memory only (no disk persistence).
Each tab / session gets its own independent set of rules. When the session
ends the rules are automatically discarded.

When **no rules** are configured for a session the limiter is transparent
(everything allowed). Once at least one rule exists, only paths that fall
under an allowed folder (with the matching permission) are permitted.

Permission levels:
  "read"  — list / read / grep / glob only
  "write" — write / create / delete / move / copy only
  "both"  — full access
"""
from __future__ import annotations

import contextvars
import os
import uuid
import logging
from typing import Any, Dict, List, Literal, Optional

logger = logging.getLogger("agent")

Permission = Literal["read", "write", "both"]

# ── Session context ──────────────────────────────────────────────────────
# Set by the WebSocket handler before dispatching a tool call so that
# fs._check_folder_read / _check_folder_write can locate the correct
# session's limiter without every tool handler needing an explicit arg.
current_session_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "folder_limiter_session_id", default="default"
)

# ── Per-session storage ──────────────────────────────────────────────────
_SESSIONS: Dict[str, "FolderLimiter"] = {}


class FolderLimiter:
    """Per-session folder permission manager."""

    def __init__(self) -> None:
        self._rules: List[Dict[str, Any]] = []
        self._enabled: bool = True

    # ── session registry ─────────────────────────────────────────────────
    @classmethod
    def get(cls, session_id: Optional[str] = None) -> "FolderLimiter":
        """Return the limiter for *session_id* (creates one if needed).

        When *session_id* is ``None`` the value is read from the
        ``current_session_id`` context-var (set by the WebSocket layer).
        """
        sid = session_id or current_session_id.get("default")
        if sid not in _SESSIONS:
            _SESSIONS[sid] = cls()
        return _SESSIONS[sid]

    @classmethod
    def clear_session(cls, session_id: str) -> None:
        """Remove all rules for a session (called when a tab closes)."""
        _SESSIONS.pop(session_id, None)

    @classmethod
    def list_sessions(cls) -> List[str]:
        """Return all session IDs that have rules."""
        return list(_SESSIONS.keys())

    # ── public API ───────────────────────────────────────────────────────
    @property
    def enabled(self) -> bool:
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool) -> None:
        self._enabled = value

    @property
    def rules(self) -> List[Dict[str, Any]]:
        return list(self._rules)

    def has_rules(self) -> bool:
        return len(self._rules) > 0

    def add_rule(self, path: str, permission: Permission = "both") -> Dict[str, Any]:
        """Add an allowed-folder rule. Returns the created rule."""
        path = os.path.abspath(os.path.expanduser(path))
        if permission not in ("read", "write", "both"):
            raise ValueError(f"Invalid permission: {permission}. Must be read, write, or both.")

        # Prevent duplicates for the same path
        for r in self._rules:
            if os.path.normcase(r["path"]) == os.path.normcase(path):
                r["permission"] = permission
                return r

        rule: Dict[str, Any] = {
            "id": uuid.uuid4().hex[:8],
            "path": path,
            "permission": permission,
        }
        self._rules.append(rule)
        return rule

    def remove_rule(self, rule_id: str) -> bool:
        """Remove a rule by its id. Returns True if removed."""
        before = len(self._rules)
        self._rules = [r for r in self._rules if r.get("id") != rule_id]
        return len(self._rules) < before

    def remove_rule_by_path(self, path: str) -> bool:
        """Remove a rule by its folder path. Returns True if removed."""
        path = os.path.normcase(os.path.abspath(os.path.expanduser(path)))
        before = len(self._rules)
        self._rules = [r for r in self._rules if os.path.normcase(r["path"]) != path]
        return len(self._rules) < before

    def clear_rules(self) -> None:
        """Remove all rules (disabling folder limiting)."""
        self._rules = []

    # ── permission checks ────────────────────────────────────────────────
    def _normalize(self, path: str) -> str:
        return os.path.normcase(os.path.abspath(os.path.expanduser(path)))

    def _is_under(self, target: str, folder: str) -> bool:
        """Check if *target* is equal to or a sub-path of *folder*."""
        target = self._normalize(target)
        folder = self._normalize(folder)
        # Ensure folder ends with separator for prefix check
        if not folder.endswith(os.sep):
            folder += os.sep
        return target.startswith(folder) or target.rstrip(os.sep) == folder.rstrip(os.sep)

    def check_read(self, path: str) -> bool:
        """Return True if reading *path* is allowed."""
        if not self._enabled or not self._rules:
            return True
        for r in self._rules:
            if r["permission"] in ("read", "both") and self._is_under(path, r["path"]):
                return True
        return False

    def check_write(self, path: str) -> bool:
        """Return True if writing to *path* is allowed."""
        if not self._enabled or not self._rules:
            return True
        for r in self._rules:
            if r["permission"] in ("write", "both") and self._is_under(path, r["path"]):
                return True
        return False

    def check(self, path: str, operation: str = "read") -> bool:
        """Generic check. *operation* is 'read' or 'write'."""
        if operation == "write":
            return self.check_write(path)
        return self.check_read(path)

    def describe_denial(self, path: str, operation: str = "read") -> str:
        """Human-readable denial message."""
        return (
            f"Folder access denied: {operation} on '{path}'. "
            f"This path is not in the allowed folder list. "
            f"Use folder_permission_list to see allowed folders, or "
            f"folder_permission_add to grant access."
        )


# ── Helper to resolve session_id from tool args ─────────────────────────

def _resolve_session_id(args: Dict[str, Any]) -> str:
    """Extract session_id from args or fall back to the context var."""
    return str(
        args.get("session_id")
        or args.get("sessionId")
        or current_session_id.get("default")
    )


# ── Tool handlers (registered in dispatch.py) ───────────────────────────

async def folder_permission_add(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add a folder to the allowed list with a permission level."""
    path = str(args.get("path") or "").strip()
    permission = str(args.get("permission") or "both").strip().lower()
    if not path:
        return {"ok": False, "error": "missing path"}
    if permission not in ("read", "write", "both"):
        return {"ok": False, "error": f"Invalid permission '{permission}'. Must be read, write, or both."}
    sid = _resolve_session_id(args)
    limiter = FolderLimiter.get(sid)
    rule = limiter.add_rule(path, permission)  # type: ignore[arg-type]
    return {"ok": True, "rule": rule, "total_rules": len(limiter.rules), "session_id": sid}


async def folder_permission_remove(args: Dict[str, Any]) -> Dict[str, Any]:
    """Remove a folder rule by id or path."""
    rule_id = str(args.get("id") or "").strip()
    path = str(args.get("path") or "").strip()
    sid = _resolve_session_id(args)
    limiter = FolderLimiter.get(sid)
    removed = False
    if rule_id:
        removed = limiter.remove_rule(rule_id)
    elif path:
        removed = limiter.remove_rule_by_path(path)
    else:
        return {"ok": False, "error": "Provide either 'id' or 'path' to remove a rule."}
    return {"ok": removed, "message": "Rule removed" if removed else "Rule not found", "total_rules": len(limiter.rules)}


async def folder_permission_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """List all folder permission rules for the current session."""
    sid = _resolve_session_id(args)
    limiter = FolderLimiter.get(sid)
    return {
        "ok": True,
        "enabled": limiter.enabled,
        "rules": limiter.rules,
        "total": len(limiter.rules),
        "session_id": sid,
        "note": "When no rules exist, all folders are accessible. Add rules to restrict access. Rules are session-scoped."
    }


async def folder_permission_set_enabled(args: Dict[str, Any]) -> Dict[str, Any]:
    """Enable or disable the folder limiter for the current session."""
    enabled = args.get("enabled")
    if enabled is None:
        return {"ok": False, "error": "missing 'enabled' (true/false)"}
    sid = _resolve_session_id(args)
    limiter = FolderLimiter.get(sid)
    limiter.enabled = bool(enabled)
    return {"ok": True, "enabled": limiter.enabled}


async def folder_permission_check(args: Dict[str, Any]) -> Dict[str, Any]:
    """Check if a path is allowed for a given operation."""
    path = str(args.get("path") or "").strip()
    operation = str(args.get("operation") or "read").strip().lower()
    if not path:
        return {"ok": False, "error": "missing path"}
    sid = _resolve_session_id(args)
    limiter = FolderLimiter.get(sid)
    allowed = limiter.check(path, operation)
    return {"ok": True, "path": path, "operation": operation, "allowed": allowed}
