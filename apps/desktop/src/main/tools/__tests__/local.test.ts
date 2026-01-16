import { describe, it, expect } from 'vitest';
import { calcToolTimeout } from '../handlers/local';

describe('calcToolTimeout', () => {
  it('should return default timeout for unknown tools', () => {
    expect(calcToolTimeout('unknown', {})).toBe(300000); // 5 min
  });

  it('should calculate timeout for run_python_script with packages', () => {
    const args = { packages: ['pkg1', 'pkg2'], timeoutMs: 10000 };
    // 10000 + 2*60000 + 30000 = 160000
    expect(calcToolTimeout('run_python_script', args)).toBe(160000);
  });

  it('should handle capture_media until_stop', () => {
    expect(calcToolTimeout('capture_media', { mode: 'until_stop' })).toBe(60000);
  });

  it('should handle capture_media fixed duration', () => {
    // 10s duration -> 10s + 60s cushion = 70s = 70000ms
    expect(calcToolTimeout('capture_media', { mode: 'fixed', durationMs: 10000 })).toBe(70000);
  });
});
