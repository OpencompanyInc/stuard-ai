/**
 * Curated UI Package Registry
 *
 * These packages ship as production dependencies of the desktop app, so they
 * can be bundled into a custom_ui package set fully offline (no npm/network
 * needed). Anything NOT in this list can still be installed when `allowNpm` is
 * enabled and npm is available on the host — it just isn't guaranteed offline.
 *
 * React / ReactDOM / Framer Motion are intentionally NOT installable packages:
 * they are already exposed as runtime globals (React, ReactDOM, motion,
 * AnimatePresence) and imports for them are rewritten to those globals.
 */

export interface CuratedPackage {
  /** npm package name as imported in component code */
  name: string;
  /** Short human description (surfaced to the agent + UI builder) */
  description: string;
  /**
   * Whether this package is a desktop production dependency and therefore
   * bundle-able fully offline. When false the package is only a recommendation
   * and requires an npm install.
   */
  builtin: boolean;
}

/**
 * Packages whose imports must be mapped to existing runtime globals instead of
 * being bundled. Bundling these again would duplicate React or break hooks.
 */
export const GLOBAL_PACKAGE_ALIASES: Record<string, string> = {
  react: 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOM',
  'framer-motion': 'window.Motion',
};

export const CURATED_UI_PACKAGES: CuratedPackage[] = [
  { name: 'lucide-react', description: 'Feather-style icon components', builtin: true },
  { name: 'recharts', description: 'Composable charting library', builtin: true },
  { name: 'clsx', description: 'Tiny className constructor', builtin: true },
  { name: 'tailwind-merge', description: 'Merge conflicting Tailwind classes', builtin: true },
  { name: 'class-variance-authority', description: 'Type-safe variant styling', builtin: true },
  { name: 'three', description: '3D rendering engine (large bundle)', builtin: true },
];

const BUILTIN_NAMES = new Set(CURATED_UI_PACKAGES.filter((p) => p.builtin).map((p) => p.name));

export function isBuiltinPackage(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}

export function isGlobalAliasPackage(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(GLOBAL_PACKAGE_ALIASES, name);
}

/**
 * Validate a package specifier is a plausible npm package name. Rejects paths,
 * URLs, scripts and anything that could be used for command injection when
 * shelling out to npm.
 */
export function isValidPackageName(name: string): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 214) return false;
  // Disallow shell metacharacters / whitespace / path traversal outright.
  if (/[\s;&|`$()<>\\]/.test(trimmed)) return false;
  if (trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.includes('..')) return false;
  // Optional scope, then a standard npm name. Subpaths are not allowed as
  // top-level install specifiers (imports of subpaths still work post-install).
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(trimmed);
}
