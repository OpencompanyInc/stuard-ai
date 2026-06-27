import { z } from 'zod';
import { makeLocalTool } from './shared';

export const list_open_windows = makeLocalTool(
  'list_open_windows',
  'List all open window titles and properties',
  z.object({}),
  z.object({
    windows: z.array(z.object({
      id: z.number().optional(),
      title: z.string(),
      minimized: z.boolean().optional(),
      maximized: z.boolean().optional(),
      bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
    }))
  }),
);

export const bring_window_to_foreground = makeLocalTool(
  'bring_window_to_foreground',
  'Activate and focus a window',
  z.object({ title: z.string() }),
);

export const get_window_info = makeLocalTool(
  'get_window_info',
  'Get details about a specific window',
  z.object({ title: z.string() }),
  z.object({ bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }) }),
);

export const smart_bring_window_to_foreground = makeLocalTool(
  'smart_bring_window_to_foreground',
  'Intelligently find and activate windows, launching apps if needed',
  z.object({ hint: z.string() }),
);

export const set_window_bounds = makeLocalTool(
  'set_window_bounds',
  'Move and/or resize a window',
  z.object({
    id: z.number().optional(),
    title: z.string().optional(),
    bounds: z.object({
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
    bringToTop: z.boolean().optional(),
  }),
  z.object({
    ok: z.boolean().optional(),
    bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
    error: z.string().optional(),
  }),
);
