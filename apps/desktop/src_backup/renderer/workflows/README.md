# Workflows Module Structure

This directory contains the refactored workflows UI, broken down into modular, maintainable components.

## Directory Structure

```
workflows/
├── README.md                     # This file
├── types.ts                      # TypeScript type definitions
├── hooks/
│   └── useWorkflows.ts          # Hook for fetching workflow data
├── utils/
│   └── conversions.ts           # Spec ↔ Designer model conversion utilities
├── components/
│   ├── index.ts                 # Component exports
│   ├── SectionButton.tsx        # Tab/section button component
│   ├── Palette.tsx              # Draggable tool palette
│   ├── ArgEditor.tsx            # Key-value argument editor with JSON mode
│   ├── NodeCard.tsx             # Workflow node visual card
│   ├── ShortcutInput.tsx        # Keyboard shortcut capture input
│   ├── ScheduleSimpleEditor.tsx # Cron schedule editor with presets
│   ├── ImportModal.tsx          # Workflow import modal dialog
│   ├── WorkflowHeader.tsx       # Main header with branding and actions
│   ├── WorkflowList.tsx         # Sidebar workflow list
│   ├── WorkflowToolbar.tsx      # Toolbar with save/run/deploy actions
│   ├── WebhookURLs.tsx          # Webhook URL display and copy
│   └── WorkflowInspector.tsx    # Right panel for editing nodes/workflow
└── constants/
    └── paletteItems.ts          # Tool palette item definitions
```

## Component Responsibilities

### Core Components

- **WorkflowHeader**: Top navigation bar with branding, tabs, and primary actions (New flow, Import, Create with AI)
- **WorkflowList**: Left sidebar showing all workflows with selection state
- **WorkflowToolbar**: Action bar for the selected workflow (Save, Run, Stop, Delete, Deploy)
- **WorkflowInspector**: Right panel for editing workflow metadata and selected nodes

### UI Components

- **SectionButton**: Reusable tab/section button with active state
- **Palette**: Draggable tool palette with integration status indicators
- **ArgEditor**: Flexible argument editor supporting strings, numbers, booleans, and JSON
- **NodeCard**: Visual representation of workflow nodes on the canvas
- **WebhookURLs**: Display and copy webhook URLs (local and cloud)
- **ImportModal**: Modal dialog for importing Stuard workflow definitions

### Specialized Inputs

- **ShortcutInput**: Captures keyboard shortcuts (e.g., Ctrl+Alt+K)
- **ScheduleSimpleEditor**: User-friendly cron schedule editor with presets

## Types

All TypeScript interfaces are defined in `types.ts`:

- `WorkflowItem`: Workflow list item
- `DesignerModel`: Complete designer state model
- `DesignerNode`: Workflow step/node
- `DesignerTrigger`: Workflow trigger
- `DesignerWire`: Connection between nodes
- `StuardSpec`: Stuard workflow specification format
- `PaletteItem`: Tool palette item definition
- `LogEntry` / `StuardLogEntry`: Log message types

## Utilities

### Conversion Functions (`utils/conversions.ts`)

- `specToDesignerModel(spec)`: Converts Stuard spec to designer model
- `designerModelToStuardSpec(model)`: Converts designer model to Stuard spec

These handle the bidirectional conversion between the authoring DSL (StuardSpec) and the visual designer format (DesignerModel).

## Hooks

### useWorkflows (`hooks/useWorkflows.ts`)

Manages workflow list state:
- Fetches workflows from desktop API
- Provides loading state
- Exposes refresh function

## Constants

### Palette Items (`constants/paletteItems.ts`)

Defines all available tools organized by category:
- `TRIGGER_ITEMS`: File watch, schedule, webhook, hotkey, etc.
- `LOCAL_TOOL_ITEMS`: System commands, file operations, UI automation
- `CLOUD_TOOL_ITEMS`: AI vision, parallel/sequential execution
- `INTEGRATION_ITEMS`: Google Drive, Gmail, Outlook, etc.

## Usage Example

```tsx
import { useWorkflows } from "./workflows/hooks/useWorkflows";
import { WorkflowHeader, WorkflowList } from "./workflows/components";
import { TRIGGER_ITEMS } from "./workflows/constants/paletteItems";

function MyWorkflowApp() {
  const { items, loading, refresh } = useWorkflows();
  
  return (
    <div>
      <WorkflowHeader
        tab="flows"
        setTab={setTab}
        hasDesktopAPI={true}
        onNewFlow={handleNewFlow}
        onImport={handleImport}
        onCreateWithAI={handleCreateWithAI}
        onOpenDashboard={handleOpenDashboard}
      />
      <WorkflowList
        items={items}
        loading={loading}
        selectedId={selectedId}
        onSelect={handleSelect}
      />
    </div>
  );
}
```

## Benefits of This Structure

1. **Modularity**: Each component has a single responsibility
2. **Reusability**: Components can be used in other parts of the app
3. **Testability**: Individual units can be tested in isolation
4. **Maintainability**: Easy to locate and modify specific functionality
5. **Type Safety**: Centralized type definitions with proper TypeScript
6. **Scalability**: Easy to add new components or modify existing ones

## Next Steps

To fully integrate these components into the main `workflows.tsx`:

1. Import the new components
2. Replace inline JSX with component calls
3. Pass appropriate props to each component
4. Remove any remaining inline component definitions
5. Test the refactored application
