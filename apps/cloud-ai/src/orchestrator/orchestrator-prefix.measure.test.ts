import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from '../tools/zod-utils';
import { buildOrchestratorPrompt } from './orchestrator-agent';
import { ORCHESTRATOR_DELEGATION_TOOLS } from './delegation-tools';
import { search_tools, get_tool_schema, execute_tool, chatUiTool } from '../tools/meta-tools';
import { ask_user } from '../tools/ask-user';
import { waitTool } from '../tools/wait';
import { runSequentialTool, runParallelTool } from '../tools/workflow-system';
import { web_search } from '../tools/perplexity-tools';
import { scrape_url } from '../tools/tavily-tools';
import { analyzeMediaTool } from '../tools/analyze-media';
import { get_skill_info } from '../tools/skill-tools';
import { RESEARCH_MODE_TOOLS } from '../tools/research-mode';
import {
  search_past_conversations, get_conversation_context, agent_todo,
  search_local_workflows, run_workflow,
} from '../tools/device-tools';
import {
  list_projects, create_project, update_project, delete_project,
  enter_project_mode, exit_project_mode, journal_add, memory_add,
  project_search, pin_file, add_project_context, unpin_file,
} from '../tools/device/projects';
import { createVariablesTool } from '../tools/chat-variables';

// Rough token estimate. Prose ≈ 4 chars/tok; minified JSON schema ≈ 3.3.
const tok = (s: string, json = false) => Math.round(s.length / (json ? 3.3 : 4));

function schemaCost(tool: any): number {
  const id = String(tool?.id || tool?.name || '');
  const desc = String(tool?.description || '');
  let schemaStr = '';
  try { schemaStr = JSON.stringify(zodToJsonSchema(tool.inputSchema)); } catch {}
  return tok(id + desc) + tok(schemaStr, true);
}

const sum = (tools: any[]) => tools.reduce((acc, t) => acc + schemaCost(t), 0);

describe('orchestrator cold-start prefix size', () => {
  it('keeps the cold active tool set lean (regression guard)', () => {
    const { enter_research_mode } = RESEARCH_MODE_TOOLS;

    // The tools the orchestrator LLM sees on a plain "hey" (bridge connected,
    // no active project / research / mobile). Mode-specific surfaces are gated
    // out and only loaded when the mode is entered.
    const coldSet: Array<[string, any]> = [
      ['delegate', ORCHESTRATOR_DELEGATION_TOOLS.delegate],
      ['reply_to_subagent', ORCHESTRATOR_DELEGATION_TOOLS.reply_to_subagent],
      ['search_tools', search_tools],
      ['get_tool_schema', get_tool_schema],
      ['execute_tool', execute_tool],
      ['ask_user', ask_user],
      ['chat_ui', chatUiTool],
      ['wait', waitTool],
      ['run_sequential', runSequentialTool],
      ['run_parallel', runParallelTool],
      ['web_search', web_search],
      ['scrape_url', scrape_url],
      ['analyze_media', analyzeMediaTool],
      ['variables', createVariablesTool('test')],
      ['search_past_conversations', search_past_conversations],
      ['get_conversation_context', get_conversation_context],
      ['agent_todo', agent_todo],
      ['enter_research_mode', enter_research_mode],
      ['get_skill_info', get_skill_info],
      ['search_local_workflows', search_local_workflows],
      ['run_workflow', run_workflow],
      ['list_projects', list_projects],
      ['create_project', create_project],
      ['enter_project_mode', enter_project_mode],
    ];

    // Gated out of the cold set — re-armed only when the relevant mode is active.
    const researchSession = [
      RESEARCH_MODE_TOOLS.research_search, RESEARCH_MODE_TOOLS.research_read,
      RESEARCH_MODE_TOOLS.research_note, RESEARCH_MODE_TOOLS.research_status,
      RESEARCH_MODE_TOOLS.research_compile, RESEARCH_MODE_TOOLS.research_report,
      RESEARCH_MODE_TOOLS.exit_research_mode,
    ];
    const projectGated = [
      update_project, delete_project, exit_project_mode, journal_add, memory_add,
      project_search, pin_file, add_project_context, unpin_file,
    ];

    const coldTok = sum(coldSet.map(([, t]) => t));
    const researchSaved = sum(researchSession);
    const projectSaved = sum(projectGated);

    console.log('\n=== Orchestrator cold-start tool prefix ===');
    console.log(`  cold active set:  ${coldTok} tok (${coldSet.length} tools)`);
    console.log(`  gated research:   ${researchSaved} tok (loaded only when a research session is active)`);
    console.log(`  gated project:    ${projectSaved} tok (loaded only when a project is active)`);
    console.log(`  total deferred:   ${researchSaved + projectSaved} tok`);

    // Regression guard: if this trips, something bloated the always-sent cold
    // tool set. Trim or gate the new tool before merging rather than raising the
    // bound. (Measured cold set is ~7.5k after gating + description trims.)
    expect(coldTok).toBeLessThan(8000);
    // The gating must actually defer a meaningful chunk.
    expect(researchSaved + projectSaved).toBeGreaterThan(3000);
  });

  it('keeps the orchestrator system prompt lean', () => {
    // Default cold-start prompt (no project/research/mobile takeover).
    const systemPrompt = buildOrchestratorPrompt([], [], [], {});
    const systemTok = tok(systemPrompt);
    console.log(`\n=== Orchestrator system prompt: ${systemTok} tok (${systemPrompt.length} chars) ===`);

    // Regression guard: the system prompt is re-sent every step, so keep it
    // lean. Tool-specific mechanics belong in the tool descriptions (single
    // source of truth), not duplicated here. (Measured ~3.8k for the minimal
    // cold prompt; production adds conversation/skills/bots context on top.)
    expect(systemTok).toBeLessThan(4000);
  });
});
