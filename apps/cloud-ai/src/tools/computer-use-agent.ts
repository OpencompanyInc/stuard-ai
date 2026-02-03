import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText } from 'ai';
import { Buffer } from 'node:buffer';
import { buildProviderModel } from '../utils/models';
import { execLocalTool, hasClientBridge, safeToolWrite } from './bridge';

function extractJson(text: string): any | null {
  try {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? String(fenced[1] || '').trim() : raw;

    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(candidate.slice(start, end + 1));
      }
      return null;
    }
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeModelAction(input: any): any {
  if (!input || typeof input !== 'object') return input;

  const obj: any = { ...input };
  const rawAction =
    (typeof obj.action === 'string' ? obj.action : '') ||
    (typeof obj.type === 'string' ? obj.type : '') ||
    (typeof obj.tool === 'string' ? obj.tool : '');

  const key = String(rawAction || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  const actionMap: Record<string, string> = {
    click: 'left_click',
    tap: 'left_click',
    leftclick: 'left_click',
    left_click: 'left_click',
    doubleclick: 'double_click',
    rightclick: 'right_click',
    middleclick: 'middle_click',
    move: 'mouse_move',
    mousemove: 'mouse_move',
    drag: 'left_click_drag',
    press: 'key',
    hotkey: 'key',
    shortcut: 'key',
    type_text: 'type',
    input: 'type',
    write: 'type',
  };

  const mappedAction = actionMap[key] || key;

  if (mappedAction) obj.action = mappedAction;

  if (obj.coordinate === undefined && typeof obj.x === 'number' && typeof obj.y === 'number') {
    obj.coordinate = [obj.x, obj.y];
  }

  if (obj.action === 'answer' && obj.text === undefined && typeof obj.answer === 'string') {
    obj.text = obj.answer;
  }

  if (obj.action === 'terminate' && obj.status === undefined && typeof obj.result === 'string') {
    obj.status = obj.result;
  }

  if (obj.action === 'key' && (!Array.isArray(obj.keys) || obj.keys.length === 0)) {
    if (typeof obj.hotkey === 'string') {
      obj.keys = obj.hotkey
        .split(/[+,\s]+/g)
        .map((s: string) => s.trim())
        .filter(Boolean);
    } else if (typeof obj.key === 'string') {
      obj.keys = [obj.key];
    } else if (typeof obj.keys === 'string') {
      obj.keys = obj.keys
        .split(/[+,\s]+/g)
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
  }

  if (obj.action === 'scroll' && obj.pixels === undefined) {
    if (typeof obj.deltaY === 'number') obj.pixels = obj.deltaY;
    if (typeof obj.delta === 'number') obj.pixels = obj.delta;
  }

  if (obj.action === 'wait' && obj.time === undefined) {
    if (typeof obj.seconds === 'number') obj.time = obj.seconds;
    if (typeof obj.duration === 'number') obj.time = obj.duration;
  }

  return obj;
}

const ComputerUseActionSchema = z.object({
  action: z.enum([
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
  ]),
  keys: z.array(z.string()).optional(),
  text: z.string().optional(),
  coordinate: z.array(z.number()).length(2).optional(),
  pixels: z.number().optional(),
  time: z.number().optional(),
  status: z.enum(['success', 'failure']).optional(),
  monitorIndex: z.number().int().optional(),
  useClipboardFallback: z.boolean().optional(),
});

type ComputerUseAction = z.infer<typeof ComputerUseActionSchema>;

const DEFAULT_MODEL_ID = 'openrouter/qwen/qwen3-vl-30b-a3b-instruct';

export const computer_use_agent = createTool({
  id: 'computer_use_agent',
  description:
    'Autonomous computer control loop. Provide a goal and optional context. The tool will repeatedly capture the screen, ask a vision model (e.g., Qwen3-VL via OpenRouter) what action to take next, execute it using computer_use, and stop when it returns answer/terminate.',
  inputSchema: z.object({
    goal: z.string().min(1),
    context: z.string().optional(),
    maxSteps: z.number().int().min(1).max(100).default(30),
    timeoutMs: z.number().int().min(1000).max(10 * 60 * 1000).default(2 * 60 * 1000),
    monitorIndex: z.number().int().optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    status: z.enum(['success', 'failure']).optional(),
    answer: z.string().optional(),
    error: z.string().optional(),
    modelResponsePreview: z.string().optional(),
    modelAction: z.any().optional(),
    modelValidationIssues: z.array(z.any()).optional(),
    steps: z.array(z.any()).optional(),
  }),
  execute: async (inputData: any, { writer }: any) => {
    const c = inputData as any;
    const goal = String(c.goal || '').trim();
    const extra = typeof c.context === 'string' ? c.context : '';
    const modelId = DEFAULT_MODEL_ID;
    const maxSteps = Number.isFinite(c.maxSteps) ? Number(c.maxSteps) : 30;
    const timeoutMs = Number.isFinite(c.timeoutMs) ? Number(c.timeoutMs) : 120000;
    const fixedMonitorIndex = typeof c.monitorIndex === 'number' ? Number(c.monitorIndex) : undefined;

    const model = buildProviderModel(modelId);
    if (!model) {
      return { ok: false, error: `model_unavailable: ${modelId}` };
    }

    if (!hasClientBridge()) {
      return { ok: false, error: 'no_client_bridge' };
    }

    const start = Date.now();
    const steps: any[] = [];
    let lastResult: any = null;

    await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'started', modelId, maxSteps, timeoutMs });

    for (let i = 0; i < maxSteps; i++) {
      if (Date.now() - start > timeoutMs) {
        await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'timeout', step: i + 1 });
        return { ok: false, error: 'timeout', steps };
      }

      const shot = await execLocalTool(
        'computer_use',
        {
          action: 'wait',
          time: 0,
          includeScreenshot: true,
          returnDataUrl: false,
          ...(fixedMonitorIndex !== undefined ? { monitorIndex: fixedMonitorIndex } : {}),
        },
        writer as any,
      );
      const filePath = typeof shot?.filePath === 'string' ? shot.filePath : '';
      const display = shot?.display && typeof shot.display === 'object' ? shot.display : undefined;
      if (!filePath) {
        await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'error', error: 'screenshot_failed' });
        return { ok: false, error: 'screenshot_failed', steps };
      }

      const bin = await execLocalTool('read_file_binary', { path: filePath }, writer as any);
      const imageB64 = typeof bin?.data === 'string' ? bin.data : '';
      const mimeType = typeof bin?.mimeType === 'string' ? bin.mimeType : 'image/png';
      if (!imageB64) {
        await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'error', error: 'read_screenshot_failed', filePath });
        return { ok: false, error: 'read_screenshot_failed', steps };
      }

      const imageBuf = Buffer.from(imageB64, 'base64');

      await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'step', step: i + 1, filePath });

      const instruction = [
        `Goal: ${goal}`,
        extra ? `Context: ${extra}` : '',
        display && typeof display.width === 'number' && typeof display.height === 'number'
          ? `Screen: ${display.width}x${display.height}`
          : '',
        `You can control the computer by outputting a single JSON object describing the next action.`,
        `Actions: key, type, mouse_move, left_click, left_click_drag, right_click, middle_click, double_click, scroll, hscroll, wait, answer, terminate.`,
        `Coordinates: prefer coordinate=[x,y] in normalized screen space where x and y are 0..1000. (You may also use absolute pixel coordinates.)`,
        `For scrolling, set pixels (positive=down, negative=up).`,
        `For wait, set time in seconds.`,
        `For key, set keys=[...] like ["ctrl","l"].`,
        `For type, set text="...". If typing emojis/special characters, you may set useClipboardFallback=true.`,
        `IMPORTANT: If you include Windows paths in JSON strings, you MUST escape backslashes (use double \\). Example: "C:\\Users\\solar\\Desktop\\stuard_demo.txt".`,
        `To finish: use action="answer" with text="..." OR action="terminate" with status="success" or "failure".`,
        lastResult ? `Last result: ${JSON.stringify(lastResult).slice(0, 1500)}` : '',
        `Return ONLY JSON.`,
      ].filter(Boolean).join('\n');

      const messages: any[] = [
        {
          role: 'system',
          content:
            'You are a computer-using assistant. Decide the next single action to accomplish the goal based on the screenshot. Output strictly valid JSON with no extra text.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image', image: imageBuf, mediaType: mimeType },
          ],
        },
      ];

      const res = await generateText({ model: model as any, messages, temperature: 0.2 });
      const raw = String((res as any)?.text || '').trim();
      const parsed = extractJson(raw);
      const responsePreview = raw.slice(0, 2000);
      const normalized = parsed && typeof parsed === 'object' ? normalizeModelAction(parsed) : null;

      if (!normalized || typeof normalized !== 'object') {
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'computer_use_agent',
          status: 'error',
          error: 'invalid_model_action',
          step: i + 1,
          responsePreview,
        });
        steps.push({ step: i + 1, screenshot: filePath, error: 'invalid_model_action', modelResponsePreview: responsePreview });
        return { ok: false, error: 'invalid_model_action', modelResponsePreview: responsePreview, steps };
      }

      const actionParsed = ComputerUseActionSchema.safeParse(normalized);

      if (!actionParsed.success) {
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'computer_use_agent',
          status: 'error',
          error: 'invalid_model_action',
          step: i + 1,
          responsePreview,
          validationIssues: actionParsed.error.issues,
        });
        steps.push({
          step: i + 1,
          screenshot: filePath,
          error: 'invalid_model_action',
          modelResponsePreview: responsePreview,
          modelAction: normalized,
          modelValidationIssues: actionParsed.error.issues,
        });
        return {
          ok: false,
          error: 'invalid_model_action',
          modelResponsePreview: responsePreview,
          modelAction: normalized,
          modelValidationIssues: actionParsed.error.issues,
          steps,
        };
      }

      const action: ComputerUseAction = actionParsed.data;
      await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'action', step: i + 1, action });

      if (action.action === 'answer') {
        const answer = String(action.text || '').trim();
        await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'completed', result: 'answer' });
        steps.push({ step: i + 1, screenshot: filePath, action, result: { ok: true, answer } });
        return { ok: true, status: 'success' as const, answer, steps };
      }

      if (action.action === 'terminate') {
        const status = (action.status || 'success') as 'success' | 'failure';
        await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'completed', result: status });
        steps.push({ step: i + 1, screenshot: filePath, action, result: { ok: true, status } });
        return { ok: status === 'success', status, steps };
      }

      const execArgs: any = {
        ...action,
        includeScreenshot: false,
      };
      if (fixedMonitorIndex !== undefined && execArgs.monitorIndex === undefined) {
        execArgs.monitorIndex = fixedMonitorIndex;
      }

      const execRes = await execLocalTool('computer_use', execArgs, writer as any);
      lastResult = execRes;
      steps.push({ step: i + 1, screenshot: filePath, action, result: execRes });

      await sleep(250);
    }

    await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'error', error: 'max_steps_reached' });
    return { ok: false, error: 'max_steps_reached', steps };
  },
} as any);
