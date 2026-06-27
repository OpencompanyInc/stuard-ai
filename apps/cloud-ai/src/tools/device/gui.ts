import { z } from 'zod';
import { makeLocalTool } from './shared';

export const get_mouse_position = makeLocalTool(
  'get_mouse_position',
  'Get the current mouse cursor position on screen',
  z.object({}),
  z.object({ ok: z.boolean(), x: z.number(), y: z.number() }),
);

export const move_cursor = makeLocalTool(
  'move_cursor',
  'Move the mouse cursor to specific screen coordinates',
  z.object({ 
    x: z.number().describe('X coordinate'), 
    y: z.number().describe('Y coordinate'),
    duration: z.number().optional().describe('Duration in seconds for smooth movement'),
  }),
  z.object({ ok: z.boolean(), x: z.number(), y: z.number() }),
);

export const computer_use = makeLocalTool(
  'computer_use',
  'Perform GUI actions (mouse/keyboard) and optionally capture a screenshot. coordinate can be absolute pixels or normalized [0..1000, 0..1000].',
  z.object({
    action: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : v),
      z.enum([
      'key',
      'type',
      'mouse_move',
      'left_click',
      'left_click_drag',
      'right_click',
      'middle_click',
      'double_click',
      'scroll',
      'hscroll',
      'wait',
      'answer',
      'terminate',
      'click',
      'tap',
      'leftclick',
      'doubleclick',
      'rightclick',
      'middleclick',
      'mousemove',
      'move',
      'drag',
      'press',
      'hotkey',
      'shortcut',
      'type_text',
      'input',
      'write',
    ]),
    ),
    keys: z.array(z.string()).optional(),
    hotkey: z.string().optional(),
    key: z.string().optional(),
    text: z.string().optional(),
    answer: z.string().optional(),
    coordinate: z.array(z.number()).length(2).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    pixels: z.number().optional(),
    deltaY: z.number().optional(),
    delta: z.number().optional(),
    time: z.number().optional(),
    seconds: z.number().optional(),
    duration: z.number().optional(),
    status: z.enum(['success', 'failure']).optional(),
    result: z.enum(['success', 'failure']).optional(),
    monitorIndex: z.number().int().optional(),
    includeScreenshot: z.boolean().optional(),
    includeCursor: z.boolean().optional().default(true),
    returnDataUrl: z.boolean().optional(),
    imageQuality: z.number().int().min(1).max(95).optional(),
    imageMaxPixels: z.number().int().min(4096).optional(),
    mouseMoveDuration: z.number().optional(),
    dragDuration: z.number().optional(),
    useClipboardFallback: z.boolean().optional(),
  }),
  z.object({
    ok: z.boolean(),
    action: z.string().optional(),
    filePath: z.string().optional(),
    screenshot: z.string().optional(),
    cursor: z.object({ x: z.number(), y: z.number() }).optional(),
    display: z.object({ width: z.number(), height: z.number() }).optional(),
    text: z.string().optional(),
  }),
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
  z.object({ keys: z.array(z.string()).min(1).describe('e.g., ["Control","C"]'), count: z.number().optional().describe('Number of times to repeat (default 1)'), delay: z.number().optional().describe('Delay in seconds between repeats (default 0)') }),
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
