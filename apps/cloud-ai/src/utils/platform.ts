import { platform as osPlatform } from 'os';

export type Platform = 'win32' | 'darwin' | 'linux';

export function getPlatform(): Platform {
  return osPlatform() as Platform;
}

export function isCloudVM(): boolean {
  return getPlatform() === 'linux' && !!process.env.STUARD_VM;
}

export function getDefaultShell(plat?: Platform): string {
  const p = plat || getPlatform();
  switch (p) {
    case 'win32':  return 'powershell.exe';
    case 'darwin': return '/bin/zsh';
    default:       return '/bin/bash';
  }
}

/** Normalize all backslashes to forward slashes */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/** Convert to platform-native separators */
export function toNativePath(filePath: string, plat?: Platform): string {
  const p = plat || getPlatform();
  if (p === 'win32') return filePath.replace(/\//g, '\\');
  return filePath.replace(/\\/g, '/');
}

/** Wrap a command for the correct shell on the given platform */
export function buildShellCommand(command: string, plat?: Platform): { shell: string; args: string[] } {
  const p = plat || getPlatform();
  if (p === 'win32') {
    return { shell: 'powershell.exe', args: ['-NoProfile', '-Command', command] };
  }
  const sh = p === 'darwin' ? '/bin/zsh' : '/bin/bash';
  return { shell: sh, args: ['-c', command] };
}

/** Escape a string for safe embedding in a shell command */
export function shellEscape(str: string, plat?: Platform): string {
  const p = plat || getPlatform();
  if (p === 'win32') {
    // PowerShell: wrap in single quotes, double any internal single quotes
    return `'${str.replace(/'/g, "''")}'`;
  }
  // POSIX: wrap in single quotes, break out to escape internal single quotes
  return `'${str.replace(/'/g, "'\\''")}'`;
}
