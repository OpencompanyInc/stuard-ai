import { z } from 'zod';
import { makeLocalTool } from './shared';

export const list_open_windows = makeLocalTool(
  'list_open_windows',
  'List all open window titles and properties',
  z.object({}),
  z.object({ windows: z.array(z.object({ title: z.string(), minimized: z.boolean().optional(), maximized: z.boolean().optional() })) }),
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
