import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, appGetPathMock, getAllWindowsMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  appGetPathMock: vi.fn(),
  getAllWindowsMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
  app: {
    getPath: appGetPathMock,
  },
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function loadFileIndexingModule() {
  vi.resetModules();
  return import('./file-indexing');
}

describe('file-indexing search bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    appGetPathMock.mockImplementation((name: string) => `C:/mock/${name}`);
    getAllWindowsMock.mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers the new result.results agent payload shape', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          results: [{ id: 'new-result', filename: 'cat.jpg' }],
          files: [{ id: 'legacy-result', filename: 'old-cat.jpg' }],
        }),
      });

    const { searchFiles } = await loadFileIndexingModule();
    await expect(searchFiles('cat')).resolves.toEqual([{ id: 'new-result', filename: 'cat.jpg' }]);
  });

  it('falls back to legacy result.files payloads', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          files: [{ id: 'legacy-result', filename: 'report.docx' }],
        }),
      });

    const { searchFiles } = await loadFileIndexingModule();
    await expect(searchFiles('report')).resolves.toEqual([{ id: 'legacy-result', filename: 'report.docx' }]);
  });

  it('skips legacy Windows app roots during startup scans', async () => {
    if (process.platform !== 'win32') {
      return;
    }

    process.env.ProgramFiles = 'C:\\Program Files';
    process.env.OneDrive = '';
    process.env.OneDriveConsumer = '';

    const roots = [
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

    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/health')) {
        return { ok: true };
      }

      const body = JSON.parse(String((init as any)?.body || '{}'));
      if (body.tool === 'file_index_list_roots') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ roots }),
        };
      }

      if (body.tool === 'file_index_add_root') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ ok: false }),
        };
      }

      if (body.tool === 'file_index_scan') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            ok: true,
            progress: {
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
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch call: ${String(url)}`);
    });

    const { runStartupIndexing } = await loadFileIndexingModule();
    await runStartupIndexing();

    const toolCalls = fetchMock.mock.calls
      .filter(([url]) => String(url).includes('/v1/tools/exec'))
      .map(([, init]) => JSON.parse(String((init as any).body)));

    expect(toolCalls).toEqual([
      { tool: 'file_index_list_roots', args: {} },
      { tool: 'file_index_list_roots', args: {} },
      { tool: 'file_index_scan', args: { root_id: 'docs-root' } },
    ]);
  });
});
