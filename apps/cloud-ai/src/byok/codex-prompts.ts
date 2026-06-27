/**
 * Codex prompt scaffolding.
 *
 * Codex models were RL-trained against tools called `apply_patch`,
 * `update_plan`, etc. When we attach our own tools (with our own names
 * and Zod schemas), the model's instinct is still to emit calls to its
 * trained tool names — and the API will reject those because we never
 * declared them. The OpenCode plugin solves this by prepending a
 * developer-role system message that *reframes* the canonical Codex
 * tools as our actual tools. That's TOOL_REMAP_MESSAGE below.
 *
 * In addition we include a short bridge instruction that tells the
 * model it's running inside Stuard (not a standalone CLI), so it doesn't
 * try to "complete the coding task and exit."
 */

export const STUARD_CODEX_BRIDGE = `<environment priority="0">
You are running inside Stuard, a personal AI assistant — not the standalone Codex CLI.

- The user is having a conversation with Stuard. You are the model handling this turn.
- You do NOT have direct shell, file system, or git access. The "tools" you can call are the ones declared in this request's tools array.
- Use the user's tools by their declared names. Do not invent tool names.
- Respond conversationally; the user is reading your final text reply, not a CLI transcript.
- Stuard already provides session memory, file viewing, and notification channels through its own UI; do not assume they're tools you call.
</environment>`;

/**
 * Translates Codex's trained tool vocabulary into "use the host's tools
 * instead." We don't ship a fixed allowlist here because the actual tool
 * names vary per request (Stuard's tool registry decides which tools are
 * available for a given conversation). Instead we tell the model to read
 * its own request's `tools` array as the source of truth.
 */
export const TOOL_REMAP_MESSAGE = `<user_instructions priority="0">
<environment_override priority="0">
You are NOT in the Codex CLI. The tools you were trained on (apply_patch, update_plan, shell, etc.) DO NOT exist here.
</environment_override>

<critical_rule priority="0">
The ONLY tools you may call are the ones declared in this request's "tools" array. Read that array; pick from it.
- ❌ apply_patch / applyPatch — does not exist
- ❌ update_plan / updatePlan — does not exist
- ❌ shell / bash / exec  — does not exist (unless explicitly in the tools array)
- ❌ read / write / edit  — only if explicitly in the tools array
</critical_rule>

<verification_checklist priority="0">
Before emitting a tool call:
1. Is the tool name present in the request's tools array? If no → STOP and reply with text instead.
2. Are the arguments shaped like the tool's JSON schema? If no → fix them.
</verification_checklist>
</user_instructions>`;

/**
 * Build the developer-role message that gets prepended to the Codex input.
 * Returns null when no tools are attached — in that case the model is
 * just a chat model and no remap is needed.
 */
export function buildCodexSystemPrelude(hasTools: boolean): string {
  return hasTools
    ? `${STUARD_CODEX_BRIDGE}\n\n${TOOL_REMAP_MESSAGE}`
    : STUARD_CODEX_BRIDGE;
}

/**
 * Per-model reasoning-effort and verbosity defaults. Mirrors what the
 * OpenCode plugin learned by talking to the chatgpt backend: codex-mini
 * doesn't accept "minimal" or "none"; non-codex-max models reject "xhigh";
 * gpt-5.1 general accepts "none" but Codex models do not.
 */
export function normalizeReasoningEffort(model: string, effort: string | undefined): 'none' | 'low' | 'medium' | 'high' | 'xhigh' {
  const m = (model || '').toLowerCase();
  const isCodexMax = m.includes('codex-max');
  const isCodexMini = m.includes('codex-mini');
  const isCodex = m.includes('codex') && !isCodexMini;
  const isGpt52 = m.includes('gpt-5.2') && !m.includes('gpt-5.2-codex');
  const isGpt52Codex = m.includes('gpt-5.2-codex');
  const isGpt51General = m.includes('gpt-5.1') && !isCodex && !isCodexMax && !isCodexMini;

  const supportsXhigh = isCodexMax || isGpt52 || isGpt52Codex;
  const supportsNone = isGpt51General || isGpt52;

  let e = (effort || '').toLowerCase();
  if (!e) {
    e = isCodexMini ? 'medium' : supportsXhigh ? 'high' : 'medium';
  }
  if (e === 'minimal') e = 'low';
  if (e === 'xhigh' && !supportsXhigh) e = 'high';
  if (e === 'none' && !supportsNone) e = 'low';
  if (isCodexMini && e !== 'medium' && e !== 'high') e = 'medium';
  if (e !== 'none' && e !== 'low' && e !== 'medium' && e !== 'high' && e !== 'xhigh') e = 'medium';
  return e as any;
}
