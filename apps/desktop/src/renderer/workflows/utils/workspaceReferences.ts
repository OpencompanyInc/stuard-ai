/**
 * Auto-detect which workspace files a workflow actually references.
 *
 * Publishing/exporting a workspace workflow bundles its dependency files (see
 * workspaceBundle.ts). Bundling *every* file under the size caps risks leaking
 * personal media that merely happens to sit in the workspace folder
 * (`assets/vacation-photo.jpg`, `data/private-notes.txt`). This module scans the
 * spec — node args, inline scripts, `call_workspace_function` paths — and reports
 * which candidate files are referenced, so the publish UI can pre-select only
 * those and leave the rest unchecked (the creator can still opt them back in).
 *
 * Matching is deliberately inclusive (basename OR relative-path substring): a
 * file that *looks* referenced is bundled, an unreferenced personal file is not.
 * False positives keep a workflow working; false negatives would break it — so we
 * err toward inclusion while still excluding files nothing mentions.
 *
 * `.stuard` sub-workflows are resolved transitively: if the main flow references
 * `imported/sub.stuard`, that file's own script/asset references come along too.
 */

export interface ReferenceDetection {
  /** Relative paths (forward-slash) the spec references. */
  referenced: Set<string>;
  /** path → short human reason, e.g. "referenced by node n2" or "required by sub.stuard". */
  reasonByPath: Map<string, string>;
}

const STRIP_KEYS = new Set(['__workspaceBundle', '__install']);

/** Serialize a value to a searchable string, dropping bundle/manifest noise. */
function toSearchText(value: any): string {
  try {
    return JSON.stringify(value, (key, val) => (STRIP_KEYS.has(key) ? undefined : val)) || '';
  } catch {
    return '';
  }
}

function basenameOf(relPath: string): string {
  const norm = relPath.replace(/\\/g, '/');
  const slash = norm.lastIndexOf('/');
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

/**
 * Does `corpus` mention this file? Checks the forward-slash path, a backslash
 * variant (Windows-style string literals in code), and the bare basename.
 */
function corpusMentions(corpus: string, relPath: string): boolean {
  const fwd = relPath.replace(/\\/g, '/');
  if (corpus.includes(fwd)) return true;
  if (corpus.includes(fwd.replace(/\//g, '\\\\'))) return true; // escaped backslashes in JSON
  if (corpus.includes(fwd.replace(/\//g, '\\'))) return true;
  const base = basenameOf(fwd);
  // Basenames shorter than 3 chars (e.g. "a.b") are too noisy to trust.
  return base.length >= 3 && corpus.includes(base);
}

/** Find the first node whose args mention this file, for a precise reason string. */
function nodeReasonFor(spec: any, relPath: string): string | null {
  const nodes = Array.isArray(spec?.nodes) ? spec.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const argsText = toSearchText((node as any).args ?? (node as any).with ?? {});
    if (corpusMentions(argsText, relPath)) {
      return `referenced by node ${(node as any).id || (node as any).tool || 'step'}`;
    }
  }
  return null;
}

/**
 * Scan `candidatePaths` against the spec and return the referenced subset with
 * reasons. `readStuard` reads a `.stuard` file's raw text for transitive
 * resolution (pass the desktopAPI reader; omit to skip transitive closure).
 */
export async function detectReferencedFiles(
  spec: any,
  candidatePaths: string[],
  readStuard?: (relPath: string) => Promise<string | null>,
): Promise<ReferenceDetection> {
  const referenced = new Set<string>();
  const reasonByPath = new Map<string, string>();
  const candidates = candidatePaths.map((p) => p.replace(/\\/g, '/'));

  // Base corpus: the spec itself (nodes, scripts, variables, requirements).
  let corpus = toSearchText(spec);

  const claim = (relPath: string, reason: string) => {
    if (referenced.has(relPath)) return;
    referenced.add(relPath);
    reasonByPath.set(relPath, reason);
  };

  // First pass against the spec.
  for (const relPath of candidates) {
    if (corpusMentions(corpus, relPath)) {
      claim(relPath, nodeReasonFor(spec, relPath) || 'referenced in workflow');
    }
  }

  // Transitive closure: pull in files referenced by already-included .stuard
  // sub-workflows (and any .stuard those reference, in turn).
  if (readStuard) {
    const scanned = new Set<string>();
    let frontier = [...referenced].filter((p) => p.toLowerCase().endsWith('.stuard'));
    while (frontier.length) {
      const next: string[] = [];
      for (const stuardPath of frontier) {
        if (scanned.has(stuardPath)) continue;
        scanned.add(stuardPath);
        let content: string | null = null;
        try {
          content = await readStuard(stuardPath);
        } catch {
          content = null;
        }
        if (!content) continue;
        corpus += '\n' + content;
        const base = basenameOf(stuardPath);
        for (const relPath of candidates) {
          if (referenced.has(relPath)) continue;
          if (corpusMentions(content, relPath)) {
            claim(relPath, `required by ${base}`);
            if (relPath.toLowerCase().endsWith('.stuard')) next.push(relPath);
          }
        }
      }
      frontier = next;
    }
  }

  return { referenced, reasonByPath };
}
