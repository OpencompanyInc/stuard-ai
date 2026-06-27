import { z } from 'zod';
import { makeLocalTool } from './shared';

export const python_status = makeLocalTool(
  'python_status',
  'Get Python runtime availability and managed envs list',
  z.object({
    envId: z.string().optional().describe('Optional managed env ID to inspect. Defaults to the shared "default" env.'),
  }),
  z.any(),
);

export const python_setup = makeLocalTool(
  'python_setup',
  'Setup the managed Python runtime. Uses the shared default venv unless envId is provided.',
  z.object({
    envId: z.string().optional().describe('Optional managed env ID to create/use. Defaults to "default".'),
  }),
  z.any(),
);

export const python_list_packages = makeLocalTool(
  'python_list_packages',
  'List installed Python packages (name + version) in a managed venv. Uses the shared default venv unless envId is provided.',
  z.object({
    envId: z.string().optional().describe('Optional managed env ID. Defaults to the shared "default" env.'),
  }),
  z.object({
    ok: z.boolean().optional(),
    envId: z.string().optional(),
    ready: z.boolean().optional(),
    count: z.number().int().optional(),
    packages: z.array(z.object({ name: z.string(), version: z.string() })).optional(),
  }),
);

export const python_install = makeLocalTool(
  'python_install',
  'Install Python packages into a managed venv. Skips packages already installed that satisfy the requested version. Uses the shared default venv unless envId is provided.',
  z.object({
    envId: z.string().optional().describe('Optional managed env ID. Omit to install into the persistent default venv.'),
    packages: z.array(z.string()).optional(),
    requirementsTxt: z.string().optional(),
    offlineOnly: z.boolean().optional(),
    allowNetworkInstall: z.boolean().optional(),
    wheelhouse: z.string().optional(),
  }),
  z.object({
    ok: z.boolean().optional(),
    envId: z.string().optional(),
    envPath: z.string().optional(),
    python: z.string().optional(),
    packagesInstalled: z.array(z.string()).optional(),
    packagesSkipped: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  600000,
);

export const run_python_script = makeLocalTool(
  'run_python_script',
  'Run a Python script in a managed venv with automatic dependency management. Uses the shared default venv unless envId is provided. Specify packages to auto-install them before running. Use "code" for inline scripts or "path" for external files.',
  z.object({
    code: z.string().optional().describe('Inline Python code to execute'),
    path: z.string().optional().describe('Path to Python script file'),
    args: z.array(z.string()).optional().describe('Command-line arguments'),
    envId: z.string().optional().describe('Managed venv ID. Omit to use the persistent default venv; provide a name for an isolated env.'),
    packages: z
      .array(z.string())
      .optional()
      .describe('Packages to install (e.g., ["numpy", "pandas>=2.0", "sounddevice"])'),
    requirementsTxt: z.string().optional().describe('Requirements.txt content as string'),
    autoInstall: z.boolean().optional().default(true).describe('Auto-install missing packages (default: true)'),
    timeoutMs: z.number().int().min(100).max(600000).default(30000).describe('Script execution timeout'),
    cwd: z.string().optional().describe('Working directory'),
    checkpoint: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, create a filesystem checkpoint before execution for potential rollback.'),
    stream: z.boolean().optional().default(false).describe('Enable streaming output. Your script can call emit_chunk(data) to push chunks in real-time. Returns a streamId — connect a stream wire to consume. When this script is a stream consumer, use {{stream_chunk}} in code to access each incoming chunk.'),
  }),
  z.object({
    ok: z.boolean().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().int().optional(),
    python: z.string().optional(),
    envId: z.string().optional().describe('Environment ID used'),
    envPath: z.string().optional().describe('Managed venv path used'),
    packagesInstalled: z.array(z.string()).optional().describe('List of packages that were installed'),
    packagesSkipped: z.array(z.string()).optional().describe('Packages already installed and skipped'),
    streamId: z.string().optional().describe('Stream ID when stream=true'),
  }),
  (ctx) => {
    try {
      // Add extra time for package installation
      const packages = (ctx as any)?.packages;
      const hasPackages = Array.isArray(packages) && packages.length > 0;
      const ms = Number((ctx as any)?.timeoutMs);
      const baseTimeout = Number.isFinite(ms) && ms > 0 ? ms : 30000;
      // Add 60s per package for installation time, plus script timeout
      const installTime = hasPackages ? packages.length * 60000 : 0;
      return Math.min(baseTimeout + installTime + 30000, 600000);
    } catch {}
    return 300000;
  },
);

export const run_node_script = makeLocalTool(
  'run_node_script',
  'Run a Node.js/JavaScript script from inline code or file path',
  z.object({
    code: z.string().optional().describe('Inline JavaScript code to execute'),
    path: z.string().optional().describe('Path to JavaScript file'),
    args: z.array(z.string()).optional().describe('Command-line arguments'),
    timeoutMs: z.number().int().min(100).max(600000).default(30000),
    cwd: z.string().optional().describe('Working directory'),
    checkpoint: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, create a filesystem checkpoint before execution for potential rollback.'),
  }),
  z.object({ ok: z.boolean().optional(), stdout: z.string().optional(), stderr: z.string().optional(), exitCode: z.number().int().optional() }),
  (ctx) => {
    try {
      const ms = Number((ctx as any)?.timeoutMs);
      if (Number.isFinite(ms) && ms > 0) {
        return Math.min(ms + 15000, 600000);
      }
    } catch {}
    return 300000;
  },
);
