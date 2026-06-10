import { describe, it, expect } from 'vitest';
import {
  enter_research_mode,
  exit_research_mode,
  research_note,
  research_status,
  research_compile,
  research_report,
  attachResearchReportForClient,
  getResearchSessionView,
  normalizeResearchUrl,
} from './research-mode';
import { buildResearchStateBlock, buildResearchModeSystemPrompt } from '../agents/stuard/research-prompts';

const exec = (tool: any, args: any) => tool.execute(args);

describe('normalizeResearchUrl', () => {
  it('strips hash, www, tracking params, and trailing slash', () => {
    expect(normalizeResearchUrl('https://www.Example.com/post/?utm_source=x&fbclid=1#frag'))
      .toBe('https://example.com/post');
    expect(normalizeResearchUrl('https://example.com/post'))
      .toBe(normalizeResearchUrl('https://www.example.com/post/'));
  });

  it('returns non-URL input trimmed', () => {
    expect(normalizeResearchUrl('  not a url ')).toBe('not a url');
  });
});

describe('research mode session lifecycle', () => {
  const cid = 'test-convo-1';

  it('has no view before entering', () => {
    expect(getResearchSessionView(cid)).toBeNull();
  });

  it('enter creates a session and re-enter updates without losing state', async () => {
    const created = await exec(enter_research_mode, {
      conversation_id: cid,
      brief: 'Compare vector databases for a startup',
    });
    expect(created.ok).toBe(true);
    expect(created.created).toBe(true);

    const noted = await exec(research_note, {
      conversation_id: cid,
      notes: [
        { text: 'Qdrant is OSS with managed cloud.', kind: 'finding', topic: 'qdrant' },
        { text: 'Need pricing data for pgvector at scale.', kind: 'gap', topic: 'pgvector' },
      ],
    });
    expect(noted.ok).toBe(true);
    expect(noted.added).toEqual(['n1', 'n2']);
    expect(noted.open_questions).toBe(1);

    const updated = await exec(enter_research_mode, {
      conversation_id: cid,
      brief: 'Compare vector databases for a startup (updated)',
      plan: '1. qdrant\n2. pgvector',
    });
    expect(updated.created).toBe(false);

    const view = getResearchSessionView(cid)!;
    expect(view.brief).toContain('updated');
    expect(view.plan).toContain('pgvector');
    expect(view.notes).toHaveLength(2);
  });

  it('resolves gaps via resolves and drops unknown source ids with warnings', async () => {
    const result = await exec(research_note, {
      conversation_id: cid,
      notes: [
        { text: 'pgvector on RDS costs ~$X/mo at 10M vectors.', kind: 'answer', source_ids: ['s99'], resolves: ['n2'] },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.open_questions).toBe(0);
    expect(result.warnings?.[0]).toContain('s99');
  });

  it('status reports notes and no open questions', async () => {
    const status = await exec(research_status, { conversation_id: cid });
    expect(status.ok).toBe(true);
    expect(status.notes).toHaveLength(3);
    expect(status.open_questions).toHaveLength(0);
  });

  it('compile returns all notes and marks session compiling', async () => {
    const compiled = await exec(research_compile, { conversation_id: cid });
    expect(compiled.ok).toBe(true);
    expect(compiled.notes).toHaveLength(3);
    expect(getResearchSessionView(cid)!.status).toBe('compiling');
  });

  it('state block + takeover prompt render the session', () => {
    const view = getResearchSessionView(cid)!;
    const block = buildResearchStateBlock(view);
    expect(block).toContain('RESEARCH STATE');
    expect(block).toContain('n1');

    const prompt = buildResearchModeSystemPrompt(view, { conversationId: cid });
    expect(prompt).toContain('Research Mode');
    expect(prompt).toContain('research_compile');
    expect(prompt).toContain(cid);
  });

  it('results carry conversation_id + counts for the desktop bar (completed events lack args)', async () => {
    const created = await exec(enter_research_mode, { conversation_id: cid, brief: 'b' });
    // The desktop reads these off result, not args — regression guard.
    expect(created.conversation_id).toBe(cid);
    expect(typeof created.total_sources).toBe('number');
    expect(typeof created.total_notes).toBe('number');
    expect(created.brief).toBeTruthy();

    const noted = await exec(research_note, { conversation_id: cid, notes: [{ text: 'x' }] });
    expect(noted.conversation_id).toBe(cid);
  });

  it('research_report carries the markdown on the result so the viewer always gets it', async () => {
    const md = '# Report\n\n' + 'x'.repeat(400);
    const result = await exec(research_report, {
      conversation_id: cid,
      title: 'My Report',
      markdown: md,
    });
    expect(result.ok).toBe(true);
    expect(result.conversation_id).toBe(cid);
    // The report rides on the result through the proven tool-result channel
    // (history truncation keeps the model copy small; the client copy is full).
    expect(result.report?.title).toBe('My Report');
    expect(result.report?.markdown).toBe(md);
    // The defensive client-attach fallback is idempotent and leaves non-report
    // tools untouched.
    const clientCopy = attachResearchReportForClient('research_report', result);
    expect(clientCopy.report?.markdown).toBe(md);
    expect(attachResearchReportForClient('research_search', result)).toBe(result);
  });

  it('exit discards the session', async () => {
    const result = await exec(exit_research_mode, { conversation_id: cid });
    expect(result.ok).toBe(true);
    expect(getResearchSessionView(cid)).toBeNull();
  });

  it('tools without a session return a helpful error', async () => {
    const result = await exec(research_note, {
      conversation_id: 'missing-convo',
      notes: [{ text: 'x' }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('enter_research_mode');
  });
});
