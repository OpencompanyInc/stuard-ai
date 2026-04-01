import { describe, expect, it } from 'vitest';

import {
  isMediaGalleryExcludedToolName,
  isMediaLibraryItemVisibleInDashboard,
  shouldAutoRegisterToolMedia,
} from './media-library-policy';

describe('media-library policy', () => {
  it('keeps capture-oriented local tools out of the dashboard media gallery', () => {
    expect(isMediaGalleryExcludedToolName('capture_media')).toBe(true);
    expect(isMediaGalleryExcludedToolName('stop_capture')).toBe(true);
    expect(isMediaGalleryExcludedToolName('capture_screen')).toBe(true);
    expect(isMediaGalleryExcludedToolName('take_screenshot')).toBe(true);
    expect(isMediaGalleryExcludedToolName('capture_system_audio')).toBe(true);
  });

  it('still allows non-capture media tools to auto-register', () => {
    expect(shouldAutoRegisterToolMedia('generate_image')).toBe(true);
    expect(shouldAutoRegisterToolMedia('text_to_speech')).toBe(true);
    expect(shouldAutoRegisterToolMedia('capture_media')).toBe(false);
  });

  it('hides legacy auto-registered capture items from the dashboard media tab', () => {
    expect(isMediaLibraryItemVisibleInDashboard({
      metadata: { toolName: 'capture_media' },
    })).toBe(false);

    expect(isMediaLibraryItemVisibleInDashboard({
      metadata: { toolName: 'capture_screen' },
    })).toBe(false);

    expect(isMediaLibraryItemVisibleInDashboard({
      metadata: { toolName: 'generate_image' },
    })).toBe(true);

    expect(isMediaLibraryItemVisibleInDashboard({
      metadata: { hiddenFromMediaDashboard: true },
    })).toBe(false);
  });
});
