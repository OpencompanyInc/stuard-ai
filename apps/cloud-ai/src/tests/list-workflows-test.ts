/**
 * Test script for search_local_workflows tool
 */

import { search_local_workflows } from '../tools/device/workflows';

async function main() {
  console.log('🔍 Listing local workflows...');

  const result = await search_local_workflows.execute?.({} as any, { writer: console } as any) as any;

  if (!result?.ok) {
    console.error('❌ search_local_workflows failed', result);
    process.exit(1);
  }

  console.log('✅ Local workflows:');
  console.log(JSON.stringify((result as any).workflows, null, 2));
}

main().catch(console.error);
