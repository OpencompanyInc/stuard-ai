/**
 * Test file for workflow tool discovery
 * Run with: npx tsx apps/cloud-ai/src/test-workflow-tools.ts
 */

import { search_tools } from './tools/meta-tools';
import { retrieveToolFormat, listAllToolFormats } from './tools/workflow-system';

async function testSearchTools() {
  console.log('\n=== Testing search_tools ===\n');

  const queries = ['screenshot', 'command', 'file', 'click', 'window', 'ui'];

  for (const query of queries) {
    console.log(`\n--- Search: "${query}" ---`);
    try {
      const result = await search_tools.execute({ context: { query } } as any);
      console.log('Results:', JSON.stringify(result, null, 2));
    } catch (e: any) {
      console.error('Error:', e.message);
    }
  }
}

async function testGetToolSchema() {
  console.log('\n=== Testing get_tool_schema (single tool lookup) ===\n');

  const toolNames = ['take_screenshot', 'run_command', 'modify_workflow', 'nonexistent_tool'];

  for (const toolName of toolNames) {
    console.log(`\n--- Lookup: "${toolName}" ---`);
    try {
      const result = await retrieveToolFormat.execute({ context: { toolName } } as any);
      if (result.found && result.tool) {
        console.log(`  Found: ${result.tool.id}`);
        console.log(`  Desc: ${result.tool.description?.slice(0, 80)}...`);
        console.log(`  Args: ${JSON.stringify(result.tool.argsTemplate)}`);
      } else {
        console.log(`  Not found: ${result.error}`);
      }
    } catch (e: any) {
      console.error('Error:', e.message);
    }
  }
}

async function testListAllToolFormats() {
  console.log('\n=== Testing list_all_tool_formats ===\n');

  try {
    const result = await listAllToolFormats.execute({ context: {} } as any);

    console.log('--- Triggers ---');
    for (const t of result.triggers) {
      console.log(`  ${t.type}: ${t.description}`);
    }

    console.log(`\n--- Total tools: ${result.tools.length} ---`);
    console.log('First 5 tools:');
    for (const tool of result.tools.slice(0, 5)) {
      console.log(`  [${tool.kind}] ${tool.id}`);
    }
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

async function main() {
  console.log('Workflow Tool Discovery Test\n');
  console.log('============================');

  await testSearchTools();
  await testGetToolSchema();
  await testListAllToolFormats();

  console.log('\n\nDone!');
}

main().catch(console.error);
