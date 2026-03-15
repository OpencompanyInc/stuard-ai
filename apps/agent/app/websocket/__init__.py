import os as _os

# handler.py is the FastAPI WebSocket endpoint for desktop mode.
# In VM mode, vm_main.py uses its own websockets-based server instead.
if _os.environ.get("STUARD_AGENT_MODE") != "vm":
    from .handler import ws_endpoint
    __all__ = ["ws_endpoint"]
else:
    __all__ = []

