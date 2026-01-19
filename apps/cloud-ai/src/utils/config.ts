import 'dotenv/config';

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
