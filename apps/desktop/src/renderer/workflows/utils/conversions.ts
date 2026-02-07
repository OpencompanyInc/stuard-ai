import type { DesignerModel, StuardSpec } from "../types";

/**
 * Convert a spec to DesignerModel format.
 * Handles both:
 * - StuardSpec format (steps array with next edges)
 * - DesignerModel format (nodes/wires arrays) - passed through with normalization
 */
export function specToDesignerModel(spec: any): DesignerModel {
  try {
    const id = String(spec?.id || '').trim() || 'workflow_' + Math.random().toString(36).slice(2, 8);
    const name = String(spec?.name || 'Workflow');
    const version = String(spec?.version || '1');
    const autostart = !!spec?.autostart;
    const requirements = String(spec?.requirements || '');
    const scripts = spec?.scripts || {};

    // Detect if input is already in DesignerModel format (has nodes array)
    const hasNodes = Array.isArray(spec?.nodes) && spec.nodes.length > 0;
    const hasWires = Array.isArray(spec?.wires);
    const hasSteps = Array.isArray(spec?.steps) && spec.steps.length > 0;

    // If already in DesignerModel format, normalize and return
    if (hasNodes || (hasWires && !hasSteps)) {
      const triggers = Array.isArray(spec?.triggers) ? spec.triggers : [];
      const nodes = Array.isArray(spec?.nodes) ? spec.nodes : [];
      const wires = Array.isArray(spec?.wires) ? spec.wires : [];

      // Normalize triggers to have positions (sanitize IDs to remove dots)
      const trigNodes = triggers.map((t: any, i: number) => ({
        id: String(t?.id || `trig_${i}`).replace(/\./g, '_'),
        type: String(t?.type || ''),
        label: t?.label || String(t?.type || 'trigger'),
        args: t?.args || {},
        position: t?.position || { x: 20, y: 20 + i * 60 },
      }));

      // Normalize nodes to have positions and required fields
      // Sanitize IDs to remove dots (breaks template interpolation like {{step_1.text}})
      const normNodes = nodes.map((n: any, i: number) => ({
        id: String(n?.id || `step_${i}`).replace(/\./g, '_'),
        type: n?.type || 'local.tool',
        tool: String(n?.tool || 'noop'),
        label: n?.label || String(n?.id || `Step ${i + 1}`),
        args: n?.args || {},
        fallbackTo: n?.fallbackTo || n?.fallback?.to || '',
        position: n?.position || { x: 40 + (i % 6) * 140, y: 60 + Math.floor(i / 6) * 90 },
      }));

      // Normalize wires (sanitize IDs to match nodes)
      const normWires = wires.map((w: any) => ({
        from: String(w?.from || '').replace(/\./g, '_'),
        to: String(w?.to || '').replace(/\./g, '_'),
        guard: w?.guard || 'always',
        label: w?.label || '',
        loop: (w as any)?.loop,
        loopBreak: (w as any)?.loopBreak,
        loopFanoutMode: (w as any)?.loopFanoutMode,
        stream: (w as any)?.stream,
      })).filter((w: any) => w.from && w.to);

      console.log('[conversions] Detected DesignerModel format:', { triggers: trigNodes.length, nodes: normNodes.length, wires: normWires.length });

      return {
        id, name, version, autostart, requirements, scripts,
        triggers: trigNodes, nodes: normNodes, wires: normWires,
        marketplaceSlug: spec?.marketplaceSlug,
        locked: !!spec?.locked
      };
    }

    // Convert from StuardSpec format (steps with next edges)
    const steps = Array.isArray(spec?.steps) ? spec.steps : [];
    const triggers = Array.isArray(spec?.triggers) ? spec.triggers : [];

    // Sanitize IDs to remove dots (breaks template interpolation like {{step_1.text}})
    const nodes = steps.map((s: any, i: number) => ({
      id: String(s?.id || `step_${i}`).replace(/\./g, '_'),
      type: 'local.tool',
      tool: String(s?.tool || 'noop'),
      label: String(s?.id || `Step ${i + 1}`),
      args: s?.args || {},
      fallbackTo: s?.fallback?.to || '',
      position: s?.position || { x: 40 + (i % 6) * 140, y: 60 + Math.floor(i / 6) * 90 },
    }));

    const wires: Array<{ from: string; to: string }> = [];
    const wiresFull: any[] = [];

    for (const s of steps) {
      const fromId = String(s?.id || '');
      const nextArr = Array.isArray(s?.next) ? s.next : [];
      for (const e of nextArr) {
        const toId = String(e?.to || '');
        if (fromId && toId) {
          const guard = (e as any)?.guard;
          let g: any = 'always';
          if (guard && typeof guard === 'object' && guard.if) g = { if: guard.if };
          if (guard && typeof guard === 'object' && guard.ai) g = { ai: guard.ai };
          if (typeof guard === 'string' && guard !== 'always') g = guard;
          wires.push({ from: fromId, to: toId });
          wiresFull.push({
            from: fromId,
            to: toId,
            guard: g,
            label: (e as any)?.label || '',
            loop: (e as any)?.loop,
            loopBreak: (e as any)?.loopBreak,
            loopFanoutMode: (e as any)?.loopFanoutMode,
            stream: (e as any)?.stream,
          });
        }
      }
    }

    const trigNodes = triggers.map((t: any, i: number) => ({
      id: String(t?.id || `trig_${i}`).replace(/\./g, '_'),
      type: String(t?.type || ''),
      label: t?.label || String(t?.type || 'trigger'),
      args: t?.args || {},
      position: t?.position || { x: 20, y: 20 + i * 60 },
    }));

    console.log('[conversions] Converted StuardSpec to DesignerModel:', { triggers: trigNodes.length, nodes: nodes.length, wires: wiresFull.length });

    return {
      id, name, version, autostart, requirements, scripts,
      triggers: trigNodes, nodes, wires: wiresFull.length ? wiresFull : wires,
      marketplaceSlug: spec?.marketplaceSlug,
      locked: !!spec?.locked
    };
  } catch (e) {
    console.error('[conversions] specToDesignerModel failed:', e);
    return {
      id: 'workflow_' + Math.random().toString(36).slice(2, 8),
      name: 'Workflow',
      version: '1',
      requirements: '',
      scripts: {},
      triggers: [],
      nodes: [],
      wires: []
    };
  }
}

export function designerModelToStuardSpec(m: any): StuardSpec {
  const id = String(m?.id || '').trim() || 'stuard_' + Math.random().toString(36).slice(2, 8);
  const name = String(m?.name || 'My Stuard');
  const version = String(m?.version || '1');
  const autostart = !!m?.autostart;
  const requirements = String(m?.requirements || '');
  const scripts = m?.scripts || {};
  const nodes = Array.isArray(m?.nodes) ? m.nodes : [];
  const wires = Array.isArray(m?.wires) ? m.wires : [];
  const triggersIn = Array.isArray(m?.triggers) ? m.triggers : [];

  const steps = nodes.map((n: any) => {
    const fromId = String(n?.id || '');
    const outs = wires.filter((w: any) => String(w?.from || '') === fromId);
    const next = outs.map((w: any) => {
      const to = String(w?.to || '');
      const g = (w as any)?.guard;
      let guard: any = 'always';
      if (g && typeof g === 'object' && g.if) guard = { if: g.if };
      if (g && typeof g === 'object' && g.ai) guard = { ai: g.ai };
      const label = (w as any)?.label;
      const loop = (w as any)?.loop;
      const loopBreak = (w as any)?.loopBreak;
      const loopFanoutMode = (w as any)?.loopFanoutMode;
      const stream = (w as any)?.stream;
      const edge: any = { to, guard };
      if (label) edge.label = String(label);

      if (loop && typeof loop === 'object' && loop.type) {
        edge.loop = {
          type: loop.type,
          items: loop.items,
          itemVar: loop.itemVar || 'item',
          indexVar: loop.indexVar || 'index',
          count: loop.count,
          conditionText: loop.conditionText,
          maxIterations: loop.maxIterations || 100,
          delayMs: loop.delayMs || 0,
        };
      }

      if (loopBreak) {
        edge.loopBreak = true;
      }

      if (loopFanoutMode === 'wait' || loopFanoutMode === 'parallel') {
        edge.loopFanoutMode = loopFanoutMode;
      }

      if (stream && typeof stream === 'object') {
        edge.stream = {
          sourceField: stream.sourceField || 'streamId',
          mode: stream.mode || 'reactive',
          ...(stream.bufferSize ? { bufferSize: stream.bufferSize } : {}),
        };
      }
      return edge;
    });
    const step: any = { id: fromId, tool: String(n?.tool || 'noop'), args: n?.args || {}, next };
    if (n && typeof n.fallbackTo === 'string' && n.fallbackTo.trim()) {
      step.fallback = { to: n.fallbackTo.trim() };
    }
    return step;
  });

  const inbound = new Set<string>(wires.map((w: any) => String(w?.to || '')).filter(Boolean));
  const startNode = nodes.find((n: any) => !inbound.has(String(n?.id || ''))) || nodes[0];
  const triggers = triggersIn.map((t: any) => ({ type: String(t?.type || ''), args: t?.args || {} }));

  return {
    id,
    name,
    version,
    autostart,
    requirements,
    scripts,
    triggers,
    steps,
    start: startNode ? String(startNode.id) : undefined
  };
}
