import { describe, expect, it } from 'vitest';
import { testBotSetupPreflight } from './bot-setup-preflight';

describe('testBotSetupPreflight', () => {
  it('fails when a selected tool is not available to bots', () => {
    const result = testBotSetupPreflight(
      { allowedTools: ['analyze_media', 'not_real_tool'] },
      ['analyze_media'],
    );

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === 'tool-availability')?.status).toBe('fail');
  });

  it('blocks on unanswered clarification questions instead of silently launching blind', () => {
    const result = testBotSetupPreflight({
      allowedTools: ['analyze_media'],
      clarifyingQuestions: ['Which folder should I watch?'],
      clarifyingAnswers: {},
    }, ['analyze_media']);

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === 'clarifications')?.status).toBe('fail');
  });

  it('passes answered clarification questions and detects media setup risks', () => {
    const result = testBotSetupPreflight({
      allowedTools: ['ffmpeg_extract_audio', 'analyze_media', 'gmail_send_message'],
      clarifyingQuestions: ['Where are recordings saved?'],
      clarifyingAnswers: { 0: 'Downloads/Recordings' },
      setupChecks: ['Confirm the recording folder is accessible from the desktop and VM target.'],
    }, ['ffmpeg_extract_audio', 'ffmpeg_status', 'analyze_media', 'gmail_send_message']);

    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.id === 'clarifications')?.status).toBe('pass');
    expect(result.checks.find((check) => check.id === 'ffmpeg')?.status).toBe('warn');
    expect(result.checks.find((check) => check.id === 'email-auth')?.status).toBe('warn');
    expect(result.checks.find((check) => check.id === 'deployment-parity')?.status).toBe('warn');
  });
});
