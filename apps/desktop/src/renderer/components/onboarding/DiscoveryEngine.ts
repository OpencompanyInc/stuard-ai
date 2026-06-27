// =============================================================================
// DISCOVERY ENGINE - Always-on tips & suggestions service
// =============================================================================
// Pure TypeScript singleton that manages contextual tips, suggested prompts,
// and feature discovery state throughout the app lifecycle.

export type FeatureCategory =
  | 'workflows'
  | 'proactive'
  | 'chat'
  | 'planner'
  | 'integrations'
  | 'trust'
  | 'power-user'
  | 'general';

export type OnboardingPath = 'assistant' | 'automation' | 'workspace' | 'operator' | null;

export interface DiscoveryTip {
  id: string;
  category: FeatureCategory;
  title: string;
  description: string;
  actionLabel?: string;
  /** Route to navigate to, e.g. 'workflows', 'settings:proactive', 'integrations' */
  actionRoute?: string;
  /** Base priority (higher = more important). Workflows & Proactive start at 100. */
  priority: number;
  /** Only show if this feature hasn't been experienced yet */
  requiresUnexplored?: string;
  /** Don't show until user has had N sessions */
  showAfterSessionCount?: number;
  /** Stop showing after N times */
  maxShowCount?: number;
}

export interface SuggestedPrompt {
  id: string;
  text: string;
  category: FeatureCategory;
  icon: string; // lucide icon name
  /** Which onboarding paths this prompt is relevant for (null = all) */
  paths: OnboardingPath[] | null;
}

export interface DiscoveryState {
  tipsSeen: Record<string, number>;
  tipsDismissed: string[];
  sessionCount: number;
  lastSessionDate: string;
  featuresExperienced: Record<string, boolean>;
  selectedPath: OnboardingPath;
  promptsUsed: string[];
}

const STORAGE_KEY = 'stuard_discovery_v1';

const DEFAULT_STATE: DiscoveryState = {
  tipsSeen: {},
  tipsDismissed: [],
  sessionCount: 0,
  lastSessionDate: '',
  featuresExperienced: {},
  selectedPath: null,
  promptsUsed: [],
};

// =============================================================================
// TIP POOL
// =============================================================================

const TIP_POOL: DiscoveryTip[] = [
  // --- WORKFLOWS (HIGH PRIORITY) ---
  {
    id: 'wf-ai-build',
    category: 'workflows',
    title: 'Let AI build your workflow',
    description: 'Describe what you want automated and Stuard builds the first draft. Refine it visually after.',
    actionLabel: 'Try it',
    actionRoute: 'workflows',
    priority: 100,
    requiresUnexplored: 'workflows',
  },
  {
    id: 'wf-drag-drop',
    category: 'workflows',
    title: 'Drag-and-drop workflow builder',
    description: 'Connect nodes visually to build automations. No code needed.',
    actionRoute: 'workflows',
    priority: 95,
    requiresUnexplored: 'workflows',
  },
  {
    id: 'wf-deploy',
    category: 'workflows',
    title: 'Deploy workflows as automations',
    description: 'Turn any workflow into an always-on automation that runs on schedule or on trigger.',
    actionLabel: 'Learn more',
    actionRoute: 'automations',
    priority: 90,
  },
  {
    id: 'wf-custom-ui',
    category: 'workflows',
    title: 'Workflows can become mini apps',
    description: 'Add custom UI so a workflow can collect input, show status, or feel like a tiny purpose-built tool.',
    priority: 70,
  },
  {
    id: 'wf-schedule',
    category: 'workflows',
    title: 'Schedule workflows to run automatically',
    description: 'Set workflows to run daily, weekly, or on custom intervals without lifting a finger.',
    priority: 75,
  },
  {
    id: 'wf-chain',
    category: 'workflows',
    title: 'Chain workflows together',
    description: 'One workflow can trigger another. Build complex automations from simple building blocks.',
    priority: 65,
  },
  {
    id: 'wf-start-simple',
    category: 'workflows',
    title: 'Start simple, automate later',
    description: 'If a task works well in chat first, it usually becomes a strong candidate for a workflow later.',
    priority: 80,
  },
  {
    id: 'wf-ai-assist',
    category: 'workflows',
    title: 'AI assists while you build',
    description: 'While editing a workflow, ask AI to modify nodes, fix connections, or explain what a step does.',
    priority: 72,
  },

  // --- SCOUT / PROACTIVE AGENT (HIGH PRIORITY) ---
  {
    id: 'pa-enable',
    category: 'proactive',
    title: 'Meet Scout, your proactive agent',
    description: 'Turn Scout on and it checks in on your tasks, PRs, and schedule in the background — asking first before anything destructive.',
    actionLabel: 'Enable',
    actionRoute: 'bots',
    priority: 100,
    requiresUnexplored: 'proactive',
  },
  {
    id: 'pa-monitoring',
    category: 'proactive',
    title: 'Background monitoring',
    description: 'Scout can monitor GitHub PRs, calendar changes, and file updates, and notify you when something needs attention.',
    actionRoute: 'bots',
    priority: 95,
    requiresUnexplored: 'proactive',
  },
  {
    id: 'pa-checkins',
    category: 'proactive',
    title: 'Automated check-ins',
    description: 'Set up recurring check-ins. Scout will remind you, summarize progress, or tee up actions at set times.',
    actionRoute: 'bots',
    priority: 88,
  },
  {
    id: 'pa-reminders',
    category: 'proactive',
    title: 'Smart reminders',
    description: 'Ask Scout to remind you about anything. It remembers context and can act on reminders, not just notify.',
    priority: 82,
  },
  {
    id: 'pa-wake-log',
    category: 'proactive',
    title: 'See what Scout did while you were away',
    description: "Check Scout's activity log to see actions taken, checks completed, and insights gathered.",
    actionRoute: 'bots',
    priority: 70,
  },
  {
    id: 'pa-tools',
    category: 'proactive',
    title: 'Agent tools',
    description: 'Scout can use your integrations to send messages, create tasks, and update calendars — proposing destructive actions for your approval first.',
    priority: 75,
  },

  // --- CHAT ---
  {
    id: 'chat-mentions',
    category: 'chat',
    title: 'Add context with @mentions',
    description: 'Type @ to mention files, folders, or previous conversations. Stuard uses them as context.',
    priority: 60,
  },
  {
    id: 'chat-attach',
    category: 'chat',
    title: 'Attach files and images',
    description: 'Click + or paste images directly. Stuard can read documents, analyze screenshots, and process media.',
    priority: 55,
  },
  {
    id: 'chat-voice',
    category: 'chat',
    title: 'Talk to Stuard',
    description: 'Press the microphone to speak. Say "Send Stuard" when done, or just press the mic again.',
    priority: 50,
  },
  {
    id: 'chat-multiline',
    category: 'chat',
    title: 'Multi-line messages',
    description: 'Press Shift+Enter for a new line. Enter sends the message.',
    priority: 40,
  },
  {
    id: 'chat-paste-images',
    category: 'chat',
    title: 'Paste screenshots directly',
    description: 'Take a screenshot and paste it into chat. Stuard can analyze what\'s on your screen.',
    priority: 45,
  },
  {
    id: 'chat-model-select',
    category: 'chat',
    title: 'Switch AI models',
    description: 'Choose between fast, balanced, and smart modes. Each uses different models optimized for the task.',
    priority: 35,
  },
  {
    id: 'chat-reasoning',
    category: 'chat',
    title: 'Reasoning mode',
    description: 'Toggle reasoning to see how Stuard thinks through complex problems step by step.',
    priority: 38,
  },
  {
    id: 'chat-commands',
    category: 'chat',
    title: 'Slash commands',
    description: 'Type / to see all available commands. Quick access to workflows, settings, and more.',
    priority: 42,
  },
  {
    id: 'ux-hotkeys',
    category: 'power-user',
    title: 'Command palette',
    description: 'Press Ctrl+K to jump anywhere — workflows, settings, attach files, and more.',
    priority: 38,
  },
  {
    id: 'ux-queue',
    category: 'chat',
    title: 'Queue while Stuard works',
    description: 'Send your next message while Stuard is still responding. It lines up automatically.',
    priority: 36,
  },
  {
    id: 'ux-steer',
    category: 'chat',
    title: 'Steer mid-response',
    description: 'Type while Stuard is answering and press Steer to nudge the current step.',
    priority: 34,
  },
  {
    id: 'ux-feedback',
    category: 'chat',
    title: 'Something feel off?',
    description: 'Open Settings → Feedback to report bugs or share ideas. It helps us improve Stuard.',
    actionLabel: 'Settings',
    actionRoute: 'settings',
    priority: 28,
  },
  {
    id: 'ux-projects',
    category: 'chat',
    title: 'Project mode',
    description: 'Pin a chat to a project so Stuard keeps context, files, and goals scoped to one effort.',
    priority: 33,
  },

  // --- PLANNER ---
  {
    id: 'plan-unified',
    category: 'planner',
    title: 'Calendar + tasks in one view',
    description: 'Your planner shows calendar events and tasks together. Drag to reschedule.',
    actionRoute: 'planner',
    priority: 50,
  },
  {
    id: 'plan-ai-schedule',
    category: 'planner',
    title: 'AI-powered scheduling',
    description: 'Ask Stuard to schedule a meeting or create a task. It respects your calendar and preferences.',
    priority: 45,
  },
  {
    id: 'plan-sync',
    category: 'planner',
    title: 'Sync with Google Calendar',
    description: 'Connect Google Calendar to see all your events and let Stuard manage scheduling.',
    actionRoute: 'integrations',
    priority: 48,
    requiresUnexplored: 'integrations',
  },
  {
    id: 'plan-tasks',
    category: 'planner',
    title: 'Task management built in',
    description: 'Create, track, and complete tasks right inside Stuard. Ask AI to break down big tasks into steps.',
    priority: 42,
  },

  // --- INTEGRATIONS ---
  {
    id: 'int-google',
    category: 'integrations',
    title: 'Connect Google',
    description: 'Link Google Calendar, Gmail, and Drive. Stuard can read events, draft emails, and search documents.',
    actionLabel: 'Connect',
    actionRoute: 'integrations',
    priority: 55,
    requiresUnexplored: 'integrations',
  },
  {
    id: 'int-github',
    category: 'integrations',
    title: 'Connect GitHub',
    description: 'Monitor PRs, manage issues, and get code summaries. Stuard understands your repositories.',
    actionRoute: 'integrations',
    priority: 50,
  },
  {
    id: 'int-messaging',
    category: 'integrations',
    title: 'Send messages from Stuard',
    description: 'Connect WhatsApp, SMS, or Discord. Draft and send messages without switching apps.',
    actionRoute: 'integrations',
    priority: 45,
  },
  {
    id: 'int-outlook',
    category: 'integrations',
    title: 'Outlook integration',
    description: 'Connect Outlook for email and calendar. Stuard can draft replies and manage your schedule.',
    actionRoute: 'integrations',
    priority: 43,
  },

  // --- TRUST ---
  {
    id: 'trust-approvals',
    category: 'trust',
    title: 'Stuard asks before acting',
    description: 'Important actions require your approval. You\'re always in control of what Stuard does.',
    priority: 30,
  },
  {
    id: 'trust-memory',
    category: 'trust',
    title: 'Editable memory',
    description: 'View and edit everything Stuard remembers about you. Delete anything at any time.',
    actionRoute: 'memories',
    priority: 30,
  },
  {
    id: 'trust-local',
    category: 'trust',
    title: 'Local-first by design',
    description: 'Your data stays on your machine. Cloud features are always opt-in, never default.',
    priority: 25,
  },
  {
    id: 'trust-activity',
    category: 'trust',
    title: 'Visible activity log',
    description: 'Everything Stuard does is logged. Check the history to see every action and decision.',
    actionRoute: 'history',
    priority: 25,
  },

  // --- POWER USER ---
  {
    id: 'pu-translucent',
    category: 'power-user',
    title: 'Translucent overlay mode',
    description: 'Enable translucent mode so you can see through the overlay while chatting.',
    priority: 20,
  },
  {
    id: 'pu-file-index',
    category: 'power-user',
    title: 'File indexing',
    description: 'Enable file indexing so Stuard can search and reference your local files by content.',
    priority: 20,
  },
  {
    id: 'pu-terminal',
    category: 'power-user',
    title: 'Built-in terminal',
    description: 'Access a terminal directly inside Stuard. Run commands without leaving the overlay.',
    priority: 18,
  },
  {
    id: 'pu-cloud-vm',
    category: 'power-user',
    title: 'Cloud compute engine',
    description: 'Spin up cloud VMs for heavy tasks. Run code, train models, or process data in the cloud.',
    actionRoute: 'cloud',
    priority: 15,
    showAfterSessionCount: 5,
  },
  {
    id: 'pu-screen-capture',
    category: 'power-user',
    title: 'Screen capture & analysis',
    description: 'Stuard can capture and analyze your screen. Great for debugging UI or getting help with what you see.',
    priority: 18,
  },
  {
    id: 'pu-custom-shortcut',
    category: 'power-user',
    title: 'Customize your shortcut',
    description: 'Change your global keyboard shortcut anytime in Settings. Make Stuard always one press away.',
    priority: 15,
  },
];

// =============================================================================
// SUGGESTED PROMPTS POOL
// =============================================================================

const PROMPT_POOL: SuggestedPrompt[] = [
  // Chat prompts
  { id: 'p-summarize-desktop', text: 'Summarize what\'s on my screen', category: 'chat', icon: 'Monitor', paths: null },
  { id: 'p-draft-email', text: 'Help me draft an email', category: 'chat', icon: 'Mail', paths: ['assistant', 'workspace'] },
  { id: 'p-explain-code', text: 'Explain this code to me', category: 'chat', icon: 'Code', paths: ['assistant'] },
  { id: 'p-brainstorm', text: 'Help me brainstorm ideas for...', category: 'chat', icon: 'Lightbulb', paths: ['assistant', 'workspace'] },

  // Workflow prompts
  { id: 'p-morning-briefing', text: 'Build me a morning briefing workflow', category: 'workflows', icon: 'Workflow', paths: ['automation', 'operator'] },
  { id: 'p-automate-report', text: 'Automate my weekly report', category: 'workflows', icon: 'FileText', paths: ['automation', 'workspace'] },
  { id: 'p-file-monitor', text: 'Watch a folder and alert me on new files', category: 'workflows', icon: 'FolderSearch', paths: ['automation', 'operator'] },
  { id: 'p-build-workflow', text: 'I want to automate something', category: 'workflows', icon: 'Zap', paths: null },

  // Scout (proactive agent) prompts
  { id: 'p-standup-reminder', text: 'Set up a daily standup reminder', category: 'proactive', icon: 'Bell', paths: ['workspace', 'operator'] },
  { id: 'p-monitor-prs', text: 'Monitor my GitHub PRs', category: 'proactive', icon: 'GitPullRequest', paths: ['operator', 'automation'] },
  { id: 'p-proactive-checkin', text: 'Check in on me every afternoon', category: 'proactive', icon: 'Clock', paths: ['operator'] },
  { id: 'p-proactive-enable', text: 'What can Scout do?', category: 'proactive', icon: 'Telescope', paths: null },

  // Integration prompts
  { id: 'p-calendar-today', text: 'What meetings do I have today?', category: 'integrations', icon: 'Calendar', paths: ['assistant', 'workspace'] },
  // Disabled — WhatsApp integration temporarily hidden (see shared/integration-flags.ts)
  // { id: 'p-send-whatsapp', text: 'Send a WhatsApp message to...', category: 'integrations', icon: 'MessageCircle', paths: null },
  { id: 'p-github-issues', text: 'Show me my open GitHub issues', category: 'integrations', icon: 'Github', paths: ['automation', 'operator'] },
  { id: 'p-connect-accounts', text: 'Help me connect my accounts', category: 'integrations', icon: 'Plug', paths: null },

  // Planner prompts
  { id: 'p-plan-week', text: 'Help me plan my week', category: 'planner', icon: 'CalendarDays', paths: ['workspace'] },
  { id: 'p-create-task', text: 'Create a task list for my project', category: 'planner', icon: 'ListTodo', paths: ['workspace', 'assistant'] },
];

// =============================================================================
// DISCOVERY ENGINE CLASS
// =============================================================================

export class DiscoveryEngine {
  private state: DiscoveryState;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.state = this.loadState();
    this.checkNewSession();
  }

  // ---------------------------------------------------------------------------
  // STATE PERSISTENCE
  // ---------------------------------------------------------------------------

  private loadState(): DiscoveryState {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_STATE, ...JSON.parse(saved) };
      }
    } catch {}
    return { ...DEFAULT_STATE };
  }

  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {}
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(fn => fn());
  }

  /** Subscribe to state changes (for React hook) */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getState(): DiscoveryState {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // SESSION TRACKING
  // ---------------------------------------------------------------------------

  private checkNewSession(): void {
    const today = new Date().toISOString().split('T')[0];
    if (this.state.lastSessionDate !== today) {
      this.state.sessionCount += 1;
      this.state.lastSessionDate = today;
      this.saveState();
    }
  }

  incrementSession(): void {
    this.state.sessionCount += 1;
    this.state.lastSessionDate = new Date().toISOString().split('T')[0];
    this.saveState();
  }

  getSessionCount(): number {
    return this.state.sessionCount;
  }

  // ---------------------------------------------------------------------------
  // PATH SELECTION
  // ---------------------------------------------------------------------------

  setPath(path: OnboardingPath): void {
    this.state.selectedPath = path;
    this.saveState();
  }

  getPath(): OnboardingPath {
    return this.state.selectedPath;
  }

  // ---------------------------------------------------------------------------
  // FEATURE EXPERIENCE TRACKING
  // ---------------------------------------------------------------------------

  markFeatureExperienced(feature: string): void {
    if (!this.state.featuresExperienced[feature]) {
      this.state.featuresExperienced[feature] = true;
      this.saveState();
    }
  }

  isFeatureExperienced(feature: string): boolean {
    return !!this.state.featuresExperienced[feature];
  }

  getUnexploredFeatures(): string[] {
    const key_features = ['chat', 'workflows', 'proactive', 'planner', 'integrations', 'memories', 'automations'];
    return key_features.filter(f => !this.state.featuresExperienced[f]);
  }

  // ---------------------------------------------------------------------------
  // TIP MANAGEMENT
  // ---------------------------------------------------------------------------

  markTipSeen(tipId: string): void {
    this.state.tipsSeen[tipId] = (this.state.tipsSeen[tipId] || 0) + 1;
    this.saveState();
  }

  dismissTip(tipId: string): void {
    if (!this.state.tipsDismissed.includes(tipId)) {
      this.state.tipsDismissed.push(tipId);
      this.saveState();
    }
  }

  private isTipEligible(tip: DiscoveryTip): boolean {
    // Dismissed?
    if (this.state.tipsDismissed.includes(tip.id)) return false;

    // Exceeded max show count?
    if (tip.maxShowCount && (this.state.tipsSeen[tip.id] || 0) >= tip.maxShowCount) return false;

    // Session count requirement?
    if (tip.showAfterSessionCount && this.state.sessionCount < tip.showAfterSessionCount) return false;

    // Requires unexplored feature but it's been experienced?
    if (tip.requiresUnexplored && this.state.featuresExperienced[tip.requiresUnexplored]) return false;

    return true;
  }

  /**
   * Get the next best tip for the given context.
   * Prioritizes: unexplored features > current area > general tips.
   * Workflows & Proactive tips are boosted for users who haven't tried them.
   */
  getNextTip(context?: {
    currentArea?: string;
    isThinking?: boolean;
    isIdle?: boolean;
    isEmptyState?: boolean;
  }): DiscoveryTip | null {
    const eligible = TIP_POOL.filter(t => this.isTipEligible(t));
    if (eligible.length === 0) return null;

    // Score each tip
    const scored = eligible.map(tip => {
      let score = tip.priority;

      // Boost tips for unexplored features
      if (tip.requiresUnexplored && !this.state.featuresExperienced[tip.requiresUnexplored]) {
        score += 50;
      }

      // Boost Workflows & Proactive for new users (session < 5)
      if (this.state.sessionCount < 5) {
        if (tip.category === 'workflows' && !this.state.featuresExperienced['workflows']) score += 30;
        if (tip.category === 'proactive' && !this.state.featuresExperienced['proactive']) score += 30;
      }

      // Boost tips matching current area
      if (context?.currentArea && tip.category === context.currentArea) {
        score += 20;
      }

      // During thinking, prefer shorter actionable tips
      if (context?.isThinking && tip.actionLabel) {
        score += 10;
      }

      // Penalize already-seen tips
      const seenCount = this.state.tipsSeen[tip.id] || 0;
      score -= seenCount * 15;

      return { tip, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.tip || null;
  }

  /**
   * Get multiple tips for a carousel (e.g., during AI thinking).
   */
  getTipsForCarousel(count: number = 4, context?: { currentArea?: string }): DiscoveryTip[] {
    const eligible = TIP_POOL.filter(t => this.isTipEligible(t));

    // Score and sort
    const scored = eligible.map(tip => {
      let score = tip.priority;
      if (tip.requiresUnexplored && !this.state.featuresExperienced[tip.requiresUnexplored]) score += 50;
      if (this.state.sessionCount < 5) {
        if (tip.category === 'workflows') score += 20;
        if (tip.category === 'proactive') score += 20;
      }
      if (context?.currentArea && tip.category === context.currentArea) score += 15;
      const seenCount = this.state.tipsSeen[tip.id] || 0;
      score -= seenCount * 10;
      return { tip, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Ensure variety: pick from different categories
    const result: DiscoveryTip[] = [];
    const usedCategories = new Set<string>();

    for (const { tip } of scored) {
      if (result.length >= count) break;
      // Allow at most 2 from same category
      const catCount = result.filter(t => t.category === tip.category).length;
      if (catCount < 2) {
        result.push(tip);
        usedCategories.add(tip.category);
      }
    }

    // Fill remaining slots if we didn't hit count
    if (result.length < count) {
      for (const { tip } of scored) {
        if (result.length >= count) break;
        if (!result.find(t => t.id === tip.id)) {
          result.push(tip);
        }
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // SUGGESTED PROMPTS
  // ---------------------------------------------------------------------------

  /**
   * Get suggested prompts, optionally filtered by path.
   * Always includes at least one Workflow and one Proactive prompt.
   */
  getSuggestedPrompts(count: number = 6): SuggestedPrompt[] {
    const path = this.state.selectedPath;
    const used = new Set(this.state.promptsUsed);

    // Filter by path relevance
    const relevant = PROMPT_POOL.filter(p => {
      if (used.has(p.id)) return false;
      if (p.paths === null) return true;
      if (path && p.paths.includes(path)) return true;
      if (!path) return true; // no path selected yet, show all
      return false;
    });

    // Ensure we have at least one from workflows and proactive
    const result: SuggestedPrompt[] = [];
    const wfPrompt = relevant.find(p => p.category === 'workflows');
    const paPrompt = relevant.find(p => p.category === 'proactive');

    if (wfPrompt) result.push(wfPrompt);
    if (paPrompt) result.push(paPrompt);

    // Fill the rest with variety
    const usedIds = new Set(result.map(p => p.id));
    const remaining = relevant.filter(p => !usedIds.has(p.id));

    // Shuffle remaining for variety
    const shuffled = remaining.sort(() => Math.random() - 0.5);

    for (const prompt of shuffled) {
      if (result.length >= count) break;
      result.push(prompt);
    }

    // Shuffle final result so workflow/proactive aren't always first
    return result.sort(() => Math.random() - 0.5);
  }

  markPromptUsed(promptId: string): void {
    if (!this.state.promptsUsed.includes(promptId)) {
      this.state.promptsUsed.push(promptId);
      this.saveState();
    }
  }

  // ---------------------------------------------------------------------------
  // SESSION MILESTONE CHECKS
  // ---------------------------------------------------------------------------

  /**
   * Returns a milestone message if one should be shown, or null.
   * Call this on app launch or session start.
   */
  getSessionMilestone(): {
    id: string;
    message: string;
    actionLabel: string;
    actionRoute: string;
    feature: string;
  } | null {
    const s = this.state;
    const dismissed = new Set(s.tipsDismissed);

    // Session 1: remind about superpowers if not tried
    if (s.sessionCount >= 1 && !s.featuresExperienced['workflows'] && !s.featuresExperienced['proactive']) {
      const id = 'milestone-superpowers';
      if (!dismissed.has(id)) {
        return {
          id,
          message: "You haven't tried Workflows or Proactive yet -- these are Stuard's superpowers.",
          actionLabel: 'Explore',
          actionRoute: 'workflows',
          feature: 'workflows',
        };
      }
    }

    // Session 2: proactive agent nudge
    if (s.sessionCount >= 2 && !s.featuresExperienced['proactive']) {
      const id = 'milestone-proactive';
      if (!dismissed.has(id)) {
        return {
          id,
          message: 'Stuard can work in the background -- check in on your tasks, monitor PRs, send reminders. Enable it?',
          actionLabel: 'Enable',
          actionRoute: 'proactive',
          feature: 'proactive',
        };
      }
    }

    // Session 3: workflow nudge
    if (s.sessionCount >= 3 && !s.featuresExperienced['workflows']) {
      const id = 'milestone-workflows';
      if (!dismissed.has(id)) {
        return {
          id,
          message: 'Automate something you do every week. Describe it and Stuard builds the workflow for you.',
          actionLabel: 'Try it',
          actionRoute: 'workflows',
          feature: 'workflows',
        };
      }
    }

    // Session 5: cloud engine
    if (s.sessionCount >= 5 && !s.featuresExperienced['cloud']) {
      const id = 'milestone-cloud';
      if (!dismissed.has(id)) {
        return {
          id,
          message: 'Need more compute? Spin up cloud VMs directly from Stuard for heavy tasks.',
          actionLabel: 'Learn more',
          actionRoute: 'cloud',
          feature: 'cloud',
        };
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // MIGRATION: Initialize from v2 onboarding data
  // ---------------------------------------------------------------------------

  initializeFromV2(v2Data: {
    visitCount?: Record<string, number>;
    completedSteps?: string[];
  }): void {
    if (v2Data.visitCount) {
      for (const [area, count] of Object.entries(v2Data.visitCount)) {
        if (count > 0) {
          this.state.featuresExperienced[area] = true;
        }
      }
    }
    this.saveState();
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let _instance: DiscoveryEngine | null = null;

export function getDiscoveryEngine(): DiscoveryEngine {
  if (!_instance) {
    _instance = new DiscoveryEngine();
  }
  return _instance;
}
