import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, hasClientBridge } from './bridge';
import { anyJsonValue } from './schema-utils';

/**
 * GenUI Tools - Interactive UI Components for Human-in-the-Loop AI
 *
 * Five focused tools for blocking user-input patterns that chat_ui cannot
 * easily replicate. Everything else (tables, charts, info panels, JSON,
 * file trees, etc.) should use chat_ui instead.
 */

async function executeGenUI(toolName: string, args: any, blocking: boolean = true): Promise<any> {
  if (hasClientBridge()) {
    const timeout = blocking ? 300000 : 5000;
    try {
      return await execLocalTool(toolName, args, undefined, timeout, undefined);
    } catch (err: any) {
      return { ok: false, error: err.message || 'GenUI tool failed' };
    }
  }
  console.warn(`[GenUI] No client bridge for ${toolName}, returning mock response`);
  return blocking ? { ok: false, error: 'No client connected' } : { displayed: true };
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
  execute: async (args) => executeGenUI('ask_confirmation', args, true),
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
  execute: async (args) => executeGenUI('show_choices', args, true),
});

export const requestFiles = createTool({
  id: 'request_files',
  description: 'Show a file dropzone for user to upload/select files. Use when you need to analyze documents, images, or any files.',
  inputSchema: z.object({
    label: z.string().optional().default('Drop files here').describe('Instruction text'),
    accept: z.string().optional().describe('Accepted file types (e.g., ".pdf,.png,.jpg")'),
    maxFiles: z.number().optional().default(5).describe('Maximum number of files'),
  }),
  execute: async (args) => executeGenUI('request_files', args, true),
});

export const showFiles = createTool({
  id: 'show_files',
  description: 'Display a file/folder tree structure. Use when showing project structure or directory contents.',
  inputSchema: z.object({
    title: z.string().optional().describe('Tree title'),
    nodes: z.array(z.object({
      name: z.string(),
      type: z.enum(['file', 'folder']),
      children: z.array(anyJsonValue).optional(),
    }).passthrough()).describe('File tree nodes: { name, type: "file"|"folder", children?: [...] }'),
  }),
  execute: async (args) => executeGenUI('show_files', args, false),
});

export const showForm = createTool({
  id: 'show_form',
  description: 'Display a multi-page form/wizard to collect structured user input. Supports text, textarea, select, multiselect, toggle, number, slider, and date fields. Use for onboarding, settings, scheduling, or any multi-field input. Blocks until user submits or cancels.',
  inputSchema: z.object({
    title: z.string().describe('Form title shown at the top'),
    description: z.string().optional().describe('Short description shown below the title'),
    pages: z.array(z.object({
      id: z.string().describe('Unique page ID'),
      title: z.string().describe('Page title'),
      description: z.string().optional().describe('Page description'),
      fields: z.array(z.object({
        id: z.string().describe('Unique field ID — this becomes the key in the submitted data'),
        type: z.enum(['select', 'multiselect', 'text', 'textarea', 'toggle', 'number', 'slider', 'date']).describe('Field type. Use date for scheduling/deadline inputs.'),
        label: z.string().describe('Field label'),
        description: z.string().optional().describe('Help text below the label'),
        placeholder: z.string().optional().describe('Placeholder text for text/textarea fields'),
        options: z.array(z.object({
          id: z.string().describe('Option value returned when selected'),
          label: z.string().describe('Display label'),
          sublabel: z.string().optional().describe('Secondary text'),
        })).optional().describe('Options for select/multiselect fields'),
        required: z.boolean().optional().describe('Whether the field must be filled before proceeding'),
        defaultValue: anyJsonValue.optional().describe('Default value for the field'),
        min: z.number().optional().describe('Minimum value for number/slider'),
        max: z.number().optional().describe('Maximum value for number/slider'),
        step: z.number().optional().describe('Step increment for number/slider'),
        minDate: z.string().optional().describe('Earliest selectable date for date fields (ISO format)'),
        maxDate: z.string().optional().describe('Latest selectable date for date fields (ISO format)'),
      })).describe('Fields to render on this page'),
    })).describe('Form pages — use multiple pages for wizard-style flows, or a single page for simple forms'),
    submitLabel: z.string().optional().default('Submit').describe('Text for the submit button'),
    cancelLabel: z.string().optional().default('Cancel').describe('Text for the cancel button'),
    showProgress: z.boolean().optional().default(true).describe('Show progress indicator for multi-page forms'),
  }),
  execute: async (args) => executeGenUI('show_form', args, true),
});

export const genuiTools = {
  ask_confirmation: askConfirmation,
  show_choices: showChoices,
  request_files: requestFiles,
  show_files: showFiles,
  show_form: showForm,
};
