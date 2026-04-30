import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, getBridgeSecrets, safeToolWrite } from './bridge';
import { resolveVMAddress, sendVMCommand, pingVMAgent } from '../services/vm-command';

function requireUserId(): string {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '').trim();
  if (!userId) throw new Error('missing_user_context');
  return userId;
}

function asPositiveTimeout(value: unknown, fallbackMs: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallbackMs;
  return Math.max(1_000, Math.min(1_800_000, Math.floor(n)));
}

export const vm_status = createTool({
  id: 'vm_status',
  description:
    'Check the user cloud VM health and the VM-local Python/browser/terminal service status. Use this before VM-only actions.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    reachable: z.boolean().optional(),
    ip: z.string().nullable().optional(),
    health: z.any().optional(),
    agent: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    const userId = requireUserId();
    const ip = await resolveVMAddress(userId);
    if (!ip) {
      return { ok: false, reachable: false, ip: null, error: 'vm_not_reachable' };
    }

    const [healthRaw, agentStatusRaw] = await Promise.all([
      pingVMAgent(ip, 10_000).catch((e: any) => ({ ok: false, error: e?.message || 'ping_failed' })),
      sendVMCommand(userId, 'tool_exec', { tool: 'vm_status', args: {} }, 15_000)
        .catch((e: any) => ({ ok: false, error: e?.message || 'vm_status_failed' })),
    ]);
    const health: any = healthRaw;
    const agentStatus: any = agentStatusRaw;

    const agent = agentStatus.ok ? agentStatus.result : { ok: false, error: agentStatus.error };
    return {
      ok: !!health.ok && !!agentStatus.ok,
      reachable: !!health.ok,
      ip,
      health: health.result || health,
      agent,
      error: !health.ok ? health.error : !agentStatus.ok ? agentStatus.error : undefined,
    };
  },
});

export const vm_execute_tool = createTool({
  id: 'vm_execute_tool',
  description:
    'Execute a tool on the user cloud VM, not the desktop. Supports VM filesystem, shell, terminal, workflows, and browser_use_* tools from the VM agent.',
  inputSchema: z.object({
    tool: z.string().min(1).describe('Exact VM tool name, for example run_command, read_file, write_file, browser_use_navigate, or vm_status.'),
    args: z.record(z.string(), z.any()).optional().default({}).describe('Arguments for the VM tool.'),
    timeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds for the VM command.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    tool: z.string().optional(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData: any) => {
    const { tool, args = {}, timeoutMs } = inputData as { tool: string; args?: Record<string, any>; timeoutMs?: number };
    const userId = requireUserId();
    const timeout = asPositiveTimeout(timeoutMs, 120_000);
    const result = await sendVMCommand(userId, 'tool_exec', { tool, args }, timeout);
    if (!result.ok) return { ok: false, tool, error: result.error || 'vm_tool_failed', result: result.result };
    return { ok: true, tool, result: result.result };
  },
});

export const vm_upload_file = createTool({
  id: 'vm_upload_file',
  description:
    'Upload/copy a file from the connected desktop to the user cloud VM. Reads the desktop file over the bridge and writes it to a VM path.',
  inputSchema: z.object({
    localPath: z.string().min(1).describe('Source path on the connected desktop.'),
    vmPath: z.string().min(1).describe('Destination path on the VM.'),
    overwrite: z.boolean().optional().default(true).describe('Whether to overwrite the destination if it exists.'),
    timeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    localPath: z.string().optional(),
    vmPath: z.string().optional(),
    bytes: z.number().optional(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, { writer }: any) => {
    const { localPath, vmPath, overwrite = true, timeoutMs } = inputData as {
      localPath: string;
      vmPath: string;
      overwrite?: boolean;
      timeoutMs?: number;
    };
    const userId = requireUserId();
    const timeout = asPositiveTimeout(timeoutMs, 180_000);

    await safeToolWrite(writer as any, { type: 'tool_event', tool: 'vm_upload_file', status: 'reading_desktop_file', path: localPath });
    const file = await execLocalTool('read_file_binary', { path: localPath }, writer as any, timeout, { silent: true });
    const data = String(file?.data || '').trim();
    if (!data) {
      return { ok: false, localPath, vmPath, error: file?.error || 'desktop_file_read_failed' };
    }

    await safeToolWrite(writer as any, { type: 'tool_event', tool: 'vm_upload_file', status: 'writing_vm_file', path: vmPath });
    const result = await sendVMCommand(
      userId,
      'tool_exec',
      { tool: 'write_file_base64', args: { path: vmPath, content: data, overwrite } },
      timeout,
    );

    if (!result.ok) {
      return { ok: false, localPath, vmPath, error: result.error || 'vm_file_write_failed', result: result.result };
    }

    return {
      ok: true,
      localPath,
      vmPath,
      bytes: Buffer.from(data, 'base64').byteLength,
      result: result.result,
    };
  },
});

export const vm_download_file = createTool({
  id: 'vm_download_file',
  description:
    'Download/copy a file from the user cloud VM to the connected desktop. Reads the VM file and writes it to a desktop path.',
  inputSchema: z.object({
    vmPath: z.string().min(1).describe('Source path on the VM.'),
    localPath: z.string().min(1).describe('Destination path on the connected desktop.'),
    overwrite: z.boolean().optional().default(true).describe('Whether to overwrite the destination if it exists.'),
    timeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    vmPath: z.string().optional(),
    localPath: z.string().optional(),
    bytes: z.number().optional(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, { writer }: any) => {
    const { vmPath, localPath, overwrite = true, timeoutMs } = inputData as {
      vmPath: string;
      localPath: string;
      overwrite?: boolean;
      timeoutMs?: number;
    };
    const userId = requireUserId();
    const timeout = asPositiveTimeout(timeoutMs, 180_000);

    await safeToolWrite(writer as any, { type: 'tool_event', tool: 'vm_download_file', status: 'reading_vm_file', path: vmPath });
    const readResult = await sendVMCommand(
      userId,
      'tool_exec',
      { tool: 'read_file_base64', args: { path: vmPath } },
      timeout,
    );
    const data = String(readResult.result?.data || readResult.result?.content || '').trim();
    if (!readResult.ok || !data) {
      return { ok: false, vmPath, localPath, error: readResult.error || readResult.result?.error || 'vm_file_read_failed', result: readResult.result };
    }

    await safeToolWrite(writer as any, { type: 'tool_event', tool: 'vm_download_file', status: 'writing_desktop_file', path: localPath });
    const writeResult = await execLocalTool('write_file_base64', { path: localPath, content: data, overwrite }, writer as any, timeout, { silent: true });
    if (!writeResult?.ok) {
      return { ok: false, vmPath, localPath, error: writeResult?.error || 'desktop_file_write_failed', result: writeResult };
    }

    return {
      ok: true,
      vmPath,
      localPath,
      bytes: Buffer.from(data, 'base64').byteLength,
      result: writeResult,
    };
  },
});
