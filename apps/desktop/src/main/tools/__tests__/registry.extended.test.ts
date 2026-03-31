import { describe, it, expect } from 'vitest';
import { getToolKind, TOOL_REGISTRY, ToolKind } from '../registry';

describe('Tool Registry - Extended Tests', () => {
  describe('TOOL_REGISTRY structure', () => {
    it('should have valid kind values for all entries', () => {
      const validKinds: ToolKind[] = ['local', 'cloud', 'orchestration', 'electron'];

      for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
        expect(validKinds).toContain(entry.kind);
      }
    });

    it('should have handler paths for cloud tools that require them', () => {
      const cloudToolsWithHandlers = Object.entries(TOOL_REGISTRY)
        .filter(([_, v]) => v.kind === 'cloud' && v.handler);

      for (const [name, entry] of cloudToolsWithHandlers) {
        expect(entry.handler).toMatch(/^\/[a-z0-9\/\-_]+$/i);
      }
    });
  });

  describe('getToolKind - electron tools', () => {
    const electronTools = [
      '_media_register',
      'custom_ui',
      'update_custom_ui',
      'close_custom_ui',
      'stop_workflow',
      'log',
      'wait',
      'end',
      'invoke_workflow',
      'test_run_steps',
      'play_audio',
      'get_clipboard_content',
      'set_clipboard_content',
      'call_workspace_function',
      'list_workspace_functions',
    ];

    for (const tool of electronTools) {
      it(`should return 'electron' for ${tool}`, () => {
        expect(getToolKind(tool)).toBe('electron');
      });
    }
  });

  describe('getToolKind - variable tools', () => {
    const variableTools = [
      'set_variable',
      'get_variable',
      'toggle_variable',
      'increment_variable',
      'append_to_list',
      'list_variables',
      'delete_variable',
    ];

    for (const tool of variableTools) {
      it(`should return 'electron' for ${tool}`, () => {
        expect(getToolKind(tool)).toBe('electron');
      });
    }
  });

  describe('getToolKind - terminal tools', () => {
    const terminalTools = [
      'terminal_create',
      'terminal_list',
      'terminal_get',
      'terminal_send_input',
      'terminal_send_raw',
      'terminal_send_keys',
      'terminal_read',
      'terminal_wait_for',
      'terminal_destroy',
    ];

    for (const tool of terminalTools) {
      it(`should return 'electron' for ${tool}`, () => {
        expect(getToolKind(tool)).toBe('electron');
      });
    }
  });

  describe('getToolKind - orchestration tools', () => {
    const orchestrationTools = [
      'run_sequential',
      'run_parallel',
      'loop_executor',
    ];

    for (const tool of orchestrationTools) {
      it(`should return 'orchestration' for ${tool}`, () => {
        expect(getToolKind(tool)).toBe('orchestration');
      });
    }
  });

  describe('getToolKind - cloud tools', () => {
    const cloudTools = [
      'analyze_media',
      'ai_inference',
      'analyze_image',
      'analyze_current_screen',
      'cloud_ai_vision',
      'web_search',
      'text_to_speech',
      'list_tts_voices',
      'youtube_get_video',
      'youtube_get_channel',
      'youtube_get_playlist',
      'youtube_search',
      'search_marketplace',
      'get_marketplace_workflow',
      'import_from_marketplace',
      'list_popular_workflows',
      'list_marketplace_categories',
    ];

    for (const tool of cloudTools) {
      it(`should return 'cloud' for ${tool}`, () => {
        expect(getToolKind(tool)).toBe('cloud');
      });
    }
  });

  describe('getToolKind - default behavior', () => {
    it('should return "local" for unregistered tools', () => {
      expect(getToolKind('random_tool_name')).toBe('local');
      expect(getToolKind('some_python_tool')).toBe('local');
      expect(getToolKind('run_command')).toBe('local');
      expect(getToolKind('capture_screenshot')).toBe('local');
      expect(getToolKind('read_file')).toBe('local');
    });

    it('should handle empty string', () => {
      expect(getToolKind('')).toBe('local');
    });
  });

  describe('cloud tool handlers', () => {
    it('should have correct handler for analyze_media', () => {
      expect(TOOL_REGISTRY['analyze_media'].handler).toBe('/inference/ai/analyze-media');
    });

    it('should have correct handler for ai_inference', () => {
      expect(TOOL_REGISTRY['ai_inference'].handler).toBe('/inference/ai/text');
    });

    it('should have correct handler for cloud_ai_vision', () => {
      expect(TOOL_REGISTRY['cloud_ai_vision'].handler).toBe('/inference/ai/vision-structured');
    });

    it('should have correct handler for web_search', () => {
      expect(TOOL_REGISTRY['web_search'].handler).toBe('/tools/web_search');
    });

    it('should have correct handler for text_to_speech', () => {
      expect(TOOL_REGISTRY['text_to_speech'].handler).toBe('/tools/text_to_speech');
    });
  });
});
