import { describe, expect, it, beforeAll } from 'vitest';
import { getCapabilityPack, getAllCapabilityPacks } from './capability-packs';
import { ensureExecutionToolsRegistered } from './execution-tools-bootstrap';
import { resolveExecutionTools } from './execution-tools-resolver';

/**
 * A delegated subagent's pack tools are resolved from the execution universe in
 * buildSubagent(); a name not present there is silently dropped (logged as
 * missingTools) and the subagent loses that capability. These tests guard the
 * packs this change introduced/touched so a rename or a missing export can't
 * quietly hollow them out.
 */
describe('capability pack tool resolution', () => {
  let names: Set<string>;

  // Cold-loading the full execution universe (tool registry) can take ~15-20s on
  // first transform — mirror orchestrator.test.ts's generous bootstrap timeout.
  beforeAll(async () => {
    await ensureExecutionToolsRegistered();
    names = new Set(Object.keys(resolveExecutionTools()));
  }, 60_000);

  it('exposes the new builder/skill/variable tools in the execution universe', () => {
    for (const t of ['variables', 'deploy_integration', 'run_integration', 'modify_skill', 'save_skill']) {
      expect(names.has(t), `${t} should be in the execution universe`).toBe(true);
    }
  });

  it('integration_builder pack resolves all of its tools', () => {
    const pack = getCapabilityPack('integration_builder');
    expect(pack).toBeTruthy();
    const missing = (pack!.toolNames as string[]).filter((n) => !names.has(n));
    expect(missing, `missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('skills pack resolves all of its tools', () => {
    const pack = getCapabilityPack('skills');
    expect(pack).toBeTruthy();
    const missing = (pack!.toolNames as string[]).filter((n) => !names.has(n));
    expect(missing, `missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('packs that emit large payloads include the variables tool', () => {
    for (const kind of ['browser', 'file_ops', 'data_analysis', 'ffmpeg', 'integration_builder'] as const) {
      const pack = getCapabilityPack(kind);
      expect(pack?.toolNames, `${kind} should include variables`).toContain('variables');
    }
  });

  it('every pack tool is resolvable except the known pre-existing reminders gap', () => {
    // calendar_list_events / calendar_update_event are not exported into the
    // execution universe today — a pre-existing gap unrelated to this change.
    const KNOWN_MISSING = new Set(['calendar_list_events', 'calendar_update_event']);
    for (const pack of getAllCapabilityPacks()) {
      const missing = (pack.toolNames as string[]).filter((n) => !names.has(n) && !KNOWN_MISSING.has(n));
      expect(missing, `${pack.kind} missing: ${missing.join(', ')}`).toEqual([]);
    }
  });
});
