import {
  GCP_PROJECT_ID,
  GCP_ZONE,
  GCP_VM_IMAGE,
  GCP_VM_SERVICE_ACCOUNT,
  GCP_VM_NETWORK,
  GCP_VM_SUBNETWORK,
  CLOUD_ENGINE_BUCKET,
  CLOUD_PUBLIC_URL,
} from '../utils/config';
import { COMPUTE_TIER_CONFIG } from '../pricing';
import { generateVMSecret } from './vm-tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Compute Provider Interface
// ─────────────────────────────────────────────────────────────────────────────

export type VMStatus = 'running' | 'stopped' | 'staging' | 'terminated' | 'not_found';

export interface IComputeProvider {
  provisionVM(
    userId: string,
    tier: string,
    diskSizeGb: number,
    options?: { machineType?: string },
  ): Promise<{ instanceName: string; zone: string; vmSecret: string }>;
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
 *
 *  @param userId   Owner of this VM.
 *  @param vmSecret Per-VM unique HMAC secret (used by the agent to verify tokens).
 *  @param vmToken  Legacy provisioning token (backwards compat).
 */
function buildStartupScript(userId: string, vmSecret: string, vmToken?: string): string {
  const token = vmToken || '';
  const bucket = CLOUD_ENGINE_BUCKET || 'stuard-user-data';
  // Cloud-ai URL — the VM engine calls cloud tools + desktop relay via this
  const cloudAiUrl = CLOUD_PUBLIC_URL || 'https://api.stuard.ai';
  const cloudAiWsUrl = (() => {
    const trimmed = cloudAiUrl.replace(/\/+$/, '');
    if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) {
      return trimmed.endsWith('/ws') ? trimmed : `${trimmed}/ws`;
    }
    if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}/ws`;
    if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}/ws`;
    return `wss://${trimmed.replace(/^\/+/, '')}/ws`;
  })();

  return `#!/bin/bash
set -eo pipefail
exec > /var/log/stuard-startup.log 2>&1
echo "[stuard] ── VM startup $(date -u +%Y-%m-%dT%H:%M:%SZ) ──"

# ── 1. Create stuard user + directory ────────────────────────────────────────
id -u stuard &>/dev/null || useradd -m -s /bin/bash stuard
mkdir -p /opt/stuard /home/stuard
mkdir -p /home/stuard/memories /home/stuard/memories/topics /home/stuard/memories/conversations /home/stuard/memories/sync
mkdir -p /home/stuard/proactive
mkdir -p /home/stuard/deploys
mkdir -p /home/stuard/workspace /home/stuard/data /home/stuard/scripts /home/stuard/assets
mkdir -p /home/stuard/agent-data
chown -R stuard:stuard /home/stuard

# ── 2. Persist env vars ─────────────────────────────────────────────────────
cat > /opt/stuard/env <<'ENVEOF'
STUARD_VM=1
STUARD_USER_ID=${userId}
STUARD_GCS_BUCKET=${bucket}
STUARD_VM_TOKEN=${token}
VM_TOKEN_SECRET=${vmSecret}
CLOUD_AI_URL=${cloudAiUrl}
CLOUD_AI_WS=${cloudAiWsUrl}
STUARD_VM_ROOT=/home/stuard
STUARD_AGENT_PORT=7400
STUARD_MEMORY_ROOT=/home/stuard/memories
STUARD_PROACTIVE_ROOT=/home/stuard/proactive
STUARD_DEPLOY_ROOT=/home/stuard/deploys
AGENT_HOST=127.0.0.1
AGENT_PORT=8765
AGENT_HTTP=http://127.0.0.1:8765
AGENT_WS=ws://127.0.0.1:8765/ws
AGENT_WS_URL=ws://127.0.0.1:8765/ws
STUARD_WS_HOST=127.0.0.1
STUARD_WS_PORT=8765
STUARD_LOCAL_AGENT_WS=ws://127.0.0.1:8765/ws
STUARD_AGENT_MODE=vm
AGENT_DATA_DIR=/home/stuard/agent-data
STUARD_VM_AGENT_URL=http://127.0.0.1:7400
DISPLAY=:99
ENVEOF

# Also write to /etc/environment so interactive shells see them
grep -q STUARD_VM /etc/environment 2>/dev/null || cat /opt/stuard/env >> /etc/environment

# ── 3. DNS — set up early so all downloads work reliably ─────────────────────
if ! grep -q '8.8.8.8' /etc/resolv.conf 2>/dev/null; then
  echo "nameserver 8.8.8.8" >> /etc/resolv.conf
  echo "nameserver 8.8.4.4" >> /etc/resolv.conf
fi

# ── 4. Install Node.js + minimal deps (fast path — ~30s) ────────────────────
apt-get update -y -q
apt-get install -y -q cloud-guest-utils xfsprogs e2fsprogs jq curl wget git unzip 2>/dev/null || true

if ! command -v node &>/dev/null; then
  echo "[stuard] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "[stuard] Node.js $(node --version) installed"
else
  echo "[stuard] Node.js $(node --version) already installed"
fi

# ── 5. Expand root partition to full boot disk size ──────────────────────────
ROOT_DEV="$(findmnt -n -o SOURCE / 2>/dev/null || true)"
ROOT_FSTYPE="$(findmnt -n -o FSTYPE / 2>/dev/null || true)"
ROOT_DISK="$(lsblk -no PKNAME "$ROOT_DEV" 2>/dev/null | head -n1 || true)"
ROOT_PARTNUM="$(lsblk -no PARTNUM "$ROOT_DEV" 2>/dev/null | head -n1 || true)"
if [ -n "$ROOT_DEV" ] && [ -n "$ROOT_DISK" ] && [ -n "$ROOT_PARTNUM" ] && command -v growpart >/dev/null 2>&1; then
  echo "[stuard] Expanding root partition on /dev/$ROOT_DISK part $ROOT_PARTNUM..."
  growpart "/dev/$ROOT_DISK" "$ROOT_PARTNUM" 2>/dev/null || true
  if [ "$ROOT_FSTYPE" = "ext4" ] && command -v resize2fs >/dev/null 2>&1; then
    resize2fs "$ROOT_DEV" 2>/dev/null || true
  elif [ "$ROOT_FSTYPE" = "xfs" ] && command -v xfs_growfs >/dev/null 2>&1; then
    xfs_growfs / 2>/dev/null || true
  fi
fi

# ── 6. Download VM agent bundle from GCS ─────────────────────────────────────
AGENT_PATH="/opt/stuard/vm-agent-bundle.js"
AGENT_GCS="gs://${bucket}/agent/vm-agent-bundle.js"

echo "[stuard] Downloading agent from $AGENT_GCS..."
for i in 1 2 3; do
  if gsutil cp "$AGENT_GCS" "$AGENT_PATH" 2>/dev/null; then
    echo "[stuard] Agent downloaded ($(wc -c < "$AGENT_PATH") bytes)"
    break
  fi
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

# Install ws (needed by agent) — node-pty deferred to background
cd /opt/stuard
npm init -y 2>/dev/null || true
npm install ws 2>/dev/null || true
cd /

# ── 6b. Restore agent databases from cold storage if available ──────────────
AGENT_DB_GCS="gs://${bucket}/users/${userId}/agent-data.tar.gz"
if gsutil -q stat "$AGENT_DB_GCS" 2>/dev/null; then
  echo "[stuard] Restoring agent databases from cold storage..."
  gsutil cp "$AGENT_DB_GCS" /tmp/agent-data.tar.gz 2>/dev/null
  if [ -f /tmp/agent-data.tar.gz ]; then
    # List contents to understand the archive structure
    echo "[stuard] Archive contents:"
    tar -tzf /tmp/agent-data.tar.gz 2>/dev/null | head -30 || true

    # Extract to a temp dir first, then move files to correct locations
    mkdir -p /tmp/agent-extract
    tar -xzf /tmp/agent-data.tar.gz -C /tmp/agent-extract 2>/dev/null

    # New format: archive has agent/knowledge.db, agent/memory.db, lancedb/..., workflow.db
    if [ -d /tmp/agent-extract/agent ]; then
      echo "[stuard] New archive format detected (agent/ prefix)"
      cp -a /tmp/agent-extract/agent/* /home/stuard/agent-data/ 2>/dev/null || true
    else
      # Old format: flat files (knowledge.db, memory.db at root of archive)
      echo "[stuard] Legacy archive format (flat files)"
      cp -a /tmp/agent-extract/* /home/stuard/agent-data/ 2>/dev/null || true
    fi

    # Restore lancedb embeddings if present
    if [ -d /tmp/agent-extract/lancedb ]; then
      mkdir -p /home/stuard/lancedb
      cp -a /tmp/agent-extract/lancedb/* /home/stuard/lancedb/ 2>/dev/null || true
      chown -R stuard:stuard /home/stuard/lancedb
      echo "[stuard] LanceDB embeddings restored"
    fi

    # Restore workflow.db if present
    if [ -f /tmp/agent-extract/workflow.db ]; then
      cp -a /tmp/agent-extract/workflow.db /home/stuard/data/ 2>/dev/null || true
      echo "[stuard] workflow.db restored"
    fi

    rm -rf /tmp/agent-extract /tmp/agent-data.tar.gz

    # Log what we restored
    echo "[stuard] Agent data restored:"
    ls -la /home/stuard/agent-data/ 2>/dev/null || echo "  (empty)"
    chown -R stuard:stuard /home/stuard/agent-data
    echo "[stuard] Agent databases restored successfully"
  fi
else
  echo "[stuard] No agent database backup found — starting fresh"
fi

# ── 7. Security hardening ────────────────────────────────────────────────────
chmod 600 /opt/stuard/env
chown stuard:stuard /opt/stuard/env
chattr +i /opt/stuard/vm-agent-bundle.js 2>/dev/null || true
chmod 750 /home/stuard
grep -q '^stuard' /etc/sudoers 2>/dev/null && sed -i '/^stuard/d' /etc/sudoers 2>/dev/null || true

# Firewall
iptables -A OUTPUT -m owner --uid-owner stuard -d 169.254.169.254 -p tcp --dport 53 -j ACCEPT 2>/dev/null || true
iptables -A OUTPUT -m owner --uid-owner stuard -d 169.254.169.254 -p udp --dport 53 -j ACCEPT 2>/dev/null || true
iptables -A OUTPUT -m owner --uid-owner stuard -d 169.254.169.254 -j DROP 2>/dev/null || true
iptables -I INPUT -p tcp --dport 7400 -j ACCEPT 2>/dev/null || true
iptables -A INPUT -p tcp --dport 8765 ! -s 127.0.0.1 -j DROP 2>/dev/null || true

chown -R stuard:stuard /opt/stuard /home/stuard

# ── 8. Create and START Node.js agent service IMMEDIATELY ────────────────────
# This is the critical path — gets /health responding so cloud-ai knows we're alive.
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

LimitNOFILE=65536
MemoryMax=512M

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable stuard-agent
systemctl start stuard-agent
echo "[stuard] VM agent HTTP server started on port 7400"

# ── 9. Install heavy packages + Python agent IN BACKGROUND ──────────────────
# These take 3-8 minutes on e2-small. The Node.js agent is already serving
# /health so cloud-ai won't time out waiting.
(
  exec > /var/log/stuard-background-setup.log 2>&1
  echo "[stuard-bg] ── Background setup started $(date -u +%Y-%m-%dT%H:%M:%SZ) ──"

  # Install build tools, browser, python, media tools
  apt-get install -y -q build-essential python3 python3-pip python3-venv \\
    chromium chromium-driver xvfb xdotool imagemagick \\
    ffmpeg 2>/dev/null || true

  # Install node-pty (needs build-essential)
  cd /opt/stuard
  npm install node-pty 2>/dev/null || echo "[stuard-bg] node-pty install failed (terminal may not work)"
  cd /

  # Start Xvfb
  if command -v Xvfb >/dev/null 2>&1; then
    cat > /etc/systemd/system/stuard-xvfb.service <<'XVFBEOF'
[Unit]
Description=Xvfb Virtual Framebuffer
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
XVFBEOF
    systemctl daemon-reload
    systemctl enable stuard-xvfb
    systemctl start stuard-xvfb
    echo "[stuard-bg] Xvfb started on display :99"
  fi

  # Download & install Python agent
  PYAGENT_GCS="gs://${bucket}/agent/stuard-python-agent.tar.gz"
  PYAGENT_PATH="/opt/stuard/python-agent"
  mkdir -p "$PYAGENT_PATH"

  PYAGENT_DOWNLOADED=false
  if gsutil cp "$PYAGENT_GCS" /tmp/stuard-python-agent.tar.gz 2>/dev/null; then
    PYAGENT_DOWNLOADED=true
  else
    PYAGENT_URL="https://storage.googleapis.com/${bucket}/agent/stuard-python-agent.tar.gz"
    if curl -fsSL -o /tmp/stuard-python-agent.tar.gz "$PYAGENT_URL" 2>/dev/null; then
      PYAGENT_DOWNLOADED=true
    fi
  fi

  if [ "$PYAGENT_DOWNLOADED" = true ]; then
    tar -xzf /tmp/stuard-python-agent.tar.gz -C "$PYAGENT_PATH" --strip-components=1
    rm -f /tmp/stuard-python-agent.tar.gz

    if [ -f "$PYAGENT_PATH/requirements-vm.txt" ]; then
      python3 -m venv "$PYAGENT_PATH/venv"
      "$PYAGENT_PATH/venv/bin/pip" install --quiet --no-cache-dir -r "$PYAGENT_PATH/requirements-vm.txt" 2>&1 | tail -5
    elif [ -f "$PYAGENT_PATH/requirements.txt" ]; then
      python3 -m venv "$PYAGENT_PATH/venv"
      "$PYAGENT_PATH/venv/bin/pip" install --quiet --no-cache-dir -r "$PYAGENT_PATH/requirements.txt" 2>&1 | tail -5
    fi

    chown -R stuard:stuard /opt/stuard/python-agent

    if [ -f "$PYAGENT_PATH/vm_main.py" ]; then
      cat > /etc/systemd/system/stuard-python-agent.service <<'PYEOF'
[Unit]
Description=Stuard Python Agent (local tool provider)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/opt/stuard/env
Environment=STUARD_AGENT_MODE=vm
Environment=STUARD_WS_HOST=127.0.0.1
Environment=STUARD_WS_PORT=8765
ExecStart=/opt/stuard/python-agent/venv/bin/python vm_main.py
WorkingDirectory=/opt/stuard/python-agent
User=stuard
Group=stuard
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=stuard-python

LimitNOFILE=65536
MemoryMax=256M

[Install]
WantedBy=multi-user.target
PYEOF
      systemctl daemon-reload
      systemctl enable stuard-python-agent
      systemctl start stuard-python-agent
      echo "[stuard-bg] Python agent started on ws://127.0.0.1:8765"
    fi
    echo "[stuard-bg] Python agent ready"
  else
    echo "[stuard-bg] Warning: Python agent not available"
  fi

  # Restart Node.js agent so it picks up node-pty for terminal support
  systemctl restart stuard-agent
  echo "[stuard-bg] ── Background setup complete $(date -u +%Y-%m-%dT%H:%M:%SZ) ──"
) &
disown

echo "[stuard] ── VM ready for user ${userId} (heavy packages installing in background) ──"
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
  private firewallEnsured = false; // Only create firewall rule once per process lifetime

  private async getClient() {
    if (this.client) return this.client;
    // Lazy import — keeps startup fast
    const { InstancesClient } = await import('@google-cloud/compute');
    this.client = new InstancesClient();
    return this.client;
  }

  /**
   * Ensure a GCP VPC firewall rule exists allowing TCP:7400 to stuard-vm tagged instances.
   * This is idempotent — if the rule already exists, it's a no-op.
   * Without this, the VPC default-deny blocks all inbound traffic to port 7400.
   */
  private async ensureFirewallRule(): Promise<void> {
    if (this.firewallEnsured) return;

    const RULE_NAME = 'allow-stuard-vm-agent';
    try {
      const { FirewallsClient } = await import('@google-cloud/compute');
      const firewallsClient = new FirewallsClient();

      // Check if rule already exists
      try {
        await firewallsClient.get({ project: GCP_PROJECT_ID, firewall: RULE_NAME });
        this.firewallEnsured = true;
        console.log(`[compute:gce] Firewall rule '${RULE_NAME}' already exists`);
        return;
      } catch (err: any) {
        // 404 = doesn't exist, create it
        if (err?.code !== 404 && !err?.message?.includes('not found')) {
          console.warn(`[compute:gce] Firewall check failed (non-fatal): ${err?.message}`);
          this.firewallEnsured = true; // Don't retry on unexpected errors
          return;
        }
      }

      // Create firewall rule allowing TCP:7400 from cloud-ai server IP range
      // In production, this should be restricted to the cloud-ai server's IP
      // For now, allow from any source (VM agent has its own auth)
      console.log(`[compute:gce] Creating firewall rule '${RULE_NAME}' for port 7400...`);
      const [operation] = await firewallsClient.insert({
        project: GCP_PROJECT_ID,
        firewallResource: {
          name: RULE_NAME,
          description: 'Allow cloud-ai to reach VM agent HTTP server on port 7400',
          network: GCP_VM_NETWORK.startsWith('global/') ? `projects/${GCP_PROJECT_ID}/${GCP_VM_NETWORK}` : GCP_VM_NETWORK,
          direction: 'INGRESS',
          priority: 1000,
          allowed: [{ IPProtocol: 'tcp', ports: ['7400'] }],
          targetTags: ['stuard-vm'],
          sourceRanges: ['0.0.0.0/0'], // VM agent authenticates requests via token
        },
      });
      await waitForOperation(operation);
      this.firewallEnsured = true;
      console.log(`[compute:gce] Firewall rule '${RULE_NAME}' created successfully`);
    } catch (err: any) {
      console.warn(`[compute:gce] Firewall rule creation failed (non-fatal): ${err?.message}`);
      this.firewallEnsured = true; // Don't block provisioning
    }
  }

  async provisionVM(
    userId: string,
    tier: string,
    diskSizeGb: number,
    options?: { machineType?: string },
  ): Promise<{ instanceName: string; zone: string; vmSecret: string }> {
    return withProvisionLock(userId, () => this._doProvisionVM(userId, tier, diskSizeGb, options));
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

  private async _doProvisionVM(
    userId: string,
    tier: string,
    diskSizeGb: number,
    options?: { machineType?: string },
  ): Promise<{ instanceName: string; zone: string; vmSecret: string }> {
    const client = await this.getClient();
    const tierConfig = COMPUTE_TIER_CONFIG[tier];
    const machineTypeName = options?.machineType || tierConfig?.machineType;
    if (!machineTypeName) throw new Error(`Unknown compute tier: ${tier}`);

    const instanceName = buildInstanceName(userId);
    const zone = GCP_ZONE;

    // Generate a unique secret for this VM (never shared with other VMs)
    const vmSecret = generateVMSecret();

    // Ensure GCP VPC firewall rule exists for VM agent port 7400
    await this.ensureFirewallRule();

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

    console.log(`[compute:gce] Provisioning VM ${instanceName} (${machineTypeName}, ${diskSizeGb}GB) in ${zone}...`);

    const [operation] = await withRetry<any[]>(
      () => client.insert({
        project: GCP_PROJECT_ID,
        zone,
        instanceResource: {
          name: instanceName,
          machineType: `zones/${zone}/machineTypes/${machineTypeName}`,
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
              { key: 'startup-script', value: buildStartupScript(userId, vmSecret) },
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

    console.log(`[compute:gce] Provisioned VM ${instanceName} (${machineTypeName}, ${diskSizeGb}GB) in ${zone}`);
    return { instanceName, zone, vmSecret };
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
