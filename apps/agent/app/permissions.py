"""VM tool permissions configuration.

Controls which tools run automatically vs. require human approval.
Stored in ~/.stuard/vm_permissions.json on the VM.
"""

import json
import os
from typing import Any, Dict

from .logging_config import get_logger

logger = get_logger("permissions")

_CONFIG_DIR = os.path.expanduser("~/.stuard")
_CONFIG_FILE = os.path.join(_CONFIG_DIR, "vm_permissions.json")

# Default config: everything needs approval (safe default)
_DEFAULT_CONFIG: Dict[str, Any] = {
    # "auto" = all tools auto-approved, "manual" = all need approval, "selective" = per-tool
    "mode": "manual",
    # When mode is "selective", these tools are auto-approved
    "auto_approve": [],
    # Tools that ALWAYS require approval regardless of mode (safety net)
    "always_require": [],
}

# In-memory cache
_config: Dict[str, Any] = dict(_DEFAULT_CONFIG)


def _ensure_dir() -> None:
    try:
        os.makedirs(_CONFIG_DIR, exist_ok=True)
    except Exception:
        pass


def load() -> Dict[str, Any]:
    """Load permissions config from disk."""
    global _config
    try:
        if os.path.isfile(_CONFIG_FILE):
            with open(_CONFIG_FILE, "r") as f:
                data = json.load(f)
            if isinstance(data, dict):
                _config = {**_DEFAULT_CONFIG, **data}
                logger.info("permissions_loaded mode=%s auto_approve=%d", _config["mode"], len(_config.get("auto_approve", [])))
                return _config
    except Exception:
        logger.exception("permissions_load_error")
    _config = dict(_DEFAULT_CONFIG)
    return _config


def save(config: Dict[str, Any]) -> None:
    """Save permissions config to disk."""
    global _config
    _ensure_dir()
    # Validate mode
    mode = str(config.get("mode", "manual")).strip().lower()
    if mode not in ("auto", "manual", "selective"):
        mode = "manual"

    auto_approve = config.get("auto_approve", [])
    if not isinstance(auto_approve, list):
        auto_approve = []
    auto_approve = [str(t).strip().lower() for t in auto_approve if isinstance(t, str) and t.strip()]

    always_require = config.get("always_require", [])
    if not isinstance(always_require, list):
        always_require = []
    always_require = [str(t).strip().lower() for t in always_require if isinstance(t, str) and t.strip()]

    _config = {
        "mode": mode,
        "auto_approve": auto_approve,
        "always_require": always_require,
    }
    try:
        with open(_CONFIG_FILE, "w") as f:
            json.dump(_config, f, indent=2)
        logger.info("permissions_saved mode=%s auto_approve=%d", mode, len(auto_approve))
    except Exception:
        logger.exception("permissions_save_error")


def get() -> Dict[str, Any]:
    """Get current permissions config."""
    return dict(_config)


def is_auto_approved(tool: str) -> bool:
    """Check if a tool is auto-approved (no human approval needed)."""
    tool = str(tool).strip().lower()

    # Always-require list overrides everything
    always_require = _config.get("always_require", [])
    if tool in always_require:
        return False

    mode = _config.get("mode", "manual")

    if mode == "auto":
        return True

    if mode == "selective":
        auto_list = set(_config.get("auto_approve", []))
        # Support wildcard patterns like "browser_use_*"
        if tool in auto_list:
            return True
        for pattern in auto_list:
            if pattern.endswith("*") and tool.startswith(pattern[:-1]):
                return True
        return False

    # mode == "manual" — nothing auto-approved
    return False


# Load on import
load()
