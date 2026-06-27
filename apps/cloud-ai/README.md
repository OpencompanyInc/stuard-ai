# StuardAI Cloud AI (Node/TypeScript)

Intelligent cloud AI service using **Mastra** + **Vercel AI SDK** with **Gemini-based model routing**.

## Architecture

```
┌─────────────┐
│   Gemini    │  Routes requests to optimal model
│  (Router)   │  based on complexity & context
└──────┬──────┘
       │
       ├──> gpt-4.1 (fast, low-cost)
       ├──> gpt-5/o3-mini (medium reasoning)
       └──> gpt-5/o3-mini (high reasoning)
```

## Features

- **Intelligent Routing**: Gemini analyzes each request to select the best model
- **Multi-Model Support**: 
  - `gpt-4.1`: Fast responses for simple queries
  - `gpt-5-medium`: Balanced reasoning for most tasks
  - `gpt-5-high`: Deep reasoning for complex analysis
- **Streaming**: Real-time token streaming via WebSocket
- **Mastra Integration**: Clean agent abstractions with AI SDK providers

## Setup

1. **Install dependencies**
```bash
pnpm install
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your API keys
```

Required keys:
- `OPENAI_API_KEY`: For GPT models
- `GOOGLE_GENERATIVE_AI_API_KEY`: For Gemini routing

3. **Run dev server**
```bash
pnpm dev
# or from root: pnpm -F @stuardai/cloud-ai dev
```

Server starts at `ws://localhost:8082`

## Usage

### WebSocket Protocol

**Connect**: `ws://localhost:8082`

**Send chat request**:
```json
{
  "type": "chat",
  "text": "Explain quantum computing",
  "context": {
    "recent_tools": ["search", "analyze"]
  }
}
```

**Receive**:
```json
// Routing decision (if enabled)
{"type": "routing", "model": "gpt-5-medium"}

// Streaming tokens
{"type": "delta", "delta": "Quantum"}
{"type": "delta", "delta": " computing"}
...

// Final result
{
  "type": "final",
  "origin": "cloud-ai",
  "model": "gpt-5-medium",
  "result": {
    "text": "...",
    "steps": [...],
    "finishReason": "stop",
    "usage": {...}
  }
}
```

## Configuration

### Environment Variables

- `CLOUD_AI_PORT` (default: `8082`) - WebSocket port
- `ENABLE_ROUTING` (default: `1`) - Enable Gemini routing (set to `0` to disable and always use `gpt-5-medium`)

### Model Selection Logic

Gemini router considers:
- Query complexity and length
- Presence of attachments
- Context size
- Recent tool usage

## Development

```bash
pnpm dev          # Start dev server with hot reload
pnpm build        # Build for production
pnpm start        # Run production build
pnpm typecheck    # Type check without emit
```

## Integration with Local Agent

The cloud AI service works alongside the Python local agent:
- **Local Agent** (`apps/agent/`): Tool execution, desktop automation via `unified_agent.py`
- **Cloud AI** (`apps/cloud-ai/`): LLM inference, reasoning, content generation

Communication flow:
```
Electron ──> Local Agent ──> Cloud AI
         WS             WS/HTTP
```

## Project Structure

```
apps/cloud-ai/
├── src/
│   ├── agents/
│   │   └── stuard-agent.ts    # Agent factory with model variants
│   ├── router/
│   │   └── model-router.ts  # Gemini-based routing logic
│   └── server.ts            # WebSocket server
├── package.json
├── tsconfig.json
└── .env.example
```
