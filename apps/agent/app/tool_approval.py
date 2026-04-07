import re
from typing import Any, Dict, Optional

_RUN_COMMAND_WRITE_OR_DESTRUCTIVE_PATTERNS = (
    re.compile(r"\b(?:rm|rmdir|del|erase|mv|move|cp|copy|mkdir|md|touch|chmod|chown|tee)\b", re.IGNORECASE),
    re.compile(r"\b(?:set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|rename-item)\b", re.IGNORECASE),
    re.compile(r"\bgit\s+(?:add|commit|push|reset|clean|checkout|switch|merge|rebase)\b", re.IGNORECASE),
    re.compile(r"\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|update)\b", re.IGNORECASE),
    re.compile(r"\b(?:npm|pnpm|yarn)\s+run\s+build\b", re.IGNORECASE),
    re.compile(r"\b(?:pip|pip3)\s+install\b", re.IGNORECASE),
    re.compile(r"\bpython(?:\d+(?:\.\d+)?)?\s+-m\s+pip\s+install\b", re.IGNORECASE),
    re.compile(r"\b(?:cargo\s+build|go\s+build|dotnet\s+build|mvn\s+(?:package|install)|gradle\s+build|cmake\s+--build|make)\b", re.IGNORECASE),
)


def command_looks_write_or_destructive(command: str) -> bool:
    text = str(command or "").strip()
    if not text:
        return False
    if ">" in text:
        return True
    return any(pattern.search(text) for pattern in _RUN_COMMAND_WRITE_OR_DESTRUCTIVE_PATTERNS)


def run_command_requires_approval(args: Optional[Dict[str, Any]] = None) -> bool:
    arg_obj = args or {}
    requested = arg_obj.get("isPermissionRequired")
    if isinstance(requested, bool):
        if requested:
            return True
        return command_looks_write_or_destructive(str(arg_obj.get("command") or ""))
    return command_looks_write_or_destructive(str(arg_obj.get("command") or ""))
