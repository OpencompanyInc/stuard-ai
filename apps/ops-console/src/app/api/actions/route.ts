import { NextResponse } from 'next/server';
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

function getGithubConfig() {
  return {
    token: process.env.GITHUB_TOKEN || process.env.OPS_GITHUB_TOKEN || null,
    repo: process.env.GITHUB_REPO || process.env.OPS_GITHUB_REPO || 'Ifesol-backup/Stuard-AI',
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
    const res = await fetch(
      `https://api.github.com/repos/${config.repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref, inputs }),
      }
    );

    if (res.status === 204) {
      return { ok: true, message: `Triggered ${workflow} on ${ref}` };
    }
    
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.message || `GitHub API returned ${res.status}` };
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message || 'Failed to call GitHub API' };
  }
}

function formatTargets(targets?: { website?: boolean; cloud?: boolean; desktop?: boolean }) {
  if (!targets) return 'all targets';
  const enabled: string[] = [];
  if (targets.website) enabled.push('website');
  if (targets.cloud) enabled.push('cloud');
  if (targets.desktop) enabled.push('desktop');
  if (!enabled.length) return 'no targets selected';
  return enabled.join(', ');
}

const git = simpleGit(findRepoRoot(process.cwd()));

function isDevMode() {
  return process.env.NODE_ENV !== 'production';
}

export async function POST(req: Request) {
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
        await git.push(['-u', 'origin', branchName]);
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
        await git.push('origin', current);
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
        await git.push(['-u', 'origin', branchName]);
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
        await git.push('origin', current);
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
        const current = await git.revparse(['--abbrev-ref', 'HEAD']);
        const sourceBranch = String(payload.sourceBranch || payload.branch || current).trim() || current;
        const targets = payload.targets as { website?: boolean; cloud?: boolean; desktop?: boolean } | undefined;
        const targetLabel = formatTargets(targets);
        const github = getGithubConfig();

        // Merge source branch into develop
        await git.checkout('develop');
        await git.pull('origin', 'develop');
        await git.merge([sourceBranch, '--allow-unrelated-histories']);
        await git.push('origin', 'develop');
        await git.checkout(sourceBranch);

        // Trigger GitHub Actions workflow with selected targets
        const workflowResult = await triggerWorkflow(
          'release-beta.yml',
          'develop',
          {
            ref: 'develop',
            deploy_cloud: String(targets?.cloud ?? true),
            deploy_website: String(targets?.website ?? true),
            build_desktop: String(targets?.desktop ?? true),
          },
          github
        );

        if (!workflowResult.ok) {
          return NextResponse.json({ 
            message: `Merged ${sourceBranch} into develop, but workflow trigger failed: ${workflowResult.error}. You may need to manually run the workflow.` 
          });
        }

        return NextResponse.json({ message: `Merged ${sourceBranch} into develop (Beta) and triggered CI [${targetLabel}]` });
      }

      // Legacy preview action: just push current branch
      case 'deploy-preview': {
        const current = await git.revparse(['--abbrev-ref', 'HEAD']);
        await git.push('origin', current);
        return NextResponse.json({ message: `Pushed ${current} to trigger preview` });
      }

      // 3. STAGING (staging) ------------------------------------------------
      case 'ship-to-staging': {
        const targets = payload.targets as { website?: boolean; cloud?: boolean; desktop?: boolean } | undefined;
        const targetLabel = formatTargets(targets);
        const previous = await git.revparse(['--abbrev-ref', 'HEAD']);
        const github = getGithubConfig();

        await git.checkout('staging');
        await git.pull('origin', 'staging');
        await git.merge(['develop', '--allow-unrelated-histories']);
        await git.push('origin', 'staging');

        try {
          await git.checkout(previous);
        } catch {
          // ignore
        }

        // Trigger GitHub Actions workflow with selected targets
        const workflowResult = await triggerWorkflow(
          'release-staging.yml',
          'staging',
          {
            deploy_cloud: String(targets?.cloud ?? true),
            deploy_website: String(targets?.website ?? true),
          },
          github
        );

        if (!workflowResult.ok) {
          return NextResponse.json({ 
            message: `Merged develop into staging, but workflow trigger failed: ${workflowResult.error}` 
          });
        }

        return NextResponse.json({ message: `Merged develop into staging (Release Candidate) and triggered CI [${targetLabel}]` });
      }

      // 4. PRODUCTION (main) -----------------------------------------------
      case 'ship-to-prod':
      case 'release-production': {
        const version = String(payload.version || '').trim();
        const targets = payload.targets as { website?: boolean; cloud?: boolean; desktop?: boolean } | undefined;
        const targetLabel = formatTargets(targets);
        const previous = await git.revparse(['--abbrev-ref', 'HEAD']);
        const github = getGithubConfig();

        await git.checkout('main');
        await git.pull('origin', 'main');
        await git.merge(['staging', '--allow-unrelated-histories']);
        await git.push('origin', 'main');

        if (version) {
          await git.addTag(version);
          await git.pushTags('origin');
        }

        try {
          await git.checkout(previous);
        } catch {
          // ignore
        }

        // Trigger GitHub Actions workflow with selected targets
        const workflowResult = await triggerWorkflow(
          'release-production.yml',
          'main',
          {
            deploy_cloud: String(targets?.cloud ?? true),
            deploy_website: String(targets?.website ?? true),
            build_desktop: String(targets?.desktop ?? true),
          },
          github
        );

        const baseMessage = version ? `Released ${version} to production (main)` : 'Released to production (main)';
        
        if (!workflowResult.ok) {
          return NextResponse.json({ 
            message: `${baseMessage}, but workflow trigger failed: ${workflowResult.error}` 
          });
        }

        return NextResponse.json({ message: `${baseMessage} and triggered CI [${targetLabel}]` });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Git operation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

