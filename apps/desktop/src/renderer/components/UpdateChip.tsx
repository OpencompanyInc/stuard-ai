import React from 'react';
import { clsx } from 'clsx';
import { ArrowUpCircle } from 'lucide-react';
import { isUpdateActionable, openUpdateSettings, useUpdateStatus } from '../hooks/useUpdateStatus';

interface UpdateChipProps {
  /**
   * header  = 32px pill matching the chat header icon buttons (window,
   *           sidebar & launcher chrome).
   * topbar  = dashboard top-bar pill, sized like the dashboard badges.
   */
  variant?: 'header' | 'topbar';
  /** Override the click action (the dashboard navigates internally). */
  onOpen?: () => void;
  className?: string;
}

/**
 * "Update ready" pill — appears only while a newer version is available,
 * downloading, or downloaded. Soft primary tint (no saturated glow), one
 * click away from Settings → Updates.
 */
export const UpdateChip: React.FC<UpdateChipProps> = ({ variant = 'header', onOpen, className }) => {
  const update = useUpdateStatus();
  if (!isUpdateActionable(update.status)) return null;

  const version = update.latestVersion ? `v${update.latestVersion}` : 'new version';
  const label =
    update.status === 'downloading'
      ? `Updating… ${typeof update.downloadProgress === 'number' ? `${update.downloadProgress}%` : ''}`.trim()
      : update.status === 'downloaded'
        ? 'Restart to update'
        : 'Update ready';
  const title =
    update.status === 'downloading'
      ? `Downloading ${version}…`
      : update.status === 'downloaded'
        ? `${version} is downloaded — install from Settings → Updates`
        : `${version} is available — open Settings → Updates`;

  return (
    <button
      type="button"
      onClick={onOpen ?? openUpdateSettings}
      title={title}
      className={clsx(
        'no-drag relative flex items-center flex-shrink-0 transition-all active:scale-95',
        variant === 'header' ? 'h-8 gap-1.5 px-2.5 rounded-lg border' : 'h-[30px] gap-1.5 px-3 rounded-full border',
        className,
      )}
      style={{
        background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
        borderColor: 'color-mix(in srgb, var(--primary) 28%, transparent)',
        color: 'var(--primary)',
      }}
    >
      <ArrowUpCircle className="w-3.5 h-3.5" strokeWidth={2} />
      <span className="text-[11.5px] font-semibold whitespace-nowrap leading-none">{label}</span>
    </button>
  );
};

export default UpdateChip;
