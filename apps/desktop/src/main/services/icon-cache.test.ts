import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getFileIconMock,
  createFromPathMock,
  existsSyncMock,
  statSyncMock,
  readdirSyncMock,
} = vi.hoisted(() => ({
  getFileIconMock: vi.fn(),
  createFromPathMock: vi.fn(),
  existsSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getFileIcon: getFileIconMock,
  },
  nativeImage: {
    createFromPath: createFromPathMock,
  },
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
  statSync: statSyncMock,
  readdirSync: readdirSyncMock,
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeImage(dataUrl: string) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width: 32, height: 32 }),
    toBitmap: () => Buffer.from([0, 0, 0, 255, 1, 1, 1, 255]),
    toDataURL: () => dataUrl,
  };
}

function makeThumbnailSource(dataUrl: string) {
  return {
    ...makeImage(`${dataUrl}-source`),
    resize: vi.fn(() => ({
      isEmpty: () => false,
      toDataURL: () => dataUrl,
    })),
  };
}

async function loadIconCacheModule() {
  vi.resetModules();
  return import('./icon-cache');
}

describe('icon-cache previews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ mtimeMs: 1000, size: 42 });
    readdirSyncMock.mockReturnValue([]);
  });

  it('uses thumbnails for eligible image previews while keeping icon mode separate', async () => {
    createFromPathMock.mockReturnValue(makeThumbnailSource('data:thumb'));
    getFileIconMock.mockResolvedValue(makeImage('data:icon'));

    const { getFilePreviewCached } = await loadIconCacheModule();
    const thumbnail = await getFilePreviewCached('C:/images/cat.jpg', {
      size: 'normal',
      preferThumbnail: true,
    });
    const icon = await getFilePreviewCached('C:/images/cat.jpg', {
      size: 'normal',
      preferThumbnail: false,
    });

    expect(thumbnail).toEqual({ ok: true, dataUrl: 'data:thumb' });
    expect(icon).toEqual({ ok: true, dataUrl: 'data:icon' });
    expect(createFromPathMock).toHaveBeenCalledTimes(1);
    expect(getFileIconMock).toHaveBeenCalledTimes(1);
  });

  it('invalidates cached icon entries when the file fingerprint changes', async () => {
    getFileIconMock.mockResolvedValue(makeImage('data:icon'));

    const { getFilePreviewCached } = await loadIconCacheModule();

    await expect(getFilePreviewCached('C:/docs/report.txt', { preferThumbnail: false })).resolves.toEqual({
      ok: true,
      dataUrl: 'data:icon',
    });
    await expect(getFilePreviewCached('C:/docs/report.txt', { preferThumbnail: false })).resolves.toEqual({
      ok: true,
      dataUrl: 'data:icon',
    });
    expect(getFileIconMock).toHaveBeenCalledTimes(1);

    statSyncMock.mockReturnValue({ mtimeMs: 2000, size: 42 });

    await expect(getFilePreviewCached('C:/docs/report.txt', { preferThumbnail: false })).resolves.toEqual({
      ok: true,
      dataUrl: 'data:icon',
    });
    expect(getFileIconMock).toHaveBeenCalledTimes(2);
  });
});
