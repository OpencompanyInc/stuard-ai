# StuardAI-V2 Security and Type Safety Audit Report

## Executive Summary

This comprehensive security audit of the StuardAI-V2 codebase identifies vulnerabilities across all applications (Python agent, cloud-ai backend, desktop Electron app, ops-console, and website). The findings are categorized by severity and include recommendations for remediation.

---

## CRITICAL SEVERITY VULNERABILITIES

### 1. Unsafe Python `eval()` Usage in Loop Executor
**Location**: `apps/agent/app/tools/loops.py` (line 88)

**Description**: The loop executor uses Python's `eval()` to evaluate condition strings:
```python
is_met = bool(eval(condition, {"__builtins__": {}}, eval_scope))
```

**Impact**: Although `__builtins__` is disabled, this is still exploitable through attribute access chains. An attacker could craft conditions like:
```python
condition = "().__class__.__bases__[0].__subclasses__()[40]('/etc/passwd').read()"
```

**Exploitation Vector**: Any untrusted input reaching the `condition` parameter in loop operations can lead to arbitrary code execution.

**Remediation**:
- Replace `eval()` with AST-based safe evaluation using `ast.literal_eval()` or a dedicated safe expression evaluator library
- Implement a whitelist of allowed operations
- Consider using a DSL instead of raw Python expressions

---

### 2. Ops-Console API Lacks Authentication
**Location**: `apps/ops-console/src/app/api/actions/route.ts`

**Description**: The ops-console API endpoint allows unauthenticated access to critical git operations including:
- Stage all changes
- Create commits
- Create/switch branches
- Merge branches
- Push to origin
- Trigger production deployments
- Create version tags

**Impact**: Any network access to this endpoint allows complete repository manipulation and production deployment triggering without any authentication.

**Exploitation Vector**: Direct HTTP POST to `/api/actions` with appropriate payload types.

**Remediation**:
- Add authentication middleware (e.g., API key, session-based auth, or IP whitelist)
- Add authorization checks for destructive operations
- Add audit logging for all actions
- Consider requiring MFA for production deployments

---

## HIGH SEVERITY VULNERABILITIES

### 3. Command Injection via System Tools
**Location**: `apps/agent/app/tools/system.py` (lines 102-104, 185, 208)

**Description**: Multiple `subprocess` calls with `shell=True` execute user-provided commands:
```python
proc = subprocess.Popen(command, shell=shell, **popen_kwargs)  # nosec
subprocess.Popen(shlex.split(target), shell=True)  # nosec
completed = await asyncio.to_thread(subprocess.run, cmd, shell=True, ...)
```

**Impact**: While this is intended functionality for an AI assistant, the lack of sandboxing or command filtering allows arbitrary system command execution.

**Mitigation Status**: The `# nosec` comments indicate awareness, but no actual security controls exist.

**Remediation**:
- Implement command allowlisting
- Add user approval workflows for dangerous commands
- Consider containerization/sandboxing
- Add command logging and auditing

---

### 4. Overly Permissive CORS Configuration
**Location**: Multiple files in `apps/cloud-ai/src/`

**Description**: CORS is configured as `Access-Control-Allow-Origin: *` across all HTTP endpoints.

**Files Affected**:
- `server.ts` (lines 69-71)
- `routes/inference.ts`, `routes/tools.ts`, `routes/marketplace.ts`, `routes/calendar.ts`, etc.

**Impact**: Any website can make authenticated requests to the cloud-ai API if the user has a valid session token, enabling CSRF-like attacks.

**Remediation**:
- Restrict CORS to known application origins (e.g., `stuard.ai`, localhost for development)
- Implement a dynamic CORS whitelist from environment configuration
- Add CSRF token validation for state-changing operations

---

### 5. Missing Rate Limiting on API Endpoints
**Location**: All cloud-ai HTTP routes

**Description**: No rate limiting is implemented on any API endpoint, including:
- Authentication endpoints
- AI inference endpoints
- Tool execution endpoints
- Embedding generation endpoints

**Impact**:
- Denial of service attacks
- API cost amplification (AI model calls)
- Brute force attacks on authentication

**Remediation**:
- Implement rate limiting middleware
- Add per-user and per-IP rate limits
- Implement request quotas tied to user plans

---

### 6. Path Traversal in Desktop File Operations
**Location**: `apps/desktop/src/main/utils/files.ts` (line 19)

**Description**: The `listDirectory` function only replaces `~` with home directory but doesn't validate path traversal:
```typescript
const targetPath = dirPath ? dirPath.replace(/^~/, os.homedir()) : os.homedir();
const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
```

**Impact**: Arbitrary filesystem enumeration possible by passing paths like `../../../etc/`.

**Remediation**:
- Implement path canonicalization and validation
- Restrict access to user-approved directories
- Add allowlist for accessible paths

---

## MEDIUM SEVERITY VULNERABILITIES

### 7. XSS Risk in Workflow Overlay
**Location**: `apps/desktop/src/renderer/components/WorkflowOverlay/WorkflowOverlay.tsx` (line 452)

**Description**: Direct HTML injection via `dangerouslySetInnerHTML`:
```tsx
<div dangerouslySetInnerHTML={{ __html: content }} />
```

**Impact**: If `content` contains untrusted data, it enables XSS attacks within the Electron renderer.

**Remediation**:
- Sanitize HTML content with DOMPurify or similar library
- Use React's built-in escaping where possible
- Validate and sanitize all workflow content sources

---

### 8. Insufficient WebSocket Authentication
**Location**: `apps/cloud-ai/src/server.ts` (lines 219-220)

**Description**: The `REQUIRE_AUTH` flag defaults to checking only if the environment variable is exactly `'1'`:
```typescript
export const REQUIRE_AUTH = process.env.REQUIRE_AUTH === '1';
// Later:
if (REQUIRE_AUTH && !authUser) {
  send(ws, { type: 'error', message: 'unauthorized' }, requestId);
  return;
}
```

**Impact**: If `REQUIRE_AUTH` is not explicitly set to `1`, unauthenticated users can access all AI features and tools.

**Remediation**:
- Default `REQUIRE_AUTH` to `true` in production
- Add authentication as a non-optional requirement
- Log all unauthenticated access attempts

---

### 9. Secrets in Configuration Objects
**Location**: `apps/cloud-ai/src/utils/config.ts` (lines 21-24, 30-31)

**Description**: OAuth client secrets and integration secrets are exposed through configuration:
```typescript
export const GITHUB_CLIENT_SECRET = clean(process.env.GITHUB_CLIENT_SECRET || '');
export const GOOGLE_CLIENT_SECRET = clean(process.env.GOOGLE_CLIENT_SECRET || '');
export const MS_CLIENT_SECRET = clean(process.env.MS_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '');
export const INTEGRATION_STATE_SECRET = clean(process.env.INTEGRATION_STATE_SECRET || process.env.SUPABASE_SECRET_KEY || 'dev-secret');
```

**Impact**: If configuration is logged or exposed through error messages, secrets could leak.

**Remediation**:
- Ensure secrets are never logged
- Use a secure secrets manager
- Avoid exposing configuration in error responses

---

### 10. Weak Default for Integration State Secret
**Location**: `apps/cloud-ai/src/utils/config.ts` (line 24)

**Description**: Falls back to `'dev-secret'` if no secret is configured:
```typescript
export const INTEGRATION_STATE_SECRET = clean(process.env.INTEGRATION_STATE_SECRET || process.env.SUPABASE_SECRET_KEY || 'dev-secret');
```

**Impact**: OAuth state parameter signing uses a predictable secret in development, enabling state injection attacks.

**Remediation**:
- Remove default fallback
- Require explicit configuration
- Fail startup if secret is not configured in production

---

## LOW SEVERITY VULNERABILITIES

### 11. Excessive Error Information Disclosure
**Location**: Multiple files across the codebase

**Description**: Error messages often include full stack traces and internal details:
```python
logger.exception("conversation_create failed")
return {"ok": False, "error": str(e)}
```

**Impact**: Information leakage about internal implementation details.

**Remediation**:
- Return generic error messages to clients
- Log detailed errors server-side only

---

### 12. Missing HTTPS Enforcement
**Location**: `apps/cloud-ai/src/server.ts`

**Description**: The HTTP server is created without TLS configuration. While often handled at the infrastructure level, the code doesn't enforce HTTPS.

**Remediation**:
- Add HSTS headers
- Redirect HTTP to HTTPS at application level if needed
- Document infrastructure-level TLS requirements

---

## TYPE SAFETY ISSUES

### 13. Extensive `any` Type Usage
**Location**: Throughout TypeScript codebase (hundreds of instances)

**Files with Highest `any` Usage**:
- `apps/cloud-ai/src/server.ts` - 50+ instances
- `apps/desktop/src/renderer/hooks/useAgent.ts` - 30+ instances
- `apps/cloud-ai/src/routes/inference.ts` - 20+ instances

**Examples**:
```typescript
// server.ts
let msg: any;
const secretBag: any = { ...(secrets || {}) };
const stream: any = await agent.stream(inputMessages, {...});
for await (const chunk of fullStream as any) { }
```

**Impact**:
- Bypasses TypeScript's type checking
- Runtime type errors possible
- Reduced code maintainability

**Remediation**:
- Define proper interfaces for all data structures
- Use generic types where appropriate
- Replace `as any` casts with proper type guards

---

### 14. Missing Type Guards and Null Checks
**Location**: Multiple files

**Examples**:
```typescript
// useAgent.ts - line 306
const prompt = contentToText(lastUserMsg?.content);
// No null check before using prompt

// supabase.ts
const { data, error } = await supabaseService.from('profiles').select(...);
return { plan: String((data as any)?.plan || 'Free'), ... }; // Unsafe cast
```

**Remediation**:
- Add explicit null/undefined checks
- Use TypeScript strict mode features
- Implement type guard functions

---

### 15. Inconsistent Type Definitions
**Location**: API request/response handling

**Description**: Many API handlers use inline object types or `any`:
```typescript
// inference.ts
const body = await readJsonBody(req);
const ctx = body?.context || {};
const step = ctx.step || {};
```

**Remediation**:
- Create shared type definitions in a central types file
- Use Zod schema validation with type inference
- Generate TypeScript types from API schemas

---

## DEPENDENCY VULNERABILITIES

### 16. Potentially Outdated Dependencies

**Python Agent** (`requirements.txt`):
- `fastapi==0.115.2` - Verify no known vulnerabilities
- `pyautogui==0.9.54` - Check for security advisories

**Desktop App** (`package.json`):
- `ws: ^8.17.0` - Verify against CVE database
- `electron: ^30.0.0` - Check for latest security patches

**Recommendation**: Run `npm audit` and `pip-audit` to check for known vulnerabilities.

---

## ADDITIONAL SECURITY CONCERNS

### 17. Electron Security Best Practices

**Positive Findings**:
- `contextIsolation: true` is consistently used
- `nodeIntegration: false` is consistently used

**Areas for Improvement**:
- Consider enabling `sandbox: true`
- Review `webPreferences` for all BrowserWindow instances

---

### 18. Stripe Webhook Signature Verification
**Location**: `apps/website/src/app/api/webhook/route.ts`

**Positive Finding**: Webhook signature verification is properly implemented:
```typescript
event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
```

---

## REMEDIATION PRIORITY

### Immediate (Critical):
1. Replace `eval()` in loop executor with safe alternative
2. Add authentication to ops-console API

### Short-term (High):
3. Implement CORS restrictions
4. Add rate limiting
5. Implement path validation in file operations
6. Review and restrict shell command execution

### Medium-term (Medium):
7. Sanitize HTML in workflow overlay
8. Strengthen authentication defaults
9. Implement proper secrets management
10. Add error sanitization

### Long-term (Low/Quality):
11. Migrate from `any` types to proper TypeScript types
12. Implement comprehensive type guards
13. Create shared type definitions
14. Add dependency vulnerability scanning to CI/CD

---

## CONCLUSION

The StuardAI-V2 codebase has several critical security vulnerabilities that should be addressed immediately, particularly the use of `eval()` in the Python agent and the lack of authentication on the ops-console. The TypeScript codebase would benefit from stronger type safety practices to prevent runtime errors and improve maintainability.

The Electron app follows security best practices with context isolation and disabled node integration. The cloud-ai backend has proper authentication mechanisms but needs stricter CORS policies and rate limiting.
