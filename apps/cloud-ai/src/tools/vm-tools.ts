import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, getBridgeSecrets, safeToolWrite } from './bridge';
import { resolveVMAddress, sendVMCommand, pingVMAgent } from '../services/vm-command';

const VM_HOME = '/home/stuard';
const VM_UPLOAD_DIR = `${VM_HOME}/uploads`;

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

function stripFileUri(value: string): string {
  if (!value.startsWith('file://')) return value;
  try {
    const url = new URL(value);
    const combined = url.host ? `${url.host}${url.pathname}` : url.pathname;
    return decodeURIComponent(combined);
  } catch {
    return value.replace(/^file:\/\/\/?/i, '');
  }
}

function basenameFromAnyPath(value: string, fallback = 'upload.bin'): string {
  const cleaned = stripFileUri(String(value || '')).replace(/[\\/]+$/g, '');
  const name = cleaned.split(/[\\/]/).filter(Boolean).pop();
  return (name || fallback).replace(/[^\w.\- ()[\]]+/g, '_') || fallback;
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\/[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function normalizeVmFilePath(vmPath: string, localPath?: string): string {
  const original = stripFileUri(String(vmPath || '').trim());
  if (!original || original === '.' || original === './') {
    return `${VM_UPLOAD_DIR}/${basenameFromAnyPath(localPath || '')}`;
  }

  if (looksLikeWindowsPath(original)) {
    return `${VM_UPLOAD_DIR}/${basenameFromAnyPath(original)}`;
  }

  const normalized = original.replace(/\\/g, '/');
  if (normalized === '~') return `${VM_UPLOAD_DIR}/${basenameFromAnyPath(localPath || '')}`;
  if (normalized.startsWith('~/')) return `${VM_HOME}/${normalized.slice(2)}`;

  if (normalized.startsWith('/')) {
    if (normalized === VM_HOME || normalized.startsWith(`${VM_HOME}/`)) return normalized;
    throw new Error(`vm_path_outside_sandbox: use a path under ${VM_HOME}, for example ${VM_UPLOAD_DIR}/${basenameFromAnyPath(localPath || normalized)}`);
  }

  return normalized;
}

function vmError(result: any, fallback: string): string {
  const error = String(result?.error || result?.result?.error || result?.result?.reason || '').trim();
  const reason = String(result?.result?.reason || '').trim();
  if (error === 'access_denied' && reason === 'approval_timeout') {
    return 'vm_permission_timeout: the VM tool asked for approval but delegated VM tool calls cannot surface that VM-local prompt. Enable VM auto-approve for that tool, or use vm_upload_file/vm_download_file for file transfers.';
  }
  return error || fallback;
}

async function writeToolEvent(writer: any, payload: Record<string, any>) {
  await safeToolWrite(writer as any, { type: 'tool_event', ...payload });
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
  execute: async (inputData: any, { writer }: any) => {
    const { tool, args = {}, timeoutMs } = inputData as { tool: string; args?: Record<string, any>; timeoutMs?: number };
    const userId = requireUserId();
    const timeout = asPositiveTimeout(timeoutMs, 120_000);
    await writeToolEvent(writer, { tool: 'vm_execute_tool', status: 'started', vmTool: tool });
    const result = await sendVMCommand(userId, 'tool_exec', { tool, args }, timeout);
    if (!result.ok) {
      const error = vmError(result, 'vm_tool_failed');
      await writeToolEvent(writer, { tool: 'vm_execute_tool', status: 'error', vmTool: tool, error });
      return { ok: false, tool, error, result: result.result };
    }
    await writeToolEvent(writer, { tool: 'vm_execute_tool', status: 'completed', vmTool: tool });
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
    let resolvedVmPath: string;
    try {
      resolvedVmPath = normalizeVmFilePath(vmPath, localPath);
    } catch (e: any) {
      const error = e?.message || 'invalid_vm_path';
      await writeToolEvent(writer, { tool: 'vm_upload_file', status: 'error', path: vmPath, error });
      return { ok: false, localPath, vmPath, error };
    }

    await writeToolEvent(writer, { tool: 'vm_upload_file', status: 'reading_desktop_file', path: localPath });
    const file = await execLocalTool('read_file_base64', { path: localPath }, writer as any, timeout, { silent: true });
    if (!file?.ok) {
      const error = file?.error || 'desktop_file_read_failed';
      await writeToolEvent(writer, { tool: 'vm_upload_file', status: 'error', path: localPath, error });
      return { ok: false, localPath, vmPath: resolvedVmPath, error };
    }
    const data = typeof file.data === 'string' ? file.data : '';
    if (!data && Number(file.size || 0) > 0) {
      const error = 'desktop_file_read_returned_no_data';
      await writeToolEvent(writer, { tool: 'vm_upload_file', status: 'error', path: localPath, error });
      return { ok: false, localPath, vmPath: resolvedVmPath, error };
    }

    if (!overwrite) {
      const stat = await sendVMCommand(userId, 'file_stat', { path: resolvedVmPath }, 15_000);
      if (stat.ok) {
        const error = 'vm_destination_exists';
        await writeToolEvent(writer, { tool: 'vm_upload_file', status: 'error', path: resolvedVmPath, error });
        return { ok: false, localPath, vmPath: resolvedVmPath, error, result: stat.result };
      }
    }

    await writeToolEvent(writer, { tool: 'vm_upload_file', status: 'writing_vm_file', path: resolvedVmPath });
    const result = await sendVMCommand(
      userId,
      'file_write',
      { path: resolvedVmPath, content: data, encoding: 'base64' },
      timeout,
    );

    if (!result.ok) {
      const error = vmError(result, 'vm_file_write_failed');
      await writeToolEvent(writer, { tool: 'vm_upload_file', status: 'error', path: resolvedVmPath, error });
      return { ok: false, localPath, vmPath: resolvedVmPath, error, result: result.result };
    }

    const bytes = Number(file.size) || Buffer.from(data, 'base64').byteLength;
    await writeToolEvent(writer, { tool: 'vm_upload_file', status: 'completed', path: resolvedVmPath, bytes });
    return {
      ok: true,
      localPath,
      vmPath: resolvedVmPath,
      bytes,
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
    let resolvedVmPath: string;
    try {
      resolvedVmPath = normalizeVmFilePath(vmPath);
    } catch (e: any) {
      const error = e?.message || 'invalid_vm_path';
      await writeToolEvent(writer, { tool: 'vm_download_file', status: 'error', path: vmPath, error });
      return { ok: false, vmPath, localPath, error };
    }

    await writeToolEvent(writer, { tool: 'vm_download_file', status: 'reading_vm_file', path: resolvedVmPath });
    const readResult = await sendVMCommand(
      userId,
      'file_read',
      { path: resolvedVmPath },
      timeout,
    );
    const fileContent = readResult.result?.content;
    const encoding = String(readResult.result?.encoding || 'utf-8').toLowerCase();
    if (!readResult.ok || typeof fileContent !== 'string') {
      const error = vmError(readResult, 'vm_file_read_failed');
      await writeToolEvent(writer, { tool: 'vm_download_file', status: 'error', path: resolvedVmPath, error });
      return { ok: false, vmPath: resolvedVmPath, localPath, error, result: readResult.result };
    }
    const data = encoding === 'base64'
      ? fileContent
      : Buffer.from(fileContent, 'utf8').toString('base64');

    await writeToolEvent(writer, { tool: 'vm_download_file', status: 'writing_desktop_file', path: localPath });
    const writeResult = await execLocalTool('write_file_base64', { path: localPath, content: data, overwrite }, writer as any, timeout, { silent: true });
    if (!writeResult?.ok) {
      const error = writeResult?.error || 'desktop_file_write_failed';
      await writeToolEvent(writer, { tool: 'vm_download_file', status: 'error', path: localPath, error });
      return { ok: false, vmPath: resolvedVmPath, localPath, error, result: writeResult };
    }

    const bytes = Number(readResult.result?.size) || Buffer.from(data, 'base64').byteLength;
    await writeToolEvent(writer, { tool: 'vm_download_file', status: 'completed', path: localPath, bytes });
    return {
      ok: true,
      vmPath: resolvedVmPath,
      localPath,
      bytes,
      result: writeResult,
    };
  },
});
