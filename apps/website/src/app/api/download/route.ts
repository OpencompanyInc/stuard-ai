export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type GithubReleaseAsset = {
  id: number;
  name: string;
  browser_download_url: string;
  content_type?: string;
};

type GithubReleaseResponse = {
  assets?: GithubReleaseAsset[];
  tag_name?: string;
  name?: string;
  draft?: boolean;
  prerelease?: boolean;
};

function getEnv(name: string): string | undefined {
  return process.env[name] || process.env[`NEXT_PUBLIC_${name}`];
}

function getUserAgent(): string {
  return getEnv('GITHUB_USER_AGENT') || 'stuardai-website';
}

function resolveOwnerRepoFromEnv(): { owner?: string; repo?: string } {
  let owner = getEnv('GITHUB_OWNER');
  let repo = getEnv('GITHUB_REPO');

  if (!repo) return { owner, repo };

  const urlMatch = repo.match(/github\.com\/(?:repos\/)?([^\/#?\s]+)\/([^\/#?\s]+)/i);
  if (urlMatch) {
    const parsedOwner = urlMatch[1];
    const parsedRepo = urlMatch[2].replace(/\.git$/i, '');
    owner = owner || parsedOwner;
    repo = parsedRepo;
  } else if (repo.includes('/')) {
    const [maybeOwner, maybeRepo] = repo.split('/');
    if (maybeOwner && maybeRepo) {
      owner = owner || maybeOwner;
      repo = maybeRepo;
    }
  }

  return { owner, repo };
}

function resolveOwnerRepo(req?: Request): { owner?: string; repo?: string } {
  let { owner, repo } = resolveOwnerRepoFromEnv();
  if (!req) return { owner, repo };

  try {
    const url = new URL(req.url);
    const qOwner = url.searchParams.get('owner') || undefined;
    const qRepo = url.searchParams.get('repo') || undefined;

    if (qRepo) {
      const urlMatch = qRepo.match(/github\.com\/(?:repos\/)?([^\/#?\s]+)\/([^\/#?\s]+)/i);
      if (urlMatch) {
        const parsedOwner = urlMatch[1];
        const parsedRepo = urlMatch[2].replace(/\.git$/i, '');
        owner = qOwner || owner || parsedOwner;
        repo = parsedRepo;
      } else if (qRepo.includes('/')) {
        const [maybeOwner, maybeRepo] = qRepo.split('/');
        if (maybeOwner && maybeRepo) {
          owner = qOwner || owner || maybeOwner;
          repo = maybeRepo;
        }
      } else {
        repo = qRepo;
        owner = qOwner || owner;
      }
    } else if (qOwner) {
      owner = qOwner;
    }
  } catch {
    // ignore
  }
  return { owner, repo };
}

function pickWindowsExeAsset(assets: GithubReleaseAsset[]): GithubReleaseAsset | undefined {
  const exeWithKeywords = assets.find(
    a => /\.exe$/i.test(a.name) && /(setup|installer|windows|win|x64|amd64)/i.test(a.name)
  );
  if (exeWithKeywords) return exeWithKeywords;

  const anyExe = assets.find(a => /\.exe$/i.test(a.name));
  if (anyExe) return anyExe;

  const msi = assets.find(a => /\.msi$/i.test(a.name));
  return msi;
}

async function tryHtmlDownload(owner: string, repo: string): Promise<Response | undefined> {
  try {
    const pageRes = await fetch(`https://github.com/${owner}/${repo}/releases/latest`, {
      headers: { 'User-Agent': getUserAgent(), Accept: 'text/html' },
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!pageRes.ok) return undefined;
    const html = await pageRes.text();
    const pattern = new RegExp('href="(\\/[^"<>]+\\/releases\\/download\\/[^"<>]+\\.(?:exe|msi))"', 'i');
    const match = html.match(pattern);
    if (match && match[1]) {
      const downloadUrl = `https://github.com${match[1]}`;
      return Response.redirect(downloadUrl, 302);
    }
  } catch {}
  return undefined;
}

async function streamAssetWithToken(owner: string, repo: string, assetId: number, assetName: string, token: string): Promise<Response> {
  const dlRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`, {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': getUserAgent(),
    },
    redirect: 'follow',
    cache: 'no-store',
  });
  if (!dlRes.ok) {
    const body = await dlRes.text();
    return new Response(
      JSON.stringify({ error: 'Failed to download asset from GitHub', status: dlRes.status, body }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }
  const contentType = dlRes.headers.get('content-type') || 'application/octet-stream';
  const contentLength = dlRes.headers.get('content-length') || undefined;
  const headers: Record<string, string> = {
    'content-type': contentType,
    'content-disposition': `attachment; filename="${assetName}"`,
  };
  if (contentLength) headers['content-length'] = contentLength;
  return new Response(dlRes.body, { headers });
}

export async function GET(req: Request) {
  try {
    const { owner, repo } = resolveOwnerRepo(req);
    const token = process.env.GITHUB_TOKEN;

    if (!owner || !repo) {
      return new Response(
        JSON.stringify({ error: 'Missing configuration: set GITHUB_OWNER and GITHUB_REPO env vars, or pass ?owner=&repo=' }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }

    const ghUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const baseHeaders: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': getUserAgent(),
    };
    if (token) baseHeaders.Authorization = `Bearer ${token}`;

    const res = await fetch(ghUrl, { headers: baseHeaders, cache: 'no-store' });

    if (!res.ok && res.status === 404) {
      const listUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`;
      const listRes = await fetch(listUrl, { headers: baseHeaders, cache: 'no-store' });
      if (listRes.ok) {
        const releases = (await listRes.json()) as GithubReleaseResponse[];
        const preferred =
          releases.find(r => !r.draft && !r.prerelease && Array.isArray(r.assets) && r.assets.length > 0) ||
          releases.find(r => !r.draft && Array.isArray(r.assets) && r.assets.length > 0);

        if (preferred) {
          const asset = pickWindowsExeAsset(preferred.assets || []);
          if (asset) {
            if (token) {
              return await streamAssetWithToken(owner, repo, asset.id, asset.name, token);
            }
            return Response.redirect(asset.browser_download_url, 302);
          }
        }
      }

      const htmlResp = await tryHtmlDownload(owner, repo);
      if (htmlResp) return htmlResp;
    }

    if (!res.ok) {
      const body = await res.text();
      const htmlResp = await tryHtmlDownload(owner, repo);
      if (htmlResp) return htmlResp;
      return new Response(
        JSON.stringify({ error: 'Failed to fetch latest release from GitHub', status: res.status, body }),
        { status: 502, headers: { 'content-type': 'application/json' } }
      );
    }

    const data = (await res.json()) as GithubReleaseResponse;
    const assets = Array.isArray(data.assets) ? data.assets : [];
    if (assets.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No release assets found for latest release' }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      );
    }

    const asset = pickWindowsExeAsset(assets);
    if (!asset) {
      return new Response(
        JSON.stringify({ error: 'No Windows installer (.exe or .msi) asset found in latest release' }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      );
    }

    if (token) {
      return await streamAssetWithToken(owner, repo, asset.id, asset.name, token);
    }
    return Response.redirect(asset.browser_download_url, 302);
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Unexpected error resolving download', details: String(error) }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}