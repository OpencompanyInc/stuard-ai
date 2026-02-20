import { describe, it, expect } from 'vitest';
import { calcToolTimeout } from '../handlers/local';

describe('calcToolTimeout - Extended Tests', () => {
  describe('capture_media', () => {
    it('should return 60s for until_stop mode regardless of duration', () => {
      expect(calcToolTimeout('capture_media', { mode: 'until_stop' })).toBe(60000);
      expect(calcToolTimeout('capture_media', { mode: 'until_stop', durationMs: 300000 })).toBe(60000);
    });

    it('should add cushion for fixed mode with duration', () => {
      // 10s duration + 60s cushion = 70s
      expect(calcToolTimeout('capture_media', { mode: 'fixed', durationMs: 10000 })).toBe(70000);

      // 0 duration should still return minimum 60s
      expect(calcToolTimeout('capture_media', { mode: 'fixed', durationMs: 0 })).toBe(60000);
    });

    it('should add 2 minute cushion for recordings over 5 minutes', () => {
      // 6 min = 360000ms, should get 2 min cushion = 480000ms
      expect(calcToolTimeout('capture_media', { mode: 'fixed', durationMs: 360000 })).toBe(480000);
    });

    it('should handle invalid/negative duration', () => {
      expect(calcToolTimeout('capture_media', { mode: 'fixed', durationMs: -100 })).toBe(60000);
      expect(calcToolTimeout('capture_media', { mode: 'fixed', durationMs: NaN })).toBe(60000);
      expect(calcToolTimeout('capture_media', { mode: 'fixed', durationMs: 'invalid' })).toBe(60000);
    });

    it('should default to fixed mode when mode not specified', () => {
      expect(calcToolTimeout('capture_media', { durationMs: 30000 })).toBe(90000);
    });
  });

  describe('capture_screen / capture_system_audio', () => {
    it('should return 60s for until_stop and stream modes', () => {
      expect(calcToolTimeout('capture_screen', { mode: 'until_stop' })).toBe(60000);
      expect(calcToolTimeout('capture_screen', { mode: 'stream' })).toBe(60000);
      expect(calcToolTimeout('capture_screen', { stream: true })).toBe(60000);

      expect(calcToolTimeout('capture_system_audio', { mode: 'until_stop' })).toBe(60000);
      expect(calcToolTimeout('capture_system_audio', { mode: 'stream' })).toBe(60000);
      expect(calcToolTimeout('capture_system_audio', { stream: true })).toBe(60000);
    });

    it('should apply fixed-mode duration rules', () => {
      expect(calcToolTimeout('capture_screen', { mode: 'fixed', durationMs: 10000 })).toBe(70000);
      expect(calcToolTimeout('capture_system_audio', { mode: 'fixed', durationMs: 10000 })).toBe(70000);
      expect(calcToolTimeout('capture_screen', { mode: 'fixed', durationMs: 360000 })).toBe(480000);
      expect(calcToolTimeout('capture_system_audio', { mode: 'fixed', durationMs: 360000 })).toBe(480000);
    });
  });

  describe('stream_speech', () => {
    it('should add 60s to duration', () => {
      expect(calcToolTimeout('stream_speech', { durationMs: 30000 })).toBe(90000);
    });

    it('should return minimum 60s', () => {
      expect(calcToolTimeout('stream_speech', {})).toBe(60000);
      expect(calcToolTimeout('stream_speech', { durationMs: 0 })).toBe(60000);
    });

    it('should handle invalid duration', () => {
      expect(calcToolTimeout('stream_speech', { durationMs: NaN })).toBe(60000);
    });
  });

  describe('run_python_script', () => {
    it('should use base timeout when no packages', () => {
      // Default 30s + 30s = 60s, capped at 600s
      expect(calcToolTimeout('run_python_script', {})).toBe(60000);
    });

    it('should add 60s per package', () => {
      // 30s base + 2*60s packages + 30s = 180s
      expect(calcToolTimeout('run_python_script', { packages: ['pkg1', 'pkg2'] })).toBe(180000);
    });

    it('should use custom timeoutMs', () => {
      // 10s custom + 30s = 40s
      expect(calcToolTimeout('run_python_script', { timeoutMs: 10000 })).toBe(40000);
    });

    it('should combine custom timeout with packages', () => {
      // 10s + 1*60s + 30s = 100s
      expect(calcToolTimeout('run_python_script', { timeoutMs: 10000, packages: ['pkg1'] })).toBe(100000);
    });

    it('should cap at 600s maximum', () => {
      // Many packages should still be capped
      expect(calcToolTimeout('run_python_script', { packages: Array(20).fill('pkg') })).toBe(600000);
    });
  });

  describe('python_install', () => {
    it('should behave same as run_python_script', () => {
      expect(calcToolTimeout('python_install', { packages: ['pkg1'] })).toBe(120000);
    });
  });

  describe('run_node_script', () => {
    it('should use custom timeoutMs with 15s buffer', () => {
      expect(calcToolTimeout('run_node_script', { timeoutMs: 30000 })).toBe(45000);
    });

    it('should return 5 min default when no timeout specified', () => {
      expect(calcToolTimeout('run_node_script', {})).toBe(300000);
    });

    it('should cap at 600s', () => {
      expect(calcToolTimeout('run_node_script', { timeoutMs: 700000 })).toBe(600000);
    });
  });

  describe('run_command / run_system_command', () => {
    it('should use custom timeoutMs with 15s buffer', () => {
      expect(calcToolTimeout('run_command', { timeoutMs: 60000 })).toBe(75000);
      expect(calcToolTimeout('run_system_command', { timeoutMs: 60000 })).toBe(75000);
    });

    it('should return 5 min default', () => {
      expect(calcToolTimeout('run_command', {})).toBe(300000);
      expect(calcToolTimeout('run_system_command', {})).toBe(300000);
    });

    it('should cap at 600s', () => {
      expect(calcToolTimeout('run_command', { timeoutMs: 1000000 })).toBe(600000);
    });
  });

  describe('analyze_media', () => {
    it('should return 10 minute timeout', () => {
      expect(calcToolTimeout('analyze_media', {})).toBe(600000);
    });
  });

  describe('ffmpeg tools', () => {
    it('should return 20 minutes for ffmpeg_setup', () => {
      expect(calcToolTimeout('ffmpeg_setup', {})).toBe(1200000);
    });

    it('should use default timeout for ffmpeg operations', () => {
      expect(calcToolTimeout('ffmpeg_convert_media', {})).toBe(600000);
      expect(calcToolTimeout('ffmpeg_probe_media', {})).toBe(600000);
    });

    it('should add 30s buffer to custom timeout for ffmpeg operations', () => {
      expect(calcToolTimeout('ffmpeg_run', { timeoutMs: 10000 })).toBe(40000);
    });

    it('should cap ffmpeg operation timeout at 30 minutes', () => {
      expect(calcToolTimeout('ffmpeg_extract_audio', { timeoutMs: 99999999 })).toBe(1800000);
    });
  });

  describe('default timeout', () => {
    it('should return 5 minutes for unknown tools', () => {
      expect(calcToolTimeout('unknown_tool', {})).toBe(300000);
      expect(calcToolTimeout('some_other_tool', { random: 'args' })).toBe(300000);
    });
  });
});
