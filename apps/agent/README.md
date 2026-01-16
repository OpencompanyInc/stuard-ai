# StuardAI Local Agent (Python)

FastAPI WebSocket server for local tool execution and desktop automation.

## Architecture

The local agent handles:
- **Tool Execution**: Desktop automation, file operations, vision analysis via `unified_agent.py`
- **Local LLM Routing**: Coordinates with cloud AI service for inference
- **Device Communication**: Bridges Electron frontend with cloud backend

```
Electron ←─WS─→ Local Agent ←─WS/HTTP─→ Cloud AI
         8765   (Python)                 (Node/TS)
                unified_agent.py         Mastra + AI SDK
                + local tools            + Gemini routing
```

## Setup

### Prerequisites
- Python 3.11+
- OpenAI API key (for `unified_agent.py`)

### Install

```bash
cd apps/agent
python -m venv .venv

# Windows PowerShell
.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt
```

### Configure

The agent uses `unified_agent.py` which requires:
- `OPENAI_API_KEY` in environment or passed to `UnifiedAgent()`

### Run

```bash
python -m app.main
# or
uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
```

Server starts at: `ws://127.0.0.1:8765/ws`

## API

### Endpoints

- `GET /` - Service info + agent status
- `GET /health` - Health check
- `WS /ws` - WebSocket for chat messages

### WebSocket Protocol

**Send**:
```json
{
  "type": "chat",
  "text": "Take a screenshot and analyze it",
  "context": {
    "device_id": "...",
    "recent_messages": [...]
  },
  "attachments": [...]
}
```

**Receive**:
```json
// Progress events during tool execution
{"type": "progress", "event": "tool_executing", "data": {...}}

// Final result
{
  "type": "final",
  "origin": "agent",
  "result": {
    "response": "...",
    "tool_calls": [...],
    ...
  }
}
```

## Integration with unified_agent.py

The agent imports and uses `UnifiedAgent` from the repo root:
- `UnifiedAgent.process_user_input()` handles tool execution
- Progress callbacks stream to client via WebSocket
- Supports attachments (images, files, YouTube URLs)

## Development

- Edit `app/main.py` for routing/protocol
- Edit `unified_agent.py` for tool logic and system prompt
- Agent runs stateless per turn (controlled by `STATELESS_CONVERSATION=1`)

## Environment Variables

Agent behavior (set in `unified_agent.py`):
- `STATELESS_CONVERSATION` (default: `1`) - Don't persist server-side history
- `USE_TOKEN_AWARE_WINDOW` (default: `1`) - Smart context windowing
- `MAX_TOOL_ROUNDS` (default: `50`) - Max tool call iterations
- `TOOL_STEP_TIMEOUT_SECONDS` (default: `45`) - Per-tool timeout

Service config:
- `AGENT_HOST` (default: `127.0.0.1`)
- `AGENT_PORT` (default: `8765`)
