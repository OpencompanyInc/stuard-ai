/**
 * Stuard Workflow DSL — a dense, line-oriented PROJECTION of a DesignerModel.
 *
 * WHY: JSON is token-heavy to read/edit and the agent compounds that cost over
 * many turns. The DSL drops positions, object keys, and pretty-print whitespace,
 * giving a ~0.5-0.7x token footprint while staying diff-friendly and grep-able.
 *
 * RELIABILITY CONTRACT (this is what keeps drag-and-drop safe):
 *   • The JSON DesignerModel stays the SOURCE OF TRUTH. The DSL is a view.
 *   • All structured payloads (args, guards, loops, stream) are MINIFIED JSON,
 *     parsed with JSON.parse — zero bespoke-parser risk, fully lossless.
 *   • parseWorkflow(dsl, base) MERGES by stable identity (node id, trigger id,
 *     variable name, wire from→to). Any field the DSL does not surface
 *     (position, iconName, colorKey, marketplace meta, …) is restored from
 *     `base`. So a windowed edit changes ONLY what's in the DSL; the canvas
 *     never loses layout or visual overrides.
 *
 * A "full" node line always carries an args object (at least `{}`), so the
 * parser can distinguish a full line (authoritative — flag absence means false)
 * from a display "stub" (`id = tool`, merge keeps base fields).
 */

export interface SerializeOptions {
  /** 'full' = every node with args (used for the edit round-trip; lossless).
   *  'outline' = nodes as `id = tool` stubs + wires (cheap navigation map).
   *  'window' = focusIds full + 1-hop neighbour stubs + incident wires. */
  mode?: 'full' | 'outline' | 'window';
  /** For 'window': the node/trigger ids to show at full detail. */
  focusIds?: string[];
  /** Truncate string arg values longer than this to a `…(Nc)…` sentinel.
   *  Used for display reads only; never for the edit round-trip. */
  abbreviateOver?: number;
}

const ABBREV_RE = /^…\(\d+c\)…$/;

// ── tiny JSON scanner: returns the index just past the JSON value at s[i] ──────
function scanValueEnd(s: string, i: number): number {
  const c = s[i];
  if (c === '{' || c === '[') {
    const open = c;
    const close = c === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    return s.length;
  }
  if (c === '"') {
    let esc = false;
    for (let j = i + 1; j < s.length; j++) {
      const ch = s[j];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') return j + 1;
    }
    return s.length;
  }
  let j = i;
  while (j < s.length && !/\s/.test(s[j])) j++;
  return j;
}

interface ParsedAnnotations {
  flags: Set<string>;
  vals: Record<string, any>;
}

// Parse a trailing annotation string: ` @waitForAll @fallback(x) @label "Foo" @guard {..}`
function readAnnotations(rest: string): ParsedAnnotations {
  const flags = new Set<string>();
  const vals: Record<string, any> = {};
  let i = 0;
  while (i < rest.length) {
    while (i < rest.length && /\s/.test(rest[i])) i++;
    if (i >= rest.length) break;
    if (rest[i] !== '@') break; // not an annotation — stop
    let j = i + 1;
    while (j < rest.length && /[A-Za-z]/.test(rest[j])) j++;
    const name = rest.slice(i + 1, j);
    if (rest[j] === '(') {
      const end = rest.indexOf(')', j);
      vals[name] = rest.slice(j + 1, end === -1 ? rest.length : end);
      i = end === -1 ? rest.length : end + 1;
      continue;
    }
    let k = j;
    while (k < rest.length && rest[k] === ' ') k++;
    if (k < rest.length && rest[k] !== '@') {
      const end = scanValueEnd(rest, k);
      try { vals[name] = JSON.parse(rest.slice(k, end)); } catch { vals[name] = rest.slice(k, end); }
      i = end;
    } else {
      flags.add(name);
      i = j;
    }
  }
  return { flags, vals };
}

// ── abbreviation (display reads) ──────────────────────────────────────────────
function abbreviate(val: any, over: number): any {
  if (typeof val === 'string') return val.length > over ? `…(${val.length}c)…` : val;
  if (Array.isArray(val)) return val.map((v) => abbreviate(v, over));
  if (val && typeof val === 'object') {
    const o: Record<string, any> = {};
    for (const k of Object.keys(val)) o[k] = abbreviate(val[k], over);
    return o;
  }
  return val;
}

// Restore any `…(Nc)…` sentinel a model may have echoed back, from the base value.
function restoreAbbrev(val: any, baseVal: any): any {
  if (typeof val === 'string' && ABBREV_RE.test(val)) return baseVal !== undefined ? baseVal : val;
  if (Array.isArray(val)) return val.map((v, i) => restoreAbbrev(v, Array.isArray(baseVal) ? baseVal[i] : undefined));
  if (val && typeof val === 'object') {
    const o: Record<string, any> = {};
    for (const k of Object.keys(val)) o[k] = restoreAbbrev(val[k], baseVal && typeof baseVal === 'object' ? baseVal[k] : undefined);
    return o;
  }
  return val;
}

// ── SERIALIZE ─────────────────────────────────────────────────────────────────
function nodeLineFull(n: any, abbreviateOver?: number): string {
  const args = abbreviateOver ? abbreviate(n.args ?? {}, abbreviateOver) : (n.args ?? {});
  let s = `${n.id} = ${n.tool || 'noop'} ${JSON.stringify(args)}`;
  if (n.waitForAll) s += ' @waitForAll';
  if (n.fallbackTo) s += ` @fallback(${n.fallbackTo})`;
  if (n.label && n.label !== n.tool) s += ` @label ${JSON.stringify(n.label)}`;
  if (n.iconName) s += ` @icon ${JSON.stringify(n.iconName)}`;
  if (n.colorKey) s += ` @color ${JSON.stringify(n.colorKey)}`;
  return s;
}

function triggerLineFull(t: any): string {
  let s = `trigger ${t.id} = ${t.type} ${JSON.stringify(t.args ?? {})}`;
  if (t.label && t.label !== t.type) s += ` @label ${JSON.stringify(t.label)}`;
  if (Array.isArray(t.inputParams) && t.inputParams.length) s += ` @inputs ${JSON.stringify(t.inputParams)}`;
  return s;
}

function varLine(v: any): string {
  const flags = `${v.scope === 'local' ? ' @local' : ''}${v.persistState ? ' @persist' : ''}`;
  return `var ${v.name}:${v.type || 'string'}${flags} = ${JSON.stringify(v.defaultValue ?? null)}`;
}

function wireLine(w: any): string {
  let s = `${w.from} -> ${w.to}`;
  if (w.guard !== undefined && w.guard !== null) s += ` @guard ${JSON.stringify(w.guard)}`;
  if (w.loop) s += ` @loop ${JSON.stringify(w.loop)}`;
  if (w.loopBreak) s += ' @loopBreak';
  if (w.loopFanoutMode) s += ` @fanout ${JSON.stringify(w.loopFanoutMode)}`;
  if (w.stream) s += ` @stream ${JSON.stringify(w.stream)}`;
  if (w.callNode) s += ' @callNode';
  if (w.label) s += ` @label ${JSON.stringify(w.label)}`;
  return s;
}

export function serializeWorkflow(model: any, opts: SerializeOptions = {}): string {
  const mode = opts.mode || 'full';
  const nodes: any[] = model.nodes || [];
  const wires: any[] = model.wires || [];
  const triggers: any[] = model.triggers || [];
  const variables: any[] = model.variables || [];

  const lines: string[] = [];
  lines.push(`flow ${JSON.stringify(model.name || 'Untitled')} v${model.version || '1'} {`);
  if (model.autostart) lines.push('  @autostart');
  if (model.description) lines.push(`  @desc ${JSON.stringify(model.description)}`);

  if (mode === 'window') {
    const focus = new Set(opts.focusIds || []);
    const neigh = new Set<string>(focus);
    for (const w of wires) {
      if (focus.has(w.from)) neigh.add(w.to);
      if (focus.has(w.to)) neigh.add(w.from);
    }
    if (variables.length) { lines.push(''); for (const v of variables) lines.push('  ' + varLine(v)); }
    const focusTrigs = triggers.filter((t) => neigh.has(t.id));
    if (focusTrigs.length) { lines.push(''); for (const t of focusTrigs) lines.push('  ' + triggerLineFull(t)); }
    lines.push('');
    for (const n of nodes) {
      if (focus.has(n.id)) lines.push('  ' + nodeLineFull(n, opts.abbreviateOver ?? 800));
      else if (neigh.has(n.id)) lines.push(`  ${n.id} = ${n.tool || 'noop'}   # neighbour`);
    }
    lines.push('');
    for (const w of wires) if (focus.has(w.from) || focus.has(w.to)) lines.push('  ' + wireLine(w));
    const omitted = nodes.length - nodes.filter((n) => neigh.has(n.id)).length;
    if (omitted > 0) lines.push(`  # …${omitted} more nodes not shown (read another window or outline)`);
    lines.push('}');
    return lines.join('\n');
  }

  if (variables.length) { lines.push(''); for (const v of variables) lines.push('  ' + varLine(v)); }
  lines.push('');
  for (const t of triggers) lines.push('  ' + triggerLineFull(t));
  lines.push('');
  for (const n of nodes) {
    if (mode === 'outline') {
      let s = `  ${n.id} = ${n.tool || 'noop'}`;
      if (n.waitForAll) s += ' @waitForAll';
      if (n.label && n.label !== n.tool) s += ` @label ${JSON.stringify(n.label)}`;
      lines.push(s);
    } else {
      lines.push('  ' + nodeLineFull(n, opts.abbreviateOver));
    }
  }
  lines.push('');
  for (const w of wires) lines.push('  ' + wireLine(w));
  lines.push('}');
  return lines.join('\n');
}

// ── PARSE ─────────────────────────────────────────────────────────────────────
interface ParsedNode { id: string; tool: string; full: boolean; args?: any; labelProvided: boolean; label?: string; waitForAll: boolean; fallback?: string; iconName?: string; colorKey?: string; }
interface ParsedWire { from: string; to: string; guard?: any; loop?: any; loopBreak?: boolean; loopFanoutMode?: any; stream?: any; callNode?: boolean; label?: string; }
interface ParsedTrigger { id: string; type: string; args: any; labelProvided: boolean; label?: string; inputParams?: any; }
interface ParsedVar { name: string; type: string; scope?: string; persistState?: boolean; defaultValue: any; }

export interface ParseResult {
  name?: string; version?: string; description?: string; autostart?: boolean;
  nodes: ParsedNode[]; wires: ParsedWire[]; triggers: ParsedTrigger[]; variables: ParsedVar[];
  errors: string[];
}

export function parseDsl(text: string): ParseResult {
  const res: ParseResult = { nodes: [], wires: [], triggers: [], variables: [], errors: [] };
  const rawLines = text.split('\n');
  for (let li = 0; li < rawLines.length; li++) {
    let line = rawLines[li];
    // strip trailing `# comment` (but not inside a JSON string — comments only
    // ever appear on stub/neighbour lines we emit, so a simple split is safe)
    const hashIdx = line.indexOf(' #');
    if (hashIdx >= 0 && !/["{[]/.test(line.slice(hashIdx))) line = line.slice(0, hashIdx);
    line = line.trim();
    if (!line || line === '}') continue;
    if (line.startsWith('flow ')) {
      const after = line.slice(5);
      if (after.startsWith('"')) {
        const end = scanValueEnd(after, 0);
        try { res.name = JSON.parse(after.slice(0, end)); } catch {}
        const vm = after.slice(end).match(/v(\S+)/);
        if (vm) res.version = vm[1];
      }
      continue;
    }

    if (line.startsWith('@autostart')) { res.autostart = true; continue; }
    if (line.startsWith('@desc')) { try { res.description = JSON.parse(line.slice(5).trim()); } catch {} continue; }

    if (line.startsWith('var ')) {
      const eq = line.indexOf('=');
      if (eq === -1) { res.errors.push(`bad var line: ${line}`); continue; }
      const left = line.slice(4, eq).trim();
      const valStr = line.slice(eq + 1).trim();
      const m = left.match(/^(\w+):(\w+)(.*)$/);
      if (!m) { res.errors.push(`bad var decl: ${line}`); continue; }
      let val: any = null;
      try { val = JSON.parse(valStr); } catch { val = valStr; }
      res.variables.push({
        name: m[1], type: m[2],
        scope: /@local/.test(m[3]) ? 'local' : undefined,
        persistState: /@persist/.test(m[3]) || undefined,
        defaultValue: val,
      });
      continue;
    }

    if (line.startsWith('trigger ')) {
      const m = line.match(/^trigger\s+(\S+)\s*=\s*(\S+)\s*/);
      if (!m) { res.errors.push(`bad trigger line: ${line}`); continue; }
      let rest = line.slice(m[0].length);
      let args = {};
      if (rest.startsWith('{')) { const end = scanValueEnd(rest, 0); try { args = JSON.parse(rest.slice(0, end)); } catch {} rest = rest.slice(end); }
      const ann = readAnnotations(rest);
      res.triggers.push({ id: m[1], type: m[2], args, labelProvided: 'label' in ann.vals, label: ann.vals.label, inputParams: ann.vals.inputs });
      continue;
    }

    // wire: `from -> to ...`  (no ` = ` before the arrow)
    const arrowIdx = line.indexOf('->');
    const eqIdx = line.indexOf('=');
    if (arrowIdx >= 0 && (eqIdx === -1 || eqIdx > arrowIdx)) {
      const wm = line.match(/^(\S+)\s*->\s*(\S+)\s*/);
      if (!wm) { res.errors.push(`bad wire line: ${line}`); continue; }
      const ann = readAnnotations(line.slice(wm[0].length));
      const w: ParsedWire = { from: wm[1], to: wm[2] };
      if ('guard' in ann.vals) w.guard = ann.vals.guard;
      if ('loop' in ann.vals) w.loop = ann.vals.loop;
      if (ann.flags.has('loopBreak')) w.loopBreak = true;
      if ('fanout' in ann.vals) w.loopFanoutMode = ann.vals.fanout;
      if ('stream' in ann.vals) w.stream = ann.vals.stream;
      if (ann.flags.has('callNode')) w.callNode = true;
      if ('label' in ann.vals) w.label = ann.vals.label;
      res.wires.push(w);
      continue;
    }

    // node: `id = tool {args}? annotations`
    const nm = line.match(/^(\S+)\s*=\s*(\S+)\s*/);
    if (!nm) { res.errors.push(`unrecognized line: ${line}`); continue; }
    let rest = line.slice(nm[0].length);
    let args: any;
    let full = false;
    if (rest.startsWith('{')) { const end = scanValueEnd(rest, 0); try { args = JSON.parse(rest.slice(0, end)); full = true; } catch { res.errors.push(`bad args JSON for ${nm[1]}: ${rest.slice(0, 40)}`); } rest = rest.slice(end); }
    const ann = readAnnotations(rest);
    res.nodes.push({
      id: nm[1], tool: nm[2], full, args,
      labelProvided: 'label' in ann.vals, label: ann.vals.label,
      waitForAll: ann.flags.has('waitForAll'),
      fallback: ann.vals.fallback,
      iconName: ann.vals.icon,
      colorKey: ann.vals.color,
    });
  }
  return res;
}

// ── MERGE parsed DSL back onto a base model (the reliability core) ─────────────
function autoPosition(model: any): { x: number; y: number } {
  const items = [...(model.nodes || []), ...(model.triggers || [])];
  if (!items.length) return { x: 300, y: 200 };
  const maxX = Math.max(...items.map((i: any) => i.position?.x || 0));
  return { x: maxX + 280, y: items[0]?.position?.y || 200 };
}

export function parseWorkflow(text: string, base: any = {}): { model: any; errors: string[] } {
  const parsed = parseDsl(text);
  const errors = [...parsed.errors];
  const baseNodes = new Map<string, any>((base.nodes || []).map((n: any) => [n.id, n]));
  const baseTrigs = new Map<string, any>((base.triggers || []).map((t: any) => [t.id, t]));
  const baseVars = new Map<string, any>((base.variables || []).map((v: any) => [v.name, v]));
  const baseWires = new Map<string, any>((base.wires || []).map((w: any) => [`${w.from} ${w.to}`, w]));

  const working = { ...base }; // carries id, kind, functionNode, marketplace*, requirements, scripts, outputSchema, locked…
  if (parsed.name !== undefined) working.name = parsed.name; else working.name = base.name;
  working.version = parsed.version ?? base.version ?? '1';
  working.description = parsed.description ?? base.description;
  working.autostart = parsed.autostart ?? base.autostart ?? undefined;

  // nodes
  working.nodes = parsed.nodes.map((p) => {
    const b = baseNodes.get(p.id);
    const out: any = b ? { ...b } : { id: p.id, type: 'tool', position: autoPosition(working) };
    out.tool = p.tool;
    if (p.full) {
      out.args = restoreAbbrev(p.args ?? {}, b?.args);
      // full line is authoritative for flags
      if (p.waitForAll) out.waitForAll = true; else delete out.waitForAll;
      if (p.fallback) out.fallbackTo = p.fallback; else delete out.fallbackTo;
    } else if (b) {
      out.args = b.args; // stub — keep base args
    } else {
      out.args = {};
    }
    out.label = p.labelProvided ? p.label : (b && b.label !== undefined ? b.label : p.tool);
    if (p.iconName) out.iconName = p.iconName;
    if (p.colorKey) out.colorKey = p.colorKey;
    if (!out.position) out.position = autoPosition(working);
    return out;
  });

  // triggers
  working.triggers = parsed.triggers.map((p) => {
    const b = baseTrigs.get(p.id);
    const out: any = b ? { ...b } : { id: p.id, position: autoPosition(working) };
    out.type = p.type;
    out.args = p.args ?? b?.args ?? {};
    out.label = p.labelProvided ? p.label : (b && b.label !== undefined ? b.label : p.type);
    if (p.inputParams !== undefined) out.inputParams = p.inputParams;
    if (!out.position) out.position = autoPosition(working);
    return out;
  });
  // if the DSL omitted triggers entirely (e.g. a window with no trigger focus),
  // keep the base triggers rather than wiping them.
  if (parsed.triggers.length === 0 && (base.triggers || []).length) working.triggers = base.triggers;

  // variables
  working.variables = parsed.variables.map((p) => {
    const b = baseVars.get(p.name);
    const out: any = b ? { ...b } : {};
    out.name = p.name; out.type = p.type; out.defaultValue = p.defaultValue;
    out.scope = p.scope || (b?.scope) || 'workflow';
    if (p.persistState) out.persistState = true; else if (out.persistState && !p.persistState) delete out.persistState;
    return out;
  });
  if (parsed.variables.length === 0 && (base.variables || []).length) working.variables = base.variables;

  // wires (base-merge by from→to preserves any unknown field)
  working.wires = parsed.wires.map((p) => {
    const b = baseWires.get(`${p.from} ${p.to}`);
    const out: any = b ? { ...b } : { from: p.from, to: p.to };
    out.from = p.from; out.to = p.to;
    // authoritative: only the fields the DSL can express
    for (const f of ['guard', 'loop', 'loopFanoutMode', 'stream', 'label'] as const) {
      if ((p as any)[f] !== undefined) out[f] = (p as any)[f]; else delete out[f];
    }
    if (p.loopBreak) out.loopBreak = true; else delete out.loopBreak;
    if (p.callNode) out.callNode = true; else delete out.callNode;
    return out;
  });

  // Drop undefined props so a round-trip equals the original (no `{x: undefined}`
  // vs missing-key mismatches) and the stored model stays clean JSON.
  const clean = (o: any) => { if (o && typeof o === 'object') for (const key of Object.keys(o)) if (o[key] === undefined) delete o[key]; return o; };
  clean(working);
  (working.nodes || []).forEach(clean);
  (working.triggers || []).forEach(clean);
  (working.variables || []).forEach(clean);
  (working.wires || []).forEach(clean);

  return { model: working, errors };
}

// ── high-level edit helpers (used by the edit_workflow tool) ───────────────────
export interface DslEditResult { ok: boolean; model?: any; error?: string; changedIds?: string[]; }

function diffChangedIds(before: any, after: any): string[] {
  const ids = new Set<string>();
  const bn = new Map<string, string>((before.nodes || []).map((n: any) => [n.id, JSON.stringify(n)]));
  const an = new Map<string, string>((after.nodes || []).map((n: any) => [n.id, JSON.stringify(n)]));
  for (const [id, s] of an) if (bn.get(id) !== s) ids.add(id);
  for (const id of bn.keys()) if (!an.has(id)) ids.add(id);
  const bw = new Set((before.wires || []).map((w: any) => `${w.from}->${w.to}`));
  const aw = new Set((after.wires || []).map((w: any) => `${w.from}->${w.to}`));
  for (const w of aw) if (!bw.has(w)) { const [f, t] = String(w).split('->'); ids.add(f); ids.add(t); }
  for (const w of bw) if (!aw.has(w)) { const [f, t] = String(w).split('->'); ids.add(f); ids.add(t); }
  return [...ids];
}

/** Apply an anchored find/replace over the full DSL of `base`, returning the new model. */
export function applyDslEdit(base: any, oldString: string, newString: string, replaceAll = false): DslEditResult {
  const full = serializeWorkflow(base, { mode: 'full' });
  const count = full.split(oldString).length - 1;
  if (count === 0) return { ok: false, error: 'old_string not found in the workflow DSL. Read a window first; the text must match exactly.' };
  if (count > 1 && !replaceAll) return { ok: false, error: `old_string appears ${count} times — provide a longer unique anchor or set replace_all: true.` };
  const patched = replaceAll ? full.split(oldString).join(newString) : full.replace(oldString, newString);
  const { model, errors } = parseWorkflow(patched, base);
  if (errors.length) return { ok: false, error: `DSL no longer parses after the edit: ${errors.slice(0, 3).join('; ')}` };
  return { ok: true, model, changedIds: diffChangedIds(base, model) };
}

/** Replace the whole workflow with a new DSL document (for big rewrites / generation). */
export function applyDslContent(base: any, content: string): DslEditResult {
  const { model, errors } = parseWorkflow(content, base);
  if (errors.length) return { ok: false, error: `DSL parse errors: ${errors.slice(0, 5).join('; ')}` };
  return { ok: true, model, changedIds: diffChangedIds(base || { nodes: [], wires: [] }, model) };
}
