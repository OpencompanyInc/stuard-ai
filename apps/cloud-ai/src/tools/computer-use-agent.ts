import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';
import { execLocalTool, hasClientBridge, safeToolWrite } from './bridge';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MODEL = 'gpt-5.4';

/**
 * Capture a screenshot via the local agent and return {filePath, imageB64, display}.
 */
async function captureScreenshot(
  writer: any,
  monitorIndex?: number,
): Promise<{ filePath: string; imageB64: string; display?: { width: number; height: number } } | null> {
  const shot = await execLocalTool(
    'computer_use',
    {
      action: 'wait',
      time: 0,
      includeScreenshot: true,
      returnDataUrl: false,
      ...(monitorIndex !== undefined ? { monitorIndex } : {}),
    },
    writer,
  );
  const filePath = typeof shot?.filePath === 'string' ? shot.filePath : '';
  if (!filePath) return null;

  const bin = await execLocalTool('read_file_binary', { path: filePath }, writer);
  const imageB64 = typeof bin?.data === 'string' ? bin.data : '';
  if (!imageB64) return null;

  const display =
    shot?.display && typeof shot.display === 'object' && typeof shot.display.width === 'number'
      ? { width: shot.display.width as number, height: shot.display.height as number }
      : undefined;

  return { filePath, imageB64, display };
}

/**
 * Execute a single GPT-5.4 computer_call action using the local agent tools.
 * Uses specific tools (click_at_coordinates, move_cursor, etc.) to avoid
 * the 0-1000 normalisation in the generic computer_use handler.
 */
async function executeAction(action: any, writer: any, monitorIndex?: number): Promise<any> {
  const type = action?.type;
  if (!type) return null;

  switch (type) {
    case 'click': {
      const button = action.button || 'left';
      if (button === 'back' || button === 'forward') {
        // Browser nav — send Alt+Left / Alt+Right as keyboard shortcut
        const key = button === 'back' ? 'left' : 'right';
        return execLocalTool('send_hotkey', { keys: ['alt', key] }, writer);
      }
      return execLocalTool(
        'click_at_coordinates',
        { x: action.x, y: action.y, button },
        writer,
      );
    }

    case 'double_click':
      return execLocalTool(
        'double_click_at_coordinates',
        { x: action.x, y: action.y, button: 'left' },
        writer,
      );

    case 'type':
      return execLocalTool('type_text', { text: action.text || '' }, writer);

    case 'keypress':
      return execLocalTool('send_hotkey', { keys: action.keys || [] }, writer);

    case 'scroll':
      return execLocalTool(
        'scroll',
        {
          deltaY: action.scroll_y || 0,
          deltaX: action.scroll_x || 0,
        },
        writer,
      );

    case 'drag': {
      const path: { x: number; y: number }[] = action.path || [];
      if (path.length < 2) return null;
      const first = path[0];
      const last = path[path.length - 1];
      return execLocalTool(
        'drag_and_drop',
        { fromX: first.x, fromY: first.y, toX: last.x, toY: last.y },
        writer,
      );
    }

    case 'move':
      return execLocalTool('move_cursor', { x: action.x, y: action.y }, writer);

    case 'wait':
      await sleep(action.ms || 1000);
      return { ok: true };

    case 'screenshot':
      // Screenshot is handled by the loop after all actions execute
      return null;

    default:
      return null;
  }
}

export const computer_use_agent = createTool({
  id: 'computer_use_agent',
  description:
    'Autonomous computer control loop using GPT-5.4 native computer use. Provide a goal and optional context. ' +
    'Uses the OpenAI Responses API with the built-in computer tool to repeatedly analyse screenshots, ' +
    'execute batched actions, and loop until the task is complete.',
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
    steps: z.array(z.any()).optional(),
  }),
  execute: async (inputData: any, { writer }: any) => {
    const c = inputData as any;
    const goal = String(c.goal || '').trim();
    const extra = typeof c.context === 'string' ? c.context : '';
    const maxSteps = Number.isFinite(c.maxSteps) ? Number(c.maxSteps) : 30;
    const timeoutMs = Number.isFinite(c.timeoutMs) ? Number(c.timeoutMs) : 120000;
    const fixedMonitorIndex = typeof c.monitorIndex === 'number' ? Number(c.monitorIndex) : undefined;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { ok: false, error: 'OPENAI_API_KEY not set' };
    }

    if (!hasClientBridge()) {
      return { ok: false, error: 'no_client_bridge' };
    }

    const client = new OpenAI({ apiKey });
    const start = Date.now();
    const steps: any[] = [];

    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: 'computer_use_agent',
      status: 'started',
      modelId: MODEL,
      maxSteps,
      timeoutMs,
    });

    // --- Capture initial screenshot ---
    const initShot = await captureScreenshot(writer, fixedMonitorIndex);
    if (!initShot) {
      return { ok: false, error: 'screenshot_failed', steps };
    }

    const userText = `${goal}${extra ? `\n\nContext: ${extra}` : ''}`;

    // --- Initial request to GPT-5.4 Responses API ---
    let response: any;
    try {
      response = await (client as any).responses.create({
        model: MODEL,
        tools: [{ type: 'computer' }],
        instructions:
          'You are a computer-using assistant. Analyse the screenshot and perform actions to accomplish the user\'s goal. ' +
          'Use the computer tool to interact with the desktop. When finished, provide your final answer as a text message.',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: userText },
              {
                type: 'input_image',
                image_url: `data:image/png;base64,${initShot.imageB64}`,
                detail: 'original',
              },
            ],
          },
        ],
        reasoning: { summary: 'concise' },
      });
    } catch (err: any) {
      return { ok: false, error: `openai_api_error: ${err.message || err}`, steps };
    }

    // --- Agentic loop ---
    for (let i = 0; i < maxSteps; i++) {
      if (Date.now() - start > timeoutMs) {
        await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'timeout', step: i + 1 });
        return { ok: false, error: 'timeout', steps };
      }

      const output: any[] = response.output || [];

      // Find computer_call items
      const computerCalls = output.filter((item: any) => item.type === 'computer_call');

      if (computerCalls.length === 0) {
        // No more computer calls — extract final text answer
        let answer = '';
        for (const item of output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            for (const part of item.content) {
              if (part.type === 'output_text') answer += part.text || '';
            }
          }
        }
        await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'completed', result: 'success' });
        steps.push({ step: i + 1, result: { ok: true, answer: answer.trim() } });
        return { ok: true, status: 'success' as const, answer: answer.trim(), steps };
      }

      const computerCall = computerCalls[0];
      const callId = computerCall.call_id;
      const actions: any[] = computerCall.actions || [];

      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'computer_use_agent',
        status: 'action',
        step: i + 1,
        actions,
      });

      // Execute each action in the batch
      for (const gptAction of actions) {
        if (gptAction.type === 'screenshot') continue; // screenshot taken after all actions
        await executeAction(gptAction, writer, fixedMonitorIndex);
        await sleep(100); // small delay between batched actions
      }

      // Capture screenshot after executing all actions
      await sleep(250);
      const shot = await captureScreenshot(writer, fixedMonitorIndex);
      if (!shot) {
        return { ok: false, error: 'screenshot_failed', steps };
      }

      // Handle pending safety checks — auto-acknowledge
      const safetyChecks: any[] = computerCall.pending_safety_checks || [];
      const acknowledged = safetyChecks.map((sc: any) => ({
        id: sc.id,
        code: sc.code,
        message: sc.message,
      }));

      steps.push({ step: i + 1, actions, screenshot: shot.filePath, safetyChecks });
      await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'step', step: i + 1, filePath: shot.filePath });

      // Send computer_call_output back to GPT-5.4
      try {
        const callOutput: any = {
          call_id: callId,
          type: 'computer_call_output',
          output: {
            type: 'computer_screenshot',
            image_url: `data:image/png;base64,${shot.imageB64}`,
            detail: 'original',
          },
        };
        if (acknowledged.length > 0) {
          callOutput.acknowledged_safety_checks = acknowledged;
        }

        response = await (client as any).responses.create({
          model: MODEL,
          previous_response_id: response.id,
          tools: [{ type: 'computer' }],
          input: [callOutput],
          reasoning: { summary: 'concise' },
        });
      } catch (err: any) {
        return { ok: false, error: `openai_api_error: ${err.message || err}`, steps };
      }
    }

    await safeToolWrite(writer, { type: 'tool_event', tool: 'computer_use_agent', status: 'error', error: 'max_steps_reached' });
    return { ok: false, error: 'max_steps_reached', steps };
  },
} as any);
