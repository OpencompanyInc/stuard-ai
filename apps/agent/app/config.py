import os

APP_HOST = os.getenv("AGENT_HOST", "127.0.0.1")
APP_PORT = int(os.getenv("AGENT_PORT", "8765"))
CLOUD_WS = os.getenv("CLOUD_AI_WS", "ws://127.0.0.1:8082/ws")

# Back-compat alias
CloudWS = CLOUD_WS
