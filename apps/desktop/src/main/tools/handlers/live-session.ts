import { ipcMain } from 'electron';
import { getMainWindow } from '../../windows';
import { bindLiveSessionToWorkflow } from '../../workflows/workflows';

function newEphemeralSessionId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Open a live voice session via the renderer voice pill (same path as chat
 * `start_live_session`, but invoked from the workflow engine in main).
 */
export async function execStartLiveSession(args: any): Promise<any> {
  const mainWin = getMainWindow();
  if (!mainWin || mainWin.isDestroyed()) {
    return { ok: false, error: 'voice_unavailable' };
  }

  const requestId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ids: string[] = Array.isArray(args?.knowledgePackIds)
    ? args.knowledgePackIds.map((s: any) => String(s || '').trim()).filter(Boolean)
    : [];

  const flowId = String(args?.flowId || '').trim();
  const requestedSessionId = String(args?.sessionId || '').trim();
  let sessionId = requestedSessionId;
  let workflowId = '';

  if (flowId) {
    const binding = bindLiveSessionToWorkflow(flowId, requestedSessionId || undefined);
    if (!binding) {
      return { ok: false, error: 'invalid_workflow_id' };
    }
    sessionId = binding.sessionId;
    workflowId = binding.workflowId;
  } else if (!sessionId) {
    sessionId = newEphemeralSessionId('ls_voice');
  }

  const persona = args?.persona ?? args?.systemPrompt;
  const cfg = {
    sessionId,
    workflowId: workflowId || undefined,
    knowledgePackIds: ids.length ? ids : undefined,
    knowledgePacks: ids.length ? ids.map((id: string) => ({ id })) : undefined,
    systemPrompt: persona ? String(persona) : undefined,
    initialMessage: args?.initialMessage ? String(args.initialMessage) : undefined,
    provider: args?.provider ? String(args.provider) : undefined,
  };

  return new Promise((resolve) => {
    const timeoutMs = 20000;
    let settled = false;

    const finish = (result: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ipcMain.removeHandler(`live_session:respond:${requestId}`); } catch { }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: 'live_session_start_timeout' });
    }, timeoutMs);

    ipcMain.handleOnce(`live_session:respond:${requestId}`, (_e, result: any) => {
      const ok = Boolean(result?.ok);
      if (ok) {
        finish({
          ok: true,
          started: true,
          sessionId,
          workflowId: workflowId || undefined,
          ...(ids.length ? { attachedPacks: ids.map((id) => ({ id })) } : {}),
          note: workflowId
            ? `Live voice session ${sessionId} started for workflow ${workflowId}. Deploy the workflow so its On Live Session End trigger can fire.`
            : 'Live voice session started. The conversation runs independently by voice.',
        });
      } else {
        finish({ ok: false, error: result?.error || 'failed_to_start_live_session' });
      }
      return { ok: true };
    });

    mainWin.webContents.send('live_session:start', { requestId, cfg });
  });
}
