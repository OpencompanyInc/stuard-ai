# StuardAI-V2 Codebase Refactoring Plan

## Executive Summary

The StuardAI-V2 codebase is a monorepo containing five applications: a Python local agent, a TypeScript cloud AI server, an Electron desktop app, a Next.js operations console, and a Next.js marketing website. While the project has decent modular separation at the application level, there are significant structural issues including:

- **Monolithic files** exceeding 1000+ lines that violate Single Responsibility Principle
- **Backup/temporary files** scattered throughout the codebase
- **Duplicate tool definitions** across cloud-ai and desktop apps
- **Placeholder/empty test files** providing no value
- **Orphaned directories** from past refactoring attempts
- **Inconsistent organization patterns** across applications

---

## 1. FILES TO DELETE (Immediately Safe)

### 1.1 Backup and Temporary Files

| File Path | Justification |
|-----------|---------------|
| `apps/desktop/src/renderer/workflows.tsx.backup` | Old backup file (70,330 bytes) |
| `apps/desktop/src/renderer/workflows.tsx.old-backup` | Duplicate old backup (54,823 bytes) |
| `apps/desktop/src/renderer/workflows-manual-builder.backup.tsx` | Abandoned backup (37,608 bytes) |
| `apps/desktop/src/main/Untitled-1.txt` | Scratch file (57KB) in source |
| `url_test.js` | Empty test file at root |
| `verify_migration.py` | One-time migration verification script |
| `apps/agent/verify_modify.py` | One-time verification script |
| `test_ui_demo.json` | Demo/test artifact at root |
| `corrected_countdown.json` | Temporary data file at root |
| `apps/agent/revert_check.txt` | Development artifact |
| `apps/agent/%TEMP%/` | Entire temp directory (Windows path artifact) |

### 1.2 Empty or Placeholder Test Files

| File Path | Justification |
|-----------|---------------|
| `apps/agent/tests/test_main.py` | Contains only `assert True` |
| `apps/cloud-ai/src/server.test.ts` | Contains only `expect(true).toBe(true)` |
| `apps/cloud-ai/src/agents/test-agent.ts` | Empty file (0 lines) |
| `apps/website/src/app/health.test.ts` | Minimal placeholder |

### 1.3 Orphaned/Duplicate Directories

| Directory Path | Justification |
|----------------|---------------|
| `apps-cloud-ai/` | Orphaned duplicate of apps/cloud-ai with empty files |
| `StuardAI/` | Empty directory |
| `dist/` | Root-level dist folder (should be app-specific) |

---

## 2. MONOLITHIC FILES REQUIRING DECOMPOSITION

### 2.1 Critical Priority (1000+ lines)

#### `apps/cloud-ai/src/tools/device-tools.ts` (2,234 lines)
**Problem**: Single file contains 50+ tool definitions mixing GUI, filesystem, memory, system, and media operations.

**Proposed Split**:
```
apps/cloud-ai/src/tools/
  device/
    index.ts              # Re-exports all device tools
    gui-tools.ts          # click, scroll, drag, hotkey operations (~200 lines)
    screen-tools.ts       # screenshot, OCR, visual tools (~150 lines)
    fs-tools.ts           # File system operations (~250 lines)
    system-tools.ts       # Commands, applications, process management (~300 lines)
    memory-tools.ts       # Memory retrieval, embeddings (~400 lines)
    media-tools.ts        # Audio, video, recording (~350 lines)
    knowledge-tools.ts    # Knowledge graph tools (~300 lines)
    conversation-tools.ts # Conversation/space management (~200 lines)
```

#### `apps/desktop/src/main/tool-router.ts` (1,734 lines)
**Problem**: Mixes tool routing, variable management, workflow execution, and cloud tool handlers.

**Proposed Split**:
```
apps/desktop/src/main/routing/
  index.ts               # Main router exports
  registry.ts            # TOOL_REGISTRY and kind definitions (~100 lines)
  variables.ts           # Variable system (get/set/persist) (~150 lines)
  agent-client.ts        # Python agent WebSocket client (~200 lines)
  cloud-client.ts        # Cloud AI HTTP client (~150 lines)
  electron-handlers.ts   # Electron-native tool handlers (~400 lines)
  orchestration.ts       # Sequential/parallel/loop execution (~200 lines)
  types.ts               # Shared types and interfaces
```

#### `apps/desktop/src/renderer/components/SpacesSidebar.tsx` (1,190 lines)
**Problem**: Massive UI component handling spaces, conversations, navigation, and state.

**Proposed Split**:
```
apps/desktop/src/renderer/components/sidebar/
  index.tsx              # Main SpacesSidebar component (~150 lines)
  SpaceList.tsx          # List of spaces (~150 lines)
  SpaceItem.tsx          # Individual space card (~100 lines)
  ConversationList.tsx   # Conversation list within space (~200 lines)
  ConversationItem.tsx   # Individual conversation row (~100 lines)
  SidebarHeader.tsx      # Header with actions (~100 lines)
  NewSpaceDialog.tsx     # Space creation modal (~150 lines)
  hooks/
    useSpaces.ts         # Space data management
    useConversations.ts  # Conversation state
```

#### `apps/desktop/src/main/stuards-engine.ts` (1,141 lines)
**Problem**: Engine v1 coexists with v2, mixing streaming, tool execution, and state management.

**Recommendation**: This file appears to be legacy alongside `stuards-engine-v2.ts`. Evaluate whether v1 can be deprecated and removed. If both are needed:
```
apps/desktop/src/main/engine/
  index.ts               # Engine selector/exports
  v2/
    runner.ts            # Main execution loop
    streaming.ts         # Stream handling
    tool-executor.ts     # Tool dispatch
    state.ts             # State management
```

#### `apps/desktop/src/renderer/dashboard.tsx` (1,112 lines)
**Problem**: Dashboard page with inline component definitions and mixed concerns.

**Proposed Split**:
```
apps/desktop/src/renderer/pages/
  Dashboard/
    index.tsx            # Main dashboard page (~200 lines)
    DashboardHeader.tsx  # Top navigation
    QuickActions.tsx     # Action buttons
    RecentActivity.tsx   # Activity feed
    StatsPanel.tsx       # Usage statistics
    hooks/
      useDashboardData.ts
```

### 2.2 High Priority (800-1000 lines)

#### `apps/cloud-ai/src/memory/conversations.ts` (1,012 lines)
**Proposed Split**:
```
apps/cloud-ai/src/memory/
  conversations/
    index.ts             # Re-exports
    types.ts             # Interfaces and schemas
    storage.ts           # CRUD operations
    search.ts            # Semantic search
    embeddings.ts        # Vector operations
    sync.ts              # Cloud sync logic
```

#### `apps/desktop/src/main/windows/window.ts` (1,006 lines)
**Proposed Split**:
```
apps/desktop/src/main/windows/
  window/
    index.ts             # Main window manager
    creation.ts          # Window creation logic
    positioning.ts       # Window placement/sizing
    events.ts            # IPC and lifecycle events
    overlay.ts           # Overlay window handling
```

#### `apps/cloud-ai/src/tools/workflow.ts` (973 lines)
**Proposed Split**:
```
apps/cloud-ai/src/tools/workflow/
  index.ts               # Tool exports
  execution.ts           # Workflow runner
  validation.ts          # Schema validation
  marketplace.ts         # Marketplace operations
  types.ts               # Workflow types
```

### 2.3 Medium Priority (700-800 lines)

| File | Lines | Recommendation |
|------|-------|----------------|
| `apps/cloud-ai/src/server.ts` | 805 | Split into `connection.ts`, `routing.ts`, `handlers.ts` |
| `apps/agent/app/tools/media.py` | 1,395 | Split into `audio.py`, `video.py`, `recording.py`, `playback.py` |
| `apps/agent/app/tools/media_bus.py` | 895 | Split by bus type: `audio_bus.py`, `video_bus.py` |
| `apps/agent/app/tools/system.py` | 748 | Split: `commands.py`, `processes.py`, `python_runtime.py` |

---

## 3. PROPOSED FOLDER STRUCTURE

### 3.1 Agent (Python)
```
apps/agent/
  app/
    __init__.py
    main.py                    # FastAPI app entry (slim)
    config.py
    logging_config.py
    connections.py

    api/                       # NEW: API layer
      __init__.py
      routes.py                # Route definitions
      middleware.py            # CORS, auth middleware
      websocket.py             # WS handling extracted from main.py

    tools/                     # Tool implementations (reorganize)
      __init__.py
      dispatch.py              # Tool dispatcher

      gui/                     # NEW: GUI tool group
        __init__.py
        mouse.py
        keyboard.py
        screen.py

      system/                  # NEW: System tool group
        __init__.py
        commands.py
        processes.py
        runtime.py             # Python/Node runtime

      filesystem/              # NEW: Filesystem tools
        __init__.py
        operations.py
        watcher.py

      memory/                  # NEW: Memory tools (consolidate)
        __init__.py
        knowledge.py
        conversations.py
        context.py

      media/                   # NEW: Media tools
        __init__.py
        audio.py
        video.py
        recording.py

      automation/              # NEW: Workflow/automation
        __init__.py
        workflows.py
        tasks.py
        loops.py

    storage/                   # Keep as-is, well organized
      __init__.py
      cloud_sync.py
      crypto.py
      file_index_db.py
      knowledge_db.py
      memory_db.py
      tasks_db.py

  tests/                       # Improve test structure
    __init__.py
    conftest.py                # Shared fixtures
    unit/
      test_tools_gui.py
      test_tools_system.py
      ...
    integration/
      test_websocket.py
      test_cloud_sync.py
```

### 3.2 Cloud-AI (TypeScript)
```
apps/cloud-ai/
  src/
    index.ts                   # Entry point (new, slim)

    server/                    # Server infrastructure
      index.ts
      http/
        app.ts
        routes.ts              # Route mounting
        middleware.ts          # Auth, CORS, logging
      socket/
        manager.ts
        connection.ts          # WS connection handling
      streaming/
        agent-runner.ts
        response-builder.ts

    agents/                    # AI agents
      index.ts
      stuard-agent.ts
      workflow-agent.ts
      headless-agent.ts
      prompts/                 # NEW: Extract prompts
        workflow-prompts.md
        stuard-prompts.md

    tools/                     # Tool definitions (reorganize)
      index.ts
      bridge.ts                # Client bridge
      definitions.ts           # Shared schemas

      device/                  # NEW: Device tools group
        index.ts
        gui.ts
        screen.ts
        filesystem.ts
        system.ts

      memory/                  # NEW: Memory tools group
        index.ts
        retrieval.ts
        embeddings.ts
        conversations.ts

      integrations/            # External service tools
        index.ts
        google.ts
        github.ts
        outlook.ts
        youtube.ts
        perplexity.ts

      ai/                      # AI-specific tools
        index.ts
        inference.ts
        media-analysis.ts
        tts.ts

      workflow/                # Workflow tools
        index.ts
        execution.ts
        marketplace.ts

    routes/                    # HTTP route handlers (keep)
      index.ts
      inference.ts
      memory-routes.ts
      knowledge.ts
      speech.ts
      calendar.ts
      integrations/
        ...

    knowledge/                 # Knowledge system (keep)
      index.ts
      ingestion.ts
      retrieval.ts

    memory/                    # Memory system
      index.ts
      conversations.ts

    services/                  # Business logic services
      index.ts
      file-indexing.ts
      pricing.ts               # Move from root

    utils/                     # Utilities (keep)
      config.ts
      embeddings.ts
      logger.ts
      messages.ts
      sanitize.ts
      gcs.ts

    db/                        # NEW: Database layer
      index.ts
      supabase.ts              # Move from root

    types/                     # NEW: Shared types
      index.ts
      agent.ts
      tool.ts
      message.ts
```

### 3.3 Desktop (Electron/React)
```
apps/desktop/
  src/
    main/
      index.ts                 # Electron main entry
      app.ts                   # App lifecycle
      env.ts

      ipc/                     # IPC handlers
        index.ts
        handlers.ts            # Consolidated from ipc.ts
        speech.ts

      windows/                 # Window management
        index.ts
        manager.ts             # Renamed from window.ts
        overlay.ts

      routing/                 # NEW: Tool routing
        index.ts
        registry.ts
        variables.ts
        agent-client.ts
        cloud-client.ts
        electron-handlers.ts

      engine/                  # AI engine
        index.ts
        runner.ts              # Consolidated engine
        streaming.ts

      workflows/               # Workflow management
        index.ts
        converter.ts
        executor.ts            # Renamed from workflows.ts

      services/
        index.ts
        agent.ts
        updates.ts

      integrations/
        outlook/
          index.ts
          outlook.ts

      daemon/
        manager.ts
        worker.ts

      utils/
        files.ts
        logger.ts
        pkce.ts

    preload/
      index.ts

    renderer/
      index.html
      main.tsx

      pages/                   # NEW: Page components
        Dashboard/
          index.tsx
          components/
        Workflows/
          index.tsx
          components/
        Settings/
          index.tsx

      components/              # Shared components
        common/                # NEW: Generic UI
          Button.tsx
          Modal.tsx
          ...
        chat/                  # Chat-related
          ChatView.tsx
          MessageBubble.tsx
          MessageList.tsx
          InputArea.tsx
        sidebar/               # NEW: Sidebar components
          SpacesSidebar/
            index.tsx
            SpaceList.tsx
            ConversationList.tsx
          FileNavigator.tsx
        terminal/
          TerminalPanel.tsx
          AnsiText.tsx
        onboarding/
          ...
        memories/
          ...

      hooks/                   # React hooks
        useAgent.ts
        usePreferences.ts
        usePlannerData.ts
        ...

      workflows/               # Workflow builder
        builder/
        components/
        hooks/
        utils/
        constants/
        types.ts

      lib/
        posthog.ts
        supabaseClient.ts

      utils/
        text.ts
        theme.ts

      types/
        ...
```

### 3.4 Ops-Console
The ops-console is minimal but well-structured. Keep as-is but:
- Extract the 30KB `page.tsx` into proper components

```
apps/ops-console/
  src/
    app/
      page.tsx              # Slim entry
      layout.tsx
      globals.css
      api/
        actions/route.ts
        status/route.ts
    components/              # NEW
      Dashboard.tsx
      StatusPanel.tsx
      ActionButtons.tsx
      MetricsDisplay.tsx
```

### 3.5 Website
Website is well-structured. Minor improvements:
```
apps/website/
  src/
    app/                     # Keep Next.js app router structure
    components/
      common/                # NEW: Shared base components
      layout/
      sections/
      blog/
      ui/
      providers/
    hooks/
    lib/
    types/                   # NEW: Add types folder
```

---

## 4. DUPLICATE CODE PATTERNS

### 4.1 Tool Definitions Duplication
**Problem**: Tools are defined in multiple places:
- `apps/cloud-ai/src/tools/device-tools.ts` - Cloud definitions
- `apps/desktop/src/main/tool-router.ts` - Desktop registry
- `apps/agent/app/tools/dispatch.py` - Agent handlers

**Solution**: Create a shared tool schema package:
```
packages/tool-schemas/
  src/
    index.ts
    gui.ts
    filesystem.ts
    memory.ts
    system.ts
```

### 4.2 Supabase Client Duplication
**Problem**: Supabase clients created in:
- `apps/cloud-ai/src/supabase.ts`
- `apps/desktop/src/renderer/lib/supabaseClient.ts`
- `apps/website/src/lib/supabaseClient.ts`

**Solution**: Create shared package:
```
packages/supabase-client/
  src/
    index.ts
    client.ts
    types.ts
```

### 4.3 Logger Duplication
**Problem**: Logger implementations in:
- `apps/cloud-ai/src/utils/logger.ts`
- `apps/desktop/src/main/utils/logger.ts`
- `apps/agent/app/logging_config.py`

**Solution**: Standardize logging approach in shared package.

---

## 5. PRODUCTION STANDARDS GAPS

### 5.1 Missing Configuration
- [ ] No `.env.example` files documenting required environment variables
- [ ] No runtime config validation (should use Zod/Pydantic at startup)
- [ ] Environment-specific configs mixed with code

### 5.2 Missing Documentation
- [ ] Root README.md is only 11 bytes
- [ ] No API documentation
- [ ] No architecture decision records (ADRs)
- [ ] No contribution guidelines

### 5.3 Testing Infrastructure
- [ ] No test coverage configuration
- [ ] Most test files are placeholders
- [ ] No integration test infrastructure
- [ ] No E2E tests for desktop app

### 5.4 Build/Deploy Improvements
- [ ] Add proper `.gitignore` for build artifacts in each app
- [ ] Separate development dependencies from production
- [ ] Add health check endpoints documentation

---

## 6. MIGRATION PHASES

### Phase 1: Cleanup (Low Risk)
**Scope**: Delete all identified backup/temporary files and empty directories

```bash
# Files to delete
rm apps/desktop/src/renderer/workflows.tsx.backup
rm apps/desktop/src/renderer/workflows.tsx.old-backup
rm apps/desktop/src/renderer/workflows-manual-builder.backup.tsx
rm apps/desktop/src/main/Untitled-1.txt
rm url_test.js
rm verify_migration.py
rm apps/agent/verify_modify.py
rm test_ui_demo.json
rm corrected_countdown.json
rm apps/agent/revert_check.txt
rm -rf apps/agent/%TEMP%/
rm apps/agent/tests/test_main.py  # Replace with real tests
rm apps/cloud-ai/src/server.test.ts  # Replace with real tests
rm apps/cloud-ai/src/agents/test-agent.ts
rm -rf apps-cloud-ai/
rm -rf StuardAI/
rm -rf dist/
```

### Phase 2: Tool Reorganization (Medium Risk)
**Scope**: Decompose large tool files

1. Split `device-tools.ts` into domain modules
2. Split `tool-router.ts` into focused modules
3. Update imports throughout codebase
4. Run full test suite after each split

### Phase 3: Component Restructuring (Medium Risk)
**Scope**: Break up large UI components

1. Split `SpacesSidebar.tsx` into component folder
2. Split `dashboard.tsx` into page structure
3. Establish component patterns

### Phase 4: Server Refactoring (Higher Risk)
**Scope**: Decompose server.ts and engine files

1. Extract WebSocket handling
2. Separate concerns in streaming
3. Evaluate engine v1 deprecation

### Phase 5: Shared Packages (Architecture)
**Scope**: Create shared packages

1. Create tool-schemas package
2. Create supabase-client package
3. Update all imports

---

## 7. GIT STRATEGY

```
main (protected)
  |
  +-- feature/cleanup-phase-1
  |     |-- Remove backup files
  |     |-- Remove empty tests
  |     +-- Remove orphaned directories
  |
  +-- feature/refactor-tools
  |     |-- Split device-tools.ts
  |     |-- Split tool-router.ts
  |     +-- Update imports
  |
  +-- feature/refactor-components
  |     |-- Split SpacesSidebar
  |     |-- Split dashboard
  |     +-- Establish patterns
  |
  +-- feature/refactor-server
        |-- Extract connection handling
        |-- Separate streaming
        +-- Deprecate engine v1
```

**Commit Guidelines**:
- Atomic commits per file/module split
- Include "BREAKING" prefix if APIs change
- Reference issue/ticket numbers
- Run tests before each commit

---

## 8. TESTING DURING MIGRATION

1. **Before any changes**: Capture current behavior
   - Record API responses
   - Document current file structure
   - Note any existing test outputs

2. **After each split**:
   - Verify imports resolve correctly
   - Run existing tests
   - Manually test affected features
   - Check TypeScript compilation

3. **Integration verification**:
   - Agent <-> Cloud-AI communication
   - Desktop <-> Agent WebSocket
   - Desktop <-> Cloud-AI HTTP

---

## 9. PRIORITY SUMMARY

| Priority | Task | Impact | Effort |
|----------|------|--------|--------|
| 1 | Delete backup/temp files | Low risk, immediate | 1 hour |
| 2 | Split device-tools.ts | High impact on maintainability | 1 day |
| 3 | Split tool-router.ts | High impact on clarity | 1 day |
| 4 | Split SpacesSidebar.tsx | Medium impact on UI dev | 4 hours |
| 5 | Clean up test files | Improves CI/CD trust | 2 hours |
| 6 | Split server.ts | Enables easier debugging | 1 day |
| 7 | Create shared packages | Long-term maintainability | 3-5 days |
| 8 | Add documentation | Team scalability | Ongoing |

---

This plan provides a clear roadmap from the current state to a production-ready, enterprise-grade codebase. Each phase is designed to be independently deployable while minimizing risk to existing functionality.
