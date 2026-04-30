import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

// Get preload script path
export function getPreloadPath(): string {
  const candidates = [
    // Packaged with asar enabled. app.getAppPath() usually points at resources/app.asar.
    path.join(app.getAppPath(), 'dist', 'main', 'custom-ui-preload.js'),
    // Packaged dir/unpacked builds.
    path.join(process.resourcesPath, 'app', 'dist', 'main', 'custom-ui-preload.js'),
    path.join(process.resourcesPath, 'app.asar', 'dist', 'main', 'custom-ui-preload.js'),
    // Development layouts. This module can compile into either dist/main or dist/main/custom-ui.
    path.join(process.cwd(), 'dist', 'main', 'custom-ui-preload.js'),
    path.join(__dirname, 'custom-ui-preload.js'),
    path.join(__dirname, '..', 'custom-ui-preload.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // Return the most likely packaged path so callers log a useful miss.
  return candidates[0];
}
