/**
 * Per-model reasoning ("thinking") capability.
 *
 * Different models expose wildly different reasoning controls: some have an
 * extra-high tier, some can't be turned off, some don't reason at all. This
 * module derives a single normalized {@link ReasoningControl} for any model id
 * so the picker UI can show only the choices that apply and the chat backend
 * can emit a level the provider will actually accept.
 *
 * Two sources feed it:
 *   1. models.dev `reasoning_options` — precise effort ladders / budget floors
 *      for ~flagship models (authoritative for the available levels).
 *   2. A provider-family heuristic — covers the long tail and decides
 *      disable-ability (which models.dev encodes only sparsely).
 *
 * OpenRouter's model API only flags that `reasoning` is *supported*; it never
 * lists the effort values, so it's not used here.
 */

/** Ordered ladder of thinking depths, weakest → strongest. */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const REASONING_LADDER: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];

export interface ReasoningControl {
  /** Whether the model produces reasoning at all. When false, hide the control. */
  supported: boolean;
  /** Whether reasoning can be turned off entirely (an "Off" choice is valid). */
  canDisable: boolean;
  /** Selectable effort tiers, ordered, a subset of {@link REASONING_LADDER}. */
  levels: ReasoningEffort[];
  /** Sensible default effort to highlight when reasoning is on. */
  default: ReasoningEffort;
}

/** The level requested by the client (effort, or `none` to turn thinking off). */
export type RequestedReasoning = 'none' | ReasoningEffort;

/**
 * What a model should actually run at after the request is reconciled with its
 * capability: `none` = off, `default` = on but no explicit effort (let the model
 * choose), or a concrete effort tier.
 */
export type EffectiveReasoning = 'none' | 'default' | ReasoningEffort;

const NON_SUPPORTED: ReasoningControl = { supported: false, canDisable: true, levels: [], default: 'medium' };

function control(rawLevels: ReasoningEffort[], canDisable: boolean): ReasoningControl {
  // Keep ladder order and de-dupe.
  const levels = REASONING_LADDER.filter((l) => rawLevels.includes(l));
  if (levels.length === 0) return NON_SUPPORTED;
  const def: ReasoningEffort = levels.includes('high') ? 'high' : levels[levels.length - 1];
  return { supported: true, canDisable, levels, default: def };
}

function tailOf(id: string): string {
  return id.split('/').pop() || '';
}

/**
 * Stable key for matching the same model across catalogs: drops the
 * `openrouter/` transport prefix and `:free` variant suffix, and normalizes
 * version separators (`.` → `-`) so `openai/gpt-5.1` and models.dev's `gpt-5.1`
 * both land on `openai/gpt-5-1`, and `claude-opus-4.8` ↔ `claude-opus-4-8`.
 */
export function capabilityKey(id: string): string {
  return String(id || '')
    .toLowerCase()
    .replace(/^openrouter\//, '')
    .replace(/:free$/, '')
    .replace(/\./g, '-');
}

function mapEffortValue(v: string): ReasoningEffort | null {
  switch (v) {
    case 'minimal': return 'minimal';
    case 'low': return 'low';
    case 'medium': return 'medium';
    case 'high': return 'high';
    case 'xhigh': return 'xhigh';
    case 'max': return 'xhigh'; // collapse a separate "max" tier into our ceiling
    default: return null;
  }
}

/**
 * Parse a models.dev `reasoning_options` array into a control. Returns null when
 * the array carries no usable signal. `canDisable` here is provisional — the
 * caller refines it with family knowledge, since models.dev only encodes a
 * `toggle`/`none` for some disable-able models.
 */
function controlFromModelsDevOptions(opts: any): ReasoningControl | null {
  if (!Array.isArray(opts) || opts.length === 0) return null;
  let canDisable = false;
  let sawEffort = false;
  const levels = new Set<ReasoningEffort>();

  for (const o of opts) {
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'toggle') {
      canDisable = true;
    } else if (o.type === 'budget_tokens') {
      // min 0 explicitly allows "no thinking"; a positive floor is the ON budget
      // minimum, not proof the model can't be turned off (the caller decides).
      if (typeof o.min !== 'number' || o.min <= 0) canDisable = true;
    } else if (o.type === 'effort' && Array.isArray(o.values)) {
      sawEffort = true;
      for (const v of o.values) {
        if (v == null || v === 'none') { canDisable = true; continue; }
        const mapped = mapEffortValue(String(v));
        if (mapped) levels.add(mapped);
      }
    }
  }

  // Toggle/budget-only entries give disable-ability but no discrete tiers — fall
  // back to the common low/medium/high ladder for those.
  const ladder = sawEffort && levels.size > 0
    ? [...levels]
    : (['low', 'medium', 'high'] as ReasoningEffort[]);
  return control(ladder, canDisable);
}

/**
 * Provider-family heuristic. Knows the real per-vendor reasoning shape (which
 * tiers exist, whether thinking can be disabled) for the current model lineup.
 * Returns {@link NON_SUPPORTED} for non-reasoning or unrecognized models — the
 * caller layers the registry's `reasoning` flag on top for the long tail.
 */
export function heuristicReasoningControl(modelId: string): ReasoningControl {
  const bare = String(modelId || '').toLowerCase().replace(/^openrouter\//, '');
  const vendor = bare.split('/')[0];
  const name = tailOf(bare);

  if (name.includes('non-reasoning')) return NON_SUPPORTED;

  switch (vendor) {
    case 'anthropic': {
      // Claude extended thinking is toggleable. Opus/Sonnet 4.6+ add an xhigh tier.
      if (/(opus|sonnet)-4[.-][6-9]/.test(name)) return control(['low', 'medium', 'high', 'xhigh'], true);
      if (/(opus|sonnet|haiku)-4/.test(name) || /3[.-]7/.test(name)) return control(['low', 'medium', 'high'], true);
      return NON_SUPPORTED; // claude-3 / 3.5 (non-thinking)
    }
    case 'openai':
    case 'penai': /* typo-tolerant alias used elsewhere in the codebase */ {
      if (/^gpt-5/.test(name)) return control(['minimal', 'low', 'medium', 'high'], true);
      if (/^o[1-9]/.test(name)) return control(['low', 'medium', 'high'], false); // o-series always reasons
      return NON_SUPPORTED; // gpt-4o etc
    }
    case 'google': {
      if (/gemini-3/.test(name)) {
        // Gemini 3 uses thinkingLevel and has no documented "off".
        return /flash|lite/.test(name)
          ? control(['minimal', 'low', 'medium', 'high'], false)
          : control(['low', 'medium', 'high'], false);
      }
      if (/gemini-2\.5|gemini-2-5/.test(name)) {
        // 2.5 uses a thinking budget; Pro can't be fully disabled (min budget).
        return /pro/.test(name)
          ? control(['low', 'medium', 'high'], false)
          : control(['low', 'medium', 'high'], true);
      }
      return NON_SUPPORTED;
    }
    case 'x-ai':
    case 'xai': {
      // Grok reasoning models accept only low/high and always reason.
      if (/grok-3-mini|grok-4|reasoning/.test(name)) return control(['low', 'high'], false);
      return NON_SUPPORTED;
    }
    case 'deepseek': {
      if (/r1|reasoner/.test(name)) return control(['low', 'medium', 'high'], false); // R1 always reasons
      if (/v3[.-][12]|v4|chat/.test(name)) return control(['low', 'medium', 'high'], true); // toggleable thinking
      return NON_SUPPORTED;
    }
    default:
      return NON_SUPPORTED;
  }
}

/**
 * Resolve the full reasoning capability for a model.
 *
 * @param modelId        provider/model id (may be `openrouter/...`-prefixed)
 * @param reasoningFlag  the catalog's `reasoning` boolean (covers the long tail)
 * @param modelsDevOpts  models.dev `reasoning_options` for this model, if any
 */
export function resolveReasoningControl(
  modelId: string,
  reasoningFlag: boolean,
  modelsDevOpts?: any,
): ReasoningControl {
  const heuristic = heuristicReasoningControl(modelId);
  const fromDev = controlFromModelsDevOptions(modelsDevOpts);

  if (fromDev && fromDev.supported) {
    // models.dev is authoritative for the *levels*; family knowledge is more
    // reliable for *disable-ability* (models.dev lists a toggle only sometimes).
    return {
      supported: true,
      levels: fromDev.levels,
      default: fromDev.default,
      canDisable: heuristic.supported ? heuristic.canDisable : fromDev.canDisable,
    };
  }

  if (heuristic.supported) return heuristic;

  // Unknown family but the catalog says it reasons → generic toggleable ladder.
  if (reasoningFlag) return control(['low', 'medium', 'high'], true);
  return NON_SUPPORTED;
}

/**
 * Reconcile a requested level with a model's capability. Effort tiers pass
 * through (the per-provider mapping does the final translation); only `none`
 * needs deciding: keep it off when allowed, otherwise fall back to the model's
 * own default (`'default'`).
 */
export function resolveEffectiveReasoning(
  requested: RequestedReasoning,
  control: ReasoningControl,
): EffectiveReasoning {
  if (requested === 'none') {
    if (!control.supported) return 'none';
    return control.canDisable ? 'none' : 'default';
  }
  return requested;
}

/**
 * Clamp an effort tier into a model's supported set (rounding down to the
 * nearest available, then to the lowest). For unknown families only the
 * riskiest tier (`xhigh`) is folded down, so the common path passes through.
 */
export function clampEffortToControl(effort: ReasoningEffort, control: ReasoningControl): ReasoningEffort {
  if (control.supported && control.levels.length > 0) {
    if (control.levels.includes(effort)) return effort;
    const idx = REASONING_LADDER.indexOf(effort);
    for (let i = idx; i >= 0; i--) {
      if (control.levels.includes(REASONING_LADDER[i])) return REASONING_LADDER[i];
    }
    return control.levels[0];
  }
  return effort === 'xhigh' ? 'high' : effort;
}
