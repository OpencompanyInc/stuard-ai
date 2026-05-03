import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type IndexedRoot = {
  id: string;
  path: string;
  enabled: boolean;
  schedule: string;
  interval_hours: number | null;
  last_scan_at: string | null;
  next_scan_at: string | null;
  last_scan_id: number;
  backend: string;
  watch_state: string;
  volume_serial: string | null;
  last_reconcile_at: string | null;
  created_at: string;
};

const {
  rustListRootsMock,
  rustAddRootMock,
  rustRemoveRootMock,
  rustScanRootMock,
  rustSearchMock,
  rustGetStatsMock,
  rustListFolderMock,
  isIndexerAvailableMock,
  resolveIndexerBinaryMock,
  appGetPathMock,
  existsSyncMock,
  getAllWindowsMock,
} = vi.hoisted(() => ({
  rustListRootsMock: vi.fn(),
  rustAddRootMock: vi.fn(),
  rustRemoveRootMock: vi.fn(),
  rustScanRootMock: vi.fn(),
  rustSearchMock: vi.fn(),
  rustGetStatsMock: vi.fn(),
  rustListFolderMock: vi.fn(),
  isIndexerAvailableMock: vi.fn(),
  resolveIndexerBinaryMock: vi.fn(),
  appGetPathMock: vi.fn(),
  existsSyncMock: vi.fn(),
  getAllWindowsMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: getAllWindowsMock },
  app: { getPath: appGetPathMock },
}));

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./rust-file-indexer', () => ({
  listRoots: rustListRootsMock,
  addRoot: rustAddRootMock,
  removeRoot: rustRemoveRootMock,
  scanRoot: rustScanRootMock,
  searchFiles: rustSearchMock,
  getStats: rustGetStatsMock,
  listFolder: rustListFolderMock,
  isIndexerAvailable: isIndexerAvailableMock,
  resolveIndexerBinary: resolveIndexerBinaryMock,
  resolveDbPath: vi.fn(),
}));

async function loadFileIndexingModule() {
  vi.resetModules();
  return import('./file-indexing');
}

function progressStub() {
  return {
    total_dirs: 1,
    scanned_dirs: 1,
    total_files: 1,
    new_files: 1,
    changed_files: 0,
    unchanged_files: 0,
    skipped_files: 0,
    deleted_files: 0,
    moved_files: 0,
    errors: 0,
    elapsed_seconds: 1,
    files_per_second: 1,
  };
}

describe('file-indexing (Rust backend)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appGetPathMock.mockImplementation((name: string) => `C:/mock/${name}`);
    existsSyncMock.mockReturnValue(false);
    getAllWindowsMock.mockReturnValue([]);
    resolveIndexerBinaryMock.mockReturnValue('C:/mock/stuard-file-indexer.exe');
    isIndexerAvailableMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searchFiles delegates to the Rust bridge', async () => {
    rustSearchMock.mockResolvedValueOnce([{ id: 'file-1', filename: 'cat.jpg' }]);
    const { searchFiles } = await loadFileIndexingModule();
    await expect(searchFiles('cat')).resolves.toEqual([{ id: 'file-1', filename: 'cat.jpg' }]);
    expect(rustSearchMock).toHaveBeenCalledWith('cat', {});
  });

  it('searchFiles returns [] when the binary is missing', async () => {
    resolveIndexerBinaryMock.mockReturnValueOnce(null);
    const { searchFiles } = await loadFileIndexingModule();
    await expect(searchFiles('anything')).resolves.toEqual([]);
  });

  it('uses the home directory as the default Windows root and triggers a Rust scan', async () => {
    if (process.platform !== 'win32') return;

    appGetPathMock.mockImplementation((name: string) => {
      if (name === 'home') return 'C:\\Users\\solar';
      return `C:\\Users\\solar\\${name}`;
    });
    existsSyncMock.mockImplementation((target: string) => target === 'C:\\Users\\solar');

    const added: IndexedRoot[] = [];
    rustListRootsMock.mockImplementation(async () => [...added]);
    rustAddRootMock.mockImplementation(async (p: string, schedule: string, intervalHours?: number) => {
      const root: IndexedRoot = {
        id: 'home-root',
        path: p,
        enabled: true,
        schedule,
        interval_hours: intervalHours ?? null,
        last_scan_at: null,
        next_scan_at: null,
        last_scan_id: 0,
        backend: 'rust',
        watch_state: 'inactive',
        volume_serial: null,
        last_reconcile_at: null,
        created_at: '2026-05-03T00:00:00.000Z',
      };
      added.push(root);
      return root;
    });
    rustScanRootMock.mockResolvedValue(progressStub());

    const { runStartupIndexing } = await loadFileIndexingModule();
    await runStartupIndexing();

    expect(rustAddRootMock).toHaveBeenCalledWith('C:\\Users\\solar', 'daily', undefined);
    expect(rustScanRootMock).toHaveBeenCalledWith('home-root');
  });

  it('skips legacy and nested Windows roots during startup scans', async () => {
    if (process.platform !== 'win32') return;

    process.env.ProgramFiles = 'C:\\Program Files';
    process.env.OneDrive = '';
    process.env.OneDriveConsumer = '';

    const roots: IndexedRoot[] = [
      {
        id: 'legacy-root',
        path: 'C:\\Program Files',
        enabled: true,
        schedule: 'daily',
        interval_hours: null,
        last_scan_at: null,
        next_scan_at: null,
        last_scan_id: 0,
        backend: 'generic',
        watch_state: 'inactive',
        volume_serial: null,
        last_reconcile_at: null,
        created_at: '2026-04-17T00:00:00.000Z',
      },
      {
        id: 'home-root',
        path: 'C:\\Users\\solar',
        enabled: true,
        schedule: 'daily',
        interval_hours: null,
        last_scan_at: null,
        next_scan_at: null,
        last_scan_id: 0,
        backend: 'rust',
        watch_state: 'inactive',
        volume_serial: null,
        last_reconcile_at: null,
        created_at: '2026-04-17T00:00:00.000Z',
      },
      {
        id: 'docs-root',
        path: 'C:\\Users\\solar\\Documents',
        enabled: true,
        schedule: 'daily',
        interval_hours: null,
        last_scan_at: null,
        next_scan_at: null,
        last_scan_id: 0,
        backend: 'generic',
        watch_state: 'inactive',
        volume_serial: null,
        last_reconcile_at: null,
        created_at: '2026-04-17T00:00:00.000Z',
      },
    ];

    rustListRootsMock.mockResolvedValue(roots);
    rustAddRootMock.mockResolvedValue(null);
    rustScanRootMock.mockResolvedValue(progressStub());

    const { runStartupIndexing } = await loadFileIndexingModule();
    await runStartupIndexing();

    // Only the non-legacy, non-nested home root should be scanned.
    expect(rustScanRootMock).toHaveBeenCalledTimes(1);
    expect(rustScanRootMock).toHaveBeenCalledWith('home-root');
  });
});
