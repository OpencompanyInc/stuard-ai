import 'dotenv/config';

// ─────────────────────────────────────────────────────────────────────────────
// Environment Detection
// ─────────────────────────────────────────────────────────────────────────────

export type Environment = 'development' | 'beta' | 'staging' | 'production';

function detectEnvironment(): Environment {
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  
  // Direct mapping
  if (nodeEnv === 'production' || nodeEnv === 'prod') return 'production';
  if (nodeEnv === 'staging') return 'staging';
  if (nodeEnv === 'beta') return 'beta';
  if (nodeEnv === 'development' || nodeEnv === 'dev') return 'development';
  
  // Infer from CLOUD_PUBLIC_URL
  const publicUrl = (process.env.CLOUD_PUBLIC_URL || '').toLowerCase();
  if (publicUrl.includes('beta-api') || publicUrl.includes('beta.')) return 'beta';
  if (publicUrl.includes('staging-api') || publicUrl.includes('staging.')) return 'staging';
  if (publicUrl.includes('api.stuard.ai')) return 'production';
  
  return 'development';
}

export const ENVIRONMENT = detectEnvironment();
export const IS_PRODUCTION = ENVIRONMENT === 'production';
export const IS_BETA = ENVIRONMENT === 'beta';
export const IS_STAGING = ENVIRONMENT === 'staging';
export const IS_DEVELOPMENT = ENVIRONMENT === 'development';

// ─────────────────────────────────────────────────────────────────────────────
// Core Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const ENABLE_LOCAL_MEMORY = process.env.ENABLE_LOCAL_MEMORY !== '0'; // Enabled by default
export const DEFAULT_EMBEDDER = process.env.MEMORY_EMBEDDER_MODEL || process.env.EMBEDDER_MODEL_ID || 'google/gemini-embedding-2-preview';

export const PORT = Number(process.env.PORT || process.env.CLOUD_AI_PORT || 8082);
export const ENABLE_ROUTING = process.env.ENABLE_ROUTING !== '0';
export const REQUIRE_AUTH = process.env.REQUIRE_AUTH === '1';
export const MAX_STEPS_CAP = Number(process.env.MASTRA_MAX_STEPS_CAP || 50);
export const DEFAULT_MAX_STEPS = Number(process.env.MASTRA_MAX_STEPS || process.env.MAX_STEPS || 25);

// Clean helpers to avoid CR/LF or trailing slashes from secrets/envs
const clean = (v: any) => String(v ?? '').trim();
const cleanUrlBase = (v: any) => clean(v).replace(/\/+$/, '');
const normalizeMetaRedirectPath = (value: string, callbackPath: string) => {
  const cleaned = clean(value || callbackPath) || callbackPath;
  if (cleaned === callbackPath) return callbackPath;
  if (/\/connect\/?$/i.test(cleaned)) return callbackPath;
  if (!cleaned.startsWith('/')) return callbackPath;
  return cleaned;
};

export const CLOUD_PUBLIC_URL = cleanUrlBase(process.env.CLOUD_PUBLIC_URL || '');
export const PREVIEW = process.env.PREVIEW === '1';
export const CLOUD_PREVIEW_PUBLIC_URL = cleanUrlBase(process.env.CLOUD_PREVIEW_PUBLIC_URL || '');
export const PUBLIC_BASE_URL = PREVIEW ? (CLOUD_PREVIEW_PUBLIC_URL || CLOUD_PUBLIC_URL) : CLOUD_PUBLIC_URL;
export const WEBSITE_BASE_URL = cleanUrlBase(process.env.WEBSITE_BASE_URL || 'https://stuard.ai');
export const GITHUB_CLIENT_ID = clean(process.env.GITHUB_CLIENT_ID || '');
export const GITHUB_CLIENT_SECRET = clean(process.env.GITHUB_CLIENT_SECRET || '');
export const GITHUB_REDIRECT_PATH = clean(process.env.GITHUB_REDIRECT_PATH || '/integrations/github/callback');
export const INTEGRATION_STATE_SECRET = clean(process.env.INTEGRATION_STATE_SECRET || process.env.SUPABASE_SECRET_KEY || 'dev-secret');

export const GOOGLE_CLIENT_ID = clean(process.env.GOOGLE_CLIENT_ID || '');
export const GOOGLE_CLIENT_SECRET = clean(process.env.GOOGLE_CLIENT_SECRET || '');
export const GOOGLE_REDIRECT_PATH = clean(process.env.GOOGLE_REDIRECT_PATH || '/integrations/google/callback');

export const MS_CLIENT_ID = clean(process.env.MS_CLIENT_ID || process.env.AZURE_CLIENT_ID || '');
export const MS_CLIENT_SECRET = clean(process.env.MS_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '');
export const MS_TENANT = clean(process.env.MS_TENANT || 'common');
export const MS_REDIRECT_PATH = clean(process.env.MS_REDIRECT_PATH || '/integrations/outlook/callback');

export const DISCORD_CLIENT_ID = clean(process.env.DISCORD_CLIENT_ID || '');
export const DISCORD_CLIENT_SECRET = clean(process.env.DISCORD_CLIENT_SECRET || '');
export const DISCORD_REDIRECT_PATH = clean(process.env.DISCORD_REDIRECT_PATH || '/integrations/discord/callback');
export const DISCORD_BOT_TOKEN = clean(process.env.DISCORD_BOT_TOKEN || '');
export const ELEVENLABS_API_KEY = clean(process.env.ELEVENLABS_API_KEY || '');

export const REDDIT_CLIENT_ID = clean(process.env.REDDIT_CLIENT_ID || '');
export const REDDIT_CLIENT_SECRET = clean(process.env.REDDIT_CLIENT_SECRET || '');
export const REDDIT_REDIRECT_PATH = clean(process.env.REDDIT_REDIRECT_PATH || '/integrations/reddit/callback');

// X (Twitter) OAuth 2.0 + PKCE. CLIENT_SECRET is optional (only used for confidential apps).
export const X_CLIENT_ID = clean(process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID || '');
export const X_CLIENT_SECRET = clean(process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET || '');
export const X_REDIRECT_PATH = clean(process.env.X_REDIRECT_PATH || '/integrations/x/callback');
// X pay-as-you-go USD per call. Tunable via env so prices can be updated without a deploy.
export const X_PRICE_USD_READ = Number(process.env.X_PRICE_USD_READ || '0.001');
export const X_PRICE_USD_POST = Number(process.env.X_PRICE_USD_POST || '0.10');
export const X_PRICE_USD_DM = Number(process.env.X_PRICE_USD_DM || '0.01');
export const X_PRICE_USD_USER = Number(process.env.X_PRICE_USD_USER || '0.001');

export const TELNYX_API_KEY = clean(process.env.TELNYX_API_KEY || '');
export const TELNYX_FROM_NUMBER = clean(process.env.TELNYX_FROM_NUMBER || '');
export const TELNYX_MESSAGING_PROFILE_ID = clean(process.env.TELNYX_MESSAGING_PROFILE_ID || '');
export const TELNYX_SIP_CONNECTION_ID = clean(process.env.TELNYX_SIP_CONNECTION_ID || '');

export const META_APP_ID = clean(process.env.META_APP_ID || process.env.INSTAGRAM_APP_ID || '');
export const META_APP_SECRET = clean(process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || '');
export const FACEBOOK_APP_ID = clean(process.env.FACEBOOK_APP_ID || META_APP_ID || '');
export const FACEBOOK_APP_SECRET = clean(process.env.FACEBOOK_APP_SECRET || META_APP_SECRET || '');
export const FACEBOOK_REDIRECT_PATH = normalizeMetaRedirectPath(process.env.FACEBOOK_REDIRECT_PATH || '', '/integrations/facebook/callback');
export const INSTAGRAM_APP_ID = clean(process.env.INSTAGRAM_APP_ID || META_APP_ID || '');
export const INSTAGRAM_APP_SECRET = clean(process.env.INSTAGRAM_APP_SECRET || META_APP_SECRET || '');
export const INSTAGRAM_REDIRECT_PATH = normalizeMetaRedirectPath(process.env.INSTAGRAM_REDIRECT_PATH || '', '/integrations/instagram/callback');
export const THREADS_APP_ID = clean(process.env.THREADS_APP_ID || META_APP_ID || '');
export const THREADS_APP_SECRET = clean(process.env.THREADS_APP_SECRET || META_APP_SECRET || '');
export const THREADS_REDIRECT_PATH = normalizeMetaRedirectPath(process.env.THREADS_REDIRECT_PATH || '', '/integrations/threads/callback');

export const WA_PHONE_NUMBER_ID = clean(process.env.WA_PHONE_NUMBER_ID || '');
export const WA_ACCESS_TOKEN = clean(process.env.WA_ACCESS_TOKEN || '');
export const WA_WEBHOOK_VERIFY_TOKEN = clean(process.env.WA_WEBHOOK_VERIFY_TOKEN || '');

export const PING_INTERVAL_MS = Number(clean(process.env.CLOUD_WS_PING_INTERVAL_MS || 30000));

export const LOG_DIR = clean(process.env.CLOUD_LOG_DIR || './logs');
export const LOG_BASENAME = clean(process.env.CLOUD_LOG_BASENAME || 'cloud-ai');

export const PERPLEXITY_API_KEY = clean(process.env.PERPLEXITY_API_KEY || '');
export const TAVILY_API_KEY = clean(process.env.TAVILY_API_KEY || '');

// Dev mode bypasses credit/usage checks for local development
export const DEV_MODE = process.env.DEV_MODE === '1' || process.env.NODE_ENV === 'development';

// LEGACY: env-based fallback when no DB profile exists.
// The real sync_accounts preference is read from the user's profile row in Supabase.
export const SYNC_ACCOUNTS_FALLBACK = process.env.SYNC_ACCOUNTS === '1';

// Master pepper for per-user envelope encryption of OAuth tokens in Supabase.
// Required for any external_accounts read/write. Set in cloud-ai's env/secret
// manager as a 64-character hex string (32 bytes). Rotation: bump
// CURRENT_KEY_VERSION in token-encryption.ts; old rows continue decrypting
// with their stored key_version.
export const TOKEN_ENCRYPTION_PEPPER = clean(process.env.TOKEN_ENCRYPTION_PEPPER || '');

// ─────────────────────────────────────────────────────────────────────────────
// Security Configuration
// ─────────────────────────────────────────────────────────────────────────────

// CORS allowed origins - comma-separated list, or '*' for development only
// Example: 'https://stuard.ai,https://app.stuard.ai,http://localhost:3000'
export const CORS_ALLOWED_ORIGINS = clean(process.env.CORS_ALLOWED_ORIGINS || (IS_DEVELOPMENT ? '*' : ''));

// Tools that can be executed without authentication (read-only, safe tools)
export const PUBLIC_TOOLS_ALLOWLIST = new Set(
  clean(process.env.PUBLIC_TOOLS_ALLOWLIST || 'list_tts_voices').split(',').map(s => s.trim()).filter(Boolean)
);

// Whether to require auth for all tool executions (default: true in production)
export const REQUIRE_TOOL_AUTH = process.env.REQUIRE_TOOL_AUTH !== '0' && IS_PRODUCTION;

// ─────────────────────────────────────────────────────────────────────────────
// Cloud Engine / GCP Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const GCP_PROJECT_ID = clean(process.env.GCP_PROJECT_ID || '');
export const GCP_ZONE = clean(process.env.GCP_ZONE || 'us-central1-a');
export const CLOUD_ENGINE_BUCKET = clean(process.env.CLOUD_ENGINE_BUCKET || 'stuard-user-data');
// Base URL for publicly-accessible storage objects.
// Set to a custom domain (e.g. "https://media.stuard.ai") backed by Cloud CDN / LB,
// or leave empty to default to "https://storage.googleapis.com/{bucket}".
export const STORAGE_PUBLIC_BASE_URL = clean(process.env.STORAGE_PUBLIC_BASE_URL || 'https://storage.stuard.ai');
export const COMPUTE_BILLING_INTERVAL_MS = Number(clean(process.env.COMPUTE_BILLING_INTERVAL_MS || 3600000));

// GCE VM configuration
export const GCP_VM_IMAGE = clean(process.env.GCP_VM_IMAGE || 'projects/debian-cloud/global/images/family/debian-12');
export const GCP_VM_SERVICE_ACCOUNT = clean(process.env.GCP_VM_SERVICE_ACCOUNT || ''); // empty = use default Compute SA
export const GCP_VM_NETWORK = clean(process.env.GCP_VM_NETWORK || 'global/networks/default');
export const GCP_VM_SUBNETWORK = clean(process.env.GCP_VM_SUBNETWORK || ''); // e.g. 'regions/us-central1/subnetworks/default'
export const GCP_VM_STARTUP_SCRIPT = clean(process.env.GCP_VM_STARTUP_SCRIPT || ''); // path or inline startup script

// Service account key file — set GOOGLE_APPLICATION_CREDENTIALS env var for GCE + GCS auth
// Alternatively deploy on GCE/Cloud Run with an attached service account (no key file needed)
export const GCP_KEY_FILE = clean(process.env.GOOGLE_APPLICATION_CREDENTIALS || '');

// ─────────────────────────────────────────────────────────────────────────────
// VM Agent & Health Monitoring Configuration
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: VM_TOKEN_SECRET is no longer used globally. Each VM now has its own
// unique HMAC secret stored in the cloud_engines.vm_secret column.
// The per-VM secret is generated at provisioning and looked up from the DB.
export const VM_HEALTH_CHECK_INTERVAL_MS = Number(clean(process.env.VM_HEALTH_CHECK_INTERVAL_MS || 300000)); // 5 min
export const VM_HEALTH_STALE_THRESHOLD_MS = Number(clean(process.env.VM_HEALTH_STALE_THRESHOLD_MS || 90000)); // 90s

