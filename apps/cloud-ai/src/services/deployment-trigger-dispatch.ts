import { supabaseAdmin } from '../supabase';
import { sendVMCommand } from './vm-command';

const DEPLOY_TABLE = 'vm_deployments';

interface WorkflowTriggerBinding {
  triggerId: string;
  type: string;
  mode?: string | null;
  args?: Record<string, any>;
}

interface TriggerableDeployment {
  id: string;
  trigger_bindings: WorkflowTriggerBinding[];
}

function normalizeTriggerBindings(input: any): WorkflowTriggerBinding[] {
  if (!Array.isArray(input)) return [];
  const out: WorkflowTriggerBinding[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const triggerId = String(raw?.triggerId || '').trim();
    const type = String(raw?.type || '').trim();
    const modeRaw = raw?.mode == null ? '' : String(raw.mode).trim();
    if (!triggerId || !type) continue;
    const key = `${triggerId}:${type}:${modeRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      triggerId,
      type,
      mode: modeRaw || undefined,
      args: raw?.args && typeof raw.args === 'object' ? raw.args : undefined,
    });
  }
  return out;
}

export async function findDeploymentsForWorkflowTrigger(
  userId: string,
  workflowId: string,
  triggerId?: string
): Promise<TriggerableDeployment[]> {
  if (!workflowId) return [];
  const { data, error } = await supabaseAdmin
    .from(DEPLOY_TABLE)
    .select('id, trigger_bindings')
    .eq('user_id', userId)
    .eq('kind', 'workflow')
    .eq('status', 'running')
    .eq('source_workflow_id', workflowId);
  if (error) {
    console.warn(`[deployment-trigger-dispatch] trigger lookup failed: ${error.message}`);
    return [];
  }
  const rows = (data as TriggerableDeployment[]) || [];
  return rows.filter((row) => {
    const bindings = normalizeTriggerBindings(row.trigger_bindings);
    if (bindings.length === 0) return false;
    if (!triggerId) return true;
    return bindings.some((binding) => binding.triggerId === triggerId);
  });
}

export async function dispatchTriggerToDeployment(
  userId: string,
  deployId: string,
  triggerId: string | undefined,
  payload: any,
  source: string
): Promise<{ ok: boolean; error?: string }> {
  const result = await sendVMCommand(userId, 'deploy_trigger', {
    deployId,
    triggerId,
    payload,
    source,
  }, 30_000);
  return result.ok
    ? { ok: true }
    : { ok: false, error: result.error || 'deploy_trigger_failed' };
}
