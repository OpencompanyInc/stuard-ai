// Google Identity Services (GIS) loader + helpers for the client-side
// "Sign in with Google" ID-token flow. This lets us call
// supabase.auth.signInWithIdToken() instead of signInWithOAuth(), which keeps
// the whole exchange on our own domain — the browser never navigates through
// <project-ref>.supabase.co, so users only ever see Stuard's domain.

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const GSI_SCRIPT_ID = 'google-gsi-client';

export interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GoogleIdInitConfig {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  auto_select?: boolean;
  itp_support?: boolean;
  use_fedcm_for_button?: boolean;
  use_fedcm_for_prompt?: boolean;
  cancel_on_tap_outside?: boolean;
}

export interface GoogleButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: string;
  locale?: string;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdInitConfig) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
  prompt: () => void;
  cancel: () => void;
}

interface GoogleNamespace {
  accounts: { id: GoogleAccountsId };
}

declare global {
  interface Window {
    google?: GoogleNamespace;
  }
}

export function getGoogleClientId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  return id && id.trim() ? id.trim() : undefined;
}

let loadPromise: Promise<GoogleNamespace> | null = null;

/** Loads the GIS client script once and resolves with window.google. */
export function loadGoogleIdentity(): Promise<GoogleNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Identity Services is browser-only'));
  }
  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google);
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<GoogleNamespace>((resolve, reject) => {
    const finish = () => {
      if (window.google?.accounts?.id) resolve(window.google);
      else reject(new Error('Google Identity Services failed to initialize'));
    };
    const existing = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.google?.accounts?.id) {
        resolve(window.google);
      } else {
        existing.addEventListener('load', finish, { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')), { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.id = GSI_SCRIPT_ID;
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = finish;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('Failed to load Google Identity Services'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Random raw nonce, kept client-side and handed to Supabase. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

/**
 * SHA-256 hex of the raw nonce. Google embeds whatever nonce we pass into the
 * ID token verbatim, and Supabase hashes the nonce we give signInWithIdToken
 * before comparing — so Google gets the hash, Supabase gets the raw value.
 */
export async function hashNonce(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}
