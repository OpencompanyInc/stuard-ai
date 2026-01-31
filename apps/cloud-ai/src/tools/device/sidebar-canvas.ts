import { z } from 'zod';
import { makeLocalTool } from './shared';

/**
 * Canvas Document Tools
 * These tools allow AI to read and write to the sidebar canvas documents.
 * The canvas is a scratchpad where users can type notes and AI can read/modify content.
 */

export const canvas_list = makeLocalTool(
  'canvas_list',
  'List all canvas documents. Returns document IDs, titles, and metadata.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    documents: z.array(z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })).optional(),
  }),
);

export const canvas_read = makeLocalTool(
  'canvas_read',
  'Read content from a canvas document. If no documentId is provided, reads the most recent/active document.',
  z.object({
    documentId: z.string().optional().describe('ID of the document to read. If omitted, reads the most recent document.'),
  }),
  z.object({
    ok: z.boolean(),
    document: z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }).nullable().optional(),
  }),
);

export const canvas_write = makeLocalTool(
  'canvas_write',
  `Write or modify content in a canvas document. Supports multiple actions:
- replace: Replace all content with new content
- append: Add content to the end
- insert: Insert content at a specific position

The canvas will update in real-time as you write.`,
  z.object({
    documentId: z.string().optional().describe('ID of the document to write to. If omitted, writes to the most recent document.'),
    content: z.string().optional().describe('The content to write'),
    title: z.string().optional().describe('New title for the document'),
    action: z.enum(['replace', 'append', 'insert']).default('replace').describe('How to apply the content'),
    position: z.number().int().optional().describe('Position for insert action (0-indexed character position)'),
  }),
  z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
);

export const canvas_create = makeLocalTool(
  'canvas_create',
  'Create a new canvas document with optional initial content.',
  z.object({
    title: z.string().optional().default('Untitled').describe('Title for the new document'),
    content: z.string().optional().default('').describe('Initial content for the document'),
  }),
  z.object({
    ok: z.boolean(),
    documentId: z.string().optional(),
    error: z.string().optional(),
  }),
);

export const canvas_delete = makeLocalTool(
  'canvas_delete',
  'Delete a canvas document by ID.',
  z.object({
    documentId: z.string().describe('ID of the document to delete'),
  }),
  z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
);

// Backward compatibility aliases
export const sidebar_canvas_list = canvas_list;
export const sidebar_canvas_read = canvas_read;
export const sidebar_canvas_write = canvas_write;
export const sidebar_canvas_create = canvas_create;
export const sidebar_canvas_delete = canvas_delete;
