import { RouterContext } from './types';
import { getToolKind } from './registry';
import { execCloudTool } from './handlers/cloud';
import { execLocalTool, calcToolTimeout } from './handlers/local';
import { execCustomUi, execCloseCustomUi, execPlayAudio, execLog, execWait, execEnd, execReturnValue, execUpdateCustomUi, execGetClipboardContent, execSetClipboardContent, execSendUiEvent, execRunUiScript, execListCustomUiWindows, initCustomUiIpc, execListOpenWindows, execBringWindowToForeground, execGetWindowInfo, execSmartBringWindowToForeground, execSetWindowBounds } from './handlers/electron';
import { execSetVariable, execGetVariable, execToggleVariable, execIncrementVariable, execAppendToList, execListVariables, execDeleteVariable } from './handlers/variables';
import { execTerminalCreate, execTerminalList, execTerminalGet, execTerminalSendInput, execTerminalSendRaw, execTerminalSendKeys, execTerminalRead, execTerminalWaitFor, execTerminalDestroy } from './handlers/terminal';
import { execCallWorkflow, execInvokeWorkflow, execTestRunSteps, execListLocalWorkflows, execListLocalStuards } from './handlers/workflow';
import { execCallWorkspaceFunction, execListWorkspaceFunctions } from './handlers/workspace-functions';
import { execWorkspaceReadFile, execWorkspaceWriteFile, execWorkspaceDeleteFile, execWorkspaceListFiles, execWorkspaceCreateFolder, execWorkspaceGetInfo } from './handlers/workspace-files';
import { execProactiveTaskCreate, execProactiveTaskList, execProactiveTaskUpdate, execProactiveTaskDelete } from './handlers/proactive';
import {
  execCanvasList,
  execCanvasRead,
  execCanvasWrite,
  execCanvasCreate,
  execCanvasDelete,
} from './handlers/canvas';
import { execOllamaStatus, execOllamaStart, execOllamaChat, execOllamaGenerate, execOllamaVision, execOllamaEmbeddings, execOllamaModels } from './handlers/ollama';
import { execBrowserUseStatus, execBrowserUseConfigure, execBrowserUseTask, execBrowserUseNavigate, execBrowserUseClick, execBrowserUseType, execBrowserUsePressKey, execBrowserUseScreenshot, execBrowserUseContent, execBrowserUseScroll, execBrowserUseTabs, execBrowserUseCookies, startBrowserUseServer, stopBrowserUseServer, setupBrowserUse, installBrowserUse, uninstallBrowserUse } from './handlers/browser-use';
import {
  execBrowserGetContent,
  execBrowserClickElement,
  execBrowserTypeText,
  execBrowserFindText,
  execBrowserGetElementPosition,
  execBrowserFindClickable,
  execBrowserHover,
  execBrowserSelectOption,
  execBrowserPressKey,
  execBrowserGetFormFields,
  execBrowserFillForm,
  execBrowserWaitForElement,
  execBrowserScrollTo,
  execBrowserGetPageInfo,
  execBrowserExecuteScript,
  execBrowserUploadFile,
  execBrowserSetToggle,
  execBrowserStatus,
} from './handlers/browser';

export * from './registry';
export * from './types';
export * from './handlers/local'; // for calcToolTimeout
export { execCloudTool } from './handlers/cloud';
export { execCustomUi, execCloseCustomUi, initCustomUiIpc } from './handlers/electron';

/**
 * Unified Tool Executor
 * Execute any tool, routing to the correct backend
 */
export async function execTool(toolName: string, args: any, ctx: RouterContext): Promise<any> {
  const kind = getToolKind(toolName);

  switch (kind) {
    case 'electron':
      // Handle Electron-native tools
      if (toolName === 'custom_ui') return execCustomUi(args, ctx);
      if (toolName === 'close_custom_ui') return execCloseCustomUi(args);
      if (toolName === 'update_custom_ui') return execUpdateCustomUi(args, ctx);
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
      if (toolName === 'call_workspace_function') return execCallWorkspaceFunction(args, ctx);
      if (toolName === 'list_workspace_functions') return execListWorkspaceFunctions(args, ctx);
      if (toolName === 'workspace_read_file') return execWorkspaceReadFile(args, ctx);
      if (toolName === 'workspace_write_file') return execWorkspaceWriteFile(args, ctx);
      if (toolName === 'workspace_delete_file') return execWorkspaceDeleteFile(args, ctx);
      if (toolName === 'workspace_list_files') return execWorkspaceListFiles(args, ctx);
      if (toolName === 'workspace_create_folder') return execWorkspaceCreateFolder(args, ctx);
      if (toolName === 'workspace_get_info') return execWorkspaceGetInfo(args, ctx);
      if (toolName === 'test_run_steps') return execTestRunSteps(args, ctx);
      if (toolName === 'list_local_workflows') return execListLocalWorkflows(args, ctx);
      if (toolName === 'list_local_stuards') return execListLocalStuards(args, ctx);
      if (toolName === 'get_clipboard_content') return execGetClipboardContent(args, ctx);
      if (toolName === 'set_clipboard_content') return execSetClipboardContent(args, ctx);

      if (toolName === 'list_open_windows') return execListOpenWindows(args, ctx);
      if (toolName === 'bring_window_to_foreground') return execBringWindowToForeground(args, ctx);
      if (toolName === 'get_window_info') return execGetWindowInfo(args, ctx);
      if (toolName === 'smart_bring_window_to_foreground') return execSmartBringWindowToForeground(args, ctx);
      if (toolName === 'set_window_bounds') return execSetWindowBounds(args, ctx);

      // Canvas document tools
      if (toolName === 'canvas_list' || toolName === 'sidebar_canvas_list') return execCanvasList(args, ctx);
      if (toolName === 'canvas_read' || toolName === 'sidebar_canvas_read') return execCanvasRead(args, ctx);
      if (toolName === 'canvas_write' || toolName === 'sidebar_canvas_write') return execCanvasWrite(args, ctx);
      if (toolName === 'canvas_create' || toolName === 'sidebar_canvas_create') return execCanvasCreate(args, ctx);
      if (toolName === 'canvas_delete' || toolName === 'sidebar_canvas_delete') return execCanvasDelete(args, ctx);

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

      // Browser tools
      if (toolName === 'browser_status') return execBrowserStatus(args, ctx);
      if (toolName === 'browser_get_content') return execBrowserGetContent(args, ctx);
      if (toolName === 'browser_click_element') return execBrowserClickElement(args, ctx);
      if (toolName === 'browser_type_text') return execBrowserTypeText(args, ctx);
      if (toolName === 'browser_find_text') return execBrowserFindText(args, ctx);
      if (toolName === 'browser_get_element_position') return execBrowserGetElementPosition(args, ctx);
      if (toolName === 'browser_find_clickable') return execBrowserFindClickable(args, ctx);
      if (toolName === 'browser_hover') return execBrowserHover(args, ctx);
      if (toolName === 'browser_select_option') return execBrowserSelectOption(args, ctx);
      if (toolName === 'browser_press_key') return execBrowserPressKey(args, ctx);
      if (toolName === 'browser_get_form_fields') return execBrowserGetFormFields(args, ctx);
      if (toolName === 'browser_fill_form') return execBrowserFillForm(args, ctx);
      if (toolName === 'browser_wait_for_element') return execBrowserWaitForElement(args, ctx);
      if (toolName === 'browser_scroll_to') return execBrowserScrollTo(args, ctx);
      if (toolName === 'browser_get_page_info') return execBrowserGetPageInfo(args, ctx);
      if (toolName === 'browser_upload_file') return execBrowserUploadFile(args, ctx);
      if (toolName === 'browser_set_toggle') return execBrowserSetToggle(args, ctx);
      if (toolName === 'browser_execute_script') return execBrowserExecuteScript(args, ctx);

      // Ollama (Local AI) tools
      if (toolName === 'ollama_status') return execOllamaStatus(args, ctx);
      if (toolName === 'ollama_start') return execOllamaStart(args, ctx);
      if (toolName === 'ollama_chat') return execOllamaChat(args, ctx);
      if (toolName === 'ollama_generate') return execOllamaGenerate(args, ctx);
      if (toolName === 'ollama_vision') return execOllamaVision(args, ctx);
      if (toolName === 'ollama_embeddings') return execOllamaEmbeddings(args, ctx);
      if (toolName === 'ollama_models') return execOllamaModels(args, ctx);

      // Browser Use (AI browser automation) tools
      if (toolName === 'browser_use_setup') return setupBrowserUse();
      if (toolName === 'browser_use_install') return installBrowserUse();
      if (toolName === 'browser_use_start') return startBrowserUseServer();
      if (toolName === 'browser_use_stop') return stopBrowserUseServer();
      if (toolName === 'browser_use_uninstall') return uninstallBrowserUse();
      if (toolName === 'browser_use_status') return execBrowserUseStatus(args, ctx);
      if (toolName === 'browser_use_configure') return execBrowserUseConfigure(args, ctx);
      if (toolName === 'browser_use_task') return execBrowserUseTask(args, ctx);
      if (toolName === 'browser_use_navigate') return execBrowserUseNavigate(args, ctx);
      if (toolName === 'browser_use_click') return execBrowserUseClick(args, ctx);
      if (toolName === 'browser_use_type') return execBrowserUseType(args, ctx);
      if (toolName === 'browser_use_press_key') return execBrowserUsePressKey(args, ctx);
      if (toolName === 'browser_use_screenshot') return execBrowserUseScreenshot(args, ctx);
      if (toolName === 'browser_use_content') return execBrowserUseContent(args, ctx);
      if (toolName === 'browser_use_scroll') return execBrowserUseScroll(args, ctx);
      if (toolName === 'browser_use_tabs') return execBrowserUseTabs(args, ctx);
      if (toolName === 'browser_use_cookies') return execBrowserUseCookies(args, ctx);
      if (toolName === 'proactive_task_list') return execProactiveTaskList(args, ctx);
      if (toolName === 'proactive_task_update') return execProactiveTaskUpdate(args, ctx);
      if (toolName === 'proactive_task_create') return execProactiveTaskCreate(args, ctx);
      if (toolName === 'proactive_task_delete') return execProactiveTaskDelete(args, ctx);

      // ask_user — blocking interactive questionnaire rendered in chat overlay
      if (toolName === 'ask_user') {
        return execCustomUi({
          id: args?.id || `ask-user-${Date.now()}`,
          title: args?.title || 'Question',
          layout: { type: 'ask_user', ...args },
          blocking: true,
          timeoutMs: args?.timeoutMs || 300000,
          window: { width: 420, height: 360, position: 'center', alwaysOnTop: true, ...args?.window },
          data: args,
        }, ctx);
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
      return execCloudTool(toolName, args, ctx);

    case 'orchestration':
      // Orchestration tools are handled by the engine, not here
      return { ok: false, error: `orchestration_tool_not_handled: ${toolName}` };

    case 'local':
    default:
      return execLocalTool(toolName, args, ctx, calcToolTimeout(toolName, args));
  }
}
