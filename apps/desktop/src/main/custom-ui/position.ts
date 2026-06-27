import { screen } from 'electron';

function roundedPoint(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Number.isFinite(point.x) ? Math.round(point.x) : 0,
    y: Number.isFinite(point.y) ? Math.round(point.y) : 0,
  };
}

export function mousePointToElectronPoint(x: number, y: number): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { x: 0, y: 0 };
  }

  const point = { x, y };
  const screenToDipPoint = (screen as any).screenToDipPoint;
  if (typeof screenToDipPoint === 'function') {
    try {
      return roundedPoint(screenToDipPoint.call(screen, point));
    } catch {
      // Fall back to scaleFactor math below on platforms without this API.
    }
  }

  const displays = screen.getAllDisplays();
  const match = displays.find(display => {
    const scale = display.scaleFactor || 1;
    const left = display.bounds.x * scale;
    const top = display.bounds.y * scale;
    const right = left + display.bounds.width * scale;
    const bottom = top + display.bounds.height * scale;
    return x >= left && x < right && y >= top && y < bottom;
  });

  const display = match || screen.getDisplayNearestPoint({ x, y });
  const scale = display.scaleFactor || 1;
  if (scale === 1) return roundedPoint(point);

  return roundedPoint({
    x: Math.round(display.bounds.x + (x - display.bounds.x * scale) / scale),
    y: Math.round(display.bounds.y + (y - display.bounds.y * scale) / scale),
  });
}

export function calculatePosition(
  position: string | { x?: number; y?: number } | undefined,
  windowWidth: number,
  windowHeight: number,
  explicitX?: number,
  explicitY?: number,
  margin: number = 20
): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay();

  if (explicitX !== undefined && explicitY !== undefined) {
    return mousePointToElectronPoint(explicitX, explicitY);
  }

  if (position && typeof position === 'object') {
    const p = {
      x: position.x ?? workArea.x + margin,
      y: position.y ?? workArea.y + margin,
    };
    return position.x !== undefined && position.y !== undefined ? mousePointToElectronPoint(p.x, p.y) : p;
  }

  const pos = String(position || 'center').toLowerCase().replace(/[_-]/g, '');

  switch (pos) {
    case 'center':
      return {
        x: Math.round(workArea.x + (workArea.width - windowWidth) / 2),
        y: Math.round(workArea.y + (workArea.height - windowHeight) / 2),
      };
    case 'topleft':
      return { x: workArea.x + margin, y: workArea.y + margin };
    case 'top':
    case 'topcenter':
      return {
        x: Math.round(workArea.x + (workArea.width - windowWidth) / 2),
        y: workArea.y + margin,
      };
    case 'topright':
      return { x: workArea.x + workArea.width - windowWidth - margin, y: workArea.y + margin };
    case 'left':
    case 'centerleft':
      return {
        x: workArea.x + margin,
        y: Math.round(workArea.y + (workArea.height - windowHeight) / 2),
      };
    case 'right':
    case 'centerright':
      return {
        x: workArea.x + workArea.width - windowWidth - margin,
        y: Math.round(workArea.y + (workArea.height - windowHeight) / 2),
      };
    case 'bottomleft':
      return { x: workArea.x + margin, y: workArea.y + workArea.height - windowHeight - margin };
    case 'bottom':
    case 'bottomcenter':
      return {
        x: Math.round(workArea.x + (workArea.width - windowWidth) / 2),
        y: workArea.y + workArea.height - windowHeight - margin,
      };
    case 'bottomright':
      return {
        x: workArea.x + workArea.width - windowWidth - margin,
        y: workArea.y + workArea.height - windowHeight - margin,
      };
    default:
      return {
        x: Math.round(workArea.x + (workArea.width - windowWidth) / 2),
        y: Math.round(workArea.y + (workArea.height - windowHeight) / 2),
      };
  }
}
