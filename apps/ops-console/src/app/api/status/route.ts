import { NextResponse } from 'next/server';
import simpleGit from 'simple-git';
import { exec } from 'child_process';
import { promisify } from 'util';
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

const repoRoot = findRepoRoot(process.cwd());
const git = simpleGit(repoRoot);
const execAsync = promisify(exec);

// Configuration
const VERCEL_PROJECT = 'stuard';
const VERCEL_TEAM = 'ifesol1s-projects'; // Derived from your CLI output
const GCP_REGION = process.env.GCP_REGION || 'us-central1';

type UpdateChannel = 'stable' | 'beta' | 'staging';

interface UpdateChannelInfo {
  ok: boolean;
  url: string;
  version?: string | null;
  releaseDate?: string | null;
  error?: string;
}

function readPackageVersion(relativeDir: string): string | null {
  try {
    const pkgPath = path.join(repoRoot, relativeDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

async function fetchDesktopUpdate(channel: UpdateChannel): Promise<UpdateChannelInfo> {
  const url = `https://storage.googleapis.com/stuardai-updates/desktop/${channel}/latest.yml`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return { ok: false, url, error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    const version = text.match(/^version:\s*([^\s]+)/m)?.[1] || null;
    const releaseDate = text.match(/^releaseDate:\s*([^\n]+)/m)?.[1] || null;
    return { ok: true, url, version, releaseDate };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to fetch update manifest';
    return { ok: false, url, error };
  }
}

async function getCloudRunUrl(serviceName: string) {
  try {
    // Try to fetch via gcloud if available
    const { stdout } = await execAsync(`gcloud run services describe ${serviceName} --platform managed --region ${GCP_REGION} --format "value(status.url)"`);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function getLastDeployTime() {
  try {
    // Get last commit timestamp
    const log = await git.log({ maxCount: 1 });
    return log.latest?.date || null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const [status, branch, tags, lastDeploy, updates] = await Promise.all([
      git.status(),
      git.branch(),
      git.tags(),
      getLastDeployTime(),
      Promise.all([
        fetchDesktopUpdate('stable'),
        fetchDesktopUpdate('staging'),
        fetchDesktopUpdate('beta'),
      ]),
    ]);
    const [stableUpdate, stagingUpdate, betaUpdate] = updates;

    // Construct Dynamic Vercel URL
    // Format: https://{project}-git-{branch}-{team}.vercel.app
    // Note: Vercel sanitizes branch names (slashes -> dashes, limited chars)
    const sanitizedBranch = branch.current.replace(/[^a-zA-Z0-9-]/g, '-');
    const vercelPreviewUrl = `https://${VERCEL_PROJECT}-git-${sanitizedBranch}-${VERCEL_TEAM}.vercel.app`;
    
    // Real Production URLs
    const vercelProdUrl = 'https://stuard.ai';
    
    // Try to get Cloud Run URLs (this might fail if gcloud isn't auth'd, handled gracefully)
    // We assume 'stuard-cloud-ai-staging' and 'stuard-cloud-ai-prod' based on your workflows
    const cloudRunStagingUrl = await getCloudRunUrl('stuard-cloud-ai-staging');
    const cloudRunProdUrl = await getCloudRunUrl('stuard-cloud-ai-prod');

    return NextResponse.json({
      currentBranch: branch.current,
      branches: branch.all,
      isClean: status.isClean(),
      modified: status.modified,
      not_added: status.not_added,
      ahead: status.ahead,
      behind: status.behind,
      latestTag: tags.latest,
      allTags: tags.all.slice(-5).reverse(),
      lastDeployTime: lastDeploy,
      versions: {
        desktop: readPackageVersion('apps/desktop'),
        website: readPackageVersion('apps/website'),
        cloud: readPackageVersion('apps/cloud-ai'),
      },
      updates: {
        stable: stableUpdate,
        staging: stagingUpdate,
        beta: betaUpdate,
      },
      urls: {
        vercel: {
          preview: vercelPreviewUrl,
          production: vercelProdUrl
        },
        cloudRun: {
          staging: cloudRunStagingUrl || 'Pending deployment...',
          production: cloudRunProdUrl || 'Pending deployment...'
        }
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to fetch git status' }, { status: 500 });
  }
}
