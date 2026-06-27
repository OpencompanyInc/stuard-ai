type TokenResponse = {
  token_type: string;
  scope?: string;
  expires_in: number;
  ext_expires_in?: number;
  access_token: string;
  refresh_token?: string;
  id_token?: string;
};

function getEnv(name: string): string {
  return process.env[name] || '';
}

export function buildAuthorizeUrl(codeChallenge: string, state: string): string {
  const clientId = getEnv('OUTLOOK_CLIENT_ID');
  const redirectUri = getEnv('OUTLOOK_REDIRECT_URI');
  const scopes = getEnv('OUTLOOK_SCOPES') || 'openid profile email offline_access User.Read Calendars.ReadWrite';

  const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return url.toString();
}

export async function exchangeCodeForToken(args: {
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const clientId = getEnv('OUTLOOK_CLIENT_ID');
  const clientSecret = getEnv('OUTLOOK_CLIENT_SECRET');
  const redirectUri = getEnv('OUTLOOK_REDIRECT_URI');

  if (!clientId || !redirectUri) {
    throw new Error('outlook_oauth_not_configured');
  }

  const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const body = new URLSearchParams();
  body.set('client_id', clientId);
  if (clientSecret) body.set('client_secret', clientSecret);
  body.set('grant_type', 'authorization_code');
  body.set('code', args.code);
  body.set('redirect_uri', redirectUri);
  body.set('code_verifier', args.codeVerifier);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token_exchange_failed:${res.status}:${text}`);
  }

  return (await res.json()) as TokenResponse;
}
