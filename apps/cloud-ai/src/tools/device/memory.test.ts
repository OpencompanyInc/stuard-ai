import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSpaceMock,
  listSpacesMock,
  getSpaceItemsMock,
  getSpaceTreeMock,
} = vi.hoisted(() => ({
  getSpaceMock: vi.fn(),
  listSpacesMock: vi.fn(),
  getSpaceItemsMock: vi.fn(),
  getSpaceTreeMock: vi.fn(),
}));

vi.mock('./shared', () => ({
  hasClientBridge: () => true,
}));

vi.mock('../../memory/conversations', () => ({
  getSpace: getSpaceMock,
  listSpaces: listSpacesMock,
  getSpaceItems: getSpaceItemsMock,
  getSpaceTree: getSpaceTreeMock,
}));

import { get_space_tree, list_space_path } from './memory';

describe('space device tools', () => {
  beforeEach(() => {
    getSpaceMock.mockReset();
    listSpacesMock.mockReset();
    getSpaceItemsMock.mockReset();
    getSpaceTreeMock.mockReset();
  });

  it('resolves a space by name before listing path contents', async () => {
    getSpaceMock.mockResolvedValue(null);
    listSpacesMock.mockResolvedValue([
      { id: 'space-1', name: 'Projects', description: null, type: 'project' },
    ]);
    getSpaceItemsMock.mockResolvedValue([
      { id: 'item-1', type: 'note', title: 'Roadmap', content: '...' },
    ]);

    const result = await list_space_path.execute?.(
      { space_id: 'Projects', path: '', limit: 50 },
      {} as any
    );

    expect(listSpacesMock).toHaveBeenCalledWith({ include_archived: true, limit: 500 });
    expect(getSpaceItemsMock).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({ include_all: false, limit: 50 })
    );
    expect(result).toMatchObject({
      ok: true,
      folder_id: null,
      items: [{ id: 'item-1' }],
    });
  });

  it('returns an error when the space reference does not exist', async () => {
    getSpaceMock.mockResolvedValue(null);
    listSpacesMock.mockResolvedValue([]);

    const result = await list_space_path.execute?.(
      { space_id: 'Missing Space', path: '', limit: 200 },
      {} as any
    );

    expect(getSpaceItemsMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: 'space not found: Missing Space',
    });
  });

  it('resolves a space by name before loading its tree', async () => {
    getSpaceMock.mockResolvedValue(null);
    listSpacesMock.mockResolvedValue([
      { id: 'space-2', name: 'Research', description: null, type: 'research' },
    ]);
    getSpaceTreeMock.mockResolvedValue([{ id: 'folder-1', name: 'Notes', children: [] }]);

    const result = await get_space_tree.execute?.(
      { space_id: 'Research' },
      {} as any
    );

    expect(getSpaceTreeMock).toHaveBeenCalledWith('space-2');
    expect(result).toMatchObject({
      ok: true,
      tree: [{ id: 'folder-1' }],
    });
  });
});
