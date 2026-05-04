export interface RouterContext {
  agentWsUrl: string;
  cloudAiUrl: string;
  logFn: (msg: string) => void;
  accessToken?: string; // User's auth token for cloud API calls
  sourceLabel?: string; // Human-readable origin for usage billing (e.g. "Workflow: Study")
  /**
   * The proactive bot id whose run is currently invoking this tool, if any.
   * Used to scope kanban / memory operations to the calling bot. Absent for
   * regular chat tool calls (those default to the legacy bot scope).
   */
  proactiveBotId?: string;
}

