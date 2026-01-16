# Frontend-Backend Integration Guide

This document explains how the Electron frontend connects to the Python backend for chat, file uploads, and real-time communication.

## Architecture Overview

```
┌─────────────────────┐
│  Electron Frontend  │
│   (React/TS)        │
│                     │
│  • Overlay UI       │
│  • File selection   │
│  • WebSocket client │
└──────────┬──────────┘
           │ WS: ws://127.0.0.1:8765/ws
           ↓
┌─────────────────────┐
│  Python Agent       │
│   (FastAPI)         │
│                     │
│  • unified_agent.py │
│  • Tool execution   │
│  • Progress events  │
└─────────────────────┘
```

## Communication Protocol

### WebSocket Messages

#### Client → Server (Electron → Python)

**Chat message with attachments**:
```json
{
  "type": "chat",
  "text": "Analyze this image",
  "context": {
    "recent_messages": [...],
    "device_id": "electron-desktop"
  },
  "attachments": [
    {
      "type": "image",
      "name": "screenshot.png",
      "data": "base64-encoded-data",
      "mimeType": "image/png"
    }
  ]
}
```

#### Server → Client (Python → Electron)

**Handshake**:
```json
{
  "type": "handshake",
  "origin": "agent",
  "message": "connected"
}
```

**Progress event** (during tool execution):
```json
{
  "type": "progress",
  "event": "tool_executing",
  "data": {
    "tool": "take_screenshot",
    "args": {}
  }
}
```

**Final response**:
```json
{
  "type": "final",
  "origin": "agent",
  "result": {
    "response": "I've analyzed the image...",
    "tool_calls": [...],
    "cancelled": false
  }
}
```

**Error**:
```json
{
  "type": "error",
  "message": "Agent not available"
}
```

## File Handling

### Electron Side

**File Selection** (`apps/desktop/src/main/index.ts`):
- `selectFiles()`: Opens file dialog for any file type
- `selectImages()`: Opens file dialog filtered to images
- Returns array with base64-encoded file data and metadata

**API** (`window.desktopAPI`):
```typescript
const files = await window.desktopAPI.selectFiles();
// Returns: [{ name, path, data, mimeType }] | null

const images = await window.desktopAPI.selectImages();
// Returns: [{ name, path, data, mimeType }] | null
```

### Python Side

**Attachment Processing** (`apps/agent/app/main.py`):
- Receives attachments in `msg.attachments[]`
- Passes to `UnifiedAgent.process_user_input(attachments=...)`
- `unified_agent.py` handles image/file processing

## React Components

### useAgent Hook (`apps/desktop/src/renderer/hooks/useAgent.ts`)

Custom hook that manages WebSocket connection and state:

```typescript
const { messages, state, sendMessage } = useAgent();

// State
state.connected  // boolean: connection status
state.status     // string: current status (idle, processing, etc.)

// Send message
sendMessage({
  text: "Hello",
  attachments: [...],
  context: {}
});
```

**Features**:
- Auto-connect on mount
- Auto-reconnect on disconnect (3s delay)
- Message history management
- Progress event handling
- Error handling

### App Component (`apps/desktop/src/renderer/App.tsx`)

Main overlay UI with:
- **File upload buttons**: FileIcon and ImageIcon buttons
- **Attachment chips**: Shows selected files with remove button
- **Status bar**: Displays connection status
- **Message list**: Shows conversation history

## Testing

### 1. Start Python Agent

```bash
cd apps/agent
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Set environment variable
$env:OPENAI_API_KEY="sk-..."

# Start server
python -m app.main
```

Server will start at `ws://127.0.0.1:8765/ws`

### 2. Start Electron App

```bash
# From repo root
pnpm -F @stuardai/desktop dev
```

### 3. Test Connection

1. **Toggle overlay**: Press `Ctrl+Shift+Space`
2. **Check status**: Bottom-left should show "connected" when agent is running
3. **Send message**: Type "hello" and press Enter
4. **Upload file**: Click FileIcon button, select a file
5. **Upload image**: Click ImageIcon button, select an image
6. **Send with attachments**: Type message or just send attachments

### 4. Monitor Logs

**Python side**:
```
INFO:     Application startup complete.
[agent] Connected
[agent] Received: chat
```

**Electron side** (DevTools console):
```
[agent] Connected
[agent] Received: handshake
[agent] Received: final
```

## Troubleshooting

### "Disconnected" status in UI

- Check Python agent is running on port 8765
- Check firewall/antivirus isn't blocking localhost:8765
- Check Python agent logs for errors
- Try manual reconnect: restart Electron app

### "Agent not available" error

- Ensure `unified_agent.py` is in repo root
- Check Python import path in `apps/agent/app/main.py`
- Verify `OPENAI_API_KEY` is set (required by UnifiedAgent)

### File upload not working

- Check file dialog appears (may be behind other windows)
- Verify file size is reasonable (<10MB recommended)
- Check main process logs for file read errors
- Ensure file has read permissions

### No response from agent

- Check if `UnifiedAgent` initialized successfully
- Verify OpenAI API key is valid
- Check Python logs for tool execution errors
- Enable Python debug logging: `logging.basicConfig(level=logging.DEBUG)`

## Development Tips

### Add Progress Event Handling

In `useAgent.ts`, handle specific progress events:

```typescript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'progress') {
    if (msg.event === 'tool_executing') {
      // Show "Executing tool X..." in UI
    }
  }
};
```

### Custom Context Per Message

Pass additional context when sending:

```typescript
sendMessage({
  text: "...",
  context: {
    screen_resolution: "1920x1080",
    os: "Windows 11",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  }
});
```

### Streaming Responses (Future)

Currently responses are sent as single `final` message. To add streaming:

1. Update Python agent to yield partial responses
2. Add `delta` message type
3. Handle in `useAgent.ts` to build response incrementally

## File Structure

```
apps/
├── desktop/                    # Electron app
│   ├── src/
│   │   ├── main/
│   │   │   └── index.ts       # File selection, IPC handlers
│   │   ├── preload/
│   │   │   └── index.ts       # Exposed APIs
│   │   └── renderer/
│   │       ├── hooks/
│   │       │   └── useAgent.ts  # WebSocket hook
│   │       ├── App.tsx         # Main UI
│   │       └── global.d.ts     # Type definitions
│   └── package.json
│
└── agent/                      # Python backend
    ├── app/
    │   ├── __init__.py
    │   └── main.py             # FastAPI server
    ├── requirements.txt
    └── README.md

unified_agent.py                # Tool execution (repo root)
```

## Next Steps

- **Add streaming**: Implement partial response streaming
- **Add audio**: Support audio file uploads and transcription
- **Add clipboard**: Paste images directly from clipboard
- **Add drag-drop**: Drag files onto overlay
- **Add history**: Persist conversation history
- **Add settings**: Configure agent behavior from dashboard
