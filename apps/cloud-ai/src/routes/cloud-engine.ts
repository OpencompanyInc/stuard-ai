import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, checkAccess, getCloudEngine, upsertCloudEngine, updateCloudEngineStatus, deleteCloudEngine, getStorageUsage, upsertStorageUsage, updateEngineHealth, getCreditSummary, listExternalAccounts, getSyncPreferences } from '../supabase';
import { COMPUTE_TIER_CONFIG, DEFAULT_CLOUD_DISK_GB_BY_TIER, STORAGE_PRICING, estimateComputeCostCredits, estimateMachineCreditsPerHour, estimateStorageCostCredits, resolveComputeMachineSpec } from '../pricing';
import { getComputeProvider } from '../services/compute';
import { syncToCloud, restoreFromCloud, getSyncStatus } from '../services/sync-engine';
import { deleteAllUserData, uploadAgentData } from '../services/cold-storage';
import { getUserComputeUsage, catchUpBilling } from '../services/compute-billing';
import { sendVMCommand, pingVMAgent, VM_COMMANDABLE_STATUSES } from '../services/vm-command';
import { getDesktopWs } from '../services/vm-bridge';
import { execLocalTool, withClientBridge } from '../tools/bridge';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TIERS = [...Object.keys(COMPUTE_TIER_CONFIG), 'custom'];
const MIN_DISK_GB = 10;
const MAX_DISK_GB = 500;
const PROVISION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Prevent double-click / rapid-fire provision requests per user
const _activeProvisions = new Set<string>();

/**
 * Push all OAuth tokens to a user's reachable VM.
 * Fire-and-forget — safe to call even if the VM isn't running.
 */
export async function pushOAuthTokensToVM(userId: string): Promise<void> {
  try {
    const engine = await getCloudEngine(userId);
    if (!engine || !VM_COMMANDABLE_STATUSES.has(String(engine.status || ''))) return;
    const accounts = await listExternalAccounts(userId);
    const tokens = accounts
      .filter((a: any) => a.access_token && a.access_token !== 'verified')
      .map((a: any) => ({
        provider: a.provider,
        profileLabel: a.profile_label,
        isDefault: a.is_default,
        accessToken: a.access_token,
        refreshToken: a.refresh_token || null,
        expiresAt: a.expires_at || null,
        scopes: a.scopes || [],
        accountEmail: a.account_email || null,
      }));
    if (tokens.length > 0) {
      // Retry once with increased timeout — token payloads are small but
      // the VM may be under load during provisioning
      let result = await sendVMCommand(userId, 'store_oauth_tokens', { tokens }, 30_000);
      if (!result.ok) {
        console.warn('[oauth-sync] First push attempt failed, retrying:', result.error);
        await new Promise(r => setTimeout(r, 2000));
        result = await sendVMCommand(userId, 'store_oauth_tokens', { tokens }, 30_000);
        if (!result.ok) {
          console.warn('[oauth-sync] Auto-push to VM failed after retry:', result.error || 'store_oauth_tokens_failed');
        }
      }
    }
  } catch (e: any) {
    console.warn('[oauth-sync] Auto-push to VM failed:', e?.message);
  }
}

/**
 * Sync default browser profile (cookies) from desktop to VM.
 * Requests cookies from the desktop's browser server via WebSocket,
 * then pushes them to the VM's browser profile directory.
 * Fire-and-forget — safe to call even if desktop is offline.
 */
export async function pushBrowserProfileToVM(userId: string): Promise<void> {
  try {
    const engine = await getCloudEngine(userId);
    if (!engine || !VM_COMMANDABLE_STATUSES.has(String(engine.status || ''))) return;

    // Request cookies from desktop's browser server
    const desktopWs = getDesktopWs(userId);
    if (!desktopWs) {
      console.log('[browser-sync] Desktop offline, skipping browser profile sync');
      return;
    }

    const exportResult = await withClientBridge(desktopWs, async () => {
      return execLocalTool(
        'browser_use_cookies',
        { action: 'export', session_id: 'default' },
        undefined,
        15_000,
        { silent: true, noFallback: true },
      );
    }) as any;

    if (!exportResult?.ok || !Array.isArray(exportResult?.cookies)) {
      console.log('[browser-sync] Desktop cookie export unavailable:', exportResult?.error || 'no_cookies');
      return;
    }

    const cookies = exportResult.cookies;
    const result = await sendVMCommand(userId, 'sync_browser_profile', {
      profile: 'default',
      cookies,
    }, 15_000);

    if (result.ok) {
      console.log(`[browser-sync] Synced ${cookies.length} cookies to VM for user ${userId}`);
    } else {
      console.warn('[browser-sync] Failed to sync browser profile to VM:', result.error || 'sync_browser_profile_failed');
    }
  } catch (e: any) {
    console.warn('[browser-sync] Browser profile sync failed:', e?.message);
  }
}

async function syncRuntimeStateToVM(userId: string): Promise<void> {
  const results = await Promise.allSettled([
    pushOAuthTokensToVM(userId),
    pushBrowserProfileToVM(userId),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[cloud-engine] Runtime sync task failed:', result.reason?.message || result.reason);
    }
  }
}

// In-memory provision progress tracking — cleared once provisioning completes
export type ProvisionStep = 'vm_creating' | 'vm_created' | 'waiting_ip' | 'waiting_agent' | 'restoring_data' | 'syncing_agent' | 'syncing_integrations' | 'finalizing' | 'done';
const _provisionProgress = new Map<string, { step: ProvisionStep; updatedAt: number }>();

function setProvisionStep(userId: string, step: ProvisionStep) {
  if (step === 'done') {
    _provisionProgress.delete(userId);
  } else {
    _provisionProgress.set(userId, { step, updatedAt: Date.now() });
  }
}

export function getProvisionStep(userId: string): { step: ProvisionStep; updatedAt: number } | null {
  return _provisionProgress.get(userId) || null;
}

function json(res: ServerResponse, status: number, body: any): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<{ userId: string; email?: string } | null> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = token ? await verifyToken(token) : null;
  if (!user) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCloudEngineRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = parsedUrl.pathname;
  const method = req.method || '';

  // ── GET /v1/cloud-engine/tiers (no auth required) ────────────────────────
  if (method === 'GET' && path === '/v1/cloud-engine/tiers') {
    const tiers = Object.entries(COMPUTE_TIER_CONFIG).map(([key, cfg]) => ({
      tier: key,
      machineType: cfg.machineType,
      vcpus: cfg.vcpus,
      memoryGb: cfg.memoryGb,
      defaultDiskGb: DEFAULT_CLOUD_DISK_GB_BY_TIER[key] ?? MIN_DISK_GB,
      hourlyUsd: cfg.hourlyUsd,
      estimatedComputeCreditsPerHour: estimateComputeCostCredits(key, 1),
      estimatedStorageCreditsPerHour: estimateStorageCostCredits(DEFAULT_CLOUD_DISK_GB_BY_TIER[key] ?? MIN_DISK_GB, 0, 1),
      estimatedTotalCreditsPerHour:
        estimateComputeCostCredits(key, 1)
        + estimateStorageCostCredits(DEFAULT_CLOUD_DISK_GB_BY_TIER[key] ?? MIN_DISK_GB, 0, 1),
      estimatedMonthlyCostCredits: estimateComputeCostCredits(key, 730),
    }));
    json(res, 200, {
      ok: true,
      tiers,
      storagePricing: STORAGE_PRICING,
      diskSizeLimits: { min: MIN_DISK_GB, max: MAX_DISK_GB },
    });
    return true;
  }

  // ── CORS preflight ───────────────────────────────────────────────────────
  if (method === 'OPTIONS' && path.startsWith('/v1/cloud-engine')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  // All remaining routes require auth
  if (!path.startsWith('/v1/cloud-engine')) return false;

  // ── POST /v1/cloud-engine/provision ──────────────────────────────────────
  if (method === 'POST' && path === '/v1/cloud-engine/provision') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      // Prevent duplicate concurrent provisions for the same user
      if (_activeProvisions.has(user.userId)) {
        json(res, 429, { ok: false, error: 'provision_in_progress', message: 'A provision is already in progress. Please wait.' });
        return true;
      }
      _activeProvisions.add(user.userId);

      try {
      // Check for existing engine
      const existing = await getCloudEngine(user.userId);
      if (existing) {
        // Check provision cooldown if engine was recently deleted
        if (existing.deleted_at) {
          const deletedAt = new Date(existing.deleted_at).getTime();
          if (Date.now() - deletedAt < PROVISION_COOLDOWN_MS) {
            json(res, 429, { ok: false, error: 'provision_cooldown', message: 'Please wait before provisioning a new engine' });
            return true;
          }
        } else {
          json(res, 409, { ok: false, error: 'engine_exists', message: 'An engine already exists for this user' });
          return true;
        }
      }

      // Parse and validate body
      const body = await readBody(req);
      const tier = String(body.tier || 'basic');
      const diskSizeGb = Number(body.diskSizeGb || MIN_DISK_GB);

      if (!VALID_TIERS.includes(tier)) {
        json(res, 400, { ok: false, error: 'invalid_tier', validTiers: VALID_TIERS });
        return true;
      }
      if (!Number.isInteger(diskSizeGb) || diskSizeGb < MIN_DISK_GB || diskSizeGb > MAX_DISK_GB) {
        json(res, 400, { ok: false, error: 'invalid_disk_size', min: MIN_DISK_GB, max: MAX_DISK_GB });
        return true;
      }

      // Credit check
      const access = await checkAccess(user.userId);
      if (!access.allowed) {
        json(res, 402, { ok: false, error: 'insufficient_credits', message: 'Not enough credits to provision an engine' });
        return true;
      }

      // Resolve tier config — for 'custom' tier, pick the closest match or use body vcpus/ramGb
      let tierConfig = COMPUTE_TIER_CONFIG[tier];
      let machineTypeOverride: string | undefined;
      if (tier === 'custom') {
        const customVcpus = Math.max(1, Math.min(16, Number(body.vcpus) || 2));
        const customRam = Math.max(1, Math.min(64, Number(body.ramGb) || 4));
        const memoryMb = customRam * 1024;
        const machineType = `e2-custom-${customVcpus}-${memoryMb}`;
        const hourlyUsd = (customVcpus * 0.022) + (customRam * 0.003); // e2 custom: ~$0.022/vCPU/hr + ~$0.003/GB/hr
        tierConfig = { machineType, vcpus: customVcpus, memoryGb: customRam, hourlyUsd };
        machineTypeOverride = machineType;
      }
      // Fetch user timezone for VM env
      const syncPrefs = await getSyncPreferences(user.userId);
      const userTimezone = syncPrefs.timezone || null;

      const provider = getComputeProvider();
      setProvisionStep(user.userId, 'vm_creating');
      const { instanceName, zone, vmSecret } = await provider.provisionVM(user.userId, tier, diskSizeGb, {
        machineType: machineTypeOverride,
        userTimezone,
      });

      // Insert cloud engine record (including per-VM secret for HMAC auth).
      // Reset stale fields from any previous (deleted) engine for this user.
      const engine = await upsertCloudEngine(user.userId, {
        instance_name: instanceName,
        zone,
        machine_type: tierConfig.machineType,
        disk_size_gb: diskSizeGb,
        status: 'provisioning',
        vm_secret: vmSecret,
        started_at: null,
        stopped_at: null,
        deleted_at: null,
        external_ip: null,
        health_status: null,
        last_heartbeat_at: null,
        agent_version: null,
      });
      if (!engine) {
        // DB write failed — delete the orphaned VM
        console.error('[cloud-engine] upsertCloudEngine returned null, cleaning up orphaned VM', instanceName);
        provider.deleteVM(instanceName, zone).catch((e: any) =>
          console.error('[cloud-engine] Failed to cleanup orphaned VM:', e?.message),
        );
        json(res, 500, { ok: false, error: 'provision_failed', message: 'Could not save engine record. Please try again.' });
        return true;
      }

      // Initialize storage usage record
      await upsertStorageUsage(user.userId, {
        hot_storage_gb: diskSizeGb,
        cold_storage_bytes: 0,
      });

      // Fetch external IP from GCE (may take a moment to assign)
      let externalIp: string | null = null;
      try {
        const vmStatus = await provider.getVMExternalIP(instanceName, zone);
        externalIp = vmStatus || null;
      } catch { /* IP not yet assigned — health monitor will update it later */ }

      // Store external IP if we got one
      if (externalIp) {
        await updateEngineHealth(user.userId, { external_ip: externalIp });
      }

      // Return immediately with provisioning status — background task will
      // wait for VM agent readiness, restore data, and transition to running.
      setProvisionStep(user.userId, 'vm_created');
      json(res, 201, { ok: true, engine: { ...engine, status: 'provisioning', external_ip: externalIp, vm_secret: undefined } });

      // Fire-and-forget: wait for VM agent, restore data, then mark running
      (async () => {
        try {
          // Wait for VM agent to be reachable (max 300s — e2-small needs
          // ~2-4 min for apt-get + Node.js install before agent starts)
          let vmIp = externalIp;
          let vmReady = false;
          for (let i = 0; i < 60; i++) {
            // Re-fetch IP if not available yet
            if (!vmIp) {
              setProvisionStep(user.userId, 'waiting_ip');
              try {
                vmIp = await provider.getVMExternalIP(instanceName, zone);
                if (vmIp) {
                  await updateEngineHealth(user.userId, { external_ip: vmIp });
                }
              } catch { /* retry */ }
            }
            if (vmIp) {
              setProvisionStep(user.userId, 'waiting_agent');
              try {
                const pingResp = await fetch(`http://${vmIp}:7400/health`, {
                  signal: AbortSignal.timeout(5000),
                });
                if (pingResp.ok) {
                  vmReady = true;
                  break;
                }
              } catch { /* retry */ }
            }
            await new Promise(r => setTimeout(r, 5000));
          }

          // Restore from cold storage if VM is ready
          if (vmReady) {
            // 1. Restore workspace backup (memories, deploys, scripts, etc.)
            setProvisionStep(user.userId, 'restoring_data');
            const restoreResult = await restoreFromCloud(user.userId);
            if (!restoreResult.success && restoreResult.error !== 'no_backup_exists') {
              console.warn('[cloud-engine] Post-provision workspace restore failed:', restoreResult.error);
            } else {
              console.log('[cloud-engine] Post-provision workspace restore complete for user', user.userId);
            }

            // 2. Sync agent databases + OAuth tokens + browser cookies in parallel
            //    Agent data sync gets generous timeout (10 min) and retries for large DBs.
            //    OAuth/browser sync runs alongside — no dependency between them.
            setProvisionStep(user.userId, 'syncing_agent');
            const [agentSyncSettled, integrationSyncSettled] = await Promise.allSettled([
              // Agent data sync with retry (up to 3 attempts, exponential backoff)
              (async () => {
                let lastErr = '';
                for (let attempt = 0; attempt < 3; attempt++) {
                  if (attempt > 0) {
                    await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
                    console.log(`[cloud-engine] Agent data sync retry ${attempt + 1} for user ${user.userId}`);
                  }
                  try {
                    const result = await sendVMCommand(user.userId, 'sync_agent_data', { direction: 'download' }, 10 * 60_000);
                    if (result.ok) {
                      console.log('[cloud-engine] Post-provision agent data sync complete for user', user.userId);
                      return;
                    }
                    lastErr = result.error || 'sync_failed';
                  } catch (e: any) {
                    lastErr = e?.message || 'sync_error';
                  }
                  console.warn(`[cloud-engine] Agent data sync attempt ${attempt + 1} failed:`, lastErr);
                }
                console.error('[cloud-engine] Agent data sync failed after 3 attempts:', lastErr);
              })(),
              // OAuth tokens + browser cookies (with step update)
              (async () => {
                setProvisionStep(user.userId, 'syncing_integrations');
                await syncRuntimeStateToVM(user.userId);
              })(),
            ]);

            if (agentSyncSettled.status === 'rejected') {
              console.warn('[cloud-engine] Post-provision agent sync rejected:', agentSyncSettled.reason?.message);
            }
            if (integrationSyncSettled.status === 'rejected') {
              console.warn('[cloud-engine] Post-provision integration sync rejected:', integrationSyncSettled.reason?.message);
            }
          } else {
            console.warn('[cloud-engine] VM not ready after provision, skipping restore for user', user.userId);
          }

          // Transition to running
          setProvisionStep(user.userId, 'finalizing');
          const now = new Date().toISOString();
          if (vmReady) {
            const ok = await updateCloudEngineStatus(user.userId, 'running', 'provisioning', {
              started_at: now,
            });
            if (!ok) {
              // Retry without health_status in case constraint is blocking
              console.warn('[cloud-engine] Status update failed, retrying bare status transition');
              await updateCloudEngineStatus(user.userId, 'running', 'provisioning', { started_at: now });
            }
          } else {
            // Agent never responded — still transition to running so the user
            // isn't stuck, but log prominently. The startup script may still be
            // installing Node.js / downloading the agent.
            console.error('[cloud-engine] VM agent never responded to health check for user', user.userId,
              '— transitioning to running anyway (agent may still be booting)');
            // Try with health_status first, fall back to bare transition if constraint fails
            const ok = await updateCloudEngineStatus(user.userId, 'running', 'provisioning', {
              started_at: now,
              health_status: 'unreachable',
            });
            if (!ok) {
              console.warn('[cloud-engine] Status update with health_status failed, retrying without it');
              await updateCloudEngineStatus(user.userId, 'running', 'provisioning', { started_at: now });
              // Update health_status separately so it doesn't block the transition
              await updateEngineHealth(user.userId, { health_status: 'unreachable' }).catch(() => {});
            }
          }
          setProvisionStep(user.userId, 'done');
        } catch (bgErr: any) {
          console.error('[cloud-engine] Background provision finalization failed:', bgErr?.message);
          // Always transition to running — don't leave user stuck at provisioning
          const ok = await updateCloudEngineStatus(user.userId, 'running', 'provisioning', {
            started_at: new Date().toISOString(),
          }).catch(() => false);
          if (!ok) {
            // Last resort: update status without expectedStatus guard
            await updateCloudEngineStatus(user.userId, 'running', undefined, {
              started_at: new Date().toISOString(),
            }).catch(() => {});
          }
          setProvisionStep(user.userId, 'done');
        }
      })();
      } finally {
        _activeProvisions.delete(user.userId);
      }
    } catch (e: any) {
      _activeProvisions.delete(user.userId);
      setProvisionStep(user.userId, 'done');
      // Extract a meaningful error message from GCP errors
      const gcpMsg = e?.error?.message || e?.errors?.[0]?.message || e?.message || 'failed';
      const gcpCode = e?.code ?? e?.error?.code;
      const gcpReason = e?.error?.errors?.[0]?.reason || e?.error?.details?.find((d: any) => d.reason)?.reason || '';
      console.error('[cloud-engine] provision error:', JSON.stringify(e?.error || e?.message || e, null, 2));
      console.error('[cloud-engine] provision error stack:', e?.stack);

      // Map GCP errors to user-friendly messages
      let userMessage = 'Could not create your cloud engine. Please try again in a moment.';
      let status = 500;
      if (gcpCode === 403 || gcpReason.includes('QUOTA') || gcpReason === 'rateLimitExceeded') {
        userMessage = 'Cloud servers are busy right now. Please wait a minute and try again.';
        status = 429;
      } else if (gcpCode === 409) {
        userMessage = 'A cloud engine is already being set up. Please wait for it to finish.';
        status = 409;
      } else if (gcpMsg.includes('not found') || gcpMsg.includes('does not exist')) {
        userMessage = 'Cloud configuration error. Please contact support.';
      }

      json(res, status, { ok: false, error: 'provision_failed', message: userMessage, detail: gcpMsg });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/start ──────────────────────────────────────────
  if (method === 'POST' && path === '/v1/cloud-engine/start') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const engine = await getCloudEngine(user.userId);
      if (!engine) {
        json(res, 404, { ok: false, error: 'no_engine' });
        return true;
      }
      if (engine.status !== 'stopped') {
        json(res, 409, { ok: false, error: 'invalid_state', currentStatus: engine.status, message: `Cannot start engine in '${engine.status}' state` });
        return true;
      }

      // Credit check
      const access = await checkAccess(user.userId);
      if (!access.allowed) {
        json(res, 402, { ok: false, error: 'insufficient_credits' });
        return true;
      }

      // Transition: stopped → starting
      await updateCloudEngineStatus(user.userId, 'starting', 'stopped');

      // Start VM FIRST - it needs to be running before we can restore
      const provider = getComputeProvider();
      await provider.startVM(engine.instance_name, engine.zone);

      // Fetch external IP (may have changed since last start)
      let externalIp: string | null = null;
      try {
        externalIp = await provider.getVMExternalIP(engine.instance_name, engine.zone);
        if (externalIp) {
          await updateEngineHealth(user.userId, { external_ip: externalIp, health_status: 'unknown' });
        }
      } catch { /* non-fatal */ }

      // Wait for VM agent to be reachable before restoring (max 120s for cold-start VMs)
      let vmReady = false;
      for (let i = 0; i < 24; i++) {
        // Re-fetch IP if not yet available (may change after stop/start)
        if (!externalIp) {
          try {
            externalIp = await provider.getVMExternalIP(engine.instance_name, engine.zone);
            if (externalIp) {
              await updateEngineHealth(user.userId, { external_ip: externalIp });
            }
          } catch { /* retry */ }
        }
        if (externalIp) {
          try {
            const pingResp = await fetch(`http://${externalIp}:7400/health`, {
              signal: AbortSignal.timeout(5000),
            });
            if (pingResp.ok) {
              vmReady = true;
              break;
            }
          } catch { /* retry */ }
        }
        await new Promise(r => setTimeout(r, 5000));
      }

      // Restore from cold storage AFTER VM is running
      let restoreResult: { success: boolean; error?: string } = { success: false, error: 'vm_not_ready' };
      if (vmReady) {
        // 1. Restore workspace backup (memories, deploys, scripts, etc.)
        restoreResult = await restoreFromCloud(user.userId);
        if (!restoreResult.success) {
          console.warn('[cloud-engine] Restore failed:', restoreResult.error);
        }

        // 2. Sync agent databases + OAuth tokens + browser cookies in parallel
        //    Agent data gets retries and generous timeout for large knowledge DBs
        const [agentResult, integrationResult] = await Promise.allSettled([
          // Agent data sync with retry (3 attempts, 10 min timeout each)
          (async () => {
            let lastErr = '';
            for (let attempt = 0; attempt < 3; attempt++) {
              if (attempt > 0) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
                console.log(`[cloud-engine] Agent data sync retry ${attempt + 1} on start for user ${user.userId}`);
              }
              try {
                const agentSync = await sendVMCommand(user.userId, 'sync_agent_data', { direction: 'download' }, 10 * 60_000);
                if (agentSync.ok) {
                  console.log('[cloud-engine] Agent data synced on start for user', user.userId);
                  return;
                }
                lastErr = agentSync.error || 'sync_failed';
              } catch (e: any) {
                lastErr = e?.message || 'sync_error';
              }
              console.warn(`[cloud-engine] Agent data sync attempt ${attempt + 1} on start failed:`, lastErr);
            }
            console.error('[cloud-engine] Agent data sync on start failed after 3 attempts:', lastErr);
          })(),
          // OAuth tokens + browser cookies (independent of agent data)
          syncRuntimeStateToVM(user.userId).catch((e: any) => {
            console.warn('[cloud-engine] Integration sync on start failed:', e?.message);
          }),
        ]);

        if (agentResult.status === 'rejected') {
          console.warn('[cloud-engine] Agent sync on start rejected:', agentResult.reason?.message);
        }
        if (integrationResult.status === 'rejected') {
          console.warn('[cloud-engine] Integration sync on start rejected:', integrationResult.reason?.message);
        }
      } else {
        console.warn('[cloud-engine] VM not ready for restore after 120s, skipping');
      }

      // Transition: starting → running
      await updateCloudEngineStatus(user.userId, 'running', 'starting', {
        started_at: new Date().toISOString(),
      });

      json(res, 200, { ok: true, status: 'running', externalIp, restore: restoreResult });
    } catch (e: any) {
      console.error('[cloud-engine] start error:', e?.message);
      json(res, 500, { ok: false, error: 'start_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/stop ───────────────────────────────────────────
  if (method === 'POST' && path === '/v1/cloud-engine/stop') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const engine = await getCloudEngine(user.userId);
      if (!engine) {
        json(res, 404, { ok: false, error: 'no_engine' });
        return true;
      }
      if (engine.status !== 'running') {
        json(res, 409, { ok: false, error: 'invalid_state', currentStatus: engine.status, message: `Cannot stop engine in '${engine.status}' state` });
        return true;
      }

      // Transition: running → stopping
      await updateCloudEngineStatus(user.userId, 'stopping', 'running');

      // Sync to cold storage BEFORE stopping VM
      const syncResult = await syncToCloud(user.userId);
      if (!syncResult.success) {
        // Sync failed — keep VM running and report error
        await updateCloudEngineStatus(user.userId, 'running', 'stopping', {
          started_at: engine.started_at || undefined,
        });
        json(res, 500, { ok: false, error: 'sync_failed', message: syncResult.error || 'Cold storage sync failed, VM kept running' });
        return true;
      }

      // Stop VM
      const provider = getComputeProvider();
      await provider.stopVM(engine.instance_name, engine.zone);

      // Transition: stopping → stopped
      await updateCloudEngineStatus(user.userId, 'stopped', 'stopping', {
        stopped_at: new Date().toISOString(),
      });

      json(res, 200, { ok: true, status: 'stopped', sync: syncResult });
    } catch (e: any) {
      console.error('[cloud-engine] stop error:', e?.message);
      json(res, 500, { ok: false, error: 'stop_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── DELETE /v1/cloud-engine ──────────────────────────────────────────────
  if (method === 'DELETE' && path === '/v1/cloud-engine') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const engine = await getCloudEngine(user.userId);
      if (!engine) {
        json(res, 404, { ok: false, error: 'no_engine' });
        return true;
      }

      // If running, sync first then stop
      if (engine.status === 'running') {
        await syncToCloud(user.userId);
        const provider = getComputeProvider();
        await provider.stopVM(engine.instance_name, engine.zone);
      }

      // Delete VM
      const provider = getComputeProvider();
      await provider.deleteVM(engine.instance_name, engine.zone);

      // Delete all cloud storage
      await deleteAllUserData(user.userId);

      // Mark engine as deleted
      await deleteCloudEngine(user.userId);

      // Reset storage_usage so stale values don't persist
      await upsertStorageUsage(user.userId, {
        hot_storage_gb: 0,
        cold_storage_bytes: 0,
        backup_object_name: null,
        last_sync_at: null,
      });

      json(res, 200, { ok: true, message: 'Engine and all storage deleted' });
    } catch (e: any) {
      console.error('[cloud-engine] delete error:', e?.message);
      json(res, 500, { ok: false, error: 'delete_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── GET /v1/cloud-engine/status ──────────────────────────────────────────
  if (method === 'GET' && path === '/v1/cloud-engine/status') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const engine = await getCloudEngine(user.userId);
      if (!engine) {
        json(res, 200, { ok: true, engine: null });
        return true;
      }

      // Keep status polling from replaying long billing history after restarts.
      await catchUpBilling(engine, { maxBackfillHours: 6 });

      const syncStatus = await getSyncStatus(user.userId);
      const computeUsage = await getUserComputeUsage(user.userId);
      const creditSummary = await getCreditSummary(user.userId);
      const machineSpec = resolveComputeMachineSpec(engine.machine_type);
      const currentTier = machineSpec?.custom ? 'custom' : (machineSpec?.tier || 'custom');
      const computeCreditsPerHour = estimateMachineCreditsPerHour(engine.machine_type);
      const storageCredits = computeUsage.hotStorage + computeUsage.coldStorage;
      const hoursThisMonth = computeCreditsPerHour > 0
        ? Number((computeUsage.compute / computeCreditsPerHour).toFixed(2))
        : 0;

      // Include provision progress if still provisioning
      const provisionProgress = engine.status === 'provisioning' ? getProvisionStep(user.userId) : null;

      // Active health check: ping the VM now instead of relying on background intervals
      // (Cloud Run CPU may not be allocated between requests, so intervals are unreliable)
      let liveHealthStatus = engine.health_status;
      let liveHeartbeat = engine.last_heartbeat_at;
      let liveAgentVersion = engine.agent_version;
      let vmMemoryStats: { totalMemories: number; totalConversations: number; topicCount: number; diskUsageBytes: number; byOrigin?: { cloud_vm: number; desktop: number } } | null = null;
      if (engine.status === 'running' && engine.external_ip) {
        try {
          const ping = await pingVMAgent(engine.external_ip, 5_000);
          if (ping.ok) {
            const now = new Date().toISOString();
            liveHealthStatus = 'healthy';
            liveHeartbeat = now;
            liveAgentVersion = ping.result?.agentVersion || engine.agent_version;
            // Fire-and-forget DB update
            updateEngineHealth(user.userId, {
              last_heartbeat_at: now,
              health_status: 'healthy',
              agent_version: liveAgentVersion ?? undefined,
            }).catch(() => {});

            // Fetch VM memory stats for sync comparison (non-blocking, short timeout)
            try {
              const memResult = await sendVMCommand(user.userId, 'memory_stats', {}, 5_000);
              if (memResult.ok && memResult.result?.stats) {
                vmMemoryStats = memResult.result.stats;
              }
            } catch { /* non-fatal */ }
          } else {
            const staleMs = engine.last_heartbeat_at
              ? Date.now() - new Date(engine.last_heartbeat_at).getTime()
              : Infinity;
            liveHealthStatus = staleMs < 120_000 ? 'unhealthy' : 'unreachable';
          }
        } catch {
          // Non-fatal — fall back to DB values
        }
      }

      // Fetch desktop memory stats (from cloud-ai's own memory service if bridge is available)
      let desktopMemoryStats: { conversations: number; messages: number; spaces: number; space_items: number; segments: number } | null = null;
      try {
        const { getMemoryStats } = await import('../memory/conversations');
        desktopMemoryStats = await getMemoryStats();
      } catch { /* non-fatal — desktop bridge may be offline */ }

      json(res, 200, {
        ok: true,
        engine: {
          id: engine.id,
          userId: engine.user_id,
          status: engine.status,
          instanceName: engine.instance_name,
          zone: engine.zone,
          machineType: engine.machine_type,
          tier: currentTier,
          vcpus: machineSpec?.vcpus ?? null,
          ramGb: machineSpec?.memoryGb ?? null,
          diskSizeGb: engine.disk_size_gb,
          createdAt: engine.created_at,
          startedAt: engine.started_at,
          stoppedAt: engine.stopped_at,
          externalIp: engine.external_ip,
          healthStatus: liveHealthStatus,
          lastHeartbeat: liveHeartbeat,
          agentVersion: liveAgentVersion,
          provisionStep: provisionProgress?.step ?? null,
        },
        storage: syncStatus,
        sync: {
          lastSyncAt: syncStatus.lastSyncAt,
          vm: vmMemoryStats ? {
            memories: vmMemoryStats.totalMemories,
            conversations: vmMemoryStats.totalConversations,
            topics: vmMemoryStats.topicCount,
            diskBytes: vmMemoryStats.diskUsageBytes,
            byOrigin: vmMemoryStats.byOrigin ?? null,
          } : null,
          desktop: desktopMemoryStats ? {
            conversations: desktopMemoryStats.conversations,
            messages: desktopMemoryStats.messages,
            spaces: desktopMemoryStats.spaces,
            spaceItems: desktopMemoryStats.space_items,
            segments: desktopMemoryStats.segments,
          } : null,
        },
        billing: {
          total_credits_used: computeUsage.total,
          compute_credits: computeUsage.compute,
          storage_credits: storageCredits,
          hot_storage_credits: computeUsage.hotStorage,
          cold_storage_credits: computeUsage.coldStorage,
          current_tier: currentTier,
          engine_status: engine.status,
          hours_this_month: hoursThisMonth,
          compute_credits_per_hour: computeCreditsPerHour,
          credits_remaining: creditSummary.remaining,
          credits_limit: creditSummary.limit,
        },
      });
    } catch (e: any) {
      console.error('[cloud-engine] status error:', e?.message);
      json(res, 500, { ok: false, error: 'status_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/upload-agent-data ──────────────────────────────
  // Returns a signed GCS upload URL. Desktop uploads tar.gz directly to GCS,
  // bypassing Cloud Run body limits entirely. Supports any size (1GB+).
  // Flow: Desktop → POST {} → gets signed URL → PUT binary to GCS
  if (method === 'POST' && path === '/v1/cloud-engine/upload-agent-data') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const body = await readBody(req, 1 * 1024 * 1024); // 1 MB — only needs empty/small JSON
      const base64Data = body?.data;

      if (typeof base64Data === 'string' && base64Data.length > 0) {
        // Legacy inline upload (old desktop versions) — accept if small enough
        const buffer = Buffer.from(base64Data, 'base64');
        console.log(`[cloud-engine] upload-agent-data: inline upload ${(buffer.length / 1024 / 1024).toFixed(1)} MB for user ${user.userId}`);
        const result = await uploadAgentData(user.userId, buffer);
        json(res, 200, { ok: true, ...result });
      } else {
        // Return a signed upload URL for the desktop to upload directly to GCS
        const { generateAgentDataUploadUrl } = await import('../services/cold-storage');
        const { uploadUrl, objectName } = await generateAgentDataUploadUrl(user.userId);
        console.log(`[cloud-engine] upload-agent-data: issued signed URL for user ${user.userId} → ${objectName}`);
        json(res, 200, { ok: true, uploadUrl, objectName });
      }
    } catch (e: any) {
      console.error('[cloud-engine] upload-agent-data error:', e?.message);
      json(res, 500, { ok: false, error: 'upload_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── GET /v1/cloud-engine/oauth-tokens ──────────────────────────────────
  // Returns OAuth tokens for all connected integrations.
  // Used by VM agent to access integrations (Google, GitHub, etc.)
  if (method === 'GET' && path === '/v1/cloud-engine/oauth-tokens') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const accounts = await listExternalAccounts(user.userId);
      // Strip sensitive fields, keep what the VM needs
      const tokens = accounts
        .filter((a: any) => a.access_token && a.access_token !== 'verified')
        .map((a: any) => ({
          provider: a.provider,
          profileLabel: a.profile_label,
          isDefault: a.is_default,
          accessToken: a.access_token,
          refreshToken: a.refresh_token || null,
          expiresAt: a.expires_at || null,
          scopes: a.scopes || [],
          accountEmail: a.account_email || null,
        }));
      json(res, 200, { ok: true, tokens });
    } catch (e: any) {
      console.error('[cloud-engine] oauth-tokens error:', e?.message);
      json(res, 500, { ok: false, error: 'tokens_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/sync-oauth-to-vm ──────────────────────────────
  // Pushes OAuth tokens to the running VM so integrations work there
  if (method === 'POST' && path === '/v1/cloud-engine/sync-oauth-to-vm') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const engine = await getCloudEngine(user.userId);
      if (!engine || engine.status !== 'running') {
        json(res, 409, { ok: false, error: 'engine_not_running' });
        return true;
      }

      const accounts = await listExternalAccounts(user.userId);
      const tokens = accounts
        .filter((a: any) => a.access_token && a.access_token !== 'verified')
        .map((a: any) => ({
          provider: a.provider,
          profileLabel: a.profile_label,
          isDefault: a.is_default,
          accessToken: a.access_token,
          refreshToken: a.refresh_token || null,
          expiresAt: a.expires_at || null,
          scopes: a.scopes || [],
          accountEmail: a.account_email || null,
        }));

      // Send tokens to VM agent
      const result = await sendVMCommand(user.userId, 'store_oauth_tokens', { tokens }, 15_000);
      json(res, 200, { ok: true, synced: tokens.length, vmResult: result.ok });
    } catch (e: any) {
      console.error('[cloud-engine] sync-oauth error:', e?.message);
      json(res, 500, { ok: false, error: 'sync_oauth_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/sync-browser-profile-to-vm ────────────────────
  // Pushes the desktop browser cookie backup to the running VM browser profile
  if (method === 'POST' && path === '/v1/cloud-engine/sync-browser-profile-to-vm') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const engine = await getCloudEngine(user.userId);
      if (!engine || engine.status !== 'running') {
        json(res, 409, { ok: false, error: 'engine_not_running' });
        return true;
      }
      if (!getDesktopWs(user.userId)) {
        json(res, 409, { ok: false, error: 'desktop_offline' });
        return true;
      }

      await pushBrowserProfileToVM(user.userId);
      json(res, 200, { ok: true });
    } catch (e: any) {
      console.error('[cloud-engine] sync-browser-profile error:', e?.message);
      json(res, 500, { ok: false, error: 'sync_browser_profile_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/sync-agent-data ────────────────────────────
  // Tells the running VM to download agent databases (knowledge.db, memory.db)
  // from GCS, so the headless agent has the user's full memory/knowledge.
  if (method === 'POST' && path === '/v1/cloud-engine/sync-agent-data') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const engine = await getCloudEngine(user.userId);
      if (!engine || engine.status !== 'running') {
        json(res, 409, { ok: false, error: 'engine_not_running' });
        return true;
      }

      // Generate signed download URL so the VM doesn't need direct GCS access
      const { generateAgentDataDownloadUrl } = await import('../services/cold-storage');
      const urlResult = await generateAgentDataDownloadUrl(user.userId);
      if (!urlResult) {
        json(res, 404, { ok: false, error: 'no_agent_data', message: 'No agent data found in cloud storage' });
        return true;
      }

      const result = await sendVMCommand(user.userId, 'sync_agent_data', {
        direction: 'download',
        downloadUrl: urlResult.downloadUrl,
      }, 10 * 60_000);
      json(res, 200, { ok: Boolean(result.ok), direction: 'download' });
    } catch (e: any) {
      console.error('[cloud-engine] sync-agent-data error:', e?.message);
      json(res, 500, { ok: false, error: 'sync_agent_data_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/vm/agent-data-urls ───────────────────────
  // Called BY the VM agent to get signed GCS URLs for uploading/downloading
  // agent data. Auth: VM sends its userId + HMAC token (same format cloud-ai uses).
  // This lets the VM sync data without having direct GCS access.
  if (method === 'POST' && path === '/v1/cloud-engine/vm/agent-data-urls') {
    try {
      const body = await readBody(req, 4096);
      const userId = body?.userId;
      const vmToken = body?.vmToken;
      if (!userId || !vmToken) {
        json(res, 400, { ok: false, error: 'missing userId or vmToken' });
        return true;
      }

      // Verify the VM token against the stored vm_secret for this user's engine
      const engine = await getCloudEngine(userId);
      if (!engine || !engine.vm_secret) {
        json(res, 403, { ok: false, error: 'no_engine' });
        return true;
      }

      // Verify HMAC signature using the VM's secret
      const { verifyVMToken } = await import('../services/vm-tokens');
      const tokenPayload = verifyVMToken(vmToken, engine.vm_secret);
      if (!tokenPayload || tokenPayload.userId !== userId) {
        json(res, 403, { ok: false, error: 'invalid_vm_token' });
        return true;
      }

      // Generate signed URLs for this user only
      const { generateAgentDataUploadUrl, generateAgentDataDownloadUrl } = await import('../services/cold-storage');
      const [uploadResult, downloadResult] = await Promise.all([
        generateAgentDataUploadUrl(userId),
        generateAgentDataDownloadUrl(userId),
      ]);

      json(res, 200, {
        ok: true,
        uploadUrl: uploadResult.uploadUrl,
        downloadUrl: downloadResult?.downloadUrl || null,
        objectName: uploadResult.objectName,
      });
    } catch (e: any) {
      console.error('[cloud-engine] vm/agent-data-urls error:', e?.message);
      json(res, 500, { ok: false, error: 'failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/vm/agent-data-updated ──────────────────────
  // Called BY the VM agent after it uploads new agent data to GCS.
  // Cloud-ai notifies the desktop via WebSocket so it can pull the update.
  if (method === 'POST' && path === '/v1/cloud-engine/vm/agent-data-updated') {
    try {
      const body = await readBody(req, 4096);
      const userId = body?.userId;
      const vmToken = body?.vmToken;
      if (!userId || !vmToken) {
        json(res, 400, { ok: false, error: 'missing userId or vmToken' });
        return true;
      }

      // Verify the VM token
      const engine = await getCloudEngine(userId);
      if (!engine || !engine.vm_secret) {
        json(res, 403, { ok: false, error: 'no_engine' });
        return true;
      }
      const { verifyVMToken } = await import('../services/vm-tokens');
      const tokenPayload = verifyVMToken(vmToken, engine.vm_secret);
      if (!tokenPayload || tokenPayload.userId !== userId) {
        json(res, 403, { ok: false, error: 'invalid_vm_token' });
        return true;
      }

      // Notify desktop via WebSocket that new agent data is available in GCS
      const desktopWs = getDesktopWs(userId);
      if (desktopWs) {
        try {
          desktopWs.send(JSON.stringify({
            type: 'agent_data_updated',
            source: 'vm',
            timestamp: new Date().toISOString(),
          }));
          console.log(`[cloud-engine] Notified desktop of agent data update for user ${userId}`);
        } catch (e: any) {
          console.warn('[cloud-engine] Failed to notify desktop:', e?.message);
        }
      }

      json(res, 200, { ok: true, desktopNotified: !!desktopWs });
    } catch (e: any) {
      console.error('[cloud-engine] vm/agent-data-updated error:', e?.message);
      json(res, 500, { ok: false, error: 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/push-agent-data ─────────────────────────────
  // Called BY the desktop after it uploads new agent data to GCS.
  // Cloud-ai tells the running VM to download the updated data.
  if (method === 'POST' && path === '/v1/cloud-engine/push-agent-data') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      const engine = await getCloudEngine(user.userId);
      if (!engine || engine.status !== 'running') {
        json(res, 409, { ok: false, error: 'engine_not_running' });
        return true;
      }

      // Generate signed download URL for the VM
      const { generateAgentDataDownloadUrl } = await import('../services/cold-storage');
      const urlResult = await generateAgentDataDownloadUrl(user.userId);
      if (!urlResult) {
        json(res, 404, { ok: false, error: 'no_agent_data' });
        return true;
      }

      // Tell VM to download the updated agent data (10 min timeout for large DBs)
      const result = await sendVMCommand(user.userId, 'sync_agent_data', {
        direction: 'download',
        downloadUrl: urlResult.downloadUrl,
      }, 10 * 60_000);

      json(res, 200, { ok: Boolean(result.ok), direction: 'download', vmResult: result });
    } catch (e: any) {
      console.error('[cloud-engine] push-agent-data error:', e?.message);
      json(res, 500, { ok: false, error: 'push_agent_data_failed', message: e?.message || 'failed' });
    }
    return true;
  }

  // ── POST /v1/cloud-engine/push-oauth-tokens ───────────────────────────
  // Explicitly push current OAuth tokens to the running VM.
  // Called by desktop when an integration is connected/disconnected.
  if (method === 'POST' && path === '/v1/cloud-engine/push-oauth-tokens') {
    const user = await authenticate(req, res);
    if (!user) return true;
    try {
      await pushOAuthTokensToVM(user.userId);
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 500, { ok: false, error: e?.message || 'push_failed' });
    }
    return true;
  }

  return false;
}
