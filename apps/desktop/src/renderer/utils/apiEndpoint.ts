/**
 * Dynamic API Endpoint Management
 * 
 * Manages the Cloud AI API endpoint based on the selected update channel.
 * When the user switches channels (stable/beta/staging), the API endpoint
 * also switches to match the corresponding backend.
 */

type UpdateChannel = 'stable' | 'beta' | 'staging';

// Fallback endpoints (used if main process doesn't provide one)
const CHANNEL_ENDPOINTS: Record<UpdateChannel, string> = {
  stable: 'https://api.stuard.ai',
  beta: 'https://beta-api.stuard.ai',
  staging: 'https://staging-api.stuard.ai',
};

// Current endpoint cache
let currentEndpoint = '';
let initialized = false;
const listeners: Set<(endpoint: string) => void> = new Set();

/**
 * Initialize the API endpoint management system.
 * Should be called once at app startup.
 */
export async function initApiEndpoint(): Promise<string> {
  if (initialized && currentEndpoint) {
    return currentEndpoint;
  }

  // Try to get from main process
  const api = (window as any).desktopAPI;
  if (api?.updatesGetApiEndpoint) {
    try {
      const result = await api.updatesGetApiEndpoint();
      if (result?.ok && result?.endpoint) {
        currentEndpoint = result.endpoint;
        initialized = true;
        return currentEndpoint;
      }
    } catch (e) {
      console.warn('[apiEndpoint] Failed to get from main:', e);
    }
  }

  // Fallback to build-time env or default
  const buildTimeEndpoint = (window as any).__CLOUD_AI_HTTP__;
  currentEndpoint = buildTimeEndpoint || CHANNEL_ENDPOINTS.stable;
  initialized = true;
  return currentEndpoint;
}

/**
 * Get the current API endpoint.
 * Returns immediately with cached value or fallback.
 */
export function getApiEndpoint(): string {
  if (currentEndpoint) {
    return currentEndpoint;
  }
  
  // Fallback to build-time value
  const buildTime = (window as any).__CLOUD_AI_HTTP__;
  return buildTime || CHANNEL_ENDPOINTS.stable;
}

/**
 * Subscribe to API endpoint changes.
 * Returns an unsubscribe function.
 */
export function onApiEndpointChange(callback: (endpoint: string) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Setup listener for main process endpoint changes.
 * Should be called once at app startup.
 */
export function setupApiEndpointListener(): () => void {
  const api = (window as any).desktopAPI;
  if (!api?.onApiEndpointChanged) {
    return () => {};
  }

  return api.onApiEndpointChanged((endpoint: string) => {
    console.log('[apiEndpoint] Endpoint changed:', endpoint);
    currentEndpoint = endpoint;
    
    // Notify all listeners
    listeners.forEach((cb) => {
      try {
        cb(endpoint);
      } catch (e) {
        console.error('[apiEndpoint] Listener error:', e);
      }
    });
  });
}

/**
 * Get endpoint for a specific channel (for preview/display purposes).
 */
export function getEndpointForChannel(channel: UpdateChannel): string {
  return CHANNEL_ENDPOINTS[channel] || CHANNEL_ENDPOINTS.stable;
}

// Initialize on module load (non-blocking)
if (typeof window !== 'undefined') {
  initApiEndpoint().catch(() => {});
}
