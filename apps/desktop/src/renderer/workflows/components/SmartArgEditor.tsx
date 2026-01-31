/**
 * SmartArgEditor - Schema-aware argument editor with dropdowns, suggestions, and context-aware completions
 * 
 * This file re-exports from the modular smart-args folder for backwards compatibility.
 * The actual implementation is now split into separate files under ./smart-args/
 */

// Re-export everything from the modular structure
export { 
  SmartArgEditor, 
  ToolArgsEditor,
  type SmartArgEditorProps,
  type UpstreamNode 
} from './smart-args';

// Also export individual editors for direct use
export { 
  BooleanToggle,
  HotkeyEditor,
  SelectInput,
  TextInputWithVariables,
  CodeEditor,
  ArrayEditor,
  JsonEditor,
  DriveQueryEditor,
  ParallelStepsEditor,
  FilesEditor
} from './smart-args';
