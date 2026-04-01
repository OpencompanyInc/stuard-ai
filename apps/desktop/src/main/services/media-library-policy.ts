const MEDIA_GALLERY_EXCLUDED_TOOL_NAMES = new Set([
  'take_screenshot',
  'capture_media',
  'stop_capture',
  'capture_screen',
  'capture_system_audio',
]);

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
