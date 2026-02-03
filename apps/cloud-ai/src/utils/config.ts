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
export const DEFAULT_EMBEDDER = process.env.MEMORY_EMBEDDER_MODEL || process.env.EMBEDDER_MODEL_ID || 'openai/text-embedding-3-large';

export const PORT = Number(process.env.PORT || process.env.CLOUD_AI_PORT || 8082);
export const ENABLE_ROUTING = process.env.ENABLE_ROUTING !== '0';
export const REQUIRE_AUTH = process.env.REQUIRE_AUTH === '1';
export const MAX_STEPS_CAP = Number(process.env.MASTRA_MAX_STEPS_CAP || 50);
export const DEFAULT_MAX_STEPS = Number(process.env.MASTRA_MAX_STEPS || process.env.MAX_STEPS || 25);

// Clean helpers to avoid CR/LF or trailing slashes from secrets/envs
const clean = (v: any) => String(v ?? '').trim();
const cleanUrlBase = (v: any) => clean(v).replace(/\/+$/, '');

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

export const PING_INTERVAL_MS = Number(clean(process.env.CLOUD_WS_PING_INTERVAL_MS || 30000));

export const LOG_DIR = clean(process.env.CLOUD_LOG_DIR || './logs');
export const LOG_BASENAME = clean(process.env.CLOUD_LOG_BASENAME || 'cloud-ai');

export const PERPLEXITY_API_KEY = clean(process.env.PERPLEXITY_API_KEY || '');
export const TAVILY_API_KEY = clean(process.env.TAVILY_API_KEY || '');

// Dev mode bypasses credit/usage checks for local development
export const DEV_MODE = process.env.DEV_MODE === '1' || process.env.NODE_ENV === 'development';

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
