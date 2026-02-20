import logging
import os
import sys
from pathlib import Path

_initialized = False

def _get_log_dir() -> Path:
    """Get the log directory - prefer STUARD_LOG_DIR env var, else use platform-specific location."""
    if os.environ.get("STUARD_LOG_DIR"):
        return Path(os.environ["STUARD_LOG_DIR"])
    
    # Platform-specific default
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA", "")
        if appdata:
            return Path(appdata) / "@stuardai" / "desktop" / "logs"
        return Path.home() / "AppData" / "Roaming" / "@stuardai" / "desktop" / "logs"
    elif sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "@stuardai" / "desktop" / "logs"
    else:
        return Path.home() / ".config" / "@stuardai" / "desktop" / "logs"


def _setup_logging():
    """Set up root logging with both console and file handlers."""
    global _initialized
    if _initialized:
        return
    
    log_dir = _get_log_dir()
    log_file = log_dir / "agent.log"
    
    # Ensure log directory exists
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    
    # Root logger setup
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # File handler with rotation
    try:
        from logging.handlers import RotatingFileHandler
        file_handler = RotatingFileHandler(
            log_file, 
            maxBytes=5*1024*1024,  # 5MB
            backupCount=2,
            encoding="utf-8"
        )
        # On Windows, os.rename fails if the target is held open by another
        # process (e.g. the desktop app tailing the log).  Use copy+truncate
        # instead so rotation never raises PermissionError.
        if sys.platform == "win32":
            import shutil
            def _win_rotator(source: str, dest: str) -> None:
                try:
                    if os.path.exists(dest):
                        os.remove(dest)
                except OSError:
                    pass
                try:
                    shutil.copy2(source, dest)
                except OSError:
                    pass
                try:
                    with open(source, "w"):
                        pass  # truncate
                except OSError:
                    pass
            file_handler.rotator = _win_rotator
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
    except Exception as e:
        print(f"[WARN] Could not set up file logging: {e}", file=sys.stderr)
    
    _initialized = True


def get_logger(name: str = "agent") -> logging.Logger:
    _setup_logging()
    return logging.getLogger(name)
