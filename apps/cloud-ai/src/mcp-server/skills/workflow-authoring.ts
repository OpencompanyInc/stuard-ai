/**
 * Workflow Authoring "skill" — served to external MCP clients.
 *
 * The manual itself lives in a real `workflow-authoring.SKILL.md` (frontmatter +
 * body, the Agent-Skills convention) so it's editable/reviewable as a document
 * and contains the actual wiring logic. This module just loads that file and
 * exposes it two ways:
 *   - MCP **prompt** `create_workflow` → Claude Code/Cursor surface it as a
 *     `/mcp__stuard__create_workflow` slash command that loads the manual.
 *   - MCP **resource** `skill://stuard/workflow-authoring` → browsable doc.
 *
 * Single source of truth = the .md file. In dev (tsx) it sits next to this
 * module; the prod bundle (tsup) copies it to dist/ via onSuccess, so the same
 * `import.meta.url`-relative read works in both.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import type { MCPServerPrompts, MCPServerResources } from '@mastra/mcp';

export const WORKFLOW_GUIDE_PROMPT_NAME = 'create_workflow';
export const WORKFLOW_SKILL_URI = 'skill://stuard/workflow-authoring';

const SKILL_FILENAME = 'workflow-authoring.SKILL.md';

/** Raw SKILL.md (frontmatter + body), loaded once. */
function loadSkillDoc(): string {
  try {
    const url = new URL(`./${SKILL_FILENAME}`, import.meta.url);
    return readFileSync(fileURLToPath(url), 'utf-8');
  } catch {
    // Bundle without the .md alongside it — degrade gracefully rather than 500.
    return [
      '# Stuard Workflow Authoring',
      '',
      'You are the architect — compose the graph yourself. Ground with stuard_search_workflow_docs,',
      'find nodes with stuard_search_workflow_nodes (+ stuard_get_node_schema for exact args), seed a',
      'spec with stuard_create_workflow, then build + validate with stuard_read_workflow /',
      'stuard_modify_workflow (validate:true), and activate it with stuard_deploy_workflow.',
      'Edit an existing flow via stuard_list_workflows → stuard_read_workflow → stuard_modify_workflow.',
    ].join('\n');
  }
}

const SKILL_DOC = loadSkillDoc();

/** Body with the YAML frontmatter stripped — what we hand the model as a prompt. */
function skillBody(): string {
  return SKILL_DOC.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

/** MCP prompts config exposing the guide as the `create_workflow` prompt. */
export function buildWorkflowPrompts(): MCPServerPrompts {
  return {
    listPrompts: async () => [
      {
        name: WORKFLOW_GUIDE_PROMPT_NAME,
        description:
          'How Stuard workflows are wired and how to compose/edit them YOURSELF via stuard_search_workflow_docs / stuard_create_workflow / stuard_read_workflow / stuard_modify_workflow / stuard_deploy_workflow.',
        arguments: [],
      },
    ],
    getPromptMessages: async ({ name }) => {
      if (name !== WORKFLOW_GUIDE_PROMPT_NAME) throw new Error(`Unknown prompt: ${name}`);
      return [{ role: 'user', content: { type: 'text', text: skillBody() } }];
    },
  };
}

/** MCP resources config exposing the raw SKILL.md as a browsable document. */
export function buildWorkflowResources(): MCPServerResources {
  return {
    listResources: async () => [
      {
        uri: WORKFLOW_SKILL_URI,
        name: 'Stuard Workflow Authoring (SKILL.md)',
        description: 'The full workflow wiring manual: graph model, execution, wire types, triggers, variables.',
        mimeType: 'text/markdown',
      },
    ],
    getResourceContent: async ({ uri }) => {
      if (uri !== WORKFLOW_SKILL_URI) throw new Error(`Unknown resource: ${uri}`);
      return { text: SKILL_DOC };
    },
  };
}