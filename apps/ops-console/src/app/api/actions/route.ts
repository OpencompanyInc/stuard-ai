import { NextResponse } from 'next/server';
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import { verifyOpsToken } from '../../lib/supabase-server';

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

function normalizeGithubRepo(input: string | null | undefined): string {
  const fallback = 'Ifesol-backup/Stuard-AI';
  const raw = String(input || '').trim();
  if (!raw) return fallback;

  const cleaned = raw.replace(/\.git$/i, '');

  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      const url = new URL(cleaned);
      const pathParts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        return `${pathParts[0]}/${pathParts[1]}`;
      }
    } catch {
      // fall through to other formats
    }
  }

  const sshLike = cleaned.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (sshLike) {
    return `${sshLike[1]}/${sshLike[2]}`;
  }

  if (/^[^/]+\/[^/]+$/.test(cleaned)) {
    return cleaned;
  }

  return fallback;
}

function getGithubConfig() {
  const repoRaw = process.env.GITHUB_REPO || process.env.OPS_GITHUB_REPO || 'Ifesol-backup/Stuard-AI';
  return {
    token:
      process.env.GITHUB_TOKEN ||
      process.env.OPS_GITHUB_TOKEN ||
      process.env.GH_TOKEN ||
      process.env.GITHUB_PAT ||
      null,
    repo: normalizeGithubRepo(repoRaw),
  };
}

type GithubWorkflow = {
  id: number;
  name: string;
  path: string;
};

async function dispatchWorkflowByIdentifier(opts: {
  workflow: string;
  ref: string;
  inputs: Record<string, string | boolean>;
  config: { token: string | null; repo: string };
}): Promise<{ status: number; message: string; details: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${opts.config.repo}/actions/workflows/${opts.workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: opts.ref, inputs: opts.inputs }),
    }
  );

  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  const message = typeof data.message === 'string' ? data.message : `GitHub API returned ${res.status}`;
  const details = [
    `repo=${opts.config.repo}`,
    `workflow=${opts.workflow}`,
    `dispatch_ref=${opts.ref}`,
    `status=${res.status}`,
  ].join(', ');

  return { status: res.status, message, details };
}

function normalizeWorkflowName(input: string): string {
  return input.trim().toLowerCase();
}

function workflowFileFromPath(workflowPath: string): string {
  const slash = workflowPath.lastIndexOf('/');
  return slash >= 0 ? workflowPath.slice(slash + 1) : workflowPath;
}

async function listRepoWorkflows(config: { token: string | null; repo: string }): Promise<
  { ok: true; workflows: GithubWorkflow[] } | { ok: false; error: string }
> {
  if (!config.token) {
    return { ok: false, error: 'GitHub token not configured. Set GITHUB_TOKEN or OPS_GITHUB_TOKEN.' };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${config.repo}/actions/workflows?per_page=100`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      const message = typeof data.message === 'string' ? data.message : `GitHub API returned ${res.status}`;
      return { ok: false, error: `${message} (repo=${config.repo}, status=${res.status})` };
    }

    const raw = Array.isArray((data as { workflows?: unknown[] }).workflows)
      ? ((data as { workflows: unknown[] }).workflows)
      : [];
    const workflows: GithubWorkflow[] = raw
      .map((item) => {
        const obj = item as Record<string, unknown>;
        if (typeof obj.id !== 'number' || typeof obj.name !== 'string' || typeof obj.path !== 'string') {
          return null;
        }
        return { id: obj.id, name: obj.name, path: obj.path };
      })
      .filter((wf): wf is GithubWorkflow => wf !== null);

    return { ok: true, workflows };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || 'Failed to list workflows' };
  }
}

async function resolveWorkflowIdentifier(
  workflow: string,
  config: { token: string | null; repo: string }
): Promise<{ ok: true; id: number; matchedBy: 'id' | 'file' | 'path' | 'name' } | { ok: false; error: string }> {
  const trimmed = workflow.trim();
  if (/^\d+$/.test(trimmed)) {
    return { ok: true, id: Number(trimmed), matchedBy: 'id' };
  }

  const listed = await listRepoWorkflows(config);
  if (!listed.ok) {
    return { ok: false, error: listed.error };
  }

  const lower = normalizeWorkflowName(trimmed);

  const byFile = listed.workflows.find((wf) => normalizeWorkflowName(workflowFileFromPath(wf.path)) === lower);
  if (byFile) return { ok: true, id: byFile.id, matchedBy: 'file' };

  const byPath = listed.workflows.find((wf) => normalizeWorkflowName(wf.path) === lower);
  if (byPath) return { ok: true, id: byPath.id, matchedBy: 'path' };

  const byName = listed.workflows.find((wf) => normalizeWorkflowName(wf.name) === lower);
  if (byName) return { ok: true, id: byName.id, matchedBy: 'name' };

  const available = listed.workflows.map((wf) => wf.name).slice(0, 8).join(', ');
  return {
    ok: false,
    error: `Workflow '${workflow}' was not found in repo ${config.repo}. Visible workflows: ${available || 'none'}`,
  };
}

// GitHub API helper to trigger workflow dispatch
async function triggerWorkflow(
  workflow: string,
  ref: string,
  inputs: Record<string, string | boolean>,
  config: { token: string | null; repo: string }
): Promise<{ ok: boolean; message?: string; error?: string }> {
  if (!config.token) {
    return { ok: false, error: 'GitHub token not configured. Set GITHUB_TOKEN or OPS_GITHUB_TOKEN.' };
  }

  try {
    const direct = await dispatchWorkflowByIdentifier({ workflow, ref, inputs, config });
    if (direct.status === 204) {
      return { ok: true, message: `Triggered ${workflow} on ${ref}` };
    }

    if (direct.status === 404) {
      const resolved = await resolveWorkflowIdentifier(workflow, config);
      if (!resolved.ok) {
        return { ok: false, error: `${direct.message} (${direct.details}) | ${resolved.error}` };
      }

      const retry = await dispatchWorkflowByIdentifier({ workflow: String(resolved.id), ref, inputs, config });
      if (retry.status === 204) {
        return {
          ok: true,
          message: `Triggered ${workflow} on ${ref} (resolved by ${resolved.matchedBy} -> id ${resolved.id})`,
        };
      }

      return {
        ok: false,
        error: `${retry.message} (${retry.details}, resolved_by=${resolved.matchedBy}, resolved_id=${resolved.id})`,
      };
    }

    return { ok: false, error: `${direct.message} (${direct.details})` };
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message || 'Failed to call GitHub API' };
  }
}

async function triggerWorkflowWithFallback(
  candidates: Array<{ workflow: string; ref: string; inputs: Record<string, string | boolean> }>,
  config: { token: string | null; repo: string }
): Promise<{ ok: true; message: string; workflow: string } | { ok: false; error: string }> {
  const errors: string[] = [];

  for (const candidate of candidates) {
    const result = await triggerWorkflow(candidate.workflow, candidate.ref, candidate.inputs, config);
    if (result.ok) {
      return {
        ok: true,
        message: result.message || `Triggered ${candidate.workflow} on ${candidate.ref}`,
        workflow: candidate.workflow,
      };
    }

    errors.push(`${candidate.workflow}: ${result.error || 'Unknown error'}`);

    const isNotFound = (result.error || '').includes('status=404') || (result.error || '').includes('Not Found');
    if (!isNotFound) {
      break;
    }
  }

  return { ok: false, error: errors.join(' | ') || 'Workflow trigger failed' };
}

type DeployTargets = { website?: boolean; cloud?: boolean; desktop?: boolean; vm?: boolean };

function formatTargets(targets?: DeployTargets) {
  if (!targets) return 'all targets';
  const enabled: string[] = [];
  if (targets.website) enabled.push('website');
  if (targets.cloud) enabled.push('cloud');
  if (targets.desktop) enabled.push('desktop');
  if (targets.vm) enabled.push('vm');
  if (!enabled.length) return 'no targets selected';
  return enabled.join(', ');
}

const git = simpleGit(findRepoRoot(process.cwd()));

function isDevMode() {
  return process.env.NODE_ENV !== 'production';
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function pushOriginWithRetry(opts: {
  branch: string;
  upstream?: boolean;
  maxAttempts?: number;
}): Promise<{ ok: true; output?: string } | { ok: false; error: string }> {
  const maxAttempts = opts.maxAttempts ?? 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const args = [
        '-c',
        'http.postBuffer=524288000',
        '-c',
        'http.lowSpeedLimit=0',
        '-c',
        'http.lowSpeedTime=999999',
        'push',
      ];

      if (opts.upstream) args.push('-u');
      args.push('origin', opts.branch);

      const output = await git.raw(args);
      return { ok: true, output };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt >= maxAttempts) {
        return { ok: false, error: msg };
      }

      // brief backoff for transient network/proxy/GitHub hiccups
      await sleep(1500);
    }
  }

  return { ok: false, error: 'Unknown push failure' };
}

export async function POST(req: Request) {
  if (!verifyOpsToken(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { type, payload = {} } = await req.json();

    switch (type) {
      // 1. LOCAL DEV ---------------------------------------------------------
      case 'stage-all': {
        await git.add('.');
        return NextResponse.json({ message: 'Staged all changes' });
      }

      case 'create-branch': {
        if (!isDevMode()) {
          return NextResponse.json({ error: 'This action is only available in dev mode' }, { status: 403 });
        }

        const branchName = String(payload.branch || payload.name || '').trim();
        const baseBranch = String(payload.baseBranch || '').trim();

        if (!branchName) {
          return NextResponse.json({ error: 'Branch name is required' }, { status: 400 });
        }

        // Create from the current branch by default
        if (baseBranch) {
          await git.checkout(baseBranch);
          await git.pull('origin', baseBranch);
        }

        // Creates and checks out the new branch
        await git.checkoutLocalBranch(branchName);

        const pushed = await pushOriginWithRetry({ branch: branchName, upstream: true, maxAttempts: 2 });
        if (!pushed.ok) {
          return NextResponse.json({ error: pushed.error }, { status: 500 });
        }

        return NextResponse.json({ message: `Created branch: ${branchName}` });
      }

      case 'commit': {
        const msg = String(payload.message || '').trim();
        if (!msg) {
          return NextResponse.json({ error: 'Commit message is required' }, { status: 400 });
        }
        await git.commit(msg);
        return NextResponse.json({ message: 'Committed changes' });
      }

      case 'push-current': {
        if (!isDevMode()) {
          return NextResponse.json({ error: 'This action is only available in dev mode' }, { status: 403 });
        }

        const autoCommit = Boolean(payload.autoCommit);

        const status = await git.status();
        if (!status.isClean()) {
          if (!autoCommit) {
            return NextResponse.json({ error: 'Working tree is not clean. Commit changes or enable autoCommit.' }, { status: 400 });
          }
          await git.add('.');
          await git.commit('wip: push current branch');
        }

        const current = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

        const pushed = await pushOriginWithRetry({ branch: current, upstream: false, maxAttempts: 2 });
        if (!pushed.ok) {
          return NextResponse.json({ error: pushed.error }, { status: 500 });
        }

        return NextResponse.json({ message: `Pushed ${current} to remote` });
      }

      // Start a new feature branch (new API) or legacy "push-feature"
      case 'start-feature':
      case 'push-feature': {
        if (!isDevMode()) {
          return NextResponse.json({ error: 'This action is only available in dev mode' }, { status: 403 });
        }

        const rawName = String(payload.name || '').trim();
        if (!rawName) {
          return NextResponse.json({ error: 'Feature name is required' }, { status: 400 });
        }
        const slug = rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
        const branchName = `feature/${slug || 'unnamed'}`;
        await git.checkoutLocalBranch(branchName);

        const pushed = await pushOriginWithRetry({ branch: branchName, upstream: true, maxAttempts: 2 });
        if (!pushed.ok) {
          return NextResponse.json({ error: pushed.error }, { status: 500 });
        }

        return NextResponse.json({ message: `Started feature branch: ${branchName}` });
      }

      case 'share-feature': {
        if (!isDevMode()) {
          return NextResponse.json({ error: 'This action is only available in dev mode' }, { status: 403 });
        }

        // Check if there are uncommitted changes
        const status = await git.status();
        if (!status.isClean()) {
          await git.add('.');
          await git.commit('wip: sync shared branch');
        }
        const current = await git.revparse(['--abbrev-ref', 'HEAD']);

        const pushed = await pushOriginWithRetry({ branch: String(current).trim(), upstream: false, maxAttempts: 2 });
        if (!pushed.ok) {
          return NextResponse.json({ error: pushed.error }, { status: 500 });
        }

        return NextResponse.json({ message: `Synced ${current} to remote (with auto-commit)` });
      }

      case 'checkout-branch': {
        if (!isDevMode()) {
          return NextResponse.json({ error: 'This action is only available in dev mode' }, { status: 403 });
        }

        const branchName = String(payload.branch || '').trim();
        if (!branchName) {
          return NextResponse.json({ error: 'Branch name is required' }, { status: 400 });
        }

        // Check if there are uncommitted changes
        const status = await git.status();
        if (!status.isClean()) {
           // Optional: auto-stash or reject. For now, let's try to checkout.
           // If checkout fails due to dirty state, git will throw and we catch it below.
        }

        await git.checkout(branchName);
        return NextResponse.json({ message: `Switched to branch ${branchName}` });
      }

      // Run local checks (lint, typecheck, test)
      case 'run-checks': {
        const { exec } = await import('child_process');
        const util = await import('util');
        const execPromise = util.promisify(exec);
        const repoRoot = findRepoRoot(process.cwd());

        try {
          // Run in sequence to fail fast
          await execPromise('pnpm run typecheck', { cwd: repoRoot });
          await execPromise('pnpm run lint', { cwd: repoRoot });
          // Ensure tests run in CI mode (non-interactive)
          await execPromise('pnpm run test', { cwd: repoRoot, env: { ...process.env, CI: 'true' } });
          
          return NextResponse.json({ message: 'All checks passed (typecheck, lint, test)' });
        } catch (error: unknown) {
          console.error('Checks failed:', error);
          const execErr = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
          const stdout = execErr.stdout?.toString() || '';
          const stderr = execErr.stderr?.toString() || '';
          // Return a readable error summary
          return NextResponse.json({ 
            error: `Checks failed. \n${stderr || stdout || execErr.message || 'Unknown error'}`.slice(0, 500) // Truncate for UI
          }, { status: 400 });
        }
      }

      // 2. BETA (develop) ---------------------------------------------------
      case 'ship-to-beta': {
        const current = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
        const sourceBranch = String(payload.sourceBranch || payload.branch || current).trim() || current;
        const targets = payload.targets as DeployTargets | undefined;
        const targetLabel = formatTargets(targets);
        const github = getGithubConfig();

        // 1. Push source branch to remote first
        const pushSource = await pushOriginWithRetry({ branch: sourceBranch, upstream: false, maxAttempts: 2 });
        if (!pushSource.ok) {
          return NextResponse.json({ error: `Failed to push ${sourceBranch}: ${pushSource.error}` }, { status: 500 });
        }

        // 2. Push source branch code TO develop remotely (no local checkout)
        //    git push origin feature/x:develop --force-with-lease
        try {
          await git.raw(['push', 'origin', `${sourceBranch}:develop`, '--force-with-lease']);
        } catch (pushErr: unknown) {
          const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
          return NextResponse.json({ error: `Failed to push ${sourceBranch} to develop: ${msg}` }, { status: 500 });
        }

        // 3. Trigger workflow manually after push with selected targets.
        //    First try dedicated beta workflow; if missing remotely, fall back to unified release workflow.
        const workflowResult = await triggerWorkflowWithFallback(
          [
            {
              workflow: 'release-beta.yml',
              ref: 'develop',
              inputs: {
                ref: 'develop',
                deploy_cloud: Boolean(targets?.cloud ?? true),
                deploy_website: Boolean(targets?.website ?? true),
                build_desktop: Boolean(targets?.desktop ?? true),
                deploy_vm: Boolean(targets?.vm ?? false),
              },
            },
            {
              workflow: 'Beta Release (Develop)',
              ref: 'develop',
              inputs: {
                ref: 'develop',
                deploy_cloud: Boolean(targets?.cloud ?? true),
                deploy_website: Boolean(targets?.website ?? true),
                build_desktop: Boolean(targets?.desktop ?? true),
                deploy_vm: Boolean(targets?.vm ?? false),
              },
            },
            {
              workflow: 'release.yml',
              ref: 'develop',
              inputs: {
                environment: 'beta',
                ref: 'develop',
                deploy_cloud: Boolean(targets?.cloud ?? true),
                deploy_website: Boolean(targets?.website ?? true),
                build_desktop: Boolean(targets?.desktop ?? true),
                deploy_vm: Boolean(targets?.vm ?? false),
              },
            },
          ],
          github
        );

        if (!workflowResult.ok) {
          return NextResponse.json({ 
            error: `Pushed ${sourceBranch} to develop, but workflow trigger failed: ${workflowResult.error}. You may need to manually run the workflow.` 
          }, { status: 502 });
        }

        return NextResponse.json({ message: `Shipped ${sourceBranch} to Beta (develop) and triggered ${workflowResult.workflow} [${targetLabel}]` });
      }

      // Legacy preview action: just push current branch
      case 'deploy-preview': {
        const current = await git.revparse(['--abbrev-ref', 'HEAD']);
        await git.push('origin', current);
        return NextResponse.json({ message: `Pushed ${current} to trigger preview` });
      }

      // 3. STAGING (staging) ------------------------------------------------
      case 'ship-to-staging': {
        const targets = payload.targets as DeployTargets | undefined;
        const targetLabel = formatTargets(targets);
        const current = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
        const github = getGithubConfig();

        // Push current branch to remote (no branch switching)
        const pushResult = await pushOriginWithRetry({ branch: current, upstream: false, maxAttempts: 2 });
        if (!pushResult.ok) {
          return NextResponse.json({ error: `Failed to push ${current}: ${pushResult.error}` }, { status: 500 });
        }

        // Trigger workflow on 'staging' (where the YAML lives)
        const workflowResult = await triggerWorkflow(
          'release-staging.yml',
          'staging',
          {
            deploy_cloud: String(targets?.cloud ?? true),
            deploy_website: String(targets?.website ?? true),
            build_desktop: String(targets?.desktop ?? true),
            deploy_vm: String(targets?.vm ?? false),
          },
          github
        );

        if (!workflowResult.ok) {
          return NextResponse.json({ 
            error: `Pushed ${current}, but staging workflow trigger failed: ${workflowResult.error}` 
          }, { status: 502 });
        }

        return NextResponse.json({ message: `Shipped ${current} to Staging and triggered release [${targetLabel}]` });
      }

      // 4. PRODUCTION (main) -----------------------------------------------
      case 'ship-to-prod':
      case 'release-production': {
        const version = String(payload.version || '').trim();
        const targets = payload.targets as DeployTargets | undefined;
        const targetLabel = formatTargets(targets);
        const current = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
        const github = getGithubConfig();

        // Push current branch to remote (no branch switching)
        const pushResult = await pushOriginWithRetry({ branch: current, upstream: false, maxAttempts: 2 });
        if (!pushResult.ok) {
          return NextResponse.json({ error: `Failed to push ${current}: ${pushResult.error}` }, { status: 500 });
        }

        if (version) {
          await git.addTag(version);
          await git.pushTags('origin');
        }

        // Trigger workflow on 'main' (where the YAML lives)
        const workflowResult = await triggerWorkflow(
          'release-production.yml',
          'main',
          {
            deploy_cloud: String(targets?.cloud ?? true),
            deploy_website: String(targets?.website ?? true),
            build_desktop: String(targets?.desktop ?? true),
            deploy_vm: String(targets?.vm ?? false),
          },
          github
        );

        const baseMessage = version ? `Released ${version} to production` : 'Released to production';
        
        if (!workflowResult.ok) {
          return NextResponse.json({ 
            error: `${baseMessage}, but workflow trigger failed: ${workflowResult.error}` 
          }, { status: 502 });
        }

        return NextResponse.json({ message: `${baseMessage} and triggered release [${targetLabel}]` });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Git operation failed';

    if (typeof message === 'string' && message.includes('HTTP 408')) {
      return NextResponse.json(
        {
          error:
            `${message}\n\nHint: This is usually a network/proxy timeout pushing over HTTPS. ` +
            `Retry, or switch your origin remote to SSH (git@github.com:Ifesol-backup/Stuard-AI.git). ` +
            `If the push is very large, consider pushing smaller batches.`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
