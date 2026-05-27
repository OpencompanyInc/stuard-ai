import { RouterContext } from './types';
import { getToolKind } from './registry';
import { execCloudTool } from './handlers/cloud';
import { execLocalTool, calcToolTimeout } from './handlers/local';
import { execCustomUi, execCloseCustomUi, execPlayAudio, execLog, execWait, execEnd, execReturnValue, execUpdateCustomUi, execGetClipboardContent, execSetClipboardContent, execSendNotification, execSendUiEvent, execRunUiScript, execListCustomUiWindows, initCustomUiIpc, execListOpenWindows, execBringWindowToForeground, execGetWindowInfo, execSmartBringWindowToForeground, execSetWindowBounds } from './handlers/electron';
import { execAskUserViaNotification } from './handlers/ask-user-notification';
import { execAskUserInApp } from './handlers/ask-user-inapp';
import { execSetVariable, execGetVariable, execToggleVariable, execIncrementVariable, execAppendToList, execListVariables, execDeleteVariable } from './handlers/variables';
import { execTerminalCreate, execTerminalList, execTerminalGet, execTerminalSendInput, execTerminalSendRaw, execTerminalSendKeys, execTerminalRead, execTerminalWaitFor, execTerminalDestroy } from './handlers/terminal';
import { execCliAgentDetect, execCliAgentStart, execCliAgentSend, execCliAgentRead, execCliAgentStatus, execCliAgentWaitFor, execCliAgentWaitIdle, execCliAgentStop } from './handlers/cli-agent';
import { execCallWorkflow, execInvokeWorkflow, execTestRunSteps, execSearchLocalWorkflows, execReadLocalWorkflow, execDeployLocalWorkflow, execListLocalStuards } from './handlers/workflow';
import { execCallWorkspaceFunction, execListWorkspaceFunctions } from './handlers/workspace-functions';
import { execWorkspaceReadFile, execWorkspaceWriteFile, execWorkspaceDeleteFile, execWorkspaceListFiles, execWorkspaceCreateFolder, execWorkspaceGetInfo } from './handlers/workspace-files';
import { execProactiveTaskCreate, execProactiveTaskList, execProactiveTaskUpdate, execProactiveTaskDelete } from './handlers/proactive';
import { execBotList, execBotGetStatus, execBotCreate, execBotDeploy, execBotPause, execBotDelete, execBotAsk } from './handlers/bots';
import { execBotMemoryList, execBotMemoryCreate, execBotMemoryUpdate, execBotMemoryDelete, execBotMemoryLog } from './handlers/bot-memory';
import { execWakewordStart, execWakewordStop, execWakewordStatus } from './handlers/wakeword';
import { skills_save, skills_list } from '../skills';
import { execOllamaStatus, execOllamaStart, execOllamaAgent, execOllamaChat, execOllamaGenerate, execOllamaVision, execOllamaEmbeddings, execOllamaModels } from './handlers/ollama';
import { execBrowserUseStatus, execBrowserUseConfigure, execBrowserUseTask, execBrowserUseExecuteScript, execBrowserUseNavigate, execBrowserUseClick, execBrowserUseType, execBrowserUsePressKey, execBrowserUseScreenshot, execBrowserUseContent, execBrowserUseScroll, execBrowserUseTabs, execBrowserUseCookies, execBrowserUseHover, execBrowserUseSelectOption, execBrowserUseGetDropdownOptions, execBrowserUseGetInteractiveElements, execBrowserUseFillForm, execBrowserUseUploadFile, execBrowserUseWaitFor, startBrowserUseServer, stopBrowserUseServer, setupBrowserUse, installBrowserUse, uninstallBrowserUse, shutdownAllBrowserUseServers } from './handlers/browser-use';
import { captureToolMedia, getMediaLibrarySourceDir, registerLocalMedia } from '../services/media-library';
import { isRustFileTool, execRustFileTool } from './handlers/file-indexer';

export * from './registry';
export * from './types';
export * from './handlers/local'; // for calcToolTimeout
export { execCloudTool } from './handlers/cloud';
export { execCustomUi, execCloseCustomUi, initCustomUiIpc } from './handlers/electron';
export { shutdownAllBrowserUseServers, prewarmBrowserUseServer } from './handlers/browser-use';

function normalizeCommandTool(toolName: string, args: any): { toolName: string; args: any } {
  if (toolName !== 'run_system_command') {
    return { toolName, args };
  }

  const normalizedArgs = (args && typeof args === 'object') ? { ...args } : {};
  if (typeof normalizedArgs.shell !== 'string' || !normalizedArgs.shell.trim()) {
    normalizedArgs.shell = 'default';
  }
  return { toolName: 'run_command', args: normalizedArgs };
}

/**
 * Internal handler for _media_register tool.
 * Accepts base64 images (or file paths) from cloud-originated tools and
 * registers them into the local media library so they appear in the dashboard gallery.
 */
async function execMediaRegister(args: any): Promise<any> {
  const images: any[] = Array.isArray(args?.images) ? args.images : [];
  const filePath: string = String(args?.filePath || '').trim();
  const source: string = String(args?.source || 'generated').trim();
  const toolName: string = String(args?.toolName || 'generate_image').trim();
  const classification: string | undefined = String(args?.classification || '').trim() || undefined;
  const tags: string[] = Array.isArray(args?.tags) ? args.tags : [];
  const metadata: any = args?.metadata || {};
  const base64Data: string = String(args?.b64 || '').trim();
  const mimeType: string | undefined = String(args?.mimeType || '').trim() || undefined;
  const format: string = String(args?.format || '').trim();
  const fileNameArg: string = String(args?.fileName || '').trim();
  const linkOnly: boolean = !!args?.linkOnly;

  const results: any[] = [];
  const fs = require('fs');
  const path = require('path');

  // Handle base64 images array (from generate_image)
  if (images.length > 0) {
    const { randomUUID } = require('crypto');
    const imgDir = getMediaLibrarySourceDir(source === 'generated' ? 'generated' : source);

    for (const img of images) {
      try {
        const b64 = String(img?._b64 || img?.b64 || '');
        const format = String(img?.format || 'png');
        const ext = format === 'jpeg' ? 'jpg' : format;

        let localPath = String(img?.filePath || '').trim();

        // Save base64 to file if provided
        if (b64 && !localPath) {
          const fileName = `img_${randomUUID().slice(0, 8)}.${ext}`;
          localPath = path.join(imgDir, fileName);
          fs.writeFileSync(localPath, Buffer.from(b64, 'base64'));
        }

        if (!localPath || !fs.existsSync(localPath)) continue;

        const item = await registerLocalMedia({
          filePath: localPath,
          source,
          toolName,
          classification: classification || 'Generated image',
          tags: ['generated', 'ai', ...tags],
          metadata: {
            ...metadata,
            revisedPrompt: img?.revisedPrompt || null,
          },
          preserveName: true,
        });
        results.push({ ok: true, id: item.id, localPath: item.localPath });
      } catch (e: any) {
        results.push({ ok: false, error: e?.message });
      }
    }
    return { ok: true, registered: results.length, items: results };
  }

  // Handle single base64 media payload (for cloud-originated audio or image)
  if (base64Data) {
    try {
      const { randomUUID } = require('crypto');
      const mediaDir = getMediaLibrarySourceDir(source || 'misc');

      const extFromMime = mimeType?.split('/')[1]?.replace('jpeg', 'jpg');
      const ext = (format || extFromMime || path.extname(fileNameArg).replace(/^\./, '') || 'bin').toLowerCase();
      const baseName = fileNameArg
        ? path.basename(fileNameArg, path.extname(fileNameArg))
        : `${toolName || 'media'}_${randomUUID().slice(0, 8)}`;
      const localPath = path.join(mediaDir, `${baseName}.${ext}`);

      fs.writeFileSync(localPath, Buffer.from(base64Data, 'base64'));

      const item = await registerLocalMedia({
        filePath: localPath,
        source,
        toolName,
        mimeType: mimeType || null,
        classification,
        tags,
        metadata,
        preserveName: true,
      });
      return { ok: true, id: item.id, localPath: item.localPath };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }

  // Handle single file path registration
  if (filePath && fs.existsSync(filePath)) {
    try {
      const item = await registerLocalMedia({
        filePath,
        source,
        toolName,
        classification,
        tags,
        metadata,
        preserveName: true,
        linkOnly,
      });
      return { ok: true, id: item.id, localPath: item.localPath };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }

  return { ok: false, error: 'no_media_to_register' };
}

/**
 * Unified Tool Executor
 * Execute any tool, routing to the correct backend
 */
export async function execTool(toolName: string, args: any, ctx: RouterContext): Promise<any> {
  const normalized = normalizeCommandTool(toolName, args);
  toolName = normalized.toolName;
  args = normalized.args;
  const kind = getToolKind(toolName);
  const withMediaCapture = async (promise: Promise<any>) => captureToolMedia(toolName, args, await promise);

  // File index / search — handled by the native Rust indexer directly, no agent round-trip.
  if (isRustFileTool(toolName)) {
    return execRustFileTool(toolName, args);
  }

  switch (kind) {
    case 'electron':
      // Internal: register media files from cloud-originated tools into local media library
      if (toolName === '_media_register') {
        return execMediaRegister(args);
      }
      // Handle Electron-native tools
      if (toolName === 'custom_ui') return execCustomUi(args, ctx);
      if (toolName === 'close_custom_ui') return execCloseCustomUi(args);
      if (toolName === 'update_custom_ui') return execUpdateCustomUi(args, ctx);
      if (toolName === 'send_notification') return execSendNotification(args, ctx);
      if (toolName === 'send_ui_event') return execSendUiEvent(args, ctx);
      if (toolName === 'run_ui_script') return execRunUiScript(args, ctx);
      if (toolName === 'list_custom_ui_windows') return execListCustomUiWindows(args, ctx);
      if (toolName === 'play_audio') return execPlayAudio(args, ctx);
      if (toolName === 'log') return execLog(args, ctx);
      if (toolName === 'wait') return execWait(args, ctx);
      if (toolName === 'end') return execEnd(args, ctx);
      if (toolName === 'return_value') return execReturnValue(args, ctx);
      if (toolName === 'invoke_workflow') return execInvokeWorkflow(args, ctx);
      if (toolName === 'call_workflow') return execCallWorkflow(args, ctx);
      // call_function is an engine-internal tool — it executes a function trigger chain
      // within the same workflow. When called from the engine (execution.ts), it's handled
      // inline there. When called from callNode (custom_ui), it's handled in custom-ui/ipc.ts.
      // If it reaches here, it means something tried to call it outside those contexts.
      if (toolName === 'call_function') {
        return { ok: false, error: 'call_function must be used within a workflow engine context or via callNode from custom_ui. It cannot be called as a standalone tool.' };
      }
      if (toolName === 'call_workspace_function') return execCallWorkspaceFunction(args, ctx);
      if (toolName === 'list_workspace_functions') return execListWorkspaceFunctions(args, ctx);
      if (toolName === 'workspace_read_file') return execWorkspaceReadFile(args, ctx);
      if (toolName === 'workspace_write_file') return execWorkspaceWriteFile(args, ctx);
      if (toolName === 'workspace_delete_file') return execWorkspaceDeleteFile(args, ctx);
      if (toolName === 'workspace_list_files') return execWorkspaceListFiles(args, ctx);
      if (toolName === 'workspace_create_folder') return execWorkspaceCreateFolder(args, ctx);
      if (toolName === 'workspace_get_info') return execWorkspaceGetInfo(args, ctx);
      if (toolName === 'test_run_steps') return execTestRunSteps(args, ctx);
      if (toolName === 'search_local_workflows') return execSearchLocalWorkflows(args, ctx);
      if (toolName === 'read_local_workflow') return execReadLocalWorkflow(args, ctx);
      if (toolName === 'deploy_local_workflow') return execDeployLocalWorkflow(args, ctx);
      if (toolName === 'list_local_stuards') return execListLocalStuards(args, ctx);
      if (toolName === 'get_clipboard_content') return execGetClipboardContent(args, ctx);
      if (toolName === 'set_clipboard_content') return execSetClipboardContent(args, ctx);

      if (toolName === 'list_open_windows') return execListOpenWindows(args, ctx);
      if (toolName === 'bring_window_to_foreground') return execBringWindowToForeground(args, ctx);
      if (toolName === 'get_window_info') return execGetWindowInfo(args, ctx);
      if (toolName === 'smart_bring_window_to_foreground') return execSmartBringWindowToForeground(args, ctx);
      if (toolName === 'set_window_bounds') return execSetWindowBounds(args, ctx);

      // Variable management tools
      if (toolName === 'set_variable') return execSetVariable(args, ctx);
      if (toolName === 'get_variable') return execGetVariable(args, ctx);
      if (toolName === 'toggle_variable') return execToggleVariable(args, ctx);
      if (toolName === 'increment_variable') return execIncrementVariable(args, ctx);
      if (toolName === 'append_to_list') return execAppendToList(args, ctx);
      if (toolName === 'list_variables') return execListVariables(args, ctx);
      if (toolName === 'delete_variable') return execDeleteVariable(args, ctx);

      // Terminal tools
      if (toolName === 'terminal_create') return execTerminalCreate(args, ctx);
      if (toolName === 'terminal_list') return execTerminalList(args, ctx);
      if (toolName === 'terminal_get') return execTerminalGet(args, ctx);
      if (toolName === 'terminal_send_input') return execTerminalSendInput(args, ctx);
      if (toolName === 'terminal_send_raw') return execTerminalSendRaw(args, ctx);
      if (toolName === 'terminal_send_keys') return execTerminalSendKeys(args, ctx);
      if (toolName === 'terminal_read') return execTerminalRead(args, ctx);
      if (toolName === 'terminal_wait_for') return execTerminalWaitFor(args, ctx);
      if (toolName === 'terminal_destroy') return execTerminalDestroy(args, ctx);

      // Coding-agent CLI integrations
      if (toolName === 'cli_agent_detect') return execCliAgentDetect(args);
      if (toolName === 'cli_agent_start') return execCliAgentStart(args, ctx);
      if (toolName === 'cli_agent_send') return execCliAgentSend(args, ctx);
      if (toolName === 'cli_agent_read') return execCliAgentRead(args);
      if (toolName === 'cli_agent_status') return execCliAgentStatus(args);
      if (toolName === 'cli_agent_wait_for') return execCliAgentWaitFor(args);
      if (toolName === 'cli_agent_wait_idle') return execCliAgentWaitIdle(args);
      if (toolName === 'cli_agent_stop') return execCliAgentStop(args, ctx);

      // Ollama (Local AI) tools
      if (toolName === 'ollama_status') return execOllamaStatus(args, ctx);
      if (toolName === 'ollama_start') return execOllamaStart(args, ctx);
      if (toolName === 'ollama_agent') return execOllamaAgent(args, ctx);
      if (toolName === 'ollama_chat') return execOllamaChat(args, ctx);
      if (toolName === 'ollama_generate') return execOllamaGenerate(args, ctx);
      if (toolName === 'ollama_vision') return execOllamaVision(args, ctx);
      if (toolName === 'ollama_embeddings') return execOllamaEmbeddings(args, ctx);
      if (toolName === 'ollama_models') return execOllamaModels(args, ctx);

      // Browser Use (AI browser automation) tools
      if (toolName === 'browser_use_setup') return setupBrowserUse(args?.session_id || args?._browserUseSessionId || 'default');
      if (toolName === 'browser_use_install') return installBrowserUse();
      if (toolName === 'browser_use_start') return startBrowserUseServer(args?.session_id || args?._browserUseSessionId || 'default');
      if (toolName === 'browser_use_stop') return stopBrowserUseServer(args?.session_id || args?._browserUseSessionId || 'default');
      if (toolName === 'browser_use_uninstall') return uninstallBrowserUse();
      if (toolName === 'browser_use_status') return execBrowserUseStatus(args, ctx);
      if (toolName === 'browser_use_configure') return execBrowserUseConfigure(args, ctx);
      if (toolName === 'browser_use_task') return execBrowserUseTask(args, ctx);
      if (toolName === 'browser_use_execute_script') return execBrowserUseExecuteScript(args, ctx);
      if (toolName === 'browser_use_navigate') return execBrowserUseNavigate(args, ctx);
      if (toolName === 'browser_use_click') return execBrowserUseClick(args, ctx);
      if (toolName === 'browser_use_type') return execBrowserUseType(args, ctx);
      if (toolName === 'browser_use_press_key') return execBrowserUsePressKey(args, ctx);
      if (toolName === 'browser_use_screenshot') return execBrowserUseScreenshot(args, ctx);
      if (toolName === 'browser_use_content') return execBrowserUseContent(args, ctx);
      if (toolName === 'browser_use_scroll') return execBrowserUseScroll(args, ctx);
      if (toolName === 'browser_use_tabs') return execBrowserUseTabs(args, ctx);
      if (toolName === 'browser_use_cookies') return execBrowserUseCookies(args, ctx);
      if (toolName === 'browser_use_hover') return execBrowserUseHover(args, ctx);
      if (toolName === 'browser_use_select_option') return execBrowserUseSelectOption(args, ctx);
      if (toolName === 'browser_use_get_dropdown_options') return execBrowserUseGetDropdownOptions(args, ctx);
      if (toolName === 'browser_use_get_interactive_elements') return execBrowserUseGetInteractiveElements(args, ctx);
      if (toolName === 'browser_use_fill_form') return execBrowserUseFillForm(args, ctx);
      if (toolName === 'browser_use_upload_file') return execBrowserUseUploadFile(args, ctx);
      if (toolName === 'browser_use_wait_for') return execBrowserUseWaitFor(args, ctx);
      if (toolName === 'proactive_task_list') return execProactiveTaskList(args, ctx);
      if (toolName === 'proactive_task_update') return execProactiveTaskUpdate(args, ctx);
      if (toolName === 'proactive_task_create') return execProactiveTaskCreate(args, ctx);
      if (toolName === 'proactive_task_delete') return execProactiveTaskDelete(args, ctx);
      if (toolName === 'agent_list' || toolName === 'bot_list') return execBotList(args, ctx);
      if (toolName === 'agent_get_status' || toolName === 'bot_get_status') return execBotGetStatus(args, ctx);
      if (toolName === 'agent_create' || toolName === 'bot_create') return execBotCreate(args, ctx);
      if (toolName === 'agent_deploy' || toolName === 'bot_deploy') return execBotDeploy(args, ctx);
      if (toolName === 'agent_pause' || toolName === 'bot_pause') return execBotPause(args, ctx);
      if (toolName === 'agent_delete' || toolName === 'bot_delete') return execBotDelete(args, ctx);
      if (toolName === 'ask_agent' || toolName === 'agent_ask' || toolName === 'ask_bot' || toolName === 'bot_ask') return execBotAsk(args, ctx);
      if (toolName === 'agent_memory_list' || toolName === 'bot_memory_list') return execBotMemoryList(args, ctx);
      if (toolName === 'agent_memory_create' || toolName === 'bot_memory_create') return execBotMemoryCreate(args, ctx);
      if (toolName === 'agent_memory_update' || toolName === 'bot_memory_update') return execBotMemoryUpdate(args, ctx);
      if (toolName === 'agent_memory_delete' || toolName === 'bot_memory_delete') return execBotMemoryDelete(args, ctx);
      if (toolName === 'agent_memory_log' || toolName === 'bot_memory_log') return execBotMemoryLog(args, ctx);
      if (toolName === 'wakeword_start') return execWakewordStart(args);
      if (toolName === 'wakeword_stop') return execWakewordStop();
      if (toolName === 'wakeword_status') return execWakewordStatus();

      // Auto-skill storage (from cloud-ai auto-skills pipeline)
      if (toolName === 'auto_skill_store') {
        try {
          const skill = args?.skill;
          if (!skill || typeof skill !== 'object') return { ok: false, error: 'skill object required' };
          // Ensure required fields
          const now = new Date().toISOString();
          const fullSkill = {
            id: skill.id || `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: skill.name || 'Auto-Generated Skill',
            description: skill.description || '',
            icon: skill.icon || 'Sparkles',
            color: skill.color || 'purple',
            trigger: skill.trigger || '',
            steps: Array.isArray(skill.steps) ? skill.steps : [],
            isActive: skill.isActive ?? false,
            createdAt: now,
            updatedAt: now,
            ...(skill.source ? { source: skill.source } : {}),
            ...(skill.metadata ? { metadata: skill.metadata } : {}),
          };
          const result = skills_save(fullSkill);
          if (result.ok) {
            console.log(`[auto-skill] Stored skill "${fullSkill.name}" (${fullSkill.id})`);
          }
          return { ...result, skillId: fullSkill.id };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'auto_skill_store_failed' };
        }
      }
      if (toolName === 'auto_skill_list') {
        return skills_list();
      }

      // ask_user — in-app when window is focused, notification overlay when not
      if (toolName === 'ask_user') {
        return execAskUserInApp(args, ctx);
      }

      // GenUI interactive tools - route through custom_ui with component type
      const GENUI_TOOLS = new Set([
        'ask_confirmation', 'show_choices', 'pick_date', 'request_files',
        'show_table', 'show_info', 'show_details', 'show_files',
        'show_command', 'show_json', 'show_link', 'show_colors',
        'show_progress', 'show_info_card', 'show_feedback_form'
      ]);
      if (GENUI_TOOLS.has(toolName)) {
        // GenUI tools render via custom_ui with layout.type = tool name
        const isBlocking = ['ask_confirmation', 'show_choices', 'pick_date', 'request_files', 'show_command', 'show_feedback_form'].includes(toolName);
        return execCustomUi({
          id: args?.id || `genui-${toolName}-${Date.now()}`,
          title: args?.title || toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          layout: { type: toolName, ...args },
          blocking: isBlocking,
          timeoutMs: args?.timeoutMs || (isBlocking ? 300000 : 5000),
          window: { width: 400, height: 300, position: 'center', alwaysOnTop: true, ...args?.window },
          data: args,
        }, ctx);
      }

      return { ok: false, error: `unknown_electron_tool: ${toolName}` };

    case 'cloud':
      return withMediaCapture(execCloudTool(toolName, args, ctx));

    case 'orchestration':
      // Orchestration tools are handled by the engine, not here
      return { ok: false, error: `orchestration_tool_not_handled: ${toolName}` };

    case 'local':
    default:
      return withMediaCapture(execLocalTool(toolName, args, ctx, calcToolTimeout(toolName, args)));
  }
}
