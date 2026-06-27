/**
 * Custom-integration manifest types.
 *
 * A manifest is the public contract for an integration package: identity,
 * auth schema, outbound-host allowlist, and the tools it exposes. The
 * implementation body (declarative HTTP / TypeScript / workflow) is
 * orthogonal to the manifest; for now we only ship the declarative body.
 *
 * Templating: string fields tagged "templated" below accept Mustache-style
 * {{secrets.<field>}} and {{args.<field>}} placeholders. Substitution
 * happens at request-bind time inside cloud-ai; placeholders MUST resolve
 * to declared secret fields or declared tool args — anything else is a
 * manifest error.
 */

/** What the user is asked for at connect time. */
export interface AuthField {
  /** Stable identifier used inside templates: {{secrets.<name>}} */
  name: string;
  /** Human-readable label for the connect form. */
  label: string;
  /** When true the value is masked in the UI and encrypted at rest. */
  secret: boolean;
  /** When true the connect form refuses to submit without this field. */
  required?: boolean;
  /** Placeholder shown in the connect form. */
  placeholder?: string;
  /** Optional help text. */
  hint?: string;
  /** Optional regex the value must match before the connect form will submit. */
  pattern?: string;
}

/**
 * Auth strategy. We expand this enum as new body kinds need it; for the
 * declarative path "apiKey" covers most SaaS APIs.
 */
export type AuthStrategy =
  /** Bearer token in Authorization header. */
  | { type: 'bearer'; tokenField: string; headerName?: string; scheme?: string }
  /** Key value injected into a header. */
  | { type: 'apiKey'; keyField: string; in: 'header'; headerName: string; prefix?: string }
  /** Key value injected as a query parameter. */
  | { type: 'apiKey'; keyField: string; in: 'query'; paramName: string }
  /** HTTP Basic auth. */
  | { type: 'basic'; userField: string; passField: string }
  /**
   * OAuth 2.0 authorization-code flow ("bring your own OAuth client").
   *
   * The user registers an app on the provider's developer console and supplies
   * its client_id / client_secret as ordinary auth.fields. Stuard runs the
   * consent redirect, the code-for-token exchange, and the refresh loop. The
   * live access token is injected exactly like a bearer token.
   *
   * The access/refresh tokens themselves are NOT user-entered fields — they're
   * written by the OAuth callback under the reserved secret keys below
   * (OAUTH_ACCESS_TOKEN_KEY etc.) and read by the executor at call time.
   */
  | {
      type: 'oauth2';
      /** Provider consent endpoint (browser redirect target). */
      authorizeUrl: string;
      /** Provider token endpoint (server-side code exchange + refresh). */
      tokenUrl: string;
      /** auth.fields name holding the user's OAuth client id. */
      clientIdField: string;
      /** auth.fields name holding the user's OAuth client secret. */
      clientSecretField: string;
      /** Scopes to request at consent. */
      scopes?: string[];
      /** Header the access token is injected into. Default Authorization. */
      headerName?: string;
      /** Auth scheme prefix. Default "Bearer". */
      scheme?: string;
      /** Extra static params appended to the authorize URL (e.g. access_type=offline, prompt=consent). */
      extraAuthParams?: Record<string, string>;
    }
  /** No auth — tool calls itself supply credentials or the API is public. */
  | { type: 'none' };

/**
 * Reserved secret keys that the OAuth callback / refresh loop manage for an
 * `oauth2` integration. These are never collected from the user — they hold
 * the live tokens and are merged into the integration's encrypted secret bag
 * server-side. The executor reads OAUTH_ACCESS_TOKEN_KEY to inject the bearer.
 */
export const OAUTH_ACCESS_TOKEN_KEY = 'oauth_access_token';
export const OAUTH_REFRESH_TOKEN_KEY = 'oauth_refresh_token';
/** Epoch-ms expiry of the access token, stored as a string. */
export const OAUTH_EXPIRES_AT_KEY = 'oauth_expires_at';
export const OAUTH_RUNTIME_KEYS: readonly string[] = [
  OAUTH_ACCESS_TOKEN_KEY,
  OAUTH_REFRESH_TOKEN_KEY,
  OAUTH_EXPIRES_AT_KEY,
];

/**
 * Body shape for declarative tools. JSON and form cover ~95% of REST APIs;
 * `text` is the escape hatch for APIs that demand raw payloads (XML, etc).
 */
export type RequestBody =
  | { kind: 'none' }
  | { kind: 'json'; value: any }           // value may contain {{args.*}} templates
  | { kind: 'form'; fields: Record<string, string> }  // application/x-www-form-urlencoded
  | { kind: 'text'; contentType: string; value: string };

/**
 * Pagination hint. The executor doesn't auto-paginate at v1 — it only
 * surfaces the next-cursor in the response so the caller (or a TS-body
 * tool wrapping the same endpoint) can iterate. Wired up later.
 */
export interface PaginationHint {
  style: 'cursor' | 'page' | 'offset' | 'link-header';
  /** For cursor/page/offset: JSON path on the response that holds the next pointer. */
  nextField?: string;
  /** For cursor/page/offset: query param the caller should set with that pointer. */
  nextParam?: string;
}

/**
 * A single tool the integration exposes. The agent sees one of these per
 * registered tool: id, description, args schema. Everything else is
 * implementation detail.
 */
export interface DeclarativeTool {
  /** Stable identifier used by the agent. Final tool id is `<slug>.<name>`. */
  name: string;
  /** Plain-English description shown to the model. */
  description: string;

  /**
   * Args schema as plain JSON Schema (draft-07 subset). Compiled to Zod
   * by the tool registrar at request time. Keep it small — the agent
   * reads the description, not the regex constraints.
   */
  args: ToolArgsSchema;

  /** HTTP request shape — every field below supports templating. */
  request: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
    /** Templated URL. {{args.x}} substitutes into path/query; {{secrets.x}} only allowed if the manifest's auth declares it. */
    urlTemplate: string;
    /** Extra headers. Templated. Auth headers are injected separately from `manifest.auth`. */
    headers?: Record<string, string>;
    /** Extra query params merged into the URL. Templated. */
    query?: Record<string, string>;
    /** Body. */
    body?: RequestBody;
  };

  /** How to interpret a non-2xx response. Default = ok:false with status + body. */
  errorMap?: {
    /** Map of HTTP status → friendly error message (also templated against the response body). */
    [status: number]: string;
  };

  /** Optional pagination hint for the caller. */
  pagination?: PaginationHint;
}

/** Minimal JSON-Schema subset we accept. */
export interface ToolArgsSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number)[];
  default?: any;
  /** For arrays: item schema. */
  items?: JsonSchemaProperty;
  /** For objects: nested property schema. */
  properties?: Record<string, JsonSchemaProperty>;
}

/**
 * The full integration package manifest. This is what gets published to
 * the marketplace and what the executor consumes at runtime.
 */
export interface IntegrationManifest {
  /** URL-friendly identifier. Globally unique in the marketplace. */
  slug: string;
  /** Display name. */
  name: string;
  /** One-line description for tiles and search. */
  description: string;
  /** Lucide icon id or emoji. */
  icon?: string;
  /** Free-form category (Payments, Email, DevOps, …). */
  category?: string;
  /** Semver. */
  version: string;
  /** Publisher handle (set by the marketplace on publish; optional for local packs). */
  publisher?: string;

  /** What the user is asked for at connect time. */
  auth: {
    strategy: AuthStrategy;
    fields: AuthField[];
  };

  /**
   * Outbound host allowlist. Every URL the executor emits must match at
   * least one entry. Supports glob `*.example.com` and exact `api.example.com`.
   * Localhost / RFC1918 are rejected regardless of what's listed here.
   */
  outbound_hosts: string[];

  /** The tools this pack exposes. */
  tools: DeclarativeTool[];

  /**
   * Optional cheap probe used by the "Test connection" button. If absent,
   * the connect form just saves the credentials without verifying.
   */
  ping?: {
    method: 'GET' | 'POST' | 'HEAD';
    urlTemplate: string;
    headers?: Record<string, string>;
  };
}

// ─── Runtime types ────────────────────────────────────────────────────────

/** What the executor receives at call time. */
export interface ExecutorContext {
  /** Decrypted secrets, keyed by AuthField.name. Memory-only, dropped after the call. */
  secrets: Record<string, string>;
  /** Args supplied by the agent or caller. */
  args: Record<string, any>;
  /** Optional request-id for audit logging / correlation. */
  requestId?: string;
}

/** Normalized result. The agent / caller never sees raw fetch internals. */
export interface ExecutorResult {
  ok: boolean;
  status: number;
  /** Parsed body when JSON; raw string for text; null for empty. */
  body: any;
  /** Subset of response headers exposed to callers (others stripped). */
  headers: Record<string, string>;
  /** Error message when ok:false. May come from errorMap or be a generic upstream error. */
  error?: string;
  /** Wall-clock duration. */
  elapsed_ms: number;
}
