import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { inferCaptureSourceFromPath } from './media-library';

describe('media-library capture scan', () => {
  const root = path.join('C:', 'Users', 'solar', 'Documents', 'StuardAI', 'media');

  it('maps legacy agent folder names to library sources', () => {
    expect(inferCaptureSourceFromPath(
      path.join(root, 'videos', 'video_123.mp4'),
      root,
    )).toEqual({
      source: 'video-recordings',
      classification: 'Video capture',
    });
  });

  it('maps agent screen-recording folders to library sources', () => {
    expect(inferCaptureSourceFromPath(
      path.join(root, 'screen-recordings', 'screen_123.mp4'),
      root,
    )).toEqual({
      source: 'screen-recordings',
      classification: 'Screen recording',
    });
  });

  it('maps agent webcam video folders to library sources', () => {
    expect(inferCaptureSourceFromPath(
      path.join(root, 'video-recordings', '2026-06', 'video_123.mp4'),
      root,
    )).toEqual({
      source: 'video-recordings',
    });
  });

  it('maps agent photo and audio folders', () => {
    expect(inferCaptureSourceFromPath(
      path.join(root, 'photos', 'photo_123.jpg'),
      root,
    )).toEqual({
      source: 'photos',
      classification: 'Photo capture',
    });

    expect(inferCaptureSourceFromPath(
      path.join(root, 'recordings', 'audio_123.wav'),
      root,
    )).toEqual({
      source: 'audio-recordings',
      classification: 'Audio capture',
    });
  });

  it('recognizes library-managed source folders', () => {
    expect(inferCaptureSourceFromPath(
      path.join(root, 'generated', '2026-06', 'img.png'),
      root,
    )).toEqual({ source: 'generated' });
  });

  it('ignores files outside the media root', () => {
    expect(inferCaptureSourceFromPath(
      path.join('C:', 'Users', 'solar', 'Downloads', 'clip.mp4'),
      root,
    )).toBeNull();
  });
});
