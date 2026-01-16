import { z } from 'zod';
import { makeLocalTool } from './shared';

export const python_status = makeLocalTool(
  'python_status',
  'Get Python runtime availability and managed envs list',
  z.object({}),
  z.any(),
);

export const python_setup = makeLocalTool(
  'python_setup',
  'Setup Python runtime (no-op if already available)',
  z.object({}),
  z.any(),
);

export const python_install = makeLocalTool(
  'python_install',
  'Install Python packages into a managed env (offline wheelhouse supported).',
  z.object({
    envId: z.string(),
    packages: z.array(z.string()).optional(),
    requirementsTxt: z.string().optional(),
    offlineOnly: z.boolean().optional(),
    allowNetworkInstall: z.boolean().optional(),
    wheelhouse: z.string().optional(),
  }),
  z.any(),
  600000,
);

export const run_python_script = makeLocalTool(
  'run_python_script',
  'Run a Python script with automatic dependency management. Specify packages to auto-install them before running. Use "code" for inline scripts or "path" for external files.',
  z.object({
    code: z.string().optional().describe('Inline Python code to execute'),
    path: z.string().optional().describe('Path to Python script file'),
    args: z.array(z.string()).optional().describe('Command-line arguments'),
    envId: z.string().optional().describe('Virtual environment ID (auto-generated if packages specified without envId)'),
    packages: z
      .array(z.string())
      .optional()
      .describe('Packages to install (e.g., ["numpy", "pandas>=2.0", "sounddevice"])'),
    requirementsTxt: z.string().optional().describe('Requirements.txt content as string'),
    autoInstall: z.boolean().optional().default(true).describe('Auto-install missing packages (default: true)'),
    timeoutMs: z.number().int().min(100).max(600000).default(30000).describe('Script execution timeout'),
    cwd: z.string().optional().describe('Working directory'),
  }),
  z.object({
    ok: z.boolean().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().int().optional(),
    python: z.string().optional(),
    envId: z.string().optional().describe('Environment ID used'),
    packagesInstalled: z.array(z.string()).optional().describe('List of packages that were installed'),
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
