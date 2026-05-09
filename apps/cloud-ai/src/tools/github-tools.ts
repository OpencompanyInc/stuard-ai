import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getExternalAccessToken } from '../supabase';
import { getBridgeSecrets } from './bridge';
import { getResolvedBridgeSecrets } from './device/shared';
import { getVMOAuthAccessToken } from './vm-oauth';

const GH_API = 'https://api.github.com';

// Optional profile field for all GitHub tools. Omit to use the default profile.
const profileField = z.string().optional().describe(
  'OAuth profile label to use (e.g. "work", "personal"). Omit to use the default profile.'
);

function resolveProfile(explicit?: string): string | undefined {
  if (explicit) return explicit;
  try {
    const secrets = getBridgeSecrets() || getResolvedBridgeSecrets();
    return (secrets as any)?.githubProfile || (secrets as any)?.profile || undefined;
  } catch { return undefined; }
}

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

async function requireGithubToken(profileLabel?: string): Promise<string> {
  const secrets = getBridgeSecrets() || getResolvedBridgeSecrets();
  const userId = String((secrets as any)?.userId || '');
  if (!userId) throw new Error('missing_user_context');
  const profile = resolveProfile(profileLabel);
  const vmToken = await getVMOAuthAccessToken('github', profile, secrets as any);
  if (vmToken) return vmToken;
  const token = await getExternalAccessToken(userId, 'github', profile);
  if (!token) throw new Error('github_not_connected');
  return token;
}

export const github_get_me = createTool({
  id: 'github_get_me',
  description: 'Get the authenticated GitHub user profile.',
  inputSchema: z.object({ profile: profileField }),
  execute: async (inputData) => {
    const { profile } = inputData as any;
    const token = await requireGithubToken(profile);
    const me = await ghFetch('/user', token);
    return { me };
  },
});

export const github_list_repos = createTool({
  id: 'github_list_repos',
  description: 'List repositories for the authenticated user. visibility can be all, public, or private.',
  inputSchema: z.object({
    profile: profileField,
    visibility: z.enum(['all', 'public', 'private']).default('all'),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const token = await requireGithubToken(profile);
    const { visibility, per_page, page  } = inputData as any;
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
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    state: z.enum(['open', 'closed', 'all']).default('open'),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const token = await requireGithubToken(profile);
    const { owner, repo, state, per_page, page  } = inputData as any;
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
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
  }),
  execute: async (inputData, context) => {
    const { profile } = inputData as any;
    const token = await requireGithubToken(profile);
    const { owner, repo, title, body, labels, assignees  } = inputData as any;
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

// ─── Issue Comments ──────────────────────────────────────────────────────────

export const github_list_issue_comments = createTool({
  id: 'github_list_issue_comments',
  description: 'List comments on an issue or pull request.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    issue_number: z.number().int().min(1),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, issue_number, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue_number}/comments?${params}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_create_issue_comment = createTool({
  id: 'github_create_issue_comment',
  description: 'Add a comment to an issue or pull request.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    issue_number: z.number().int().min(1),
    body: z.string().min(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, issue_number, body } = inputData as any;
    const token = await requireGithubToken(profile);
    const comment = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue_number}/comments`, token, {
      method: 'POST',
      body: JSON.stringify({ body }),
      headers: { 'Content-Type': 'application/json' },
    });
    return { comment };
  },
});

export const github_update_issue = createTool({
  id: 'github_update_issue',
  description: 'Update an existing issue — change title, body, state, labels, or assignees.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    issue_number: z.number().int().min(1),
    title: z.string().optional(),
    body: z.string().optional(),
    state: z.enum(['open', 'closed']).optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, issue_number, title, body, state, labels, assignees } = inputData as any;
    const token = await requireGithubToken(profile);
    const payload: any = {};
    if (title !== undefined) payload.title = title;
    if (body !== undefined) payload.body = body;
    if (state) payload.state = state;
    if (Array.isArray(labels)) payload.labels = labels;
    if (Array.isArray(assignees)) payload.assignees = assignees;
    const issue = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue_number}`, token, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    return { issue };
  },
});

// ─── Pull Requests ───────────────────────────────────────────────────────────

export const github_list_pulls = createTool({
  id: 'github_list_pulls',
  description: 'List pull requests for a repository. Filter by state, head branch, or base branch.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    state: z.enum(['open', 'closed', 'all']).default('open'),
    head: z.string().optional().describe('Filter by head branch (user:branch or branch)'),
    base: z.string().optional().describe('Filter by base branch'),
    sort: z.enum(['created', 'updated', 'popularity', 'long-running']).default('created'),
    direction: z.enum(['asc', 'desc']).default('desc'),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, state, head, base, sort, direction, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    params.set('state', state || 'open');
    if (head) params.set('head', head);
    if (base) params.set('base', base);
    params.set('sort', sort || 'created');
    params.set('direction', direction || 'desc');
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${params}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_get_pull = createTool({
  id: 'github_get_pull',
  description: 'Get details of a specific pull request including diff stats, mergeable state, and review status.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    pull_number: z.number().int().min(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, pull_number } = inputData as any;
    const token = await requireGithubToken(profile);
    const pr = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}`, token);
    return { pr };
  },
});

export const github_create_pull = createTool({
  id: 'github_create_pull',
  description: 'Create a pull request. head is the branch with changes, base is the target branch (e.g. "main").',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    title: z.string().min(1),
    head: z.string().min(1).describe('Branch containing changes'),
    base: z.string().min(1).describe('Target branch to merge into (e.g. "main")'),
    body: z.string().optional(),
    draft: z.boolean().optional().describe('Create as draft PR (default: false)'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, title, head, base, body, draft } = inputData as any;
    const token = await requireGithubToken(profile);
    const payload: any = { title, head, base };
    if (typeof body === 'string' && body) payload.body = body;
    if (draft === true) payload.draft = true;
    const pr = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    return { pr };
  },
});

export const github_update_pull = createTool({
  id: 'github_update_pull',
  description: 'Update a pull request — change title, body, state, or base branch.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    pull_number: z.number().int().min(1),
    title: z.string().optional(),
    body: z.string().optional(),
    state: z.enum(['open', 'closed']).optional(),
    base: z.string().optional().describe('Change the target base branch'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, pull_number, title, body, state, base } = inputData as any;
    const token = await requireGithubToken(profile);
    const payload: any = {};
    if (title !== undefined) payload.title = title;
    if (body !== undefined) payload.body = body;
    if (state) payload.state = state;
    if (base) payload.base = base;
    const pr = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}`, token, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    return { pr };
  },
});

export const github_merge_pull = createTool({
  id: 'github_merge_pull',
  description: 'Merge a pull request. Choose merge method: merge commit, squash, or rebase.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    pull_number: z.number().int().min(1),
    merge_method: z.enum(['merge', 'squash', 'rebase']).default('merge'),
    commit_title: z.string().optional().describe('Custom merge commit title'),
    commit_message: z.string().optional().describe('Custom merge commit message'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, pull_number, merge_method, commit_title, commit_message } = inputData as any;
    const token = await requireGithubToken(profile);
    const payload: any = { merge_method: merge_method || 'merge' };
    if (commit_title) payload.commit_title = commit_title;
    if (commit_message) payload.commit_message = commit_message;
    const result = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}/merge`, token, {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    return { result };
  },
});

export const github_list_pull_commits = createTool({
  id: 'github_list_pull_commits',
  description: 'List commits on a pull request.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    pull_number: z.number().int().min(1),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, pull_number, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}/commits?${params}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_list_pull_files = createTool({
  id: 'github_list_pull_files',
  description: 'List files changed in a pull request with diff stats (additions, deletions, patch).',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    pull_number: z.number().int().min(1),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, pull_number, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}/files?${params}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_list_pull_reviews = createTool({
  id: 'github_list_pull_reviews',
  description: 'List reviews on a pull request (approved, changes requested, commented, etc.).',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    pull_number: z.number().int().min(1),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, pull_number, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}/reviews?${params}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_create_pull_review = createTool({
  id: 'github_create_pull_review',
  description: 'Submit a review on a pull request — approve, request changes, or comment.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    pull_number: z.number().int().min(1),
    event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).describe('Review action'),
    body: z.string().optional().describe('Review comment body (required for REQUEST_CHANGES)'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, pull_number, event, body } = inputData as any;
    const token = await requireGithubToken(profile);
    const payload: any = { event };
    if (typeof body === 'string' && body) payload.body = body;
    const review = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}/reviews`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    return { review };
  },
});

export const github_request_reviewers = createTool({
  id: 'github_request_reviewers',
  description: 'Request reviewers for a pull request by username or team slug.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    pull_number: z.number().int().min(1),
    reviewers: z.array(z.string()).optional().describe('GitHub usernames to request review from'),
    team_reviewers: z.array(z.string()).optional().describe('Team slugs to request review from'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, pull_number, reviewers, team_reviewers } = inputData as any;
    const token = await requireGithubToken(profile);
    const payload: any = {};
    if (Array.isArray(reviewers) && reviewers.length) payload.reviewers = reviewers;
    if (Array.isArray(team_reviewers) && team_reviewers.length) payload.team_reviewers = team_reviewers;
    const result = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}/requested_reviewers`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    return { result };
  },
});

// ─── Branches ────────────────────────────────────────────────────────────────

export const github_list_branches = createTool({
  id: 'github_list_branches',
  description: 'List branches for a repository.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    protected_only: z.boolean().optional().describe('Only list protected branches'),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, protected_only, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    if (protected_only) params.set('protected', 'true');
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?${params}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_get_branch = createTool({
  id: 'github_get_branch',
  description: 'Get details of a specific branch including its latest commit and protection status.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    branch: z.string().min(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, branch } = inputData as any;
    const token = await requireGithubToken(profile);
    const result = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`, token);
    return { branch: result };
  },
});

export const github_create_branch = createTool({
  id: 'github_create_branch',
  description: 'Create a new branch from a source branch or commit SHA. Creates a git ref under refs/heads/.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    branch: z.string().min(1).describe('Name for the new branch'),
    from_branch: z.string().optional().describe('Source branch name (default: repo default branch)'),
    from_sha: z.string().optional().describe('Source commit SHA (takes precedence over from_branch)'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, branch, from_branch, from_sha } = inputData as any;
    const token = await requireGithubToken(profile);
    let sha = from_sha;
    if (!sha) {
      const source = from_branch || (await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token)).default_branch;
      const ref = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(source)}`, token);
      sha = ref.object.sha;
    }
    const result = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, token, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
      headers: { 'Content-Type': 'application/json' },
    });
    return { ref: result };
  },
});

export const github_delete_branch = createTool({
  id: 'github_delete_branch',
  description: 'Delete a branch from a repository. Cannot delete the default or protected branches.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    branch: z.string().min(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, branch } = inputData as any;
    const token = await requireGithubToken(profile);
    await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
      method: 'DELETE',
    });
    return { deleted: true, branch };
  },
});

// ─── Commits ─────────────────────────────────────────────────────────────────

export const github_list_commits = createTool({
  id: 'github_list_commits',
  description: 'List commits on a branch or repository. Optionally filter by path, author, or date range.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    sha: z.string().optional().describe('Branch name or commit SHA to list from'),
    path: z.string().optional().describe('Only commits touching this file path'),
    author: z.string().optional().describe('GitHub username or email to filter by'),
    since: z.string().optional().describe('ISO 8601 date — only commits after this date'),
    until: z.string().optional().describe('ISO 8601 date — only commits before this date'),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, sha, path, author, since, until, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    if (sha) params.set('sha', sha);
    if (path) params.set('path', path);
    if (author) params.set('author', author);
    if (since) params.set('since', since);
    if (until) params.set('until', until);
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${params}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_get_commit = createTool({
  id: 'github_get_commit',
  description: 'Get details of a specific commit including files changed and diff stats.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    ref: z.string().min(1).describe('Commit SHA, branch name, or tag'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, ref } = inputData as any;
    const token = await requireGithubToken(profile);
    const commit = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`, token);
    return { commit };
  },
});

export const github_compare_commits = createTool({
  id: 'github_compare_commits',
  description: 'Compare two commits, branches, or tags. Returns diff stats and changed files.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    base: z.string().min(1).describe('Base branch/commit/tag'),
    head: z.string().min(1).describe('Head branch/commit/tag'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, base, head } = inputData as any;
    const token = await requireGithubToken(profile);
    const comparison = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, token);
    return { comparison };
  },
});

// ─── Repository ──────────────────────────────────────────────────────────────

export const github_get_repo = createTool({
  id: 'github_get_repo',
  description: 'Get detailed information about a repository including default branch, visibility, topics, and stats.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo } = inputData as any;
    const token = await requireGithubToken(profile);
    const repository = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);
    return { repository };
  },
});

export const github_get_file_content = createTool({
  id: 'github_get_file_content',
  description: 'Get the content of a file or directory listing from a repository. Returns base64-encoded content for files.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    path: z.string().min(1).describe('File or directory path in the repository'),
    ref: z.string().optional().describe('Branch, tag, or commit SHA (default: repo default branch)'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, path, ref } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const content = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${params}`, token);
    // Decode base64 content for single files
    if (content && content.type === 'file' && content.content && content.encoding === 'base64') {
      content.decoded_content = Buffer.from(content.content, 'base64').toString('utf-8');
      delete content.content; // Remove raw base64 to save tokens
    }
    return { content };
  },
});

export const github_search_code = createTool({
  id: 'github_search_code',
  description: 'Search for code across GitHub repositories. Use qualifiers like "repo:owner/name", "language:python", "path:src/".',
  inputSchema: z.object({
    profile: profileField,
    q: z.string().min(1).describe('Search query with optional qualifiers (e.g. "addClass repo:jquery/jquery language:js")'),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, q, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    params.set('q', q);
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const result = await ghFetch(`/search/code?${params}`, token);
    return { total_count: result.total_count, items: result.items, count: Array.isArray(result.items) ? result.items.length : 0 };
  },
});

export const github_search_repos = createTool({
  id: 'github_search_repos',
  description: 'Search for repositories on GitHub. Supports qualifiers like "language:typescript", "stars:>100", "topic:react".',
  inputSchema: z.object({
    profile: profileField,
    q: z.string().min(1).describe('Search query with optional qualifiers'),
    sort: z.enum(['stars', 'forks', 'help-wanted-issues', 'updated']).optional(),
    order: z.enum(['asc', 'desc']).default('desc'),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, q, sort, order, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    params.set('q', q);
    if (sort) params.set('sort', sort);
    params.set('order', order || 'desc');
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const result = await ghFetch(`/search/repositories?${params}`, token);
    return { total_count: result.total_count, items: result.items, count: Array.isArray(result.items) ? result.items.length : 0 };
  },
});

// ─── Releases & Tags ────────────────────────────────────────────────────────

export const github_list_releases = createTool({
  id: 'github_list_releases',
  description: 'List releases for a repository.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?${params}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_create_release = createTool({
  id: 'github_create_release',
  description: 'Create a release from a tag. Optionally generate release notes automatically.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    tag_name: z.string().min(1).describe('Tag to create the release from (created if it does not exist)'),
    name: z.string().optional().describe('Release title'),
    body: z.string().optional().describe('Release notes body (markdown)'),
    draft: z.boolean().optional().describe('Create as draft (default: false)'),
    prerelease: z.boolean().optional().describe('Mark as pre-release (default: false)'),
    target_commitish: z.string().optional().describe('Branch or commit SHA for the tag (default: default branch)'),
    generate_release_notes: z.boolean().optional().describe('Auto-generate release notes from commits (default: false)'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, tag_name, name, body, draft, prerelease, target_commitish, generate_release_notes } = inputData as any;
    const token = await requireGithubToken(profile);
    const payload: any = { tag_name };
    if (name) payload.name = name;
    if (typeof body === 'string') payload.body = body;
    if (draft === true) payload.draft = true;
    if (prerelease === true) payload.prerelease = true;
    if (target_commitish) payload.target_commitish = target_commitish;
    if (generate_release_notes === true) payload.generate_release_notes = true;
    const release = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    return { release };
  },
});

// ─── Labels ──────────────────────────────────────────────────────────────────

export const github_list_labels = createTool({
  id: 'github_list_labels',
  description: 'List labels available in a repository.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    per_page: z.number().int().min(1).max(100).default(100),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    params.set('per_page', String(per_page || 100));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels?${params}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

// ─── Workflows / Actions ────────────────────────────────────────────────────

export const github_list_workflow_runs = createTool({
  id: 'github_list_workflow_runs',
  description: 'List recent workflow runs (GitHub Actions) for a repository. Filter by branch, status, or event.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    branch: z.string().optional(),
    status: z.enum(['completed', 'action_required', 'cancelled', 'failure', 'neutral', 'skipped', 'stale', 'success', 'timed_out', 'in_progress', 'queued', 'requested', 'waiting', 'pending']).optional(),
    event: z.string().optional().describe('Event type (e.g. "push", "pull_request")'),
    per_page: z.number().int().min(1).max(100).default(10),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, branch, status, event, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    if (branch) params.set('branch', branch);
    if (status) params.set('status', status);
    if (event) params.set('event', event);
    params.set('per_page', String(per_page || 10));
    params.set('page', String(page || 1));
    const result = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?${params}`, token);
    return { total_count: result.total_count, items: result.workflow_runs, count: Array.isArray(result.workflow_runs) ? result.workflow_runs.length : 0 };
  },
});

export const github_get_workflow_run = createTool({
  id: 'github_get_workflow_run',
  description: 'Get details of a specific workflow run including status, conclusion, and timing.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    run_id: z.number().int().min(1),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, run_id } = inputData as any;
    const token = await requireGithubToken(profile);
    const run = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${run_id}`, token);
    return { run };
  },
});

export const github_rerun_workflow = createTool({
  id: 'github_rerun_workflow',
  description: 'Re-run a workflow run. Optionally re-run only failed jobs.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    run_id: z.number().int().min(1),
    failed_only: z.boolean().optional().describe('Only re-run failed jobs (default: false — re-runs all)'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, run_id, failed_only } = inputData as any;
    const token = await requireGithubToken(profile);
    const endpoint = failed_only
      ? `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${run_id}/rerun-failed-jobs`
      : `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${run_id}/rerun`;
    await ghFetch(endpoint, token, { method: 'POST' });
    return { rerun: true, run_id, failed_only: !!failed_only };
  },
});

export const github_dispatch_workflow = createTool({
  id: 'github_dispatch_workflow',
  description: 'Trigger a workflow_dispatch event to run a workflow. The workflow must have a workflow_dispatch trigger.',
  inputSchema: z.object({
    profile: profileField,
    owner: z.string().min(1),
    repo: z.string().min(1),
    workflow_id: z.union([z.string(), z.number()]).describe('Workflow file name (e.g. "deploy.yml") or numeric workflow ID'),
    ref: z.string().min(1).describe('Branch or tag to run the workflow on'),
    inputs: z.record(z.string(), z.string()).optional().describe('Input parameters for the workflow'),
  }),
  execute: async (inputData) => {
    const { profile, owner, repo, workflow_id, ref, inputs } = inputData as any;
    const token = await requireGithubToken(profile);
    const payload: any = { ref };
    if (inputs && Object.keys(inputs).length) payload.inputs = inputs;
    await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(String(workflow_id))}/dispatches`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    return { dispatched: true, workflow_id, ref };
  },
});

// ─── Gists ───────────────────────────────────────────────────────────────────

export const github_list_gists = createTool({
  id: 'github_list_gists',
  description: 'List gists for the authenticated user.',
  inputSchema: z.object({
    profile: profileField,
    per_page: z.number().int().min(1).max(100).default(30),
    page: z.number().int().min(1).default(1),
  }),
  execute: async (inputData) => {
    const { profile, per_page, page } = inputData as any;
    const token = await requireGithubToken(profile);
    const params = new URLSearchParams();
    params.set('per_page', String(per_page || 30));
    params.set('page', String(page || 1));
    const items = await ghFetch(`/gists?${params}`, token);
    return { items, count: Array.isArray(items) ? items.length : 0 };
  },
});

export const github_create_gist = createTool({
  id: 'github_create_gist',
  description: 'Create a gist with one or more files. Useful for sharing code snippets.',
  inputSchema: z.object({
    profile: profileField,
    description: z.string().optional(),
    public: z.boolean().default(false).describe('Whether the gist is public (default: false/secret)'),
    files: z.record(z.string(), z.object({
      content: z.string().min(1),
    })).describe('Files in the gist: { "filename.ext": { "content": "..." } }'),
  }),
  execute: async (inputData) => {
    const { profile, description, files } = inputData as any;
    const isPublic = (inputData as any).public;
    const token = await requireGithubToken(profile);
    const payload: any = { files, public: !!isPublic };
    if (description) payload.description = description;
    const gist = await ghFetch('/gists', token, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    return { gist };
  },
});
