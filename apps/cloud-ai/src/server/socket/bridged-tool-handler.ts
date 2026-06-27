import type { WebSocket } from 'ws';

import { verifyAccessToken } from '../../auth';
import { withClientBridge } from '../../tools/bridge';
import { writeLog } from '../../utils/logger';
import { send } from './helpers';

export async function handleBridgedToolExecution(ws: WebSocket, msg: any) {
  const reqId = String(msg?.id || `btool-${Date.now()}`);
  const toolName = String(msg?.tool || '').trim();
  const toolArgs = msg?.args || {};
  const accessToken = String(msg?.auth?.accessToken || '').trim();

  if (!toolName) {
    send(ws, { type: 'exec_tool_bridged_result', id: reqId, result: { ok: false, error: 'missing_tool_name' } });
    return;
  }

  const [{ getTool }, { initToolRegistry }] = await Promise.all([
    import('../../tools/tool-registry'),
    import('../../tools/meta-tools'),
  ]);

  try {
    initToolRegistry();
  } catch { }

  const tool = getTool(toolName);
  if (!tool || typeof (tool as any).execute !== 'function') {
    send(ws, { type: 'exec_tool_bridged_result', id: reqId, result: { ok: false, error: `tool_not_found: ${toolName}` } });
    return;
  }

  writeLog(`bridged_tool_exec_start: ${toolName}`);
  try {
    const secrets: Record<string, any> = {};
    if (accessToken) {
      try {
        const authResult = await verifyAccessToken(accessToken);
        if (authResult?.success && authResult.userId) {
          secrets.userId = authResult.userId;
        }
      } catch { }
    }

    const result = await withClientBridge(ws, async () => {
      return await (tool as any).execute(toolArgs, {} as any);
    }, secrets);

    writeLog(`bridged_tool_exec_done: ${toolName}`);
    send(ws, { type: 'exec_tool_bridged_result', id: reqId, result });
  } catch (error: any) {
    writeLog(`bridged_tool_exec_error: ${toolName}: ${error?.message || error}`);
    send(ws, {
      type: 'exec_tool_bridged_result',
      id: reqId,
      result: { ok: false, error: error?.message || 'execution_failed' },
    });
  }
}
