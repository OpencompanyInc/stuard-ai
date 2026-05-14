import { describe, expect, it } from 'vitest';

import {
  isMediaGalleryExcludedToolName,
  isMediaLibraryItemVisibleInDashboard,
  shouldAutoRegisterToolMedia,
} from './media-library-policy';

describe('media-library policy', () => {
  it('allows capture-oriented local tools in the dashboard media gallery', () => {
    expect(isMediaGalleryExcludedToolName('capture_media')).toBe(false);
    expect(isMediaGalleryExcludedToolName('stop_capture')).toBe(false);
    expect(isMediaGalleryExcludedToolName('capture_screen')).toBe(false);
    expect(isMediaGalleryExcludedToolName('take_screenshot')).toBe(false);
    expect(isMediaGalleryExcludedToolName('capture_system_audio')).toBe(false);
  });

  it('allows media-producing tools to auto-register', () => {
    expect(shouldAutoRegisterToolMedia('generate_image')).toBe(true);
    expect(shouldAutoRegisterToolMedia('text_to_speech')).toBe(true);
    expect(shouldAutoRegisterToolMedia('capture_media')).toBe(true);
  });

  it('only hides explicitly hidden items from the dashboard media tab', () => {
    expect(isMediaLibraryItemVisibleInDashboard({
      metadata: { toolName: 'capture_media' },
    })).toBe(true);

    expect(isMediaLibraryItemVisibleInDashboard({
      metadata: { toolName: 'capture_screen' },
    })).toBe(true);

    expect(isMediaLibraryItemVisibleInDashboard({
      metadata: { toolName: 'generate_image' },
    })).toBe(true);

    expect(isMediaLibraryItemVisibleInDashboard({
      metadata: { hiddenFromMediaDashboard: true },
    })).toBe(false);
  });
});
