import * as path from 'path';
import { app } from 'electron';

// Get preload script path
export function getPreloadPath(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    // Development: __dirname is dist/main/, preload is dist/main/custom-ui-preload.js
    return path.join(__dirname, 'custom-ui-preload.js');
  }
  // Production: look in resources
  return path.join(process.resourcesPath, 'app', 'dist', 'main', 'custom-ui-preload.js');
}
