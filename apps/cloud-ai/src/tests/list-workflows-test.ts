/**
 * Test script for list_local_workflows tool
 */

import { list_local_workflows } from '../tools/device/workflows';

async function main() {
  console.log('🔍 Listing local workflows...');

  const result = await list_local_workflows.execute({ context: {} } as any, { writer: console } as any);

  if (!result?.ok) {
    console.error('❌ list_local_workflows failed', result);
    process.exit(1);
  }

  console.log('✅ Local workflows:');
  console.log(JSON.stringify(result.items, null, 2));
}

main().catch(console.error);
