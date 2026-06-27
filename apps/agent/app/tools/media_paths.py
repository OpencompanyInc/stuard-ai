"""Shared media path helpers aligned with the desktop media library layout."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Optional

_LEGACY_CATEGORY_TO_SOURCE = {
    "videos": "video-recordings",
    "recordings": "audio-recordings",
    "photos": "photos",
    "screen-recordings": "screen-recordings",
    "screen-audio": "screen-audio",
    "misc": "misc",
}


def _read_config_media_root() -> Optional[str]:
    appdata = os.environ.get("APPDATA")
    if appdata:
        config_path = os.path.join(appdata, "Stuard AI", "media-library", "capture-root.txt")
        try:
            if os.path.isfile(config_path):
                value = open(config_path, "r", encoding="utf-8").read().strip()
                if value:
                    return os.path.expanduser(value)
        except Exception:
            pass
    return None


def media_base_dir() -> str:
    override = (
        os.environ.get("STUARD_MEDIA_DIR")
        or os.environ.get("STUARD_AI_MEDIA_DIR")
        or _read_config_media_root()
    )
    if override and str(override).strip():
        base = os.path.expanduser(str(override).strip())
    else:
        home = os.path.expanduser("~")
        docs = os.path.join(home, "Documents")
        if not os.path.isdir(docs):
            docs = home
        base = os.path.join(docs, "StuardAI", "media")
    try:
        os.makedirs(base, exist_ok=True)
    except Exception:
        pass
    return base


def normalize_library_source(source: str) -> str:
    normalized = str(source or "misc").strip().lower() or "misc"
    return _LEGACY_CATEGORY_TO_SOURCE.get(normalized, normalized)


def library_source_dir(source: str, created_at: Optional[datetime] = None) -> str:
    created_at = created_at or datetime.now()
    safe_source = normalize_library_source(source)
    yyyy_mm = created_at.strftime("%Y-%m")
    target = os.path.join(media_base_dir(), safe_source, yyyy_mm)
    try:
        os.makedirs(target, exist_ok=True)
    except Exception:
        pass
    return target


def library_source_dir_for_category(category: str, created_at: Optional[datetime] = None) -> str:
    return library_source_dir(normalize_library_source(category), created_at)
