import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccessToken } from '../supabase';
import { getBridgeSecrets } from './bridge';

const GH_API = 'https://api.github.com';

async function ghFetch(path: string, token: string, init?: RequestInit) {
  const url = path.startsWith('http') ? path : `${GH_API}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'StuardAI-Cloud',
    ...(init?.headers as any),
  };
  const res = await fetch(url, { ...init, headers });
  let body: any = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (body && (body.message || body.error)) || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body;
}

async function requireGithubToken(): Promise<string> {
  const secrets = getBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  const token = await getExternalAccessToken(userId, 'github');
  if (!token) throw new Error('github_not_connected');
  return token;
}

export const github_get_me = createTool({
  id: 'github_get_me',
  description: 'Get the authenticated GitHub user profile.',
  inputSchema: z.object({}),
  execute: async () => {
    const token = await requireGithubToken();
    const me = await ghFetch('/user', token);
    return { me };
  },
});

export const github_list_repos = createTool({
  id: 'github_list_repos',
  description: 'List repositories for the authenticated user. visibility can be all, public, or private.',
  inputSchema: z.object({
    visibility: z.enum(['all', 'public', 'private']).default('all'),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async ({ context }) => {
    const token = await requireGithubToken();
    const { visibility, per_page, page } = context as any;
    const params = new URLSearchParams();
    params.set('visibility', visibility || 'all');
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/user/repos?${params.toString()}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_list_issues = createTool({
  id: 'github_list_issues',
  description: 'List issues for a repository. owner and repo are required.',
  inputSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    state: z.enum(['open', 'closed', 'all']).default('open'),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async ({ context }) => {
    const token = await requireGithubToken();
    const { owner, repo, state, per_page, page } = context as any;
    const params = new URLSearchParams();
    params.set('state', state || 'open');
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params.toString()}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_create_issue = createTool({
  id: 'github_create_issue',
  description: 'Create an issue in a repository. Requires repo scope.',
  inputSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    const token = await requireGithubToken();
    const { owner, repo, title, body, labels, assignees } = context as any;
    const payload: any = { title };
    if (typeof body === 'string' && body) payload.body = body;
    if (Array.isArray(labels) && labels.length) payload.labels = labels;
    if (Array.isArray(assignees) && assignees.length) payload.assignees = assignees;
    const issue = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    return { issue };
  },
});
