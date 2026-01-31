import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge } from './bridge';

/**
 * GenUI Tools - Interactive UI Components for Human-in-the-Loop AI
 * 
 * These tools render interactive UI elements in the chat and block until
 * the user interacts with them. The result is returned to the AI.
 * 
 * The actual UI rendering happens on the client side. These tools use
 * execLocalTool from the bridge to emit tool_request and wait for the 
 * client to respond with tool_result.
 * 
 * Blocking tools (ask_confirmation, show_choices, etc.) wait for user input.
 * Non-blocking tools (show_table, show_info) render and continue immediately.
 */

// Helper to execute a GenUI tool through the bridge
async function executeGenUI(toolName: string, args: any, blocking: boolean = true): Promise<any> {
  // If we have a client bridge, use it
  if (hasClientBridge()) {
    // For blocking tools, wait for user response (timeout after 5 minutes)
    // For non-blocking, use a short timeout just to confirm rendering
    const timeout = blocking ? 300000 : 5000;
    try {
      const result = await execLocalTool(toolName, args, undefined, timeout, undefined);
      return result;
    } catch (err: any) {
      return { ok: false, error: err.message || 'GenUI tool failed' };
    }
  }
  
  // Fallback when no bridge (shouldn't happen in production)
  console.warn(`[GenUI] No client bridge for ${toolName}, returning mock response`);
  return blocking 
    ? { ok: false, error: 'No client connected' }
    : { displayed: true };
}

// === Decision & Input Components ===

export const askConfirmation = createTool({
  id: 'ask_confirmation',
  description: 'Show a confirmation dialog for destructive actions. ALWAYS use this before deleting files, killing processes, or any irreversible operation. Blocks until user responds.',
  inputSchema: z.object({
    title: z.string().optional().default('Confirm Action').describe('Dialog title'),
    message: z.string().describe('What are you asking confirmation for?'),
    confirmLabel: z.string().optional().default('Confirm').describe('Text for confirm button'),
    cancelLabel: z.string().optional().default('Cancel').describe('Text for cancel button'),
    variant: z.enum(['danger', 'warning', 'info']).optional().default('warning').describe('danger=red (delete), warning=amber (modify), info=blue (safe)'),
  }),
  execute: async (args) => {
    // This is a blocking tool - wait for user to confirm or cancel
    return executeGenUI('ask_confirmation', args, true);
  },
});

export const showChoices = createTool({
  id: 'show_choices',
  description: 'Present multiple choice options as selectable chips/cards. Use when user must pick one option from several (e.g., "Which microphone?", "Select format").',
  inputSchema: z.object({
    title: z.string().optional().describe('Question or prompt'),
    choices: z.array(z.object({
      id: z.string().describe('Unique ID returned when selected'),
      label: z.string().describe('Display text'),
      sublabel: z.string().optional().describe('Secondary text'),
    })).describe('The options to choose from'),
  }),
  execute: async (args) => {
    return executeGenUI('show_choices', args, true);
  },
});

export const pickDate = createTool({
  id: 'pick_date',
  description: 'Show a calendar date/time picker. Use for scheduling meetings, reminders, deadlines.',
  inputSchema: z.object({
    label: z.string().optional().describe('Label above the picker'),
    minDate: z.string().optional().describe('Earliest selectable date (ISO format)'),
  }),
  execute: async (args) => {
    return executeGenUI('pick_date', args, true);
  },
});

export const requestFiles = createTool({
  id: 'request_files',
  description: 'Show a file dropzone for user to upload/select files. Use when you need to analyze documents, images, or any files.',
  inputSchema: z.object({
    label: z.string().optional().default('Drop files here').describe('Instruction text'),
    accept: z.string().optional().describe('Accepted file types (e.g., ".pdf,.png,.jpg")'),
    maxFiles: z.number().optional().default(5).describe('Maximum number of files'),
  }),
  execute: async (args) => {
    return executeGenUI('request_files', args, true);
  },
});

// === Information Display (Non-blocking) ===

export const showTable = createTool({
  id: 'show_table',
  description: 'Display data in an interactive table with sorting/filtering. Use for file lists, search results, or any structured data.',
  inputSchema: z.object({
    title: z.string().optional().describe('Table title'),
    columns: z.array(z.object({
      key: z.string().describe('Data key'),
      header: z.string().describe('Column header text'),
      sortable: z.boolean().optional().describe('Enable sorting'),
      width: z.union([z.string(), z.number()]).optional(),
    })).describe('Column definitions'),
    data: z.array(z.record(z.string(), z.any())).describe('Array of row objects'),
    pageSize: z.number().optional().default(5).describe('Rows per page'),
  }),
  execute: async (args) => {
    // Non-blocking: display and continue
    return executeGenUI('show_table', args, false);
  },
});

export const showInfo = createTool({
  id: 'show_info',
  description: 'Display key-value pairs in a clean grid. Use for system specs, metadata, settings display.',
  inputSchema: z.object({
    title: z.string().optional().describe('Section title'),
    items: z.array(z.object({
      key: z.string().describe('Label'),
      value: z.string().describe('Value'),
      copyable: z.boolean().optional().describe('Show copy button'),
    })).describe('Key-value pairs to display'),
    columns: z.union([z.literal(1), z.literal(2)]).optional().default(2).describe('Grid columns'),
  }),
  execute: async (args) => {
    return executeGenUI('show_info', args, false);
  },
});

export const showDetails = createTool({
  id: 'show_details',
  description: 'Show expandable/collapsible sections. Use for error logs, long explanations, detailed info.',
  inputSchema: z.object({
    sections: z.array(z.object({
      id: z.string().describe('Section ID'),
      title: z.string().describe('Section header'),
      content: z.string().describe('Section content'),
      icon: z.enum(['file', 'terminal', 'error']).optional(),
      defaultOpen: z.boolean().optional(),
    })).describe('Sections to display'),
    allowMultiple: z.boolean().optional().default(false).describe('Allow multiple sections open'),
  }),
  execute: async (args) => {
    return executeGenUI('show_details', args, false);
  },
});

export const showFiles = createTool({
  id: 'show_files',
  description: 'Display a file/folder tree structure. Use when showing project structure or directory contents.',
  inputSchema: z.object({
    title: z.string().optional().describe('Tree title'),
    nodes: z.array(z.any()).describe('File tree nodes: { name, type: "file"|"folder", children?: [...] }'),
  }),
  execute: async (args) => {
    return executeGenUI('show_files', args, false);
  },
});

// === Developer Tools ===

export const showCommand = createTool({
  id: 'show_command',
  description: 'Display a terminal command block with optional Run button. Use when suggesting commands the user can execute.',
  inputSchema: z.object({
    command: z.string().describe('The command to display'),
    title: z.string().optional().describe('Terminal title'),
    output: z.string().optional().describe('Pre-filled output'),
    autoRun: z.boolean().optional().default(false).describe('Auto-execute on display'),
  }),
  execute: async (args) => {
    // Blocking: wait for user to run or dismiss
    return executeGenUI('show_command', args, true);
  },
});

export const showJson = createTool({
  id: 'show_json',
  description: 'Display JSON in a collapsible tree viewer. Use for API responses, config files, debugging.',
  inputSchema: z.object({
    title: z.string().optional().describe('Viewer title'),
    data: z.any().describe('JSON data to display'),
    expanded: z.boolean().optional().default(true).describe('Start expanded'),
    maxDepth: z.number().optional().default(5).describe('Max nesting depth'),
  }),
  execute: async (args) => {
    return executeGenUI('show_json', args, false);
  },
});

// === Media & Rich Content ===

export const showLink = createTool({
  id: 'show_link',
  description: 'Display a rich link preview card. Use for web search results or external resources.',
  inputSchema: z.object({
    url: z.string().describe('The URL'),
    title: z.string().optional().describe('Link title'),
    description: z.string().optional().describe('Link description'),
    image: z.string().optional().describe('Preview image URL'),
    siteName: z.string().optional().describe('Site name'),
  }),
  execute: async (args) => {
    return executeGenUI('show_link', args, false);
  },
});

export const showColors = createTool({
  id: 'show_colors',
  description: 'Display a color palette with clickable swatches. Use for design tasks or color suggestions.',
  inputSchema: z.object({
    title: z.string().optional().describe('Palette title'),
    colors: z.array(z.object({
      hex: z.string().describe('Hex color code (e.g., "#FF6B35")'),
      name: z.string().optional().describe('Color name'),
    })).describe('Colors to display'),
  }),
  execute: async (args) => {
    return executeGenUI('show_colors', args, false);
  },
});

export const showProgress = createTool({
  id: 'show_progress',
  description: 'Display a progress bar. Call repeatedly to update progress during long operations.',
  inputSchema: z.object({
    progress: z.number().min(0).max(100).describe('Progress percentage 0-100'),
    label: z.string().optional().describe('Progress label'),
    sublabel: z.string().optional().describe('Additional info (e.g., "50MB / 100MB")'),
    variant: z.enum(['download', 'upload', 'task']).optional().default('task'),
    status: z.enum(['active', 'complete', 'error', 'paused']).optional().default('active'),
    color: z.enum(['blue', 'emerald', 'amber', 'purple']).optional().default('blue'),
  }),
  execute: async (args) => {
    return executeGenUI('show_progress', args, false);
  },
});

// === Feedback Form ===

export const showFeedbackForm = createTool({
  id: 'show_feedback_form',
  description: 'Display an interactive feedback form for bug reports or feature requests. Blocks until user submits or cancels.',
  inputSchema: z.object({
    type: z.enum(['bug', 'feature']).optional().describe('Pre-selected feedback type'),
    title: z.string().optional().describe('Pre-filled title'),
    description: z.string().optional().describe('Pre-filled description'),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Pre-selected severity (bugs only)'),
    labels: z.array(z.string()).optional().describe('Pre-selected labels'),
    suggestedLabels: z.array(z.string()).optional().default(['ui', 'performance', 'workflow', 'bug', 'enhancement', 'documentation']).describe('Available label options'),
    allowScreenshot: z.boolean().optional().default(true).describe('Show screenshot capture button'),
  }),
  execute: async (args) => {
    return executeGenUI('show_feedback_form', args, true);
  },
});

// Export all GenUI tools
export const genuiTools = {
  ask_confirmation: askConfirmation,
  show_choices: showChoices,
  pick_date: pickDate,
  request_files: requestFiles,
  show_table: showTable,
  show_info: showInfo,
  show_details: showDetails,
  show_files: showFiles,
  show_command: showCommand,
  show_json: showJson,
  show_link: showLink,
  show_colors: showColors,
  show_progress: showProgress,
  show_feedback_form: showFeedbackForm,
};

