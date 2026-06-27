/**
 * Thin wrappers over the platform's confirm/notify hooks. When the host app
 * provides them (desktop renders its own on-brand modal) they're used;
 * otherwise we degrade to the native window dialogs so nothing ever hangs.
 */
import type { BotsConfirmOptions, IBotsPlatform } from './platform';

export async function platformConfirm(
  platform: IBotsPlatform,
  opts: BotsConfirmOptions,
): Promise<boolean> {
  if (platform.confirm) return platform.confirm(opts);
  return window.confirm(opts.message || opts.title || 'Are you sure?');
}

export async function platformNotify(
  platform: IBotsPlatform,
  opts: Omit<BotsConfirmOptions, 'cancelLabel'>,
): Promise<void> {
  if (platform.notify) {
    await platform.notify(opts);
    return;
  }
  window.alert(opts.message || opts.title || '');
}
