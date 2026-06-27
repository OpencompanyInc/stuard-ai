export interface UiPackagesManifest {
  id: string;
  /** Declared package specifiers (npm names) the user asked for. */
  packages: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UiPackagesMeta {
  /** Hash of the resolved package set + versions + bundler version. */
  hash: string;
  builtAt: string;
  /** Package names successfully bundled and exposed to component code. */
  modules: string[];
  jsBytes: number;
  cssBytes: number;
  bundlerVersion: number;
  /** Packages that could not be resolved/bundled, with reasons. */
  failed?: Array<{ name: string; reason: string }>;
}

export interface UiPackagesStatus {
  id: string;
  exists: boolean;
  /** True when a usable bundle has been built. */
  built: boolean;
  packages: string[];
  modules: string[];
  hash?: string;
  builtAt?: string;
  jsBytes?: number;
  cssBytes?: number;
  failed?: Array<{ name: string; reason: string }>;
}

export interface UiPackagesBundle {
  js: string;
  css: string;
  modules: string[];
  hash: string;
}

export interface InstallUiPackagesOptions {
  /** Named package set id (install once, reference by name from custom_ui). */
  setId: string;
  packages: string[];
  /** 'add' merges with existing packages (default); 'set' replaces them. */
  mode?: 'add' | 'set';
  /** Allow shelling out to npm for non-builtin packages. Default false. */
  allowNpm?: boolean;
  /** Force a rebuild even if the hash is unchanged. */
  force?: boolean;
  logFn?: (msg: string) => void;
}
