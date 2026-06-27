# AI System Refactoring Plan

## Executive Summary

The current AI system has unstable tool calling due to complex, tangled streaming logic and outdated patterns. This document outlines a complete refactoring of the "brain" (agent orchestration, streaming, tool calling) while preserving the "hands" (existing tool implementations and system prompts).

---

## Current State Analysis

### Stack Versions
| Package | Current | Notes |
|---------|---------|-------|
| `@mastra/core` | ^1.1.0 | Compatible with Mastra 1.0 |
| `ai` (AI SDK) | ^6.0.64 | Latest v6 |
| `zod` | ^4.3.6 | Latest v4 |

### Critical Issues

1. **`server.ts` is 1305 lines** - Monolithic file handling auth, routing, streaming, tool events, memory, knowledge graph
2. **Inconsistent tool calling** - Multiple fallback patterns for handling chunks
3. **Zod 4 deprecations** - Using `.passthrough()`, `.strict()`, `.merge()`
4. **Mastra 1.0 breaking changes** not fully applied
5. **No unit tests** for agent flows

---

## Breaking Changes to Address

### Mastra 1.0

```typescript
// OLD: execute(inputData)
execute: async (inputData) => { ... }

// NEW: execute(inputData, context)
execute: async (inputData, context) => {
  const { requestContext, abortSignal, runId } = context;
  ...
}
```

```typescript
// OLD imports
import { createTool } from '@mastra/core/tools';
import { Agent } from '@mastra/core/agent';

// NEW subpath imports (recommended)
import { createTool } from '@mastra/core/tools';
import { Agent } from '@mastra/core/agent';
// (Same, but Mastra now recommends explicit subpaths)
```

### Zod 4

```typescript
// OLD
z.object({ ... }).passthrough()
z.object({ ... }).strict()
schema1.merge(schema2)

// NEW
z.looseObject({ ... })  // passes through extra keys
z.strictObject({ ... }) // rejects extra keys
z.object({ ...schema1.shape, ...schema2.shape })
```

```typescript
// OLD: z.record with single arg
z.record(z.string())

// NEW: z.record requires key and value types
z.record(z.string(), z.string())
```

### AI SDK 6

```typescript
// OLD
import { generateObject } from 'ai';
const { object } = await generateObject({ model, schema, prompt });

// NEW
import { generateText, Output } from 'ai';
const { output } = await generateText({
  model,
  output: Output.object({ schema }),
  prompt,
});
```

```typescript
// OLD
const messages = convertToCoreMessages(uiMessages);

// NEW (now async!)
const messages = await convertToModelMessages(uiMessages);
```

---

## Refactoring Architecture

### New File Structure

```
apps/cloud-ai/src/
├── server.ts                    # Slim entry point (HTTP + WS setup only)
├── agents/
│   ├── base-agent.ts           # NEW: Base agent configuration
│   ├── stuard/
│   │   ├── index.ts            # Agent factory
│   │   ├── tools.ts            # Tool registry
│   │   ├── prompts.ts          # System prompts
│   │   └── models.ts           # Model selection
│   └── workflow-agent/
│       ├── index.ts
│       └── tools.ts
├── streaming/
│   ├── index.ts                # NEW: Clean streaming module
│   ├── chunk-handler.ts        # NEW: Unified chunk processing
│   ├── tool-executor.ts        # NEW: Tool execution with lifecycle hooks
│   └── types.ts                # NEW: Stream event types
├── tools/
│   ├── registry.ts             # Tool registry (keep)
│   ├── bridge.ts               # Local tool bridge (keep)
│   └── [tool files]            # Individual tools (update signatures)
└── __tests__/
    ├── streaming.test.ts       # NEW: Streaming tests
    ├── tools.test.ts           # NEW: Tool calling tests
    └── agents.test.ts          # NEW: Agent integration tests
```

### New Streaming Module

```typescript
// streaming/types.ts
export type StreamEvent =
  | { type: 'start' }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: any }
  | { type: 'finish'; text: string; usage: any; finishReason: string }
  | { type: 'error'; message: string };

// streaming/chunk-handler.ts
export function handleChunk(chunk: any): StreamEvent | null {
  const type = chunk?.type;
  
  switch (type) {
    case 'text-delta':
      return { type: 'text-delta', text: chunk.payload?.text || chunk.text || '' };
    case 'tool-call':
      return { 
        type: 'tool-call', 
        toolCallId: chunk.payload?.toolCallId,
        toolName: chunk.payload?.toolName,
        args: chunk.payload?.args 
      };
    case 'tool-result':
      return {
        type: 'tool-result',
        toolCallId: chunk.payload?.toolCallId,
        toolName: chunk.payload?.toolName,
        result: chunk.payload?.result
      };
    // ... other cases
    default:
      return null; // Unknown chunk type
  }
}
```

### Tool Lifecycle Hooks

```typescript
// All tools should use lifecycle hooks for debugging
export const myTool = createTool({
  id: 'my_tool',
  description: '...',
  inputSchema: z.object({ ... }),
  outputSchema: z.object({ ... }),
  
  // Lifecycle hooks for debugging
  onInputStart: ({ toolCallId }) => {
    console.log(`[${toolCallId}] Tool input streaming started`);
  },
  onInputAvailable: ({ input, toolCallId }) => {
    console.log(`[${toolCallId}] Tool received input:`, input);
  },
  onOutput: ({ output, toolCallId }) => {
    console.log(`[${toolCallId}] Tool completed:`, output);
  },
  
  execute: async (inputData, context) => {
    const { abortSignal, requestContext } = context;
    // Implementation
  },
});
```

---

## Implementation Plan

### Phase 1: Foundation (Day 1-2)

1. **Create new streaming module** with clean chunk handling
2. **Add unit tests** for streaming logic
3. **Update Zod schemas** to v4 patterns

### Phase 2: Tool Updates (Day 3-4)

1. **Update all `createTool` calls** to new signature `(inputData, context)`
2. **Add lifecycle hooks** to key tools for debugging
3. **Add tool unit tests**

### Phase 3: Agent Refactor (Day 5-6)

1. **Extract agent logic** from server.ts into modular components
2. **Slim down server.ts** to just HTTP/WS setup
3. **Add agent integration tests**

### Phase 4: CI/CD Integration (Day 7)

1. **Add test scripts** to package.json
2. **Update GitHub workflow** to run tests
3. **Add test coverage reporting**

---

## Test Strategy

### Unit Tests (Vitest)

```typescript
// __tests__/streaming.test.ts
import { describe, it, expect } from 'vitest';
import { handleChunk } from '../streaming/chunk-handler';

describe('Chunk Handler', () => {
  it('should handle text-delta chunks', () => {
    const chunk = { type: 'text-delta', payload: { text: 'Hello' } };
    const result = handleChunk(chunk);
    expect(result).toEqual({ type: 'text-delta', text: 'Hello' });
  });

  it('should handle tool-call chunks', () => {
    const chunk = { 
      type: 'tool-call', 
      payload: { toolCallId: 'tc-1', toolName: 'web_search', args: { query: 'test' } }
    };
    const result = handleChunk(chunk);
    expect(result).toEqual({
      type: 'tool-call',
      toolCallId: 'tc-1',
      toolName: 'web_search',
      args: { query: 'test' }
    });
  });

  it('should return null for unknown chunks', () => {
    const chunk = { type: 'unknown_type' };
    expect(handleChunk(chunk)).toBeNull();
  });
});
```

### Integration Tests

```typescript
// __tests__/agents.test.ts
import { describe, it, expect } from 'vitest';
import { getAgent } from '../agents/stuard';

describe('Stuard Agent', () => {
  it('should generate a response', async () => {
    const agent = getAgent('fast', undefined, []);
    const result = await agent.generate('Hello');
    expect(result.text).toBeTruthy();
  });

  it('should handle tool calls', async () => {
    const agent = getAgent('balanced', undefined, []);
    const result = await agent.generate('What time is it?');
    // Agent should either respond or call a tool
    expect(result.text || result.steps?.length > 0).toBeTruthy();
  });
});
```

---

## CI/CD Updates

### package.json scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:ci": "vitest run --reporter=junit --outputFile=test-results.xml"
  }
}
```

### GitHub Workflow Addition

```yaml
# .github/workflows/ci-checks.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm -F @stuardai/cloud-ai test:ci
      - uses: dorny/test-reporter@v1
        if: always()
        with:
          name: Tests
          path: apps/cloud-ai/test-results.xml
          reporter: java-junit
```

---

## Migration Checklist

### Zod Updates
- [ ] Replace `.passthrough()` with `z.looseObject()`
- [ ] Replace `.strict()` with `z.strictObject()`
- [ ] Replace `.merge()` with spread syntax
- [ ] Update `z.record()` calls to two arguments
- [ ] Run codemod: `npx zod-v3-to-v4`

### Mastra Updates
- [ ] Update `createTool` execute signatures to `(inputData, context)`
- [ ] Add lifecycle hooks to critical tools
- [ ] Run codemod: `npx @mastra/codemod@latest v1`

### AI SDK Updates
- [ ] Replace `generateObject` with `generateText` + `Output.object()`
- [ ] Replace `streamObject` with `streamText` + `Output.object()`
- [ ] Make `convertToModelMessages` calls async
- [ ] Run codemod: `npx @ai-sdk/codemod v6`

### Testing
- [ ] Add streaming unit tests
- [ ] Add tool unit tests
- [ ] Add agent integration tests
- [ ] Configure CI/CD pipeline

---

## Success Criteria

1. **Stable tool calling** - No more "on and off" behavior
2. **Clean architecture** - server.ts under 300 lines
3. **Test coverage** - >80% for streaming and tool execution
4. **CI/CD integration** - Tests run on every PR
5. **Proper error handling** - Clear error messages for all failure modes
