/**
 * Test file for workflow tool discovery
 * Run with: npx tsx apps/cloud-ai/src/test-workflow-tools.ts
 */

import { search_tools } from './tools/meta-tools';
import { retrieveToolFormat } from './tools/workflow-system';

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

async function testRetrieveToolFormat() {
  console.log('\n=== Testing retrieve_tool_format ===\n');

  try {
    const result = await retrieveToolFormat.execute({ context: {} } as any);

    console.log('--- Triggers ---');
    for (const t of result.triggers) {
      console.log(`  ${t.type}: ${t.description}`);
      console.log(`    args: ${JSON.stringify(t.argsTemplate)}`);
    }

    console.log('\n--- Tools (first 20) ---');
    for (const tool of result.tools.slice(0, 20)) {
      console.log(`  [${tool.kind}] ${tool.id}`);
      console.log(`    desc: ${tool.description?.slice(0, 80)}...`);
      console.log(`    args: ${JSON.stringify(tool.argsTemplate)}`);
    }

    console.log(`\n--- Total tools: ${result.tools.length} ---`);
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

async function main() {
  console.log('Workflow Tool Discovery Test\n');
  console.log('============================');

  await testSearchTools();
  await testRetrieveToolFormat();

  console.log('\n\nDone!');
}

main().catch(console.error);
