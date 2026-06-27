import { describe, expect, it } from 'vitest';
import {
  createLauncherSuggestionsServerCacheKey,
  parseLauncherSuggestionsText,
  sanitizeBotBlueprint,
} from './inference';

const videoRundownGoal = [
  'At least every week on a random day, maybe multiple times a day or multiple days a week,',
  'I will record a short normal camera video.',
  'Convert it to MP3, transcribe it, give me the rundown, then send that to my email.',
].join(' ');

const mediaEmailTools = [
  'capture_media',
  'file_search',
  'ffmpeg_extract_audio',
  'ffmpeg_convert_media',
  'analyze_media',
  'gmail_send_message',
  'google_get_userinfo',
];

describe('sanitizeBotBlueprint — generic contract (no example coupling)', () => {
  it('trusts the model\'s tool picks and strips capture_* tools when no capture probe ran', () => {
    const blueprint = sanitizeBotBlueprint({
      name: 'Video Rundown',
      emoji: 'bot',
      description: 'Process short videos and email a rundown.',
      systemPrompt: 'Process short videos and email a rundown.',
      instructions: 'Check for a new recording, process it, and send the result.',
      // Model tried to slip in capture_media even though the user records externally.
      allowedTools: ['analyze_media', 'capture_media', 'gmail_send_message'],
      interval: 'random',
      toolRationale: [{ tool: 'analyze_media', reason: 'Transcribe and summarize media.' }],
    }, {
      goal: videoRundownGoal,
      availableTools: mediaEmailTools,
      discoveredTools: [
        { name: 'analyze_media', description: 'Analyze media', category: 'vision' },
        { name: 'capture_media', description: 'Capture media on this device', category: 'capture' },
        { name: 'gmail_send_message', description: 'Send a Gmail message', category: 'email' },
      ],
      // No capture_devices_available probe was run — capture_media must be stripped.
      registeredPreflightSteps: [],
    });

    expect(blueprint.allowedTools).toContain('analyze_media');
    expect(blueprint.allowedTools).toContain('gmail_send_message');
    expect(blueprint.allowedTools).not.toContain('capture_media');
    expect(blueprint.clarifyingQuestions.length).toBe(0);
    expect(blueprint.setupChecks.length).toBe(0);
  });

  it('keeps a model-picked tool that was validated via a probe but never returned by tool search', () => {
    // Reproduces the "agent only got analyze_media" bug: the model searched for
    // analyze_media (so it lands in discoveredTools) but validated Gmail through
    // an agent_test_run probe (oauth_connected / tool_available), so
    // gmail_send_message is a real registry tool yet absent from discoveredTools.
    // The model's own picks must be gated on the registry, not on discovery.
    const blueprint = sanitizeBotBlueprint({
      name: 'Rant Analyzer & Mailer',
      emoji: 'bot',
      description: 'Convert new video rants to audio, analyze them, and email the insights.',
      systemPrompt: 'Process video rants and email the analysis.',
      instructions: 'On a new recording, extract audio, analyze, and email the rundown.',
      allowedTools: ['analyze_media', 'gmail_send_message'],
      interval: 'manual',
    }, {
      goal: 'Watch my recordings folder, convert new videos to audio, analyze them, and email me the thoughts.',
      availableTools: mediaEmailTools,
      // Only analyze_media was surfaced via agent_tool_search; gmail_send_message
      // was confirmed via an agent_test_run probe instead.
      discoveredTools: [
        { name: 'analyze_media', description: 'Analyze media', category: 'vision' },
      ],
      registeredPreflightSteps: [{
        id: 'oauth',
        probe: 'oauth_connected',
        label: 'Gmail OAuth check',
      }],
    });

    expect(blueprint.allowedTools).toContain('analyze_media');
    expect(blueprint.allowedTools).toContain('gmail_send_message');
  });

  it('keeps capture tools when the model successfully probed capture devices', () => {
    const blueprint = sanitizeBotBlueprint({
      name: 'Screen Watcher',
      description: 'Watch the screen and summarize.',
      systemPrompt: 'Watch the screen.',
      instructions: 'Capture periodically.',
      allowedTools: ['capture_screen', 'analyze_media'],
      interval: '30m',
    }, {
      goal: 'Stuard, please capture my screen every 30 minutes and summarize.',
      availableTools: ['capture_screen', 'analyze_media'],
      discoveredTools: [
        { name: 'capture_screen', description: 'Capture the screen', category: 'capture' },
        { name: 'analyze_media', description: 'Analyze media', category: 'vision' },
      ],
      registeredPreflightSteps: [{
        id: 'capture',
        probe: 'capture_devices_available',
        label: 'Capture devices available',
      }],
    });

    expect(blueprint.allowedTools).toContain('capture_screen');
    expect(blueprint.allowedTools).toContain('analyze_media');
  });

  it('strips capture_* prefix tools by pattern, not by name list — future capture tools are covered too', () => {
    const blueprint = sanitizeBotBlueprint({
      name: 'Hypothetical',
      description: 'Anything.',
      systemPrompt: 'Anything.',
      instructions: 'Do the thing.',
      allowedTools: ['capture_braininterface_v3', 'stop_capture_braininterface_v3', 'analyze_media'],
      interval: '30m',
    }, {
      goal: 'Process whatever the user sends.',
      availableTools: ['capture_braininterface_v3', 'stop_capture_braininterface_v3', 'analyze_media'],
      discoveredTools: [
        { name: 'capture_braininterface_v3', description: 'Hypothetical future capture tool', category: 'capture' },
        { name: 'stop_capture_braininterface_v3', description: 'Stop the hypothetical capture', category: 'capture' },
        { name: 'analyze_media', description: 'Analyze media', category: 'vision' },
      ],
      registeredPreflightSteps: [],
    });

    expect(blueprint.allowedTools).not.toContain('capture_braininterface_v3');
    expect(blueprint.allowedTools).not.toContain('stop_capture_braininterface_v3');
    expect(blueprint.allowedTools).toContain('analyze_media');
  });

  it('defaults interval to 30m when the model does not return a recognized one (no keyword inference on goal text)', () => {
    const blueprint = sanitizeBotBlueprint({
      name: 'Random Goal',
      description: 'Whatever.',
      systemPrompt: 'Whatever.',
      instructions: 'Whatever.',
      allowedTools: ['analyze_media'],
      interval: 'not-a-real-interval',
    }, {
      // Goal text mentions "random" and "weekly" — the old heuristic would have
      // picked 'random'. The new contract trusts the model only and falls back
      // to '30m', so it stays generic across any user prompt.
      goal: 'Pick a random day weekly and do the thing — multiple times a day if useful.',
      availableTools: ['analyze_media'],
      discoveredTools: [{ name: 'analyze_media', description: 'Analyze media', category: 'vision' }],
    });

    expect(blueprint.interval).toBe('30m');
  });

  it('preserves first-class builder clarification tool questions in the blueprint', () => {
    const question = 'Which folder should I watch for new recordings?';
    const blueprint = sanitizeBotBlueprint({
      name: 'Video Rundown',
      description: 'Process short videos and email a rundown.',
      systemPrompt: 'Process short videos and email a rundown.',
      instructions: 'Check for a new recording.',
      allowedTools: ['analyze_media'],
      interval: 'random',
    }, {
      goal: videoRundownGoal,
      availableTools: mediaEmailTools,
      discoveredTools: [{ name: 'analyze_media', description: 'Analyze media', category: 'vision' }],
      builderClarifyingQuestions: [question],
    });

    expect(blueprint.clarifyingQuestions[0]).toBe(question);
  });

  it('drops a clarifyingQuestion from the final blueprint when the user already answered it during setup', () => {
    const question = 'Which folder should I watch for new recordings?';
    const blueprint = sanitizeBotBlueprint({
      name: 'Video Rundown',
      description: 'Process short videos.',
      systemPrompt: 'Process short videos.',
      instructions: 'Check for a new recording.',
      allowedTools: ['analyze_media'],
      interval: '30m',
      clarifyingQuestions: [question],
    }, {
      goal: 'Generic agent goal.',
      availableTools: ['analyze_media'],
      discoveredTools: [{ name: 'analyze_media', description: 'Analyze media', category: 'vision' }],
      clarifyingAnswers: [{ question, answer: 'C:\\Users\\me\\Recordings' }],
    });

    expect(blueprint.clarifyingQuestions).not.toContain(question);
    expect(blueprint.clarifyingAnswers[0]).toEqual({ question, answer: 'C:\\Users\\me\\Recordings' });
  });
});

describe('launcher suggestion helpers', () => {
  it('parses suggestion JSON and removes forbidden starter text', () => {
    expect(
      parseLauncherSuggestionsText(
        '```json\n["Plan today","Help me with email","Search recent files"]\n```',
        4,
      ),
    ).toEqual(['Plan today', 'Search recent files']);
  });

  it('keys server cache by user and normalized context', () => {
    const base = createLauncherSuggestionsServerCacheKey({
      userId: 'user-1',
      prompt: '',
      name: 'Alex',
      memories: ['[project] StuardAI'],
      count: 4,
    });
    const same = createLauncherSuggestionsServerCacheKey({
      userId: 'user-1',
      prompt: '',
      name: ' alex ',
      memories: ['[project] StuardAI'],
      count: 4,
    });
    const otherUser = createLauncherSuggestionsServerCacheKey({
      userId: 'user-2',
      prompt: '',
      name: 'Alex',
      memories: ['[project] StuardAI'],
      count: 4,
    });

    expect(same).toBe(base);
    expect(otherUser).not.toBe(base);
  });
});
