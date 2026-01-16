/**
 * Workflow Agent Tools
 *
 * Specialized tools for the workflow agent to design, test, and modify workflows.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool } from '../../tools/bridge';
import { writeLog } from '../../utils/logger';

function wfLog(event: string, data?: Record<string, any>) {
  const msg = data ? `[wf-agent-tool] ${event}: ${JSON.stringify(data)}` : `[wf-agent-tool] ${event}`;
  console.log(msg);
  writeLog(`wf_agent_tool_${event}`, data);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST STEP - Test a single workflow step before adding to workflow
// ═══════════════════════════════════════════════════════════════════════════════

export const testStep = createTool({
  id: 'test_step',
  description: `Test a single workflow step to verify tool execution and arguments.

Use this to validate:
- Tool name is correct
- Arguments are properly formatted
- Tool executes without errors
- Output matches expectations

EXAMPLE:
{
  tool: "run_python_script",
  args: {
    code: "print('Hello World')"
  },
  assertions: [
    { type: "ok" },
    { type: "contains", path: "stdout", expected: "Hello" }
  ]
}

ASSERTIONS:
- ok: Check result.ok === true
- equals: path value === expected
- contains: path value contains expected (string)
- matches: path value matches regex pattern
- exists: path exists in result
`,
  inputSchema: z.object({
    tool: z.string().describe('Tool name to test'),
    args: z.any().default({}).describe('Tool arguments'),
    kind: z.enum(['auto', 'local', 'cloud']).default('auto').describe('Where to run the tool'),
    timeoutMs: z.number().int().min(1000).max(120000).default(30000).describe('Timeout in milliseconds'),
    assertions: z.array(z.object({
      type: z.enum(['ok', 'equals', 'contains', 'matches', 'exists']),
      path: z.string().optional().describe('Dot path to value (e.g., "stdout", "data.value")'),
      expected: z.any().optional(),
      pattern: z.string().optional(),
    })).optional().describe('Assertions to validate result'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    result: z.any().optional(),
    duration: z.number().optional(),
    assertions: z.array(z.object({
      type: z.string(),
      passed: z.boolean(),
      message: z.string().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, writer }) => {
    const { tool, args, kind, timeoutMs, assertions } = context as any;
    const startTime = Date.now();

    wfLog('test_step', { tool, kind });

    try {
      // Execute the tool
      const result = await execLocalTool(tool, args, writer as any, timeoutMs);
      const duration = Date.now() - startTime;

      // Run assertions if provided
      const assertionResults: any[] = [];
      if (assertions?.length) {
        for (const assertion of assertions) {
          const assertResult = runAssertion(assertion, result);
          assertionResults.push(assertResult);
        }
      }

      const allPassed = assertionResults.every(a => a.passed);

      wfLog('test_step_done', { tool, ok: result?.ok, duration, assertionsPassed: allPassed });

      return {
        ok: (result?.ok !== false) && allPassed,
        result,
        duration,
        assertions: assertionResults.length ? assertionResults : undefined,
      };
    } catch (e: any) {
      wfLog('test_step_error', { tool, error: e.message });
      return {
        ok: false,
        duration: Date.now() - startTime,
        error: e.message || 'Test execution failed',
      };
    }
  },
});

function getValueByPath(obj: any, path: string): any {
  if (!path) return obj;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function runAssertion(assertion: any, result: any): { type: string; passed: boolean; message?: string } {
  const { type, path, expected, pattern } = assertion;
  const value = path ? getValueByPath(result, path) : result;

  switch (type) {
    case 'ok':
      return {
        type: 'ok',
        passed: result?.ok === true,
        message: result?.ok === true ? 'Result ok is true' : `Expected ok=true but got ${result?.ok}`,
      };

    case 'equals':
      const eq = JSON.stringify(value) === JSON.stringify(expected);
      return {
        type: 'equals',
        passed: eq,
        message: eq ? `${path} equals expected` : `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(value)}`,
      };

    case 'contains':
      const contains = typeof value === 'string' && value.includes(String(expected));
      return {
        type: 'contains',
        passed: contains,
        message: contains ? `${path} contains "${expected}"` : `"${path}" does not contain "${expected}"`,
      };

    case 'matches':
      const regex = new RegExp(pattern || '');
      const matches = typeof value === 'string' && regex.test(value);
      return {
        type: 'matches',
        passed: matches,
        message: matches ? `${path} matches pattern` : `"${path}" does not match pattern "${pattern}"`,
      };

    case 'exists':
      const exists = value !== undefined;
      return {
        type: 'exists',
        passed: exists,
        message: exists ? `${path} exists` : `${path} does not exist`,
      };

    default:
      return { type, passed: false, message: `Unknown assertion type: ${type}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CUSTOM TOOL - Test a custom_ui configuration
// ═══════════════════════════════════════════════════════════════════════════════

export const testCustomTool = createTool({
  id: 'test_custom_ui',
  description: `Test a custom_ui configuration to preview how it will render.

Validates:
- HTML syntax
- Tailwind classes
- Data bindings (data-bind attributes)
- Button actions (data-action attributes)
- Template variables ({{varName}})

Returns a preview URL and any validation issues found.

EXAMPLE:
{
  html: "<div class='p-4 bg-dark-800'><h1 class='text-white'>{{title}}</h1><button data-action='start'>Start</button></div>",
  data: { title: "My UI" },
  window: { width: 400, height: 300 }
}
`,
  inputSchema: z.object({
    html: z.string().describe('HTML content with Tailwind classes'),
    data: z.record(z.string(), z.any()).optional().describe('Initial data for template variables'),
    window: z.object({
      width: z.number().optional(),
      height: z.number().optional(),
      position: z.union([z.string(), z.object({ x: z.number(), y: z.number() })]).optional(),
    }).optional().describe('Window configuration'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    validation: z.object({
      hasErrors: z.boolean(),
      errors: z.array(z.string()).optional(),
      warnings: z.array(z.string()).optional(),
    }).optional(),
    bindings: z.array(z.string()).optional(),
    actions: z.array(z.string()).optional(),
    templateVars: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    const { html, data, window: windowConfig } = context as any;

    const errors: string[] = [];
    const warnings: string[] = [];
    const bindings: string[] = [];
    const actions: string[] = [];
    const templateVars: string[] = [];

    // Extract data-bind attributes
    const bindMatches = html.matchAll(/data-bind=["']([^"']+)["']/g);
    for (const match of bindMatches) {
      bindings.push(match[1]);
    }

    // Extract data-action attributes
    const actionMatches = html.matchAll(/data-action=["']([^"']+)["']/g);
    for (const match of actionMatches) {
      actions.push(match[1]);
    }

    // Extract template variables {{...}}
    const varMatches = html.matchAll(/\{\{([^}]+)\}\}/g);
    for (const match of varMatches) {
      templateVars.push(match[1].trim());
    }

    // Validate template variables have data
    if (data) {
      for (const varName of templateVars) {
        if (!(varName in data) && !varName.includes('.')) {
          warnings.push(`Template variable "{{${varName}}}" has no corresponding data value`);
        }
      }
    }

    // Basic HTML validation
    const openTags = (html.match(/<[a-z][^/>]*>/gi) || []).length;
    const closeTags = (html.match(/<\/[a-z]+>/gi) || []).length;
    const selfClosing = (html.match(/<[a-z][^>]*\/>/gi) || []).length;

    if (openTags !== closeTags + selfClosing) {
      warnings.push('HTML tag count mismatch - check for unclosed tags');
    }

    // Check for common issues
    if (html.includes('class="') && html.includes("class='")) {
      warnings.push('Mixed quote styles in class attributes');
    }

    if (!html.includes('bg-') && !html.includes('background')) {
      warnings.push('No background color set - UI may appear transparent');
    }

    wfLog('test_custom_ui', { bindings, actions, templateVars, warnings: warnings.length });

    return {
      ok: errors.length === 0,
      validation: {
        hasErrors: errors.length > 0,
        errors: errors.length ? errors : undefined,
        warnings: warnings.length ? warnings : undefined,
      },
      bindings: bindings.length ? bindings : undefined,
      actions: actions.length ? actions : undefined,
      templateVars: templateVars.length ? templateVars : undefined,
    };
  },
});

// Export all tools
export const workflowAgentTools = {
  test_step: testStep,
  test_custom_ui: testCustomTool,
};
