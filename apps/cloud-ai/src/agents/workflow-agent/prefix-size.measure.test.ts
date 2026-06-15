import { describe, it, expect } from 'vitest';
import { WORKFLOW_SYSTEM_PROMPT } from './system-prompt';
import { getCoreDocsInline } from './docs-data';
import { readWorkflow, editWorkflow } from '../../tools/workflow-dsl';
import { workflowModifyTool } from '../../tools/workflow';
import { inspectWorkflow, executeStep, searchWorkflows, loadWorkflow } from './tools';
import { createSearchToolsTool, createSearchWorkflowNodesTool, get_tool_schema } from '../../tools/meta-tools';
import { createSearchWorkflowDocsTool } from './docs';
import { zodToJsonSchema } from '../../tools/zod-utils';

// Rough token estimate. Prose ≈ 4 chars/tok; minified JSON schema ≈ 3.3.
const tok = (s: string, json = false) => Math.round(s.length / (json ? 3.3 : 4));

function schemaCost(tool: any): number {
  const id = String(tool?.id || tool?.name || '');
  const desc = String(tool?.description || '');
  let schemaStr = '';
  try { schemaStr = JSON.stringify(zodToJsonSchema(tool.inputSchema)); } catch {}
  return tok(id + desc) + tok(schemaStr, true);
}

describe('workflow-agent resent-prefix size (informational)', () => {
  it('prints the prefix breakdown', () => {
    const systemTok = tok(WORKFLOW_SYSTEM_PROMPT);
    const coreDocsTok = tok(getCoreDocsInline());
    const promptProseTok = systemTok - coreDocsTok;

    const tools: Array<[string, any]> = [
      ['search_workflow_nodes', createSearchWorkflowNodesTool({ seen: new Set() })],
      ['search_workflow_docs', createSearchWorkflowDocsTool({ seen: new Set() })],
      ['search_tools', createSearchToolsTool('workflow')],
      ['get_tool_schema', get_tool_schema],
      ['read_workflow', readWorkflow],
      ['edit_workflow', editWorkflow],
      ['inspect_workflow', inspectWorkflow],
      ['load_workflow', loadWorkflow],
      ['modify_workflow', workflowModifyTool],
      ['execute_step', executeStep],
      ['search_workflows', searchWorkflows],
    ];

    let toolsTok = 0;
    const rows = tools.map(([name, t]) => {
      const c = schemaCost(t);
      toolsTok += c;
      return `    ${name.padEnd(24)} ${String(c).padStart(6)} tok`;
    });

    console.log('\n=== Workflow-agent resent prefix (estimated) ===');
    console.log(`  System prompt prose: ${promptProseTok} tok`);
    console.log(`  Inlined core docs:   ${coreDocsTok} tok`);
    console.log(`  ── 11 measured tool schemas:`);
    rows.forEach((r) => console.log(r));
    console.log(`  Tool schemas subtotal: ${toolsTok} tok (excludes file/web/deploy tools not imported here)`);
    const floor = promptProseTok + coreDocsTok + toolsTok;
    console.log(`  ESTIMATED PREFIX FLOOR: ${floor} tok (re-sent every step)`);

    // Regression guard: the resent prefix multiplies by step count, so keep it lean.
    // If this trips, something bloated the always-sent prompt/tool schemas — trim
    // before merging rather than raising the bound.
    expect(floor).toBeLessThan(15000);
  });
});
