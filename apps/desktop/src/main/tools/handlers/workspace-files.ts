/**
 * Workspace File Tools — Native electron handlers for reading/writing/managing
 * files in a workflow's workspace directory without needing run_node_script.
 *
 * These wrap the existing workflows_* functions from workflows.ts and expose
 * them as first-class workflow tools.
 */
import {
  workflows_readWorkspaceFile,
  workflows_writeWorkspaceFile,
  workflows_deleteWorkspaceFile,
  workflows_listWorkspaceFiles,
  workflows_ensureWorkspace,
  workflows_getWorkspaceInfo,
  workflows_createWorkspaceSubdir,
} from '../../workflows/workflows';
import { RouterContext } from '../types';

/**
 * workspace_read_file — Read a file from the workflow's workspace directory.
 * Uses the running workflow's ID (auto-injected as flowId by the engine).
 */
export async function execWorkspaceReadFile(args: any, ctx: RouterContext): Promise<any> {
  try {
    const flowId = String(args?.flowId || '').trim();
    const filePath = String(args?.path || args?.filePath || '').trim();
    if (!flowId) return { ok: false, error: 'missing flowId — this tool must be used inside a workflow' };
    if (!filePath) return { ok: false, error: 'missing path' };

    // Ensure workspace exists
    const wsRes = workflows_ensureWorkspace(flowId);
    if (!wsRes.ok) return { ok: false, error: wsRes.error || 'workspace_not_available' };

    const result = workflows_readWorkspaceFile(flowId, filePath);
    return result;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'workspace_read_file failed' };
  }
}

/**
 * workspace_write_file — Write/create a file in the workflow's workspace directory.
 * Creates parent directories automatically.
 */
export async function execWorkspaceWriteFile(args: any, ctx: RouterContext): Promise<any> {
  try {
    const flowId = String(args?.flowId || '').trim();
    const filePath = String(args?.path || args?.filePath || '').trim();
    const content = args?.content ?? '';
    if (!flowId) return { ok: false, error: 'missing flowId — this tool must be used inside a workflow' };
    if (!filePath) return { ok: false, error: 'missing path' };

    // Ensure workspace exists
    const wsRes = workflows_ensureWorkspace(flowId);
    if (!wsRes.ok) return { ok: false, error: wsRes.error || 'workspace_not_available' };

    const result = workflows_writeWorkspaceFile(flowId, filePath, String(content));
    return result;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'workspace_write_file failed' };
  }
}

/**
 * workspace_delete_file — Delete a file or directory from the workflow's workspace.
 */
export async function execWorkspaceDeleteFile(args: any, ctx: RouterContext): Promise<any> {
  try {
    const flowId = String(args?.flowId || '').trim();
    const filePath = String(args?.path || args?.filePath || '').trim();
    if (!flowId) return { ok: false, error: 'missing flowId' };
    if (!filePath) return { ok: false, error: 'missing path' };

    const result = workflows_deleteWorkspaceFile(flowId, filePath);
    return result;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'workspace_delete_file failed' };
  }
}

/**
 * workspace_list_files — List files in the workflow's workspace directory (or a subpath).
 */
export async function execWorkspaceListFiles(args: any, ctx: RouterContext): Promise<any> {
  try {
    const flowId = String(args?.flowId || '').trim();
    const subpath = args?.path || args?.subpath || undefined;
    if (!flowId) return { ok: false, error: 'missing flowId' };

    // Ensure workspace exists
    const wsRes = workflows_ensureWorkspace(flowId);
    if (!wsRes.ok) return { ok: false, error: wsRes.error || 'workspace_not_available' };

    const result = workflows_listWorkspaceFiles(flowId, subpath ? String(subpath) : undefined);
    return result;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'workspace_list_files failed' };
  }
}

/**
 * workspace_create_folder — Create a subdirectory in the workflow's workspace.
 */
export async function execWorkspaceCreateFolder(args: any, ctx: RouterContext): Promise<any> {
  try {
    const flowId = String(args?.flowId || '').trim();
    const folderPath = String(args?.path || args?.folder || '').trim();
    if (!flowId) return { ok: false, error: 'missing flowId' };
    if (!folderPath) return { ok: false, error: 'missing path' };

    // Ensure workspace exists
    const wsRes = workflows_ensureWorkspace(flowId);
    if (!wsRes.ok) return { ok: false, error: wsRes.error || 'workspace_not_available' };

    const result = workflows_createWorkspaceSubdir(flowId, folderPath);
    return result;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'workspace_create_folder failed' };
  }
}

/**
 * workspace_get_info — Get workspace info: path, subdirs, all files.
 */
export async function execWorkspaceGetInfo(args: any, ctx: RouterContext): Promise<any> {
  try {
    const flowId = String(args?.flowId || '').trim();
    if (!flowId) return { ok: false, error: 'missing flowId' };

    // Ensure workspace exists
    const wsRes = workflows_ensureWorkspace(flowId);
    if (!wsRes.ok) return { ok: false, error: wsRes.error || 'workspace_not_available' };

    const result = workflows_getWorkspaceInfo(flowId);
    return result;
  } catch (e: any) {
    return { ok: false, error: e?.message || 'workspace_get_info failed' };
  }
}
