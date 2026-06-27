import { execSendNotification } from './electron';
import type { RouterContext } from '../types';

/**
 * Route ask_user through the notification system so the user can respond
 * without bringing any window to the foreground.
 *
 * Maps ask_user types to notification UI:
 *   confirm  -> Yes / No action buttons
 *   choices  -> one action button per option
 *   text     -> text input field
 */
export async function execAskUserViaNotification(args: any, ctx: RouterContext): Promise<any> {
  const type = String(args?.type || 'confirm');
  const message = String(args?.message || '');
  const title = String(args?.title || 'Question');
  const options = Array.isArray(args?.options) ? args.options : [];
  const placeholder = String(args?.placeholder || args?.inputPlaceholder || 'Type your answer...');
  const timeoutMs = Number(args?.timeoutMs) || 300000;

  const notifArgs: Record<string, any> = {
    title,
    message,
    variant: 'info',
    position: 'top-right',
    waitForInput: true,
    timeoutMs,
    dismissible: true,
    sound: true,
    // Pass askUser metadata so the renderer builds the right UI.
    askUser: { type, options },
  };

  if (type === 'text') {
    notifArgs.showInput = true;
    notifArgs.inputPlaceholder = placeholder;
    notifArgs.inputSubmitText = 'Submit';
  }

  const result = await execSendNotification(notifArgs, ctx);

  // Map the notification response to ask_user output format.
  if (!result?.ok) {
    return {
      ok: false,
      dismissed: result?.error === 'timeout',
      error: result?.error || 'no_response',
    };
  }

  const responseType = result?.response?.type;
  const value = result?.value ?? result?.response?.value;

  if (responseType === 'dismiss' || responseType === 'cancel') {
    return { ok: true, dismissed: true };
  }

  switch (type) {
    case 'confirm': {
      const confirmed = value === 'yes' || value === true || value === 'true';
      return { ok: true, confirmed };
    }
    case 'choices': {
      const selected = String(value || '');
      const match = options.find((option: any) => option.id === selected);
      return {
        ok: true,
        selected,
        selectedLabel: match?.label || selected,
      };
    }
    case 'text':
    default:
      return { ok: true, text: String(value || '') };
  }
}
