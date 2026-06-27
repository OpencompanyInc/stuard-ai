import fs from 'fs';
import path from 'path';
import { LOG_DIR, LOG_BASENAME } from './config';

let logStream: fs.WriteStream | null = null;
let logDate = '';

export function ensureLogStream() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {}
  const today = new Date().toISOString().slice(0, 10);
  if (!logStream || logDate !== today) {
    try { logStream?.end(); } catch {}
    const file = path.join(LOG_DIR, `${LOG_BASENAME}-${today}.log`);
    try {
      logStream = fs.createWriteStream(file, { flags: 'a' });
      logDate = today;
    } catch {}
  }
}

export function safeData(obj: any): any {
  try {
    const json = JSON.stringify(obj, (k, v) => {
      if (k === 'data' && typeof v === 'string') return `[base64:${v.length} bytes]`;
      if (typeof v === 'string' && v.length > 1000) return v.slice(0, 1000) + '...';
      return v;
    });
    return JSON.parse(json);
  } catch {
    return { note: 'unserializable' };
  }
}

export function writeLog(event: string, data?: any) {
  try {
    ensureLogStream();
    const ts = new Date().toISOString();
    const line = { ts, event, ...(data ? { data: safeData(data) } : {}) } as any;
    logStream?.write(JSON.stringify(line) + '\n');
  } catch {}
}
