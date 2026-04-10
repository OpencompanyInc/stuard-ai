export interface RouterContext {
  agentWsUrl: string;
  cloudAiUrl: string;
  logFn: (msg: string) => void;
  accessToken?: string; // User's auth token for cloud API calls
  sourceLabel?: string; // Human-readable origin for usage billing (e.g. "Workflow: Study")
}

