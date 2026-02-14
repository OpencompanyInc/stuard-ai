"""
Folder Limiter — controls which directories the Stuard agent may read/write.

Rules are persisted to ~/.stuard/folder-permissions.json.
When **no rules** are configured the limiter is transparent (everything allowed).
Once at least one rule exists, only paths that fall under an allowed folder
(with the matching permission) are permitted.

Permission levels:
  "read"  — list / read / grep / glob only
  "write" — write / create / delete / move / copy only
  "both"  — full access
"""
from __future__ import annotations

import json
import os
import sys
import uuid
import logging
from typing import Any, Dict, List, Literal, Optional

logger = logging.getLogger("agent")

Permission = Literal["read", "write", "both"]

_CONFIG_DIR = os.path.expanduser("~/.stuard")
_CONFIG_FILE = os.path.join(_CONFIG_DIR, "folder-permissions.json")


class FolderLimiter:
    _instance: Optional["FolderLimiter"] = None

    def __init__(self) -> None:
        self._rules: List[Dict[str, Any]] = []
        self._enabled: bool = True
        self._load()

    # ── singleton ──────────────────────────────────────────────────────
    @classmethod
    def get(cls) -> "FolderLimiter":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # ── persistence ────────────────────────────────────────────────────
    def _load(self) -> None:
        if not os.path.exists(_CONFIG_FILE):
            return
        try:
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            self._rules = data.get("rules", [])
            self._enabled = data.get("enabled", True)
        except Exception as e:
            logger.warning(f"folder_limiter: failed to load config: {e}")

    def _save(self) -> None:
        os.makedirs(_CONFIG_DIR, exist_ok=True)
        try:
            with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump({"enabled": self._enabled, "rules": self._rules}, f, indent=2)
        except Exception as e:
            logger.warning(f"folder_limiter: failed to save config: {e}")

    # ── public API ─────────────────────────────────────────────────────
    @property
    def enabled(self) -> bool:
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool) -> None:
        self._enabled = value
        self._save()

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
                self._save()
                return r

        rule: Dict[str, Any] = {
            "id": uuid.uuid4().hex[:8],
            "path": path,
            "permission": permission,
        }
        self._rules.append(rule)
        self._save()
        return rule

    def remove_rule(self, rule_id: str) -> bool:
        """Remove a rule by its id. Returns True if removed."""
        before = len(self._rules)
        self._rules = [r for r in self._rules if r.get("id") != rule_id]
        if len(self._rules) < before:
            self._save()
            return True
        return False

    def remove_rule_by_path(self, path: str) -> bool:
        """Remove a rule by its folder path. Returns True if removed."""
        path = os.path.normcase(os.path.abspath(os.path.expanduser(path)))
        before = len(self._rules)
        self._rules = [r for r in self._rules if os.path.normcase(r["path"]) != path]
        if len(self._rules) < before:
            self._save()
            return True
        return False

    def clear_rules(self) -> None:
        """Remove all rules (disabling folder limiting)."""
        self._rules = []
        self._save()

    # ── permission checks ──────────────────────────────────────────────
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


# ── Tool handlers (registered in dispatch.py) ─────────────────────────

async def folder_permission_add(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add a folder to the allowed list with a permission level."""
    path = str(args.get("path") or "").strip()
    permission = str(args.get("permission") or "both").strip().lower()
    if not path:
        return {"ok": False, "error": "missing path"}
    if permission not in ("read", "write", "both"):
        return {"ok": False, "error": f"Invalid permission '{permission}'. Must be read, write, or both."}
    limiter = FolderLimiter.get()
    rule = limiter.add_rule(path, permission)  # type: ignore[arg-type]
    return {"ok": True, "rule": rule, "total_rules": len(limiter.rules)}


async def folder_permission_remove(args: Dict[str, Any]) -> Dict[str, Any]:
    """Remove a folder rule by id or path."""
    rule_id = str(args.get("id") or "").strip()
    path = str(args.get("path") or "").strip()
    limiter = FolderLimiter.get()
    removed = False
    if rule_id:
        removed = limiter.remove_rule(rule_id)
    elif path:
        removed = limiter.remove_rule_by_path(path)
    else:
        return {"ok": False, "error": "Provide either 'id' or 'path' to remove a rule."}
    return {"ok": removed, "message": "Rule removed" if removed else "Rule not found", "total_rules": len(limiter.rules)}


async def folder_permission_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """List all folder permission rules."""
    limiter = FolderLimiter.get()
    return {
        "ok": True,
        "enabled": limiter.enabled,
        "rules": limiter.rules,
        "total": len(limiter.rules),
        "note": "When no rules exist, all folders are accessible. Add rules to restrict access."
    }


async def folder_permission_set_enabled(args: Dict[str, Any]) -> Dict[str, Any]:
    """Enable or disable the folder limiter."""
    enabled = args.get("enabled")
    if enabled is None:
        return {"ok": False, "error": "missing 'enabled' (true/false)"}
    limiter = FolderLimiter.get()
    limiter.enabled = bool(enabled)
    return {"ok": True, "enabled": limiter.enabled}


async def folder_permission_check(args: Dict[str, Any]) -> Dict[str, Any]:
    """Check if a path is allowed for a given operation."""
    path = str(args.get("path") or "").strip()
    operation = str(args.get("operation") or "read").strip().lower()
    if not path:
        return {"ok": False, "error": "missing path"}
    limiter = FolderLimiter.get()
    allowed = limiter.check(path, operation)
    return {"ok": True, "path": path, "operation": operation, "allowed": allowed}
