/**
 * Declared-dependency extraction for a workflow/function spec.
 *
 * When a workflow is installed from the marketplace (or deployed to a VM) we
 * want to provision its script dependencies up front — install the pip packages
 * its `python_install` / `run_python_script` nodes declare — instead of stalling
 * on the first run while the runtime lazily pip-installs them. This module is the
 * single, pure source of truth for "what does this spec need installed", shared
 * by the desktop installer UI and the VM deploy executor so they never drift.
 *
 * It is intentionally side-effect free: it reads the spec and returns the
 * declared deps; the caller decides how/where to install them.
 */

export interface WorkflowDependencies {
  python: { packages: string[]; requirementsTxt?: string };
  /** Forward-looking: there is no npm install path yet, so this is always empty. */
  node: { packages: string[] };
}

/** Node tools that declare Python dependencies. */
const PYTHON_DEP_TOOLS = new Set(['python_install', 'run_python_script']);

/** Strip the `local.` / `cloud.` surface prefix from a tool id. */
function normalizeToolName(raw: unknown): string {
  return String(raw || '').replace(/^(local|cloud)\./, '');
}

/** Coerce a node's `packages` arg (array or comma-separated string) into a clean list. */
function packagesFromArgs(args: any): string[] {
  if (!args || typeof args !== 'object') return [];
  let pkgs = (args as any).packages;
  if (typeof pkgs === 'string') pkgs = pkgs.split(',');
  if (!Array.isArray(pkgs)) return [];
  return pkgs.map((p) => String(p).trim()).filter(Boolean);
}

/**
 * Collect every declared dependency across a spec's nodes plus its top-level
 * `requirements` string. Packages are de-duplicated (preserving first-seen
 * order); multiple `requirementsTxt` blocks are concatenated.
 */
export function collectWorkflowDependencies(spec: any): WorkflowDependencies {
  const pyPackages = new Set<string>();
  const reqChunks: string[] = [];

  // Designer models carry a top-level requirements.txt string.
  if (typeof spec?.requirements === 'string' && spec.requirements.trim()) {
    reqChunks.push(spec.requirements.trim());
  }

  const nodes = Array.isArray(spec?.nodes) ? spec.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const tool = normalizeToolName((node as any).tool ?? (node as any).uses);
    if (!PYTHON_DEP_TOOLS.has(tool)) continue;
    const args = (node as any).args ?? (node as any).with ?? {};
    for (const p of packagesFromArgs(args)) pyPackages.add(p);
    const req = (args as any)?.requirementsTxt;
    if (typeof req === 'string' && req.trim()) reqChunks.push(req.trim());
  }

  const python: WorkflowDependencies['python'] = { packages: [...pyPackages] };
  if (reqChunks.length) python.requirementsTxt = reqChunks.join('\n');
  return { python, node: { packages: [] } };
}

/** True when a spec declares anything an installer would actually fetch. */
export function hasInstallableDependencies(deps: WorkflowDependencies | null | undefined): boolean {
  if (!deps) return false;
  return (
    deps.python.packages.length > 0 ||
    Boolean(deps.python.requirementsTxt && deps.python.requirementsTxt.trim()) ||
    deps.node.packages.length > 0
  );
}

/**
 * A short, human-readable label for what will be installed — e.g.
 * "pandas, numpy +2 more". Used by the install progress UI.
 */
export function summarizeDependencies(deps: WorkflowDependencies | null | undefined, max = 3): string {
  if (!deps) return '';
  const names = [...deps.python.packages, ...deps.node.packages];
  if (deps.python.requirementsTxt && names.length === 0) return 'requirements.txt';
  if (names.length === 0) return '';
  const shown = names.slice(0, max).join(', ');
  const extra = names.length - max;
  return extra > 0 ? `${shown} +${extra} more` : shown;
}
