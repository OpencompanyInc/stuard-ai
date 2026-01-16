/**
 * Lightweight test for the `show_json_workflow_code` local tool.
 *
 * Requirements:
 * - Stuard desktop app running (for the desktop bridge)
 * - Workflow ID present locally (JSON file in workflows/ or stuards/ folders)
 *
 * Usage:
 *   npx tsx src/tests/show-workflow-json-test.ts <workflow_id>
 *   WORKFLOW_ID=<workflow_id> npx tsx src/tests/show-workflow-json-test.ts
 *
 * The script will fetch and print the workflow JSON (and fail fast if the bridge
 * is unavailable or the workflow is missing).
 */

import { show_json_workflow_code } from '../tools/device/workflows';

const workflowId = process.argv[2] || process.env.WORKFLOW_ID || 'flow_example';

async function main() {
  console.log(`🔎 Fetching workflow JSON for: ${workflowId}`);

  const result = await show_json_workflow_code.execute(
    {
      // The tool expects args.context.id because execLocalTool forwards it.
      // We mirror that shape here to avoid schema stripping in pipelines.
      id: workflowId,
      context: { id: workflowId },
    } as any,
    { writer: console } as any,
  );

  if (!result?.ok) {
    console.error('❌ show_json_workflow_code failed', result);
    if (result?.error === 'No desktop bridge available') {
      console.error('Hint: Open the Stuard desktop app so the bridge is available.');
    }
    process.exit(1);
  }

  console.log('✅ Workflow JSON loaded');
  if (result.filePath) {
    console.log(`File: ${result.filePath}`);
  }
  console.dir(result.workflow, { depth: 8, colors: true });
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
