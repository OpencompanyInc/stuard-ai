import {
  GCP_PROJECT_ID,
  GCP_ZONE,
  GCP_VM_IMAGE,
  GCP_VM_SERVICE_ACCOUNT,
  GCP_VM_NETWORK,
  GCP_VM_SUBNETWORK,
  CLOUD_ENGINE_BUCKET,
} from '../utils/config';
import { COMPUTE_TIER_CONFIG } from '../pricing';
import { mintVMToken } from './vm-tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Compute Provider Interface
// ─────────────────────────────────────────────────────────────────────────────

export type VMStatus = 'running' | 'stopped' | 'staging' | 'terminated' | 'not_found';

export interface IComputeProvider {
  provisionVM(userId: string, tier: string, diskSizeGb: number): Promise<{ instanceName: string; zone: string }>;
  startVM(instanceName: string, zone: string): Promise<void>;
  stopVM(instanceName: string, zone: string): Promise<void>;
  deleteVM(instanceName: string, zone: string): Promise<void>;
  getVMStatus(instanceName: string, zone: string): Promise<VMStatus>;
  getVMExternalIP(instanceName: string, zone: string): Promise<string | null>;
  resizeVMDisk(instanceName: string, zone: string, newSizeGb: number): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a safe GCE instance name from a userId (max 63 chars, lowercase, hyphens only). */
function buildInstanceName(userId: string): string {
  const safe = userId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);
  return `stuard-vm-${safe}-${Date.now().toString(36)}`.slice(0, 63);
}

/** Map GCE status string → our VMStatus enum. */
function mapGceStatus(status: string | null | undefined): VMStatus {
  switch ((status || '').toUpperCase()) {
    case 'RUNNING':    return 'running';
    case 'TERMINATED':
    case 'STOPPED':    return 'stopped';
    case 'STAGING':    return 'staging';
    case 'STOPPING':   return 'terminated'; // intermediate — treat as transitioning
    default:           return 'not_found';
  }
}

/** Startup script injected into every VM.
 *  Installs Node.js, downloads the agent, starts systemd service.
 *  The VM agent runs an HTTP server on port 7400 — cloud-ai sends commands via HTTP.
 */
function buildStartupScript(userId: string, vmToken?: string): string {
  const token = vmToken || '';
  const bucket = CLOUD_ENGINE_BUCKET || 'stuard-user-data';

  return `#!/bin/bash
set -eo pipefail
exec > /var/log/stuard-startup.log 2>&1
echo "[stuard] ── VM startup $(date -u +%Y-%m-%dT%H:%M:%SZ) ──"

# ── 1. Create stuard user + directory ────────────────────────────────────────
id -u stuard &>/dev/null || useradd -m -s /bin/bash stuard
mkdir -p /opt/stuard /home/stuard
chown stuard:stuard /home/stuard

# ── 2. Persist env vars ─────────────────────────────────────────────────────
cat > /opt/stuard/env <<'ENVEOF'
STUARD_VM=1
STUARD_USER_ID=${userId}
STUARD_GCS_BUCKET=${bucket}
STUARD_VM_TOKEN=${token}
STUARD_VM_ROOT=/home/stuard
STUARD_AGENT_PORT=7400
ENVEOF

# Also write to /etc/environment so interactive shells see them
grep -q STUARD_VM /etc/environment 2>/dev/null || cat /opt/stuard/env >> /etc/environment

# ── 3. Install Node.js 20 LTS (if not already installed) ────────────────────
if ! command -v node &>/dev/null; then
  echo "[stuard] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "[stuard] Node.js $(node --version) installed"
else
  echo "[stuard] Node.js $(node --version) already installed"
fi

# Install node-pty native dependency (needed for terminal PTY support)
apt-get install -y -q build-essential python3 2>/dev/null || true
npm install -g node-pty 2>/dev/null || echo "[stuard] node-pty global install skipped (will try local)"

# ── 4. Download VM agent bundle from GCS ────────────────────────────────────
AGENT_PATH="/opt/stuard/vm-agent-bundle.js"
AGENT_GCS="gs://${bucket}/agent/vm-agent-bundle.js"

echo "[stuard] Downloading agent from $AGENT_GCS..."
for i in 1 2 3; do
  if gsutil cp "$AGENT_GCS" "$AGENT_PATH" 2>/dev/null; then
    echo "[stuard] Agent downloaded ($(wc -c < "$AGENT_PATH") bytes)"
    break
  fi
  # Fallback: try direct HTTPS (works if bucket has public access)
  AGENT_URL="https://storage.googleapis.com/${bucket}/agent/vm-agent-bundle.js"
  if curl -fsSL -o "$AGENT_PATH" "$AGENT_URL" 2>/dev/null; then
    echo "[stuard] Agent downloaded via HTTP ($(wc -c < "$AGENT_PATH") bytes)"
    break
  fi
  echo "[stuard] Download attempt $i failed, retrying in 5s..."
  sleep 5
done

if [ ! -s "$AGENT_PATH" ]; then
  echo "[stuard] FATAL: Could not download agent bundle"
  exit 1
fi

# Also install node-pty locally in /opt/stuard for the agent
cd /opt/stuard
npm init -y 2>/dev/null || true
npm install node-pty 2>/dev/null || echo "[stuard] Warning: node-pty install failed (terminal may not work)"
cd /

# Set ownership — agent runs as stuard, not root
chown -R stuard:stuard /opt/stuard

# ── 5. Open firewall for agent HTTP server (port 7400) ──────────────────────
iptables -I INPUT -p tcp --dport 7400 -j ACCEPT 2>/dev/null || true

# ── 6. Create systemd service ───────────────────────────────────────────────
cat > /etc/systemd/system/stuard-agent.service <<'SVCEOF'
[Unit]
Description=Stuard VM Agent (HTTP server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/opt/stuard/env
ExecStart=/usr/bin/node /opt/stuard/vm-agent-bundle.js
WorkingDirectory=/home/stuard
User=stuard
Group=stuard
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=stuard-agent

# Resource limits
LimitNOFILE=65536
MemoryMax=512M

[Install]
WantedBy=multi-user.target
SVCEOF

# ── 7. Start the agent ──────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable stuard-agent
systemctl start stuard-agent

echo "[stuard] VM agent HTTP server started on port 7400"
echo "[stuard] ── VM ready for user ${userId} ──"
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-user provision lock — prevents duplicate concurrent provisions
// ─────────────────────────────────────────────────────────────────────────────

const _provisionLocks = new Map<string, Promise<any>>();

async function withProvisionLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  // If there's already a provision in progress for this user, wait for it
  const existing = _provisionLocks.get(userId);
  if (existing) {
    console.warn(`[compute:gce] Provision already in progress for user ${userId}, waiting...`);
    try { await existing; } catch { /* ignore — we'll run ours regardless */ }
  }

  const promise = fn();
  _provisionLocks.set(userId, promise);
  try {
    return await promise;
  } finally {
    // Only remove if it's still our promise (not replaced by another call)
    if (_provisionLocks.get(userId) === promise) {
      _provisionLocks.delete(userId);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry helper for transient GCP errors (rate limits, quota, 503s)
// ─────────────────────────────────────────────────────────────────────────────

const RETRYABLE_REASONS = ['rateLimitExceeded', 'CONCURRENT_OPERATIONS_QUOTA_EXCEEDED', 'RESOURCE_OPERATION_RATE_EXCEEDED'];

function isRetryableGcpError(err: any): boolean {
  const msg = String(err?.message || err?.error?.message || '');
  const code = err?.code ?? err?.error?.code;
  if (code === 429 || code === 503) return true;
  if (msg.includes('Rate Limit Exceeded') || msg.includes('CONCURRENT_OPERATIONS')) return true;
  const reason = err?.error?.errors?.[0]?.reason
    || err?.errors?.[0]?.reason
    || err?.error?.details?.find((d: any) => d.reason)?.reason
    || '';
  return RETRYABLE_REASONS.includes(reason);
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 4): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const errInfo = JSON.stringify(err?.error || err?.message || err, null, 2);
      console.warn(`[compute:gce] ${label} attempt ${attempt}/${maxAttempts} failed: ${errInfo}`);

      if (attempt < maxAttempts && isRetryableGcpError(err)) {
        // Longer delays with jitter: ~5s, ~12s, ~25s
        const base = 5000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 2000;
        const delay = Math.min(base + jitter, 30000);
        console.warn(`[compute:gce] Retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────────
// LRO helper — @google-cloud/compute v6+ returns LRO objects without .promise()
// ─────────────────────────────────────────────────────────────────────────────

async function waitForOperation(operation: any): Promise<void> {
  if (!operation) return;
  // v4/v5 style — has .promise()
  if (typeof operation.promise === 'function') {
    await operation.promise();
    return;
  }
  // v6+ style — already resolved or check .done
  if (operation.done) return;
  // If not done, give GCP a few seconds to finalize
  console.log(`[compute:gce] Operation LRO (name=${operation.name}) not yet done, waiting...`);
  await new Promise(r => setTimeout(r, 3000));
}

// ─────────────────────────────────────────────────────────────────────────────
// Real GCE Provider
// ─────────────────────────────────────────────────────────────────────────────

export class GCEComputeProvider implements IComputeProvider {
  private client: any = null; // @google-cloud/compute InstancesClient

  private async getClient() {
    if (this.client) return this.client;
    // Lazy import — keeps startup fast
    const { InstancesClient } = await import('@google-cloud/compute');
    this.client = new InstancesClient();
    return this.client;
  }

  async provisionVM(userId: string, tier: string, diskSizeGb: number): Promise<{ instanceName: string; zone: string }> {
    return withProvisionLock(userId, () => this._doProvisionVM(userId, tier, diskSizeGb));
  }

  /** Clean up any orphaned stuard VMs for this user before provisioning a new one. */
  private async cleanupOrphanedVMs(client: any, userId: string, zone: string): Promise<void> {
    try {
      const labelFilter = `labels.managed-by=stuard-cloud-ai`;
      const [vms] = await client.list({ project: GCP_PROJECT_ID, zone, filter: labelFilter });
      if (!vms || vms.length === 0) return;

      const userLabel = userId.slice(0, 63).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const orphans = vms.filter((vm: any) => vm?.labels?.['stuard-user'] === userLabel);

      for (const vm of orphans) {
        console.warn(`[compute:gce] Cleaning up orphaned VM: ${vm.name} (status: ${vm.status})`);
        try {
          const [op] = await client.delete({ project: GCP_PROJECT_ID, zone, instance: vm.name });
          await waitForOperation(op);
          console.log(`[compute:gce] Deleted orphaned VM ${vm.name}`);
        } catch (delErr: any) {
          console.warn(`[compute:gce] Could not delete orphan ${vm.name}: ${delErr?.message}`);
        }
      }
    } catch (listErr: any) {
      console.warn(`[compute:gce] Orphan cleanup listing failed (non-fatal): ${listErr?.message}`);
    }
  }

  /** Wait for any pending zone operations to settle before creating a new VM. */
  private async waitForPendingOps(zone: string): Promise<void> {
    try {
      const { ZoneOperationsClient } = await import('@google-cloud/compute');
      const opsClient = new ZoneOperationsClient();
      const [ops] = await opsClient.list({
        project: GCP_PROJECT_ID,
        zone,
        filter: 'status!=DONE',
        maxResults: 20,
      });
      const pendingInserts = (ops || []).filter((op: any) =>
        op.operationType === 'insert' && op.status !== 'DONE'
      );
      if (pendingInserts.length > 0) {
        console.warn(`[compute:gce] ${pendingInserts.length} pending insert operation(s) found, waiting 5s...`);
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (err: any) {
      console.warn(`[compute:gce] Pending ops check failed (non-fatal): ${err?.message}`);
    }
  }

  private async _doProvisionVM(userId: string, tier: string, diskSizeGb: number): Promise<{ instanceName: string; zone: string }> {
    const client = await this.getClient();
    const tierConfig = COMPUTE_TIER_CONFIG[tier];
    if (!tierConfig) throw new Error(`Unknown compute tier: ${tier}`);

    const instanceName = buildInstanceName(userId);
    const zone = GCP_ZONE;

    // Pre-flight: clean up orphaned VMs and wait for pending operations
    await this.cleanupOrphanedVMs(client, userId, zone);
    await this.waitForPendingOps(zone);

    const networkInterfaces: any[] = [{
      network: GCP_VM_NETWORK,
      ...(GCP_VM_SUBNETWORK ? { subnetwork: GCP_VM_SUBNETWORK } : {}),
      accessConfigs: [{ name: 'External NAT', type: 'ONE_TO_ONE_NAT' }],
    }];

    const serviceAccounts = GCP_VM_SERVICE_ACCOUNT
      ? [{ email: GCP_VM_SERVICE_ACCOUNT, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }]
      : [{ email: 'default', scopes: ['https://www.googleapis.com/auth/cloud-platform'] }];

    console.log(`[compute:gce] Provisioning VM ${instanceName} (${tierConfig.machineType}, ${diskSizeGb}GB) in ${zone}...`);

    const [operation] = await withRetry<any[]>(
      () => client.insert({
        project: GCP_PROJECT_ID,
        zone,
        instanceResource: {
          name: instanceName,
          machineType: `zones/${zone}/machineTypes/${tierConfig.machineType}`,
          disks: [{
            boot: true,
            autoDelete: true,
            initializeParams: {
              sourceImage: GCP_VM_IMAGE,
              diskSizeGb: String(diskSizeGb),
              diskType: `zones/${zone}/diskTypes/pd-ssd`,
            },
          }],
          networkInterfaces,
          serviceAccounts,
          metadata: {
            items: [
              { key: 'startup-script', value: buildStartupScript(userId, mintVMToken(userId, instanceName)) },
              { key: 'stuard-user-id', value: userId },
              { key: 'stuard-tier', value: tier },
            ],
          },
          labels: {
            'stuard-user': userId.slice(0, 63).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
            'stuard-tier': tier,
            'managed-by': 'stuard-cloud-ai',
          },
          tags: { items: ['stuard-vm'] },
        },
      }),
      `provisionVM(${instanceName})`,
    );

    await waitForOperation(operation);

    console.log(`[compute:gce] Provisioned VM ${instanceName} (${tierConfig.machineType}, ${diskSizeGb}GB) in ${zone}`);
    return { instanceName, zone };
  }

  async startVM(instanceName: string, zone: string): Promise<void> {
    const client = await this.getClient();
    const [operation] = await client.start({
      project: GCP_PROJECT_ID,
      zone,
      instance: instanceName,
    });
    await waitForOperation(operation);
    console.log(`[compute:gce] Started VM ${instanceName}`);
  }

  async stopVM(instanceName: string, zone: string): Promise<void> {
    const client = await this.getClient();
    const [operation] = await client.stop({
      project: GCP_PROJECT_ID,
      zone,
      instance: instanceName,
    });
    await waitForOperation(operation);
    console.log(`[compute:gce] Stopped VM ${instanceName}`);
  }

  async deleteVM(instanceName: string, zone: string): Promise<void> {
    const client = await this.getClient();
    const [operation] = await client.delete({
      project: GCP_PROJECT_ID,
      zone,
      instance: instanceName,
    });
    await waitForOperation(operation);
    console.log(`[compute:gce] Deleted VM ${instanceName}`);
  }

  async getVMStatus(instanceName: string, zone: string): Promise<VMStatus> {
    const client = await this.getClient();
    try {
      const [instance] = await client.get({
        project: GCP_PROJECT_ID,
        zone,
        instance: instanceName,
      });
      return mapGceStatus(instance?.status);
    } catch (err: any) {
      // 404 = instance doesn't exist
      if (err?.code === 404 || err?.message?.includes('not found')) return 'not_found';
      throw err;
    }
  }

  async getVMExternalIP(instanceName: string, zone: string): Promise<string | null> {
    const client = await this.getClient();
    try {
      const [instance] = await client.get({
        project: GCP_PROJECT_ID,
        zone,
        instance: instanceName,
      });
      const ifaces = instance?.networkInterfaces || [];
      for (const iface of ifaces) {
        const accessConfigs = iface?.accessConfigs || [];
        for (const ac of accessConfigs) {
          if (ac?.natIP) return ac.natIP;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async resizeVMDisk(instanceName: string, zone: string, newSizeGb: number): Promise<void> {
    const { DisksClient } = await import('@google-cloud/compute');
    const disksClient = new DisksClient();
    const diskName = instanceName; // Disk shares the instance name by convention
    try {
      const [operation] = await disksClient.resize({
        project: GCP_PROJECT_ID,
        zone,
        disk: diskName,
        disksResizeRequestResource: { sizeGb: String(newSizeGb) },
      });
      // Wait for the operation to complete
      if (operation?.latestResponse) {
        console.log(`[compute] Disk resize operation started for ${diskName} → ${newSizeGb}GB`);
      }
    } catch (err: any) {
      console.error(`[compute] Disk resize failed for ${diskName}:`, err?.message);
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

let _provider: IComputeProvider | null = null;

export function getComputeProvider(): IComputeProvider {
  if (_provider) return _provider;

  if (!GCP_PROJECT_ID) {
    throw new Error('[compute] GCP_PROJECT_ID is not set. Cannot provision VMs.');
  }
  console.log(`[compute] Using GCE provider (project=${GCP_PROJECT_ID}, zone=${GCP_ZONE})`);
  _provider = new GCEComputeProvider();

  return _provider;
}
