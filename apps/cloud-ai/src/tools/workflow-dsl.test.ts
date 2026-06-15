import { describe, it, expect, beforeEach } from 'vitest';
import { serializeWorkflow, parseWorkflow, applyDslEdit, applyDslContent } from '@stuardai/workflow-core/dsl';
import { readWorkflow, editWorkflow } from './workflow-dsl';
import { setSessionWorkflow, clearSessionWorkflow, getWorkflowById } from './workflow';

const COMPONENT = `<div class="card"><h1>{{s.headline}}</h1>\n<button onclick="stuard.callNode('go',{})">Go</button></div>`;

function fixture(): any {
  return {
    id: 'flow_demo', name: 'Demo "Flow"', version: '4', description: 'a test', autostart: true,
    kind: 'function', marketplaceSlug: 'demo', outputSchema: [{ name: 'out', type: 'json' }],
    variables: [
      { name: 'counter', type: 'number', scope: 'workflow', defaultValue: 0, description: 'kept on base' },
      { name: 'cache', type: 'json', scope: 'local', persistState: true, defaultValue: null },
    ],
    triggers: [
      { id: 'trig_0', type: 'cron', label: 'Morning', args: { schedule: '0 8 * * *' }, position: { x: 80, y: 120 },
        inputParams: [{ name: 'city', type: 'string', required: true }, { name: 'limit', type: 'number', defaultValue: 10 }] },
    ],
    nodes: [
      { id: 'n1', type: 'tool', tool: 'http_get', label: 'http get', args: { url: 'https://x/{{trig.city}}', headers: { a: '{{workflow.k}}' } }, position: { x: 300, y: 200 } },
      { id: 'n2', type: 'tool', tool: 'transform', label: 'shape', args: { expr: '{{n1.body}} | take(5)' }, position: { x: 520, y: 200 }, iconName: 'wand', colorKey: 'red' },
      { id: 'n3', type: 'tool', tool: 'llm_generate', label: 'llm_generate', args: { model: 'claude-opus-4-8', prompt: 'Summarize {{n2.out}}.' }, position: { x: 740, y: 200 }, fallbackTo: 'n4' },
      { id: 'n4', type: 'tool', tool: 'log', label: 'log', args: { message: 'fallback' }, position: { x: 740, y: 360 } },
      { id: 'merge', type: 'tool', tool: 'sql_query', label: 'save', args: { q: 'insert {{n3.text}}' }, position: { x: 960, y: 200 }, waitForAll: true },
      { id: 'ui', type: 'custom_ui', tool: 'custom_ui', label: 'Card', args: { title: 'T', component: COMPONENT, height: 480 }, position: { x: 1180, y: 200 } },
    ],
    wires: [
      { from: 'trig_0', to: 'n1' },
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3', guard: { if: '{{n2.score}} > 0.7' } },
      { from: 'n2', to: 'n4', label: 'parallel' },
      { from: 'n3', to: 'merge', loop: { type: 'forEach', items: '{{n3.items}}', itemVar: 'item', maxIterations: 100 } },
      { from: 'n4', to: 'merge' },
      { from: 'merge', to: 'ui', stream: { mode: 'reactive', format: 'base64' } },
    ],
  };
}

describe('workflow DSL (serialize/parse)', () => {
  it('round-trips losslessly through the full DSL', () => {
    const wf = fixture();
    const back = parseWorkflow(serializeWorkflow(wf, { mode: 'full' }), wf).model;
    expect(back).toEqual(wf);
  });

  it('reconstructs all semantics from a layout-only base (positions/meta preserved)', () => {
    const wf = fixture();
    const layoutBase = {
      id: wf.id, kind: wf.kind, marketplaceSlug: wf.marketplaceSlug, outputSchema: wf.outputSchema,
      nodes: wf.nodes.map((n: any) => ({ id: n.id, type: n.type, position: n.position })),
      triggers: wf.triggers.map((t: any) => ({ id: t.id, position: t.position })),
      variables: wf.variables.map((v: any) => ({ name: v.name, description: v.description })),
      wires: [],
    };
    expect(parseWorkflow(serializeWorkflow(wf, { mode: 'full' }), layoutBase).model).toEqual(wf);
  });

  it('anchored edit is surgical — only the target changes; layout + icons intact', () => {
    const wf = fixture();
    const r = applyDslEdit(wf, '"url":"https://x/{{trig.city}}"', '"url":"https://y/{{trig.city}}"');
    expect(r.ok).toBe(true);
    expect(r.model.nodes.find((n: any) => n.id === 'n1').args.url).toBe('https://y/{{trig.city}}');
    expect(r.model.nodes.find((n: any) => n.id === 'n2').position).toEqual({ x: 520, y: 200 });
    expect(r.model.nodes.find((n: any) => n.id === 'n2').iconName).toBe('wand');
    expect(r.changedIds).toEqual(['n1']);
  });

  it('adds a node + wires via content, preserving existing layout and auto-positioning the new node', () => {
    const wf = fixture();
    const full = serializeWorkflow(wf, { mode: 'full' });
    const next = full.replace('  merge -> ui', '  send = gmail_send {"to":"me@x.com"}\n  merge -> send\n  send -> ui\n  merge -> ui');
    const r = applyDslContent(wf, next);
    expect(r.ok).toBe(true);
    const send = r.model.nodes.find((n: any) => n.id === 'send');
    expect(send).toBeTruthy();
    expect(typeof send.position.x).toBe('number');
    expect(r.model.nodes.find((n: any) => n.id === 'n1').position).toEqual({ x: 300, y: 200 });
    expect(r.model.nodes.length).toBe(wf.nodes.length + 1);
  });

  it('tolerates pretty-printed multi-line JSON args (what LLMs emit)', () => {
    const wf = fixture();
    // A brand-new node generated with indented, multi-line JSON + a `node` keyword
    // prefix — the exact shape that used to fail with "bad args JSON" / "unrecognized line".
    const dsl = `flow "Gen" v1 {
  trigger t = manual {}

  node story = ai_inference {
    "model": "openai/gpt-4.1-mini",
    "mode": "json",
    "prompt": "Make a 4-scene storyboard with #hashtags and a -> arrow",
    "schema": {
      "scenes": ["string"]
    }
  } @label "Generate Storyboard"

  t -> story
}`;
    const { model, errors } = parseWorkflow(dsl, {});
    expect(errors).toEqual([]);
    const story = model.nodes.find((n: any) => n.id === 'story');
    expect(story).toBeTruthy();
    expect(story.tool).toBe('ai_inference');
    expect(story.args.model).toBe('openai/gpt-4.1-mini');
    expect(story.args.schema).toEqual({ scenes: ['string'] });
    expect(story.label).toBe('Generate Storyboard');
    expect(model.wires.find((w: any) => w.from === 't' && w.to === 'story')).toBeTruthy();
  });

  it('full multi-line generation succeeds via applyDslContent on a blank base', () => {
    const dsl = `flow "Social" v1 {
  trigger t = manual {}

  node a = http_get {
    "url": "https://x"
  }
  node b = transform {
    "expr": "{{a.body}}"
  }

  t -> a
  a -> b
}`;
    const r = applyDslContent({ nodes: [], wires: [] }, dsl);
    expect(r.ok).toBe(true);
    expect(r.model.nodes.map((n: any) => n.id).sort()).toEqual(['a', 'b']);
    expect(r.model.nodes.find((n: any) => n.id === 'a').args.url).toBe('https://x');
  });

  it('tolerates unquoted (JS-style) keys and trailing commas', () => {
    const dsl = `flow "Gen" v1 {
  trigger t = manual {}

  node a = generate_image {
    prompt: "a cat",
    model: "google/gemini-3.1-flash-image-preview",
    aspect_ratio: "16:9",
  }

  t -> a
}`;
    const { model, errors } = parseWorkflow(dsl, {});
    expect(errors).toEqual([]);
    const a = model.nodes.find((n: any) => n.id === 'a');
    expect(a.args.prompt).toBe('a cat');
    expect(a.args.aspect_ratio).toBe('16:9');
  });

  it('lifts inputParams written inside the trigger args (LLM style) to the trigger', () => {
    const dsl = `flow "Gen" v1 {
  trigger t = manual {
    inputParams: [
      {
        name: "topic",
        type: "string",
        defaultValue: "stone tools to airplanes",
        required: true
      }
    ]
  } @label "Manual Trigger"
}`;
    const { model, errors } = parseWorkflow(dsl, {});
    expect(errors).toEqual([]);
    const t = model.triggers.find((x: any) => x.id === 't');
    expect(Array.isArray(t.inputParams)).toBe(true);
    expect(t.inputParams[0]).toEqual({ name: 'topic', type: 'string', defaultValue: 'stone tools to airplanes', required: true });
    expect(t.args.inputParams).toBeUndefined(); // lifted out of args
  });

  it('reproduces the failing social-video generation (node prefix + JS keys + multi-line + inputParams) — now parses clean', () => {
    // This is the shape that failed 3× in the real trace before falling back to a 33-op modify_workflow.
    const dsl = `flow "Social Media" v1 {
  @desc "Whiteboard tech-evolution video, then post to X."

  trigger trig_manual = manual {
    inputParams: [
      { name: "topic", type: "string", defaultValue: "stone tools to airplanes", required: true }
    ]
  } @label "Manual Trigger"

  node ffmpeg_status = ffmpeg_status {} @label "Check FFmpeg"

  node generate_storyboard = ai_inference {
    model: "openai/gpt-4.1-mini",
    mode: "json",
    prompt: "Create a 4-scene storyboard about '{{trigger.data.topic}}'. Keep #hashtags. Arrow -> stays literal.",
    schema: {
      type: "object",
      properties: {
        scenes: { type: "array", items: { type: "object", properties: { narration: { type: "string" } } } },
        tweet_text: { type: "string" },
      },
      required: ["scenes", "tweet_text"],
    },
  } @label "Generate Storyboard"

  node generate_image_1 = generate_image {
    prompt: "{{generate_storyboard.json.scenes[0].image_prompt}}",
    model: "google/gemini-3.1-flash-image-preview",
    aspect_ratio: "16:9",
  } @label "Generate Frame 1"

  trig_manual -> ffmpeg_status
  ffmpeg_status -> generate_storyboard
  generate_storyboard -> generate_image_1
}`;
    const r = applyDslContent({ nodes: [], wires: [] }, dsl);
    expect(r.ok).toBe(true);
    const ids = r.model.nodes.map((n: any) => n.id).sort();
    expect(ids).toEqual(['ffmpeg_status', 'generate_image_1', 'generate_storyboard']);
    const story = r.model.nodes.find((n: any) => n.id === 'generate_storyboard');
    expect(story.args.model).toBe('openai/gpt-4.1-mini');
    expect(story.args.schema.required).toEqual(['scenes', 'tweet_text']);
    expect(story.args.prompt).toContain('#hashtags');
    expect(story.args.prompt).toContain('->');
    const trig = r.model.triggers.find((t: any) => t.id === 'trig_manual');
    expect(trig.inputParams[0].name).toBe('topic');
    expect(r.model.wires.length).toBe(3);
  });

  it('removing an annotation removes the field (authoritative)', () => {
    const wf = fixture();
    const r = applyDslEdit(wf, ' @guard {"if":"{{n2.score}} > 0.7"}', '');
    expect(r.ok).toBe(true);
    const w = r.model.wires.find((x: any) => x.from === 'n2' && x.to === 'n3');
    expect('guard' in w).toBe(false);
  });

  it('DSL is much smaller than JSON', () => {
    const wf = fixture();
    const dsl = serializeWorkflow(wf, { mode: 'full' }).length;
    const json = JSON.stringify(wf).length;
    expect(dsl).toBeLessThan(json);
  });
});

describe('edit_workflow / read_workflow tools', () => {
  beforeEach(() => { clearSessionWorkflow(); });

  it('read_workflow window is loaded from session and shows the focus node', async () => {
    setSessionWorkflow(fixture());
    const out: any = await (readWorkflow as any).execute({ mode: 'window', focusIds: ['n2'], workflowId: null }, {});
    expect(out.ok).toBe(true);
    expect(out.dsl).toContain('n2 = transform');
  });

  it('edit_workflow commits a surgical change and repaints the canvas by id with positions intact', async () => {
    setSessionWorkflow(fixture());
    const out: any = await (editWorkflow as any).execute(
      { old_string: '"q":"insert {{n3.text}}"', new_string: '"q":"insert into digest {{n3.text}}"', content: null, replace_all: null, workflowId: null },
      {},
    );
    expect(out.ok).toBe(true);
    expect(out.changed).toEqual(['merge']);
    // canvas repaint path: the fresh model is resolvable by id (attachWorkflowForClient)
    const fresh: any = getWorkflowById('flow_demo');
    expect(fresh).toBeTruthy();
    expect(fresh.nodes.find((n: any) => n.id === 'merge').args.q).toBe('insert into digest {{n3.text}}');
    // untouched node layout preserved
    expect(fresh.nodes.find((n: any) => n.id === 'n1').position).toEqual({ x: 300, y: 200 });
    expect(fresh.nodes.find((n: any) => n.id === 'n2').iconName).toBe('wand');
  });

  it('edit_workflow rejects a non-matching anchor without mutating the workflow', async () => {
    setSessionWorkflow(fixture());
    const out: any = await (editWorkflow as any).execute(
      { old_string: 'THIS TEXT DOES NOT EXIST', new_string: 'x', content: null, replace_all: null, workflowId: null },
      {},
    );
    expect(out.ok).toBe(false);
    expect((getWorkflowById('flow_demo') as any).nodes.find((n: any) => n.id === 'merge').args.q).toBe('insert {{n3.text}}');
  });
});
