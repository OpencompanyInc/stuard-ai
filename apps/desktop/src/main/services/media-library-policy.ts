const MEDIA_GALLERY_EXCLUDED_TOOL_NAMES = new Set<string>();

export interface MediaGalleryPolicyItemLike {
  metadata?: Record<string, any> | null;
}

export function isMediaGalleryExcludedToolName(toolName: string | null | undefined) {
  return MEDIA_GALLERY_EXCLUDED_TOOL_NAMES.has(String(toolName || '').trim());
}

export function shouldAutoRegisterToolMedia(toolName: string | null | undefined) {
  return !isMediaGalleryExcludedToolName(toolName);
}

export function isMediaLibraryItemVisibleInDashboard(item: MediaGalleryPolicyItemLike | null | undefined) {
  if (!item) return false;
  if (item.metadata?.hiddenFromMediaDashboard === true) return false;
  return !isMediaGalleryExcludedToolName(item.metadata?.toolName);
}

const CAPTURE_START_TOOL_NAMES = new Set([
  'capture_media',
  'capture_screen',
  'capture_system_audio',
]);

/** Skip registering media while a capture session is still in progress. */
export function shouldSkipIncompleteCaptureRegistration(
  toolName: string | null | undefined,
  result: { status?: string | null; mode?: string | null } | null | undefined,
) {
  if (!CAPTURE_START_TOOL_NAMES.has(String(toolName || '').trim())) return false;
  const status = String(result?.status || '').trim().toLowerCase();
  if (status === 'recording' || status === 'streaming') return true;
  const mode = String(result?.mode || '').trim().toLowerCase();
  return mode === 'until_stop' || mode === 'stream';
}
