export function getCloudAiHttp(): string {
  try {
    const raw =
      (window as any).__CLOUD_AI_HTTP__ ||
      (import.meta as any).env?.VITE_CLOUD_AI_URL ||
      (import.meta as any).env?.VITE_CLOUD_HTTP_URL ||
      (import.meta as any).env?.VITE_CLOUD_AI_HTTP ||
      (import.meta as any).env?.VITE_CLOUD_URL ||
      "http://127.0.0.1:8082";
    return String(raw || '').replace(/\/$/, '');
  } catch {
    return "http://127.0.0.1:8082";
  }
}

/**
 * Resolve the public website base for the environment this build targets.
 *
 * Derived from the cloud-ai API base so that sign-in and every integration
 * redirect always share one environment and can never diverge:
 *   prod build (api.stuard.ai)        → https://stuard.ai
 *   beta build (beta-api.stuard.ai)   → https://beta.stuard.ai
 *   staging   (staging-api.stuard.ai) → https://staging.stuard.ai
 *   dev       (127.0.0.1:8082)        → http://localhost:3000
 */
export function getWebsiteBase(): string {
  // Explicit build/embed override wins.
  try {
    const envUrl =
      (import.meta as any).env?.VITE_WEBSITE_URL ||
      (window as any).__WEBSITE_URL__;
    if (typeof envUrl === 'string' && envUrl.trim().startsWith('http')) {
      return envUrl.trim().replace(/\/+$/, '');
    }
  } catch { /* noop */ }

  try {
    const u = new URL(getCloudAiHttp());
    const host = u.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3000';
    // api.stuard.ai → stuard.ai ; beta-api.stuard.ai → beta.stuard.ai
    const webHost = host.replace(/^api\./, '').replace(/-api\./, '.');
    return `${u.protocol}//${webHost}`;
  } catch {
    return 'https://stuard.ai';
  }
}

/** Public website auth page that brokers Supabase sign-in for the desktop app. */
export function getAuthPageUrl(): string {
  return `${getWebsiteBase()}/auth`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED SPACES API
// ═══════════════════════════════════════════════════════════════════════════════

export interface SharedSpace {
  id: string;
  local_space_id: string;
  name_encrypted: string;
  description_encrypted?: string;
  type: string;
  icon: string;
  color: string;
  items_encrypted?: string;
  checksum: string;
  synced_at: string;
  created_at: string;
}

export interface SpaceShare {
  id: string;
  shared_with_email: string;
  permission: 'read' | 'write' | 'admin';
  accepted_at?: string;
  created_at: string;
  expires_at?: string;
  share_key_encrypted?: string;
  shared_spaces?: SharedSpace;
}

export interface SharedSpacesApi {
  // Sync a local space to cloud
  syncSpace(data: {
    local_space_id: string;
    name_encrypted: string;
    description_encrypted?: string;
    type: string;
    icon?: string;
    color?: string;
    items_encrypted?: string;
    checksum: string;
  }): Promise<{ ok: boolean; shared_space_id?: string; error?: string }>;
  
  // List my synced spaces
  listSyncedSpaces(): Promise<{ ok: boolean; spaces: SharedSpace[]; error?: string }>;
  
  // Get a synced space's full data
  getSpace(spaceId: string): Promise<{ ok: boolean; space?: SharedSpace; error?: string }>;
  
  // Delete a synced space
  deleteSpace(spaceId: string): Promise<{ ok: boolean; error?: string }>;
  
  // Share a space with an email
  shareSpace(spaceId: string, email: string, options?: {
    permission?: 'read' | 'write' | 'admin';
    share_key_encrypted?: string;
    expires_at?: string;
  }): Promise<{ ok: boolean; share?: SpaceShare; error?: string }>;
  
  // List shares for a space
  listShares(spaceId: string): Promise<{ ok: boolean; shares: SpaceShare[]; error?: string }>;
  
  // Revoke a share
  revokeShare(spaceId: string, shareId: string): Promise<{ ok: boolean; error?: string }>;
  
  // List spaces shared with me
  listSharedWithMe(): Promise<{ ok: boolean; shares: SpaceShare[]; error?: string }>;
  
  // Accept a share invitation
  acceptShare(shareId: string): Promise<{ ok: boolean; error?: string }>;
}

export function createSharedSpacesApi(getToken: () => string | null): SharedSpacesApi {
  const baseUrl = getCloudAiHttp();
  
  async function request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const token = getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    
    return response.json();
  }
  
  return {
    async syncSpace(data) {
      return request('POST', '/v1/shared-spaces/sync', data);
    },
    
    async listSyncedSpaces() {
      return request('GET', '/v1/shared-spaces');
    },
    
    async getSpace(spaceId) {
      return request('GET', `/v1/shared-spaces/${spaceId}`);
    },
    
    async deleteSpace(spaceId) {
      return request('DELETE', `/v1/shared-spaces/${spaceId}`);
    },
    
    async shareSpace(spaceId, email, options = {}) {
      return request('POST', `/v1/shared-spaces/${spaceId}/share`, {
        email,
        permission: options.permission || 'read',
        share_key_encrypted: options.share_key_encrypted,
        expires_at: options.expires_at,
      });
    },
    
    async listShares(spaceId) {
      return request('GET', `/v1/shared-spaces/${spaceId}/shares`);
    },
    
    async revokeShare(spaceId, shareId) {
      return request('DELETE', `/v1/shared-spaces/${spaceId}/shares/${shareId}`);
    },
    
    async listSharedWithMe() {
      return request('GET', '/v1/shared-spaces/shared-with-me');
    },
    
    async acceptShare(shareId) {
      return request('POST', `/v1/shared-spaces/accept/${shareId}`);
    },
  };
}

// Singleton instance - initialized when auth is available
let sharedSpacesApi: SharedSpacesApi | null = null;

export function getSharedSpacesApi(getToken: () => string | null): SharedSpacesApi {
  if (!sharedSpacesApi) {
    sharedSpacesApi = createSharedSpacesApi(getToken);
  }
  return sharedSpacesApi;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKETPLACE API
// ═══════════════════════════════════════════════════════════════════════════════

export interface MarketplaceCreatorProfile {
  id: string;
  handle: string;
  display_name: string;
  bio?: string | null;
  avatar_url?: string | null;
  hero_image_url?: string | null;
  website_url?: string | null;
  verified: boolean;
  follower_count: number;
  workflow_count: number;
  is_following?: boolean;
}

export interface MarketplaceWorkflowMedia {
  id?: string;
  media_type: 'image' | 'video';
  url: string;
  thumbnail_url?: string | null;
  alt_text?: string | null;
  sort_order?: number;
}

export interface MarketplaceWorkflow {
  id: string;
  slug: string;
  name: string;
  description: string;
  short_description?: string | null;
  version: string;
  spec?: any;
  category: string;
  tags: string[];
  icon: string | null;
  thumbnail_url?: string | null;
  cover_image_url?: string | null;
  rating_avg: number;
  rating_count: number;
  download_count: number;
  publisher_id?: string;
  publisher_name: string;
  created_at: string;
  published_at?: string;
  updated_at?: string;
  similarity?: number;
  status?: string;
  /** When true, downloaders cannot view code or modify the workflow */
  locked?: boolean;
  creator?: MarketplaceCreatorProfile;
  media?: MarketplaceWorkflowMedia[];
}

export interface MarketplaceCategory {
  id: string;
  name: string;
  description: string;
}

export interface MarketplaceVersion {
  id?: string;
  version: string;
  changelog?: string;
  created_at: string;
  current?: boolean;
}

export interface MarketplaceUpdate {
  slug: string;
  name: string;
  currentVersion: string;
  latestVersion: string;
  updatedAt: string;
}

export interface MarketplaceApi {
  publish(data: {
    name: string;
    description: string;
    shortDescription?: string;
    spec: any;
    category?: string;
    tags?: string[];
    icon?: string;
    thumbnailUrl?: string;
    coverImageUrl?: string;
    media?: MarketplaceWorkflowMedia[];
    publisherName?: string;
    creatorProfile?: Partial<MarketplaceCreatorProfile>;
    /** When true, downloaders cannot view code or modify the workflow */
    locked?: boolean;
  }): Promise<{ ok: boolean; workflow?: MarketplaceWorkflow; error?: string }>;

  update(slug: string, data: {
    name?: string;
    description?: string;
    shortDescription?: string;
    spec: any;
    category?: string;
    tags?: string[];
    icon?: string;
    thumbnailUrl?: string;
    coverImageUrl?: string;
    media?: MarketplaceWorkflowMedia[];
    creatorProfile?: Partial<MarketplaceCreatorProfile>;
    changelog?: string;
    version?: string;
    /** When true, downloaders cannot view code or modify the workflow */
    locked?: boolean;
  }): Promise<{ ok: boolean; workflow?: MarketplaceWorkflow; previousVersion?: string; error?: string }>;

  search(params: {
    query?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ ok: boolean; results: MarketplaceWorkflow[]; count: number; error?: string }>;

  getWorkflow(slug: string): Promise<{ ok: boolean; workflow?: MarketplaceWorkflow; error?: string }>;

  download(slug: string): Promise<{ ok: boolean; spec?: any; error?: string }>;

  rate(slug: string, rating: number, review?: string): Promise<{ ok: boolean; error?: string }>;

  getMyWorkflows(): Promise<{ ok: boolean; workflows: MarketplaceWorkflow[]; error?: string }>;

  deleteWorkflow(slug: string): Promise<{ ok: boolean; error?: string }>;

  getCategories(): Promise<{ ok: boolean; categories: MarketplaceCategory[]; error?: string }>;

  getFeatured(): Promise<{ ok: boolean; workflows: MarketplaceWorkflow[]; error?: string }>;

  getVersions(slug: string): Promise<{ ok: boolean; versions: MarketplaceVersion[]; error?: string }>;

  getCreator(handle: string): Promise<{ ok: boolean; creator?: MarketplaceCreatorProfile; workflows?: MarketplaceWorkflow[]; error?: string }>;

  followCreator(handle: string): Promise<{ ok: boolean; creator?: MarketplaceCreatorProfile; error?: string }>;

  unfollowCreator(handle: string): Promise<{ ok: boolean; creator?: MarketplaceCreatorProfile; error?: string }>;

  checkUpdates(workflows: Array<{ slug: string; version: string }>): Promise<{ ok: boolean; updates: MarketplaceUpdate[]; error?: string }>;
}

export function createMarketplaceApi(getToken: () => string | null): MarketplaceApi {
  const baseUrl = getCloudAiHttp();

  async function request<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    return response.json();
  }

  return {
    async publish(data) {
      return request('POST', '/v1/marketplace/publish', data);
    },

    async update(slug, data) {
      return request('PUT', `/v1/marketplace/workflow/${slug}`, data);
    },

    async search(params) {
      const searchParams = new URLSearchParams();
      if (params.query) searchParams.set('q', params.query);
      if (params.category) searchParams.set('category', params.category);
      if (params.limit) searchParams.set('limit', params.limit.toString());
      if (params.offset) searchParams.set('offset', params.offset.toString());
      
      return request('GET', `/v1/marketplace/search?${searchParams.toString()}`);
    },

    async getWorkflow(slug) {
      return request('GET', `/v1/marketplace/workflow/${slug}`);
    },

    async download(slug) {
      return request('POST', `/v1/marketplace/workflow/${slug}/download`);
    },

    async rate(slug, rating, review) {
      return request('POST', `/v1/marketplace/workflow/${slug}/rate`, { rating, review });
    },

    async getMyWorkflows() {
      return request('GET', '/v1/marketplace/my-workflows');
    },

    async deleteWorkflow(slug) {
      return request('DELETE', `/v1/marketplace/workflow/${slug}`);
    },

    async getCategories() {
      return request('GET', '/v1/marketplace/categories');
    },

    async getFeatured() {
      return request('GET', '/v1/marketplace/featured');
    },

    async getVersions(slug) {
      return request('GET', `/v1/marketplace/workflow/${slug}/versions`);
    },

    async getCreator(handle) {
      return request('GET', `/v1/marketplace/creator/${encodeURIComponent(handle)}`);
    },

    async followCreator(handle) {
      return request('POST', `/v1/marketplace/creator/${encodeURIComponent(handle)}/follow`);
    },

    async unfollowCreator(handle) {
      return request('DELETE', `/v1/marketplace/creator/${encodeURIComponent(handle)}/follow`);
    },

    async checkUpdates(workflows) {
      return request('POST', '/v1/marketplace/check-updates', { workflows });
    },
  };
}

// Note: We create a new instance each time since the token may change
// This is intentional - tokens are passed at request time via getToken()
export function getMarketplaceApi(getToken: () => string | null): MarketplaceApi {
  return createMarketplaceApi(getToken);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP (MODEL CONTEXT PROTOCOL) API
// ═══════════════════════════════════════════════════════════════════════════════

export interface MCPServerConfigBase {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MCPServerConfigStdio extends MCPServerConfigBase {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPServerConfigSSE extends MCPServerConfigBase {
  transport: 'sse';
  url: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export type MCPServerConfig = MCPServerConfigStdio | MCPServerConfigSSE;

export interface MCPServerInfo {
  id: string;
  name: string;
  description: string;
  provider: string;
  icon?: string;
  category: 'productivity' | 'development' | 'data' | 'communication' | 'other';
  defaultConfig?: Partial<MCPServerConfig>;
}

export interface MCPClientStatus {
  connected: boolean;
  serverCount: number;
  servers: string[];
  age: number;
}

export interface MCPApi {
  // Registry (public, no auth required)
  getRegistry(): Promise<{ success: boolean; servers: MCPServerInfo[]; error?: string }>;
  getServerInfo(id: string): Promise<{ success: boolean; server?: MCPServerInfo; error?: string }>;
  searchRegistry(query: string): Promise<{ success: boolean; servers: MCPServerInfo[]; error?: string }>;

  // User config (requires auth)
  getUserConfigs(): Promise<{ success: boolean; configs: MCPServerConfig[]; status: MCPClientStatus; error?: string }>;
  addServer(server: MCPServerConfig): Promise<{ success: boolean; error?: string }>;
  updateServer(serverId: string, updates: Partial<MCPServerConfig>): Promise<{ success: boolean; error?: string }>;
  removeServer(serverId: string): Promise<{ success: boolean; error?: string }>;
  toggleServer(serverId: string): Promise<{ success: boolean; error?: string }>;
  disconnect(): Promise<{ success: boolean; error?: string }>;
}

export function createMCPApi(getToken: () => string | null): MCPApi {
  const baseUrl = getCloudAiHttp();

  async function request<T>(
    method: string,
    path: string,
    body?: any,
    requireAuth = false
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const token = getToken();
    if (requireAuth) {
      if (!token) {
        throw new Error('Not authenticated');
      }
      headers['Authorization'] = `Bearer ${token}`;
    } else if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    return response.json();
  }

  return {
    // Registry (public)
    async getRegistry() {
      return request('GET', '/mcp/registry');
    },

    async getServerInfo(id) {
      return request('GET', `/mcp/registry/${id}`);
    },

    async searchRegistry(query) {
      return request('GET', `/mcp/search?q=${encodeURIComponent(query)}`);
    },

    // User config (requires auth)
    async getUserConfigs() {
      return request('GET', '/mcp/config', undefined, true);
    },

    async addServer(server) {
      return request('POST', '/mcp/config', { server }, true);
    },

    async updateServer(serverId, updates) {
      return request('PATCH', `/mcp/config/${serverId}`, { updates }, true);
    },

    async removeServer(serverId) {
      return request('DELETE', `/mcp/config/${serverId}`, undefined, true);
    },

    async toggleServer(serverId) {
      return request('POST', `/mcp/config/${serverId}/toggle`, undefined, true);
    },

    async disconnect() {
      return request('POST', '/mcp/config/disconnect', undefined, true);
    },
  };
}

export function getMCPApi(getToken: () => string | null): MCPApi {
  return createMCPApi(getToken);
}

