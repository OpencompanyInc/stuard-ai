import { RouterContext } from './types';
import { getToolKind } from './registry';
import { execCloudTool } from './handlers/cloud';
import { execLocalTool, calcToolTimeout } from './handlers/local';
import { execCustomUi, execCloseCustomUi, execPlayAudio, execLog, execWait, execEnd, execUpdateCustomUi, execGetClipboardContent, execSetClipboardContent } from './handlers/electron';
import { execSetVariable, execGetVariable, execToggleVariable, execIncrementVariable, execAppendToList, execListVariables, execDeleteVariable } from './handlers/variables';
import { execTerminalCreate, execTerminalList, execTerminalGet, execTerminalSendInput, execTerminalSendRaw, execTerminalSendKeys, execTerminalRead, execTerminalWaitFor, execTerminalDestroy } from './handlers/terminal';
import { execInvokeWorkflow, execTestRunSteps } from './handlers/workflow';

export * from './registry';
export * from './types';
export * from './handlers/local'; // for calcToolTimeout
export { execCloudTool } from './handlers/cloud';
export { execCustomUi, execCloseCustomUi } from './handlers/electron';

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
      if (toolName === 'play_audio') return execPlayAudio(args, ctx);
      if (toolName === 'log') return execLog(args, ctx);
      if (toolName === 'wait') return execWait(args, ctx);
      if (toolName === 'end') return execEnd(args, ctx);
      if (toolName === 'update_custom_ui') return execUpdateCustomUi(args, ctx);
      if (toolName === 'invoke_workflow') return execInvokeWorkflow(args, ctx);
      if (toolName === 'test_run_steps') return execTestRunSteps(args, ctx);
      if (toolName === 'get_clipboard_content') return execGetClipboardContent(args, ctx);
      if (toolName === 'set_clipboard_content') return execSetClipboardContent(args, ctx);

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
