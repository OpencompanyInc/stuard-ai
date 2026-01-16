import { z } from 'zod';
import { makeLocalTool } from './shared';

export const get_mouse_position = makeLocalTool(
  'get_mouse_position',
  'Get the current mouse cursor position on screen',
  z.object({}),
  z.object({ ok: z.boolean(), x: z.number(), y: z.number() }),
);

export const click_at_coordinates = makeLocalTool(
  'click_at_coordinates',
  'Click mouse at specific screen coordinates',
  z.object({ x: z.number(), y: z.number(), button: z.enum(['left', 'right', 'middle']).default('left') }),
);

export const double_click_at_coordinates = makeLocalTool(
  'double_click_at_coordinates',
  'Double-click at specific coordinates',
  z.object({ x: z.number(), y: z.number(), button: z.enum(['left', 'right', 'middle']).default('left') }),
);

export const type_text = makeLocalTool(
  'type_text',
  'Type text at cursor position (clipboard fallback for special characters)',
  z.object({ text: z.string(), useClipboardFallback: z.boolean().optional() }),
);

export const send_hotkey = makeLocalTool(
  'send_hotkey',
  'Send keyboard hotkey combinations',
  z.object({ keys: z.array(z.string()).min(1).describe('e.g., ["Control","C"]') }),
);

export const scroll = makeLocalTool(
  'scroll',
  'Mouse wheel scrolling',
  z.object({ deltaY: z.number(), deltaX: z.number().optional(), speed: z.number().optional() }),
);

export const drag_and_drop = makeLocalTool(
  'drag_and_drop',
  'Drag from one coordinate to another',
  z.object({ fromX: z.number(), fromY: z.number(), toX: z.number(), toY: z.number() }),
);
