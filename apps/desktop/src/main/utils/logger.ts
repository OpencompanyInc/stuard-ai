import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

// Lazy init to avoid calling app.getPath before app is ready
let LOG_DIR: string | null = null;
let LOG_FILE: string | null = null;
let initialized = false;

function ensureInitialized() {
  if (initialized) return;
  
  // Try userData path first (only works after app.whenReady)
  try {
    const userData = app.getPath("userData");
    LOG_DIR = path.join(userData, "logs");
    LOG_FILE = path.join(LOG_DIR, "stuard.log");
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    initialized = true;
    return;
  } catch {}
  
  // Fallback to temp dir
  try {
    const tempDir = process.env.TEMP || process.env.TMP || process.env.LOCALAPPDATA || "C:\\Temp";
    LOG_DIR = path.join(tempDir, "StuardAI-logs");
    LOG_FILE = path.join(LOG_DIR, "stuard.log");
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    initialized = true;
    return;
  } catch {}
  
  // Last resort - just set paths but don't create (will fail silently on write)
  LOG_DIR = "C:\\Temp\\StuardAI-logs";
  LOG_FILE = path.join(LOG_DIR, "stuard.log");
  initialized = true;
}

function rotateLogIfNeeded() {
  ensureInitialized();
  if (!LOG_FILE) return;
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const backupPath = LOG_FILE + ".old";
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
        fs.renameSync(LOG_FILE, backupPath);
      }
    }
  } catch {}
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function writeLog(level: string, message: string, ...args: unknown[]) {
  const timestamp = formatTimestamp();
  const formattedArgs = args.map(arg => {
    if (arg instanceof Error) {
      return `${arg.message}\n${arg.stack}`;
    }
    if (typeof arg === "object") {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    }
    return String(arg);
  }).join(" ");
  
  const logLine = `[${timestamp}] [${level}] ${message} ${formattedArgs}\n`;
  
  // Console output (for dev)
  if (level === "ERROR") {
    console.error(logLine.trim());
  } else if (level === "WARN") {
    console.warn(logLine.trim());
  } else {
    console.log(logLine.trim());
  }
  
  // File output
  try {
    rotateLogIfNeeded();
    if (LOG_FILE) {
      fs.appendFileSync(LOG_FILE, logLine);
    }
  } catch {}
}

export const logger = {
  info: (message: string, ...args: unknown[]) => writeLog("INFO", message, ...args),
  warn: (message: string, ...args: unknown[]) => writeLog("WARN", message, ...args),
  error: (message: string, ...args: unknown[]) => writeLog("ERROR", message, ...args),
  debug: (message: string, ...args: unknown[]) => writeLog("DEBUG", message, ...args),
  
  getLogPath: () => { ensureInitialized(); return LOG_FILE || ""; },
  getLogDir: () => { ensureInitialized(); return LOG_DIR || ""; },
};

export default logger;
