import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  contentToText,
  extractToolCalls,
  extractToolResults,
  buildTranscript,
  analyzeForAutoSkill,
  type ConversationMessage,
  type AutoSkillDraft,
} from './auto-skills';

// ═══════════════════════════════════════════════════════════════════════════════
// SAMPLE CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Conversation where the user corrects the AI's web search approach multiple times,
 * teaches it to use http_request with the right API endpoint instead of web_search,
 * and injects corrections between tool calls. Should produce an auto-skill.
 */
const TEACHABLE_CONVERSATION: ConversationMessage[] = [
  { role: 'user', content: 'Search for the latest Bitcoin price and format it nicely' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Let me search for the Bitcoin price.' },
      { type: 'tool-call', toolName: 'web_search', args: { query: 'bitcoin price today' }, toolCallId: 'tc1' },
    ],
  },
  {
    role: 'tool',
    content: [
      { type: 'tool-result', toolName: 'web_search', result: 'Various news articles about crypto...', toolCallId: 'tc1' },
    ],
  },
  {
    role: 'user',
    content: "No don't use web_search for prices, use the CoinGecko API with http_request. The endpoint is https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Let me use the CoinGecko API instead.' },
      {
        type: 'tool-call',
        toolName: 'http_request',
        args: { url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', method: 'GET' },
        toolCallId: 'tc2',
      },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolName: 'http_request',
        result: '{"bitcoin":{"usd":67432.15}}',
        toolCallId: 'tc2',
      },
    ],
  },
  {
    role: 'assistant',
    content: 'The current Bitcoin price is $67432.15.',
  },
  {
    role: 'user',
    content: "Format it with commas and a dollar sign, like $67,432.15. Also always include the 24h change. Add &include_24hr_change=true to the API call.",
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Let me fetch with the 24h change included.' },
      {
        type: 'tool-call',
        toolName: 'http_request',
        args: {
          url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
          method: 'GET',
        },
        toolCallId: 'tc3',
      },
    ],
  },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolName: 'http_request',
        result: '{"bitcoin":{"usd":67432.15,"usd_24h_change":2.34}}',
        toolCallId: 'tc3',
      },
    ],
  },
  {
    role: 'assistant',
    content: 'Bitcoin: $67,432.15 (24h change: +2.34%)',
  },
  { role: 'user', content: 'Perfect, that is exactly how I want it formatted every time.' },
];

/**
 * Simple Q&A conversation — no teachable pattern, should NOT generate a skill.
 */
const SIMPLE_QA_CONVERSATION: ConversationMessage[] = [
  { role: 'user', content: 'What is the capital of France?' },
  { role: 'assistant', content: 'The capital of France is Paris.' },
  { role: 'user', content: 'And Germany?' },
  { role: 'assistant', content: 'The capital of Germany is Berlin.' },
  { role: 'user', content: 'Thanks' },
  { role: 'assistant', content: "You're welcome!" },
];

/**
 * Conversation too short to analyze (below MIN_MESSAGES threshold).
 */
const SHORT_CONVERSATION: ConversationMessage[] = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi! How can I help?' },
  { role: 'user', content: 'Bye' },
];

/**
 * Conversation with multiple tool corrections and user injections mid-flow.
 * The user teaches the AI to deploy correctly by correcting tool calls.
 */
const MULTI_CORRECTION_CONVERSATION: ConversationMessage[] = [
  { role: 'user', content: 'Deploy my app to the staging server' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'I\'ll deploy your app now.' },
      { type: 'tool-call', toolName: 'run_command', args: { command: 'npm run build' }, toolCallId: 'tc1' },
    ],
  },
  {
    role: 'tool',
    content: [{ type: 'tool-result', toolName: 'run_command', result: 'Build successful', toolCallId: 'tc1' }],
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Build done. Now deploying...' },
      { type: 'tool-call', toolName: 'run_command', args: { command: 'scp -r dist/ prod-server:/var/www' }, toolCallId: 'tc2' },
    ],
  },
  {
    role: 'user',
    content: "STOP! That's the production server! I said STAGING. The staging server is staging-server:/var/www/staging. Always use staging first!",
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Sorry, let me deploy to staging instead.' },
      { type: 'tool-call', toolName: 'run_command', args: { command: 'scp -r dist/ staging-server:/var/www/staging' }, toolCallId: 'tc3' },
    ],
  },
  {
    role: 'tool',
    content: [{ type: 'tool-result', toolName: 'run_command', result: 'Files copied successfully', toolCallId: 'tc3' }],
  },
  {
    role: 'user',
    content: "Good. Now you also need to restart the PM2 process after deploying. Run pm2 restart staging-app on the staging server.",
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Restarting the PM2 process on staging.' },
      { type: 'tool-call', toolName: 'run_command', args: { command: 'ssh staging-server "pm2 restart staging-app"' }, toolCallId: 'tc4' },
    ],
  },
  {
    role: 'tool',
    content: [{ type: 'tool-result', toolName: 'run_command', result: '[PM2] staging-app restarted', toolCallId: 'tc4' }],
  },
  {
    role: 'user',
    content: "Good. Remember: build first, deploy to STAGING (never prod directly), then restart PM2. That's the procedure.",
  },
  { role: 'assistant', content: 'Got it! I\'ll follow that procedure from now on: build → deploy to staging → restart PM2.' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT TESTS — Content Helpers
// ═══════════════════════════════════════════════════════════════════════════════

describe('contentToText', () => {
  it('handles plain strings', () => {
    expect(contentToText('hello world')).toBe('hello world');
  });

  it('extracts text from content array', () => {
    const content = [
      { type: 'text', text: 'Hello' },
      { type: 'tool-call', toolName: 'search', args: {} },
      { type: 'text', text: 'world' },
    ];
    expect(contentToText(content)).toBe('Hello world');
  });

  it('handles null/undefined gracefully', () => {
    // null ?? '' -> '', JSON.stringify('') -> '""'
    // undefined ?? '' -> '', JSON.stringify('') -> '""'
    expect(contentToText(null)).toBe('""');
    expect(contentToText(undefined)).toBe('""');
  });

  it('truncates long content arrays', () => {
    const longText = 'a'.repeat(5000);
    const content = [{ type: 'text', text: longText }];
    expect(contentToText(content).length).toBeLessThanOrEqual(4000);
  });

  it('handles objects by JSON-stringifying', () => {
    const result = contentToText({ key: 'value' });
    expect(result).toContain('key');
    expect(result).toContain('value');
  });
});

describe('extractToolCalls', () => {
  it('extracts tool-call entries from content array', () => {
    const content = [
      { type: 'text', text: 'some text' },
      { type: 'tool-call', toolName: 'web_search', args: { query: 'test' }, toolCallId: 'tc1' },
      { type: 'tool-call', toolName: 'http_request', args: { url: 'http://example.com' }, toolCallId: 'tc2' },
    ];
    const result = extractToolCalls(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ toolName: 'web_search', args: { query: 'test' }, id: 'tc1' });
    expect(result[1]).toEqual({ toolName: 'http_request', args: { url: 'http://example.com' }, id: 'tc2' });
  });

  it('returns empty array for non-array content', () => {
    expect(extractToolCalls('just text')).toEqual([]);
    expect(extractToolCalls(null)).toEqual([]);
    expect(extractToolCalls(undefined)).toEqual([]);
  });

  it('handles missing fields gracefully', () => {
    const content = [{ type: 'tool-call' }];
    const result = extractToolCalls(content);
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe('unknown');
    expect(result[0].args).toEqual({});
  });
});

describe('extractToolResults', () => {
  it('extracts tool-result entries from content array', () => {
    const content = [
      { type: 'tool-result', toolName: 'web_search', result: 'some results', toolCallId: 'tc1' },
    ];
    const result = extractToolResults(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ toolName: 'web_search', result: 'some results', id: 'tc1' });
  });

  it('stringifies non-string results', () => {
    const content = [
      { type: 'tool-result', toolName: 'api', result: { data: 42 }, toolCallId: 'tc1' },
    ];
    const result = extractToolResults(content);
    expect(result[0].result).toContain('42');
  });

  it('truncates long results to 600 chars', () => {
    const content = [
      { type: 'tool-result', toolName: 'api', result: 'x'.repeat(1000), toolCallId: 'tc1' },
    ];
    const result = extractToolResults(content);
    expect(result[0].result.length).toBeLessThanOrEqual(600);
  });

  it('returns empty array for non-array content', () => {
    expect(extractToolResults('text')).toEqual([]);
    expect(extractToolResults(null)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIT TESTS — Transcript Builder
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildTranscript', () => {
  it('builds basic user/assistant transcript', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const transcript = buildTranscript(messages);
    expect(transcript).toContain('User: Hello');
    expect(transcript).toContain('Assistant: Hi there!');
  });

  it('includes [TOOL CALL] markers for tool calls', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'search for something' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Searching...' },
          { type: 'tool-call', toolName: 'web_search', args: { query: 'something' }, toolCallId: 'tc1' },
        ],
      },
    ];
    const transcript = buildTranscript(messages);
    expect(transcript).toContain('[TOOL CALL] web_search');
    expect(transcript).toContain('"query":"something"');
  });

  it('includes [TOOL RESULT] markers for tool results', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'search' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolName: 'web_search', args: {}, toolCallId: 'tc1' }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolName: 'web_search', result: 'Found results', toolCallId: 'tc1' }],
      },
    ];
    const transcript = buildTranscript(messages);
    expect(transcript).toContain('[TOOL RESULT] web_search: Found results');
  });

  it('marks user injections between tool flows', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'do something' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolName: 'run_command', args: { command: 'wrong' }, toolCallId: 'tc1' }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolName: 'run_command', result: 'error', toolCallId: 'tc1' }],
      },
      { role: 'user', content: 'No, use the other command instead!' },
    ];
    const transcript = buildTranscript(messages);
    expect(transcript).toContain('[USER INJECTION');
    expect(transcript).toContain('No, use the other command instead!');
  });

  it('handles system messages', () => {
    const messages: ConversationMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hi' },
    ];
    const transcript = buildTranscript(messages);
    expect(transcript).toContain('[SYSTEM]: You are a helpful assistant.');
  });

  it('produces rich transcript from teachable conversation', () => {
    const transcript = buildTranscript(TEACHABLE_CONVERSATION);

    // Should contain the initial wrong approach
    expect(transcript).toContain('[TOOL CALL] web_search');
    // Should contain user correction
    expect(transcript).toContain("don't use web_search");
    // Should contain the corrected approach
    expect(transcript).toContain('[TOOL CALL] http_request');
    expect(transcript).toContain('coingecko');
    // Should mark the user's mid-flow correction as an injection
    expect(transcript).toContain('[USER INJECTION');
  });

  it('produces rich transcript from multi-correction conversation', () => {
    const transcript = buildTranscript(MULTI_CORRECTION_CONVERSATION);

    // Should contain the wrong deployment to prod
    expect(transcript).toContain('prod-server');
    // Should contain user's correction about staging
    expect(transcript).toContain('STAGING');
    expect(transcript).toContain('[USER INJECTION');
    // Should contain the correct deployment
    expect(transcript).toContain('staging-server');
    // Should contain PM2 restart step
    expect(transcript).toContain('pm2 restart');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS — Full Pipeline (mocked LLM)
// ═══════════════════════════════════════════════════════════════════════════════

// Mock the LLM call and bridge
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

vi.mock('../utils/models', () => ({
  buildProviderModel: vi.fn(() => 'mocked-model'),
}));

vi.mock('../tools/bridge', () => ({
  execLocalTool: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../utils/logger', () => ({
  writeLog: vi.fn(),
}));

describe('analyzeForAutoSkill', () => {
  let mockGenerateObject: any;
  let mockExecLocalTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const aiModule = await import('ai');
    mockGenerateObject = vi.mocked(aiModule.generateObject);
    const bridgeModule = await import('../tools/bridge');
    mockExecLocalTool = vi.mocked(bridgeModule.execLocalTool);
    mockExecLocalTool.mockResolvedValue({ ok: true });
  });

  it('returns null when totalTokensUsed is below MIN_TOTAL_TOKENS', async () => {
    const result = await analyzeForAutoSkill(SHORT_CONVERSATION, undefined, 30);
    expect(result).toBeNull();
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('returns null when LLM says no teachable pattern', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        has_teachable_pattern: false,
        pattern_reasoning: 'This is just a simple Q&A conversation with no procedural corrections.',
      },
    });

    const result = await analyzeForAutoSkill(SIMPLE_QA_CONVERSATION);
    expect(result).toBeNull();
  });

  it('returns null for low-confidence skills', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        has_teachable_pattern: true,
        pattern_reasoning: 'User corrected the AI once but it seems one-off.',
        user_intent: 'Get Bitcoin price',
        failed_approaches: ['Used web_search instead of API'],
        successful_approach: 'Use CoinGecko API',
        tool_usage: [],
        user_injections: [],
        skill: {
          name: 'Get Crypto Price',
          description: 'Fetch crypto prices from CoinGecko',
          trigger: 'When user asks for crypto price',
          icon: 'Zap',
          color: 'blue',
          steps: [{ type: 'tool', label: 'Fetch Price', content: 'Call CoinGecko API', toolName: 'http_request' }],
          anti_patterns: ['Do not use web_search'],
          confidence: 0.3, // below 0.5 threshold
        },
      },
    });

    const result = await analyzeForAutoSkill(TEACHABLE_CONVERSATION);
    expect(result).toBeNull();
  });

  it('generates auto-skill draft from teachable conversation', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        has_teachable_pattern: true,
        pattern_reasoning: 'User corrected the AI from using web_search to using CoinGecko API via http_request. User also specified formatting requirements and 24h change parameter.',
        user_intent: 'Get formatted Bitcoin price with 24h change from CoinGecko API',
        failed_approaches: [
          'Used web_search instead of direct API call',
          'Did not include 24h change parameter',
          'Did not format number with commas',
        ],
        successful_approach: 'Use http_request to CoinGecko API with include_24hr_change=true, format with $X,XXX.XX and percentage change',
        tool_usage: [
          {
            toolName: 'http_request',
            purpose: 'Fetch Bitcoin price from CoinGecko API',
            correct_args: { url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true', method: 'GET' },
            wrong_args: null,
          },
          {
            toolName: 'web_search',
            purpose: 'Initially tried to search for price (wrong approach)',
            correct_args: null,
            wrong_args: { query: 'bitcoin price today' },
          },
        ],
        user_injections: [
          {
            context: 'After AI used web_search to find Bitcoin price',
            correction: 'Use CoinGecko API with http_request instead of web_search',
            lesson: 'For real-time crypto prices, always use the CoinGecko API directly, never web_search',
          },
          {
            context: 'After AI returned unformatted price',
            correction: 'Format with commas and dollar sign, and include 24h change',
            lesson: 'Always format currency with proper separators and include 24h change data',
          },
        ],
        skill: {
          name: 'Get Crypto Price',
          description: 'Fetch and format cryptocurrency prices from the CoinGecko API with 24h change',
          trigger: 'When the user asks for a cryptocurrency price',
          icon: 'Zap',
          color: 'green',
          steps: [
            {
              type: 'tool',
              label: 'Fetch from CoinGecko API',
              content: 'Use http_request to call CoinGecko API. URL: https://api.coingecko.com/api/v3/simple/price?ids={coin}&vs_currencies=usd&include_24hr_change=true. Always include the 24h change parameter.',
              toolName: 'http_request',
            },
            {
              type: 'output',
              label: 'Format Price',
              content: 'Format the price with dollar sign and comma separators ($XX,XXX.XX). Show 24h change as a percentage with +/- prefix.',
            },
          ],
          anti_patterns: [
            'Do NOT use web_search to look up crypto prices — always use the CoinGecko API directly',
            'Do NOT return raw unformatted numbers — always format with commas and dollar sign',
            'Do NOT forget to include the 24h change parameter in the API call',
          ],
          confidence: 0.85,
        },
      },
    });

    const result = await analyzeForAutoSkill(TEACHABLE_CONVERSATION, 'conv-test-123');
    expect(result).not.toBeNull();

    const draft = result as AutoSkillDraft;
    expect(draft.name).toBe('Get Crypto Price');
    expect(draft.confidence).toBe(0.85);
    expect(draft.sourceConversationId).toBe('conv-test-123');

    // Steps should include anti-patterns prepended step + original steps
    expect(draft.steps.length).toBeGreaterThanOrEqual(3);
    expect(draft.steps[0].label).toBe('Guidelines & Anti-Patterns');
    expect(draft.steps[0].content).toContain('web_search');

    // Tool usage analysis preserved
    expect(draft.toolUsage).toHaveLength(2);
    expect(draft.toolUsage[0].toolName).toBe('http_request');
    expect(draft.toolUsage[1].toolName).toBe('web_search');

    // User injections preserved
    expect(draft.userInjections).toHaveLength(2);
    expect(draft.userInjections[0].lesson).toContain('CoinGecko');

    // Anti-patterns
    expect(draft.antiPatterns.length).toBeGreaterThan(0);
    expect(draft.antiPatterns.some(ap => ap.includes('web_search'))).toBe(true);
  });

  it('generates auto-skill from multi-correction deployment conversation', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        has_teachable_pattern: true,
        pattern_reasoning: 'User corrected the AI from deploying to production to staging. User also taught the PM2 restart step. Multiple corrections indicate a clear teachable procedure.',
        user_intent: 'Deploy app to staging server with proper procedure',
        failed_approaches: [
          'Deployed to production server instead of staging',
          'Forgot PM2 restart step',
        ],
        successful_approach: 'Build → SCP to staging-server:/var/www/staging → SSH restart PM2 staging-app',
        tool_usage: [
          {
            toolName: 'run_command',
            purpose: 'Run build, deploy via SCP, restart PM2',
            correct_args: { command: 'scp -r dist/ staging-server:/var/www/staging' },
            wrong_args: { command: 'scp -r dist/ prod-server:/var/www' },
          },
        ],
        user_injections: [
          {
            context: 'AI was about to SCP files to production server',
            correction: 'STOP — deploy to staging-server, not prod-server',
            lesson: 'Always deploy to staging first, never directly to production',
          },
          {
            context: 'After successful staging deploy',
            correction: 'Need to restart PM2 process after deploying',
            lesson: 'Always restart PM2 staging-app after deploying files',
          },
        ],
        skill: {
          name: 'Deploy to Staging',
          description: 'Build the app and deploy it to the staging server with PM2 restart',
          trigger: 'When the user asks to deploy the app',
          icon: 'Rocket',
          color: 'blue',
          steps: [
            { type: 'tool', label: 'Build', content: 'Run npm run build', toolName: 'run_command' },
            { type: 'tool', label: 'Deploy to Staging', content: 'SCP dist/ to staging-server:/var/www/staging. NEVER deploy to prod-server directly.', toolName: 'run_command' },
            { type: 'tool', label: 'Restart PM2', content: 'SSH into staging-server and run pm2 restart staging-app', toolName: 'run_command' },
          ],
          anti_patterns: [
            'NEVER deploy directly to prod-server — always go through staging first',
            'NEVER skip the PM2 restart step after deploying',
          ],
          confidence: 0.92,
        },
      },
    });

    const result = await analyzeForAutoSkill(MULTI_CORRECTION_CONVERSATION, 'conv-deploy-456');
    expect(result).not.toBeNull();

    const draft = result as AutoSkillDraft;
    expect(draft.name).toBe('Deploy to Staging');
    expect(draft.confidence).toBe(0.92);

    // Should have guidelines step + 3 procedure steps
    expect(draft.steps.length).toBe(4);
    expect(draft.steps[0].label).toBe('Guidelines & Anti-Patterns');
    expect(draft.steps[1].label).toBe('Build');
    expect(draft.steps[2].label).toBe('Deploy to Staging');
    expect(draft.steps[3].label).toBe('Restart PM2');

    // Anti-patterns should warn about prod
    expect(draft.antiPatterns.some(ap => ap.includes('prod'))).toBe(true);

    // User injections
    expect(draft.userInjections).toHaveLength(2);
    expect(draft.userInjections[0].correction).toContain('staging');
  });

  it('passes transcript with tool details to the LLM', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        has_teachable_pattern: false,
        pattern_reasoning: 'No teachable pattern found.',
      },
    });

    await analyzeForAutoSkill(TEACHABLE_CONVERSATION);

    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateObject.mock.calls[0][0];

    // The prompt should contain the rich transcript
    expect(callArgs.prompt).toContain('[TOOL CALL] web_search');
    expect(callArgs.prompt).toContain('[TOOL CALL] http_request');
    expect(callArgs.prompt).toContain('[TOOL RESULT]');
    expect(callArgs.prompt).toContain('coingecko');

    // System prompt should be the analysis prompt
    expect(callArgs.system).toContain('TEACHABLE PATTERN');
    expect(callArgs.system).toContain('THREE PHASES');

    // Should use low temperature for deterministic analysis
    expect(callArgs.temperature).toBeLessThanOrEqual(0.2);
  });

  it('stores the draft via execLocalTool when skill is generated', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        has_teachable_pattern: true,
        pattern_reasoning: 'Teachable pattern found.',
        user_intent: 'Deploy to staging',
        failed_approaches: ['Deployed to prod'],
        successful_approach: 'Deploy to staging then restart PM2',
        tool_usage: [],
        user_injections: [],
        skill: {
          name: 'Deploy to Staging',
          description: 'Deploy to staging server',
          trigger: 'When user asks to deploy',
          icon: 'Rocket',
          color: 'blue',
          steps: [{ type: 'tool', label: 'Build', content: 'npm run build', toolName: 'run_command' }],
          anti_patterns: ['Do not deploy to prod directly'],
          confidence: 0.8,
        },
      },
    });

    await analyzeForAutoSkill(MULTI_CORRECTION_CONVERSATION, 'conv-store-test');

    // Should have called execLocalTool with 'auto_skill_store'
    expect(mockExecLocalTool).toHaveBeenCalledWith(
      'auto_skill_store',
      expect.objectContaining({
        skill: expect.objectContaining({
          name: 'Deploy to Staging',
          source: 'auto',
          isActive: false,
          metadata: expect.objectContaining({
            confidence: 0.8,
          }),
        }),
      }),
      undefined,
      10000,
    );
  });

  it('handles LLM errors gracefully', async () => {
    mockGenerateObject.mockRejectedValue(new Error('API rate limit exceeded'));

    const result = await analyzeForAutoSkill(TEACHABLE_CONVERSATION);
    expect(result).toBeNull();
    // Should not throw
  });

  it('skips analysis when transcript is too short (< 200 chars)', async () => {
    const tinyMessages: ConversationMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
      { role: 'user', content: 'ok' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'bye' },
      { role: 'assistant', content: 'bye' },
    ];
    // Pass high tokens so we don't hit the token gate — test transcript length gate only
    const result = await analyzeForAutoSkill(tinyMessages, undefined, 100_000);
    expect(result).toBeNull();
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('proceeds when totalTokensUsed is not provided (undefined)', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        has_teachable_pattern: false,
        pattern_reasoning: 'No pattern found.',
      },
    });
    // No totalTokensUsed passed — should skip the token gate and proceed to LLM
    // Use TEACHABLE_CONVERSATION which has a long enough transcript (> 200 chars)
    const result = await analyzeForAutoSkill(TEACHABLE_CONVERSATION);
    expect(result).toBeNull();
    expect(mockGenerateObject).toHaveBeenCalled();
  });
});
