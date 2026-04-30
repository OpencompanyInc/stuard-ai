import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAllDisplaysMock,
  getDisplayNearestPointMock,
  getPrimaryDisplayMock,
  screenToDipPointMock,
} = vi.hoisted(() => ({
  getAllDisplaysMock: vi.fn(),
  getDisplayNearestPointMock: vi.fn(),
  getPrimaryDisplayMock: vi.fn(),
  screenToDipPointMock: vi.fn(),
}));

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: getAllDisplaysMock,
    getDisplayNearestPoint: getDisplayNearestPointMock,
    getPrimaryDisplay: getPrimaryDisplayMock,
    screenToDipPoint: screenToDipPointMock,
  },
}));

import { calculatePosition, mousePointToElectronPoint } from '../position';

const primaryDisplay = {
  bounds: { x: 0, y: 0, width: 1280, height: 720 },
  workArea: { x: 0, y: 0, width: 1280, height: 720 },
  scaleFactor: 1,
};

describe('custom-ui positioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllDisplaysMock.mockReturnValue([primaryDisplay]);
    getDisplayNearestPointMock.mockReturnValue(primaryDisplay);
    getPrimaryDisplayMock.mockReturnValue(primaryDisplay);
    screenToDipPointMock.mockImplementation((point: { x: number; y: number }) => point);
  });

  it('uses Electron physical-to-DIP conversion for mouse tool coordinates', () => {
    screenToDipPointMock.mockReturnValue({ x: 100.4, y: 199.6 });

    expect(mousePointToElectronPoint(151, 299)).toEqual({ x: 100, y: 200 });
    expect(screenToDipPointMock).toHaveBeenCalledWith({ x: 151, y: 299 });
  });

  it('falls back to display scale math when native conversion is unavailable', () => {
    const scaledDisplay = {
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
      workArea: { x: 0, y: 0, width: 1280, height: 720 },
      scaleFactor: 1.5,
    };
    screenToDipPointMock.mockImplementation(() => {
      throw new Error('screenToDipPoint unavailable');
    });
    getAllDisplaysMock.mockReturnValue([scaledDisplay]);
    getDisplayNearestPointMock.mockReturnValue(scaledDisplay);

    expect(mousePointToElectronPoint(150, 300)).toEqual({ x: 100, y: 200 });
  });

  it('converts explicit custom window coordinates through the mouse coordinate path', () => {
    screenToDipPointMock.mockReturnValue({ x: 40, y: 60 });

    expect(calculatePosition('custom', 32, 32, 80, 120)).toEqual({ x: 40, y: 60 });
  });

  it('keeps preset positions in Electron window coordinates', () => {
    screenToDipPointMock.mockReturnValue({ x: 999, y: 999 });

    expect(calculatePosition('top-left', 100, 50, undefined, undefined, 12)).toEqual({ x: 12, y: 12 });
    expect(screenToDipPointMock).not.toHaveBeenCalled();
  });
});
