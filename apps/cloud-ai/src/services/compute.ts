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
    options?: { machineType?: string; userTimezone?: string | null },
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
 *  @param signedUrls Pre-generated signed GCS URLs so the VM never needs direct bucket access.
 */
function buildStartupScript(
  userId: string,
  vmSecret: string,
  vmToken?: string,
  signedUrls?: { agentBundleUrl?: string | null; agentDataUrl?: string | null; pythonAgentUrl?: string | null },
  userTimezone?: string | null,
): string {
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
TZ=${userTimezone || 'UTC'}
STUARD_USER_TIMEZONE=${userTimezone || 'UTC'}
CHROME_PATH=/usr/bin/chromium
STUARD_BROWSER_MODE=headless
STUARD_BROWSER_HOST=127.0.0.1
STUARD_BROWSER_PORT=18082
STUARD_BROWSER_PROFILE_DIR=/home/stuard/browser-profiles
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
apt-get install -y -q cloud-guest-utils xfsprogs e2fsprogs jq curl wget git unzip python3-venv 2>/dev/null || true

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
${signedUrls?.agentBundleUrl ? `AGENT_SIGNED_URL='${signedUrls.agentBundleUrl}'` : 'AGENT_SIGNED_URL=""'}

# Helper: download from GCS using the VM's own service account token (metadata server)
gcs_download() {
  local GCS_OBJ="$1" LOCAL_PATH="$2"
  local TOKEN=$(curl -sf -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" 2>/dev/null | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])" 2>/dev/null || true)
  if [ -n "$TOKEN" ]; then
    curl -fsSL -o "$LOCAL_PATH" -H "Authorization: Bearer $TOKEN" "https://storage.googleapis.com/storage/v1/b/${bucket}/o/$(echo "$GCS_OBJ" | sed 's|/|%2F|g')?alt=media" 2>/dev/null && return 0
  fi
  return 1
}
export -f gcs_download

echo "[stuard] Downloading agent bundle..."
for i in 1 2 3; do
  if [ -n "$AGENT_SIGNED_URL" ]; then
    if curl -fsSL -o "$AGENT_PATH" "$AGENT_SIGNED_URL" 2>/dev/null; then
      echo "[stuard] Agent downloaded via signed URL ($(wc -c < "$AGENT_PATH") bytes)"
      break
    fi
  fi
  AGENT_URL="https://storage.googleapis.com/${bucket}/agent/vm-agent-bundle.js"
  if curl -fsSL -o "$AGENT_PATH" "$AGENT_URL" 2>/dev/null; then
    echo "[stuard] Agent downloaded via public URL ($(wc -c < "$AGENT_PATH") bytes)"
    break
  fi
  # Fallback: use VM's own SA token to auth directly with GCS
  if gcs_download "agent/vm-agent-bundle.js" "$AGENT_PATH"; then
    echo "[stuard] Agent downloaded via VM service account ($(wc -c < "$AGENT_PATH") bytes)"
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
${signedUrls?.agentDataUrl ? `AGENT_DATA_SIGNED_URL='${signedUrls.agentDataUrl}'` : 'AGENT_DATA_SIGNED_URL=""'}
AGENT_DATA_DOWNLOADED=0
if [ -n "$AGENT_DATA_SIGNED_URL" ]; then
  echo "[stuard] Downloading agent data via signed URL..."
  if curl -fsSL -o /tmp/agent-data.tar.gz "$AGENT_DATA_SIGNED_URL" 2>/dev/null; then
    AGENT_DATA_DOWNLOADED=1
    echo "[stuard] Agent data downloaded via signed URL ($(wc -c < /tmp/agent-data.tar.gz) bytes)"
  else
    echo "[stuard] Signed URL download failed, trying VM service account..."
  fi
fi
if [ "$AGENT_DATA_DOWNLOADED" -eq 0 ]; then
  # Fallback: use VM's own service account token (same as agent bundle fallback)
  if gcs_download "users/${userId}/agent-data.tar.gz" "/tmp/agent-data.tar.gz"; then
    AGENT_DATA_DOWNLOADED=1
    echo "[stuard] Agent data downloaded via VM service account ($(wc -c < /tmp/agent-data.tar.gz) bytes)"
  fi
fi
if [ "$AGENT_DATA_DOWNLOADED" -eq 1 ]; then
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
chmod 750 /home/stuard
grep -q '^stuard' /etc/sudoers 2>/dev/null && sed -i '/^stuard/d' /etc/sudoers 2>/dev/null || true

# Firewall
iptables -A OUTPUT -m owner --uid-owner stuard -d 169.254.169.254 -p tcp --dport 53 -j ACCEPT 2>/dev/null || true
iptables -A OUTPUT -m owner --uid-owner stuard -d 169.254.169.254 -p udp --dport 53 -j ACCEPT 2>/dev/null || true
iptables -A OUTPUT -m owner --uid-owner stuard -d 169.254.169.254 -j DROP 2>/dev/null || true
iptables -I INPUT -p tcp --dport 7400 -j ACCEPT 2>/dev/null || true
iptables -A INPUT -p tcp --dport 8765 ! -s 127.0.0.1 -j DROP 2>/dev/null || true

# chown BEFORE chattr — immutable files can't be chowned
chown -R stuard:stuard /opt/stuard /home/stuard
chattr +i /opt/stuard/vm-agent-bundle.js 2>/dev/null || true

# ── 8. Compute per-service memory limits based on total RAM ──────────────────
# Scale conservatively: Node gets ~30% of RAM, Python gets ~40%, leaving room
# for OS + tools. Minimum 384M/512M to avoid OOM on chat requests.
TOTAL_RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_RAM_MB=$((TOTAL_RAM_KB / 1024))
NODE_MEM_MB=$(( TOTAL_RAM_MB * 30 / 100 ))
PYTHON_MEM_MB=$(( TOTAL_RAM_MB * 40 / 100 ))
[ "$NODE_MEM_MB" -lt 384 ] && NODE_MEM_MB=384
[ "$PYTHON_MEM_MB" -lt 512 ] && PYTHON_MEM_MB=512
NODE_MEMORY_MAX="\${NODE_MEM_MB}M"
PYTHON_MEMORY_MAX="\${PYTHON_MEM_MB}M"
echo "[stuard] RAM=\${TOTAL_RAM_MB}MB → Node=\${NODE_MEMORY_MAX} Python=\${PYTHON_MEMORY_MAX}"

# ── 9. Create and START Node.js agent service IMMEDIATELY ────────────────────
# This is the critical path — gets /health responding so cloud-ai knows we're alive.
cat > /etc/systemd/system/stuard-agent.service <<SVCEOF
[Unit]
Description=Stuard VM Agent (HTTP server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/opt/stuard/env
Environment=NODE_PATH=/opt/stuard/node_modules
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
MemoryMax=\${NODE_MEMORY_MAX}

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

  # Install build-essential + node-pty FIRST so terminal works ASAP
  apt-get install -y -q build-essential python3 2>/dev/null || true

  echo "[stuard-bg] Installing node-pty..."
  cd /opt/stuard
  if npm install node-pty 2>&1; then
    echo "[stuard-bg] node-pty installed successfully"
  else
    echo "[stuard-bg] node-pty install failed, retrying with verbose..."
    npm install node-pty --foreground-scripts 2>&1 || echo "[stuard-bg] node-pty install FAILED (terminal will not work)"
  fi
  chown -R stuard:stuard /opt/stuard/node_modules 2>/dev/null || true
  cd /

  # Restart agent immediately so terminal is available while heavy packages install
  systemctl restart stuard-agent
  echo "[stuard-bg] Agent restarted with node-pty support"

  # Install remaining heavy packages (browser, media tools, etc.)
  apt-get install -y -q python3-pip python3-venv \\
    chromium chromium-driver xvfb xdotool imagemagick \\
    ffmpeg 2>/dev/null || true

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
  ${signedUrls?.pythonAgentUrl ? `PYAGENT_SIGNED_URL='${signedUrls.pythonAgentUrl}'` : 'PYAGENT_SIGNED_URL=""'}
  PYAGENT_PATH="/opt/stuard/python-agent"
  mkdir -p "$PYAGENT_PATH"

  PYAGENT_DOWNLOADED=false
  if [ -n "$PYAGENT_SIGNED_URL" ]; then
    echo "[stuard-bg] Downloading Python agent via signed URL..."
    if curl -fsSL -o /tmp/stuard-python-agent.tar.gz "$PYAGENT_SIGNED_URL" 2>&1; then
      echo "[stuard-bg] Python agent downloaded via signed URL ($(wc -c < /tmp/stuard-python-agent.tar.gz) bytes)"
      PYAGENT_DOWNLOADED=true
    else
      echo "[stuard-bg] Signed URL download failed, trying public URL..."
    fi
  else
    echo "[stuard-bg] No signed URL for Python agent"
  fi
  if [ "$PYAGENT_DOWNLOADED" = "false" ]; then
    PYAGENT_URL="https://storage.googleapis.com/${bucket}/agent/stuard-python-agent.tar.gz"
    echo "[stuard-bg] Downloading Python agent from public URL..."
    if curl -fsSL -o /tmp/stuard-python-agent.tar.gz "$PYAGENT_URL" 2>&1; then
      echo "[stuard-bg] Python agent downloaded via public URL ($(wc -c < /tmp/stuard-python-agent.tar.gz) bytes)"
      PYAGENT_DOWNLOADED=true
    fi
  fi
  if [ "$PYAGENT_DOWNLOADED" = "false" ]; then
    echo "[stuard-bg] Trying VM service account download..."
    if gcs_download "agent/stuard-python-agent.tar.gz" "/tmp/stuard-python-agent.tar.gz"; then
      echo "[stuard-bg] Python agent downloaded via VM service account ($(wc -c < /tmp/stuard-python-agent.tar.gz) bytes)"
      PYAGENT_DOWNLOADED=true
    else
      echo "[stuard-bg] ERROR: Python agent download FAILED from all sources"
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
      cat > /etc/systemd/system/stuard-python-agent.service <<PYEOF
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
Environment=PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring
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
MemoryMax=\${PYTHON_MEMORY_MAX}

[Install]
WantedBy=multi-user.target
PYEOF
      systemctl daemon-reload
      systemctl enable stuard-python-agent
      systemctl start stuard-python-agent
      sleep 3
      if systemctl is-active --quiet stuard-python-agent; then
        echo "[stuard-bg] Python agent running on ws://127.0.0.1:8765"
      else
        echo "[stuard-bg] ERROR: Python agent failed to start! Logs:"
        journalctl -u stuard-python-agent --no-pager -n 30
      fi
    else
      echo "[stuard-bg] ERROR: vm_main.py not found in $PYAGENT_PATH — Python agent cannot start"
      echo "[stuard-bg] Contents of $PYAGENT_PATH:"
      ls -la "$PYAGENT_PATH" 2>&1 || true
    fi
    echo "[stuard-bg] Python agent setup complete"

    # Start browser server (CDP-based, no Playwright) in headless mode
    if [ -f "$PYAGENT_PATH/browser_use_server.py" ]; then
      # Browser server uses pure CDP with system chromium — no Playwright needed.
      # Only requires aiohttp + cryptography (already in requirements).
      # Ensure the default browser profile directory exists.
      mkdir -p /home/stuard/browser-profiles/default
      chown -R stuard:stuard /home/stuard/browser-profiles

      # Verify chromium is available for the CDP client
      CHROME_BIN=""
      for bin in chromium chromium-browser google-chrome google-chrome-stable; do
        if command -v "$bin" >/dev/null 2>&1; then
          CHROME_BIN="$(command -v "$bin")"
          break
        fi
      done
      if [ -z "$CHROME_BIN" ]; then
        echo "[stuard-bg] WARNING: No Chrome/Chromium binary found — browser tools will not work"
      else
        echo "[stuard-bg] Chrome/Chromium found at $CHROME_BIN"
      fi

      cat > /etc/systemd/system/stuard-browser-use.service <<BUEOF
[Unit]
Description=Stuard Browser Server (headless CDP)
After=stuard-python-agent.service stuard-xvfb.service
Wants=stuard-python-agent.service

[Service]
Type=simple
EnvironmentFile=/opt/stuard/env
Environment=DISPLAY=:99
Environment=CHROME_PATH=\${CHROME_BIN:-/usr/bin/chromium}
Environment=STUARD_BROWSER_MODE=headless
Environment=STUARD_BROWSER_HOST=127.0.0.1
Environment=STUARD_BROWSER_PORT=18082
Environment=STUARD_BROWSER_PROFILE_DIR=/home/stuard/browser-profiles
ExecStart=/opt/stuard/python-agent/venv/bin/python browser_use_server.py
WorkingDirectory=/opt/stuard/python-agent
User=stuard
Group=stuard
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=stuard-browser

[Install]
WantedBy=multi-user.target
BUEOF
      systemctl daemon-reload
      systemctl enable stuard-browser-use
      systemctl start stuard-browser-use
      echo "[stuard-bg] Browser server started on :18082 (headless CDP, chrome=$CHROME_BIN)"
    fi
  else
    echo "[stuard-bg] Warning: Python agent not available"
  fi

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
    options?: { machineType?: string; userTimezone?: string | null },
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
    options?: { machineType?: string; userTimezone?: string | null },
  ): Promise<{ instanceName: string; zone: string; vmSecret: string }> {
    const client = await this.getClient();
    const tierConfig = COMPUTE_TIER_CONFIG[tier];
    const machineTypeName = options?.machineType || tierConfig?.machineType;
    if (!machineTypeName) throw new Error(`Unknown compute tier: ${tier}`);

    const instanceName = buildInstanceName(userId);
    const zone = GCP_ZONE;

    // Generate a unique secret for this VM (never shared with other VMs)
    const vmSecret = generateVMSecret();

    // Pre-generate signed GCS URLs so the VM downloads assets via short-lived,
    // single-object URLs instead of using broad bucket access.
    const { generateAgentDataDownloadUrl, generateVMAssetUrls } = await import('./cold-storage');
    const [assetUrls, agentDataResult] = await Promise.all([
      generateVMAssetUrls(),
      generateAgentDataDownloadUrl(userId),
    ]);
    const signedUrls = {
      agentBundleUrl: assetUrls.agentBundleUrl,
      pythonAgentUrl: assetUrls.pythonAgentUrl,
      agentDataUrl: agentDataResult?.downloadUrl || null,
    };
    console.log(`[compute:gce] Generated signed URLs for VM: bundle=${!!signedUrls.agentBundleUrl}, agentData=${!!signedUrls.agentDataUrl}, python=${!!signedUrls.pythonAgentUrl}`);

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

    // Scopes: logging/monitoring for telemetry, read-only storage as fallback
    // if signed URL generation fails during provisioning.
    const vmScopes = [
      'https://www.googleapis.com/auth/logging.write',
      'https://www.googleapis.com/auth/monitoring.write',
      'https://www.googleapis.com/auth/devstorage.read_only',
    ];
    const serviceAccounts = GCP_VM_SERVICE_ACCOUNT
      ? [{ email: GCP_VM_SERVICE_ACCOUNT, scopes: vmScopes }]
      : [{ email: 'default', scopes: vmScopes }];

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
              { key: 'startup-script', value: buildStartupScript(userId, vmSecret, undefined, signedUrls, options?.userTimezone) },
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
