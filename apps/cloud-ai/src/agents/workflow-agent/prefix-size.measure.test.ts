import { describe, it, expect } from 'vitest';
import { WORKFLOW_SYSTEM_PROMPT, WORKFLOW_EDIT_SYSTEM_PROMPT, WORKFLOW_EDIT_TOOL_NAMES } from './system-prompt';
import { getCoreDocsInline } from './docs-data';
import { readWorkflow, editWorkflow } from '../../tools/workflow-dsl';
import { workflowModifyTool } from '../../tools/workflow';
import { executeStep } from './tools';
import { createSearchWorkflowNodesTool, get_tool_schema } from '../../tools/meta-tools';
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

    // The workflow-specific schema surface (the discovery/read/edit/test tools).
    // Generic web/file tools (web_search, scrape_url, write_file, …) and the
    // delegate-only tools (create/load/search_workflows/deploy/stop) are excluded
    // — this guard tracks the workflow tooling, not the shared utilities.
    // inspect_workflow + search_tools were removed from the agent entirely.
    const tools: Array<[string, any]> = [
      ['search_workflow_nodes', createSearchWorkflowNodesTool({ seen: new Set() })],
      ['search_workflow_docs', createSearchWorkflowDocsTool({ seen: new Set() })],
      ['get_tool_schema', get_tool_schema],
      ['read_workflow', readWorkflow],
      ['edit_workflow', editWorkflow],
      ['modify_workflow', workflowModifyTool],
      ['execute_step', executeStep],
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
    console.log(`  ── ${tools.length} measured tool schemas:`);
    rows.forEach((r) => console.log(r));
    console.log(`  Tool schemas subtotal: ${toolsTok} tok (excludes generic web/file + delegate-only tools)`);
    const floor = promptProseTok + coreDocsTok + toolsTok;
    console.log(`  ESTIMATED PREFIX FLOOR: ${floor} tok (re-sent every step)`);

    // Regression guard: the resent prefix multiplies by step count, so keep it lean.
    // If this trips, something bloated the always-sent prompt/tool schemas — trim
    // before merging rather than raising the bound.
    expect(floor).toBeLessThan(15000);
  });

  it('edit-mode prefix is lean (slim prompt + lean tools)', () => {
    // Edit-mode (existing flow loaded) drops the ~6.2k inlined core docs and
    // limits the model-visible tools to WORKFLOW_EDIT_TOOL_NAMES. Goal: a single
    // edit (~2-3 steps) lands under ~20k, so the resent prefix must be tiny.
    const editPromptTok = tok(WORKFLOW_EDIT_SYSTEM_PROMPT);
    // The slim prompt must NOT inline the core-docs corpus.
    expect(WORKFLOW_EDIT_SYSTEM_PROMPT.includes(getCoreDocsInline())).toBe(false);

    const editToolMap: Record<string, any> = {
      read_workflow: readWorkflow,
      edit_workflow: editWorkflow,
      modify_workflow: workflowModifyTool,
      search_workflow_nodes: createSearchWorkflowNodesTool({ seen: new Set() }),
      get_tool_schema,
      search_workflow_docs: createSearchWorkflowDocsTool({ seen: new Set() }),
      execute_step: executeStep,
    };

    let editToolsTok = 0;
    console.log('\n=== Workflow-agent EDIT-MODE prefix (estimated) ===');
    console.log(`  Edit prompt (no inlined docs): ${editPromptTok} tok`);
    for (const name of WORKFLOW_EDIT_TOOL_NAMES) {
      const c = schemaCost(editToolMap[name]);
      editToolsTok += c;
      console.log(`    ${String(name).padEnd(24)} ${String(c).padStart(6)} tok`);
    }
    const editFloor = editPromptTok + editToolsTok;
    console.log(`  EDIT-MODE PREFIX FLOOR: ${editFloor} tok (re-sent every step; vs ~13k+ build-mode)`);

    // Slim prompt carries the wire/loop/guard syntax but no doc corpus → well under 3.5k.
    expect(editPromptTok).toBeLessThan(3500);
    // Lean prefix floor: ~2-3 steps × this should be < ~20k for a single edit.
    expect(editFloor).toBeLessThan(8000);
  });
});
