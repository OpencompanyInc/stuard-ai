import { NextRequest, NextResponse } from 'next/server';
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

const repoRoot = findRepoRoot(process.cwd());
const git = simpleGit(repoRoot);

// All apps in the monorepo whose package.json versions we manage
const MANAGED_APPS = [
  { key: 'desktop', name: 'Desktop', dir: 'apps/desktop' },
  { key: 'website', name: 'Website', dir: 'apps/website' },
  { key: 'cloud-ai', name: 'Cloud AI', dir: 'apps/cloud-ai' },
  { key: 'ops-console', name: 'Ops Console', dir: 'apps/ops-console' },
  { key: 'browser-extension', name: 'Browser Extension', dir: 'apps/browser-extension' },
];

function readPkgVersion(relDir: string): string | null {
  try {
    const p = path.join(repoRoot, relDir, 'package.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')).version || null;
  } catch { return null; }
}

function writePkgVersion(relDir: string, version: string) {
  const p = path.join(repoRoot, relDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

// ── GET: read all current versions + git tag history ──
export async function GET() {
  try {
    const apps = MANAGED_APPS.map(app => ({
      ...app,
      version: readPkgVersion(app.dir) || '0.0.0',
      path: `${app.dir}/package.json`,
    }));

    const rootVersion = readPkgVersion('.') || '0.0.0';
    const [tags, branch, status] = await Promise.all([
      git.tags(),
      git.branch(),
      git.status(),
    ]);

    let commitSha: string | null = null;
    try {
      commitSha = (await git.revparse(['HEAD'])).trim();
    } catch { /* ignore */ }

    // Build tag history with dates/messages from annotated tags
    const history: { tag: string; date: string | null; message: string | null; author: string | null }[] = [];
    const recentTags = tags.all.slice(-20).reverse();

    for (const tag of recentTags) {
      try {
        // Try to get annotated tag info
        const showRaw = await git.raw(['tag', '-l', tag, '--format=%(creatordate:iso)|||%(contents:subject)|||%(taggername)']);
        const parts = showRaw.trim().split('|||');
        history.push({
          tag,
          date: parts[0]?.trim() || null,
          message: parts[1]?.trim() || null,
          author: parts[2]?.trim() || null,
        });
      } catch {
        history.push({ tag, date: null, message: null, author: null });
      }
    }

    return NextResponse.json({
      apps,
      monorepo: { version: rootVersion, path: 'package.json' },
      git: {
        latestTag: tags.latest,
        allTags: recentTags,
        currentBranch: branch.current,
        isClean: status.isClean(),
        commitSha,
      },
      history,
    });
  } catch (error) {
    console.error('GET /api/ops/versions error:', error);
    return NextResponse.json({ error: 'Failed to read versions' }, { status: 500 });
  }
}

// ── POST: bump versions across selected apps, optionally commit + tag ──
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { version, apps: targetApps, autoCommit, autoTag } = body as {
      version: string;
      apps: string[];
      autoCommit?: boolean;
      autoTag?: boolean;
    };

    if (!version || !/^\d+\.\d+\.\d+/.test(version.replace(/^v/, ''))) {
      return NextResponse.json({ error: 'Invalid version format. Use semver (e.g. 1.2.3)' }, { status: 400 });
    }

    if (!targetApps || targetApps.length === 0) {
      return NextResponse.json({ error: 'No apps selected for version bump' }, { status: 400 });
    }

    const cleanVersion = version.replace(/^v/, '');
    const updatedApps: string[] = [];
    const changedFiles: string[] = [];

    // Update each selected app's package.json
    for (const appKey of targetApps) {
      const app = MANAGED_APPS.find(a => a.key === appKey);
      if (!app) continue;
      const pkgPath = path.join(repoRoot, app.dir, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;

      writePkgVersion(app.dir, cleanVersion);
      updatedApps.push(app.name);
      changedFiles.push(`${app.dir}/package.json`);
    }

    if (updatedApps.length === 0) {
      return NextResponse.json({ error: 'No valid apps found to update' }, { status: 400 });
    }

    const tagName = `v${cleanVersion}`;
    let committed = false;
    let tagged = false;

    // Auto-commit the version changes
    if (autoCommit) {
      await git.add(changedFiles);
      await git.commit(`chore: bump version to ${cleanVersion}\n\nUpdated: ${updatedApps.join(', ')}`);
      committed = true;
    }

    // Create git tag
    if (autoTag) {
      try {
        await git.addAnnotatedTag(tagName, `Release ${cleanVersion}`);
        tagged = true;
      } catch (e) {
        // Tag might already exist
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('already exists')) {
          return NextResponse.json({
            error: `Tag ${tagName} already exists. Use a different version or delete the tag first.`,
          }, { status: 409 });
        }
        throw e;
      }
    }

    // Build summary
    const parts: string[] = [`Updated ${updatedApps.join(', ')} to v${cleanVersion}`];
    if (committed) parts.push('committed');
    if (tagged) parts.push(`tagged ${tagName}`);

    return NextResponse.json({
      message: parts.join(' — '),
      version: cleanVersion,
      tag: tagged ? tagName : null,
      updatedApps,
      committed,
      tagged,
    });
  } catch (error) {
    console.error('POST /api/ops/versions error:', error);
    const message = error instanceof Error ? error.message : 'Version bump failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
