import { z } from 'zod';
import { makeLocalTool } from './shared';

export const canvas_manager = makeLocalTool(
  'canvas_manager',
  'Manage overlay canvas containers (create, update, delete, list, show/hide, focus, clear). Templates include notes (input) and info (display).',
  z.object({
    action: z.enum(['create', 'update', 'delete', 'list', 'show', 'hide', 'focus', 'clear']).default('create'),
    id: z.string().optional(),
    template: z.enum(['notes', 'info']).optional(),
    title: z.string().optional(),
    position: z.object({ x: z.number().int(), y: z.number().int() }).partial().optional(),
    size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).partial().optional(),
    content: z.string().optional(),
    data: z.any().optional(),
  }),
  z.any(),
);
