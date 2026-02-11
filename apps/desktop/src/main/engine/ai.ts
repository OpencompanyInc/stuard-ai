import { net } from 'electron';
import { EngineContext, StuardSpec, StuardStep } from './types';

export async function aiDecideNext(
  spec: StuardSpec,
  step: StuardStep,
  ctx: any,
  options: Array<{ to: string; label?: string }>,
  aiCfg: any,
  engineCtx: EngineContext
): Promise<{ next?: string; argsPatch?: any; ok: boolean; error?: string }> {
  try {
    const url = `${engineCtx.cloudAiUrl}/inference/workflow/next`;
    const body = {
      context: {
        step: { id: step.id, name: step.id },
        ctx,
        options,
        instruction: String(aiCfg?.instruction || ''),
        produceArgs: !!aiCfg?.produceArgs,
      },
    };

    const resp = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const j: any = await resp.json().catch(() => ({}));

    if (resp.ok && j?.next) {
      return { ok: true, next: j.next, argsPatch: j.argsPatch };
    }

    return { ok: false, error: String(j?.error || 'ai_invalid_response') };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'ai_failed') };
  }
}

