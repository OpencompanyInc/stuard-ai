import { BrowserWindow, app, net } from "electron";
import { autoUpdater, UpdateInfo } from "electron-updater";
import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";

// ─────────────────────────────────────────────────────────────────────────────
// SEAMLESS CROSS-PLATFORM, STAGE-BASED UPDATE SYSTEM
// Supports: Windows (Inno Setup), macOS (DMG/ZIP), Linux (AppImage)
// Channels: stable, beta, staging
// 
// KEY FEATURE: Single exe that dynamically switches API endpoints with channels
// - Channel switching also changes the Cloud AI API endpoint
// - Beta/staging access is gated by the beta_users table
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateChannel = "stable" | "beta" | "staging";
export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "error" | "up-to-date";

// API endpoints for each channel
const CHANNEL_API_ENDPOINTS: Record<UpdateChannel, string> = {
  stable: "https://api.stuard.ai",
  beta: "https://beta-api.stuard.ai",
  staging: "https://staging-api.stuard.ai",
};

interface UpdateState {
  status: UpdateStatus;
  channel: UpdateChannel;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  error?: string;
  downloadUrl?: string;
  apiEndpoint?: string; // Current API endpoint based on channel
}

const DEFAULT_UPDATE_BASE_URL = "https://updates.stuard.ai/desktop";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function getUpdateBaseUrl(): string {
  const fromEnv =
    process.env.STUARD_UPDATE_BASE_URL ||
    process.env.UPDATE_BASE_URL ||
    process.env.UPDATE_FEED_BASE_URL ||
    process.env.UPDATE_FEED_URL;
  return normalizeBaseUrl(fromEnv || DEFAULT_UPDATE_BASE_URL);
}

function resolveDefaultChannel(): UpdateChannel {
  const envCh = (process.env.UPDATE_CHANNEL || "").toLowerCase();
  if (envCh === "beta" || envCh === "staging" || envCh === "stable") return envCh;
  return "stable";
}

const DEFAULT_CHANNEL: UpdateChannel = resolveDefaultChannel();

function safeGetVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

let state: UpdateState = {
  status: "idle",
  channel: DEFAULT_CHANNEL,
  currentVersion: "0.0.0", // Will be set properly in initUpdates
  apiEndpoint: CHANNEL_API_ENDPOINTS[DEFAULT_CHANNEL],
};
let winInstallerPath: string | null = null;
let checkTimer: NodeJS.Timeout | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// API Endpoint Management
// ─────────────────────────────────────────────────────────────────────────────

export function getApiEndpointForChannel(channel: UpdateChannel): string {
  return CHANNEL_API_ENDPOINTS[channel] || CHANNEL_API_ENDPOINTS.stable;
}

export function getCurrentApiEndpoint(): string {
  return state.apiEndpoint || CHANNEL_API_ENDPOINTS[state.channel] || CHANNEL_API_ENDPOINTS.stable;
}

function notifyApiEndpointChange(endpoint: string) {
  // Notify all windows about the API endpoint change
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send("updates:api-endpoint-changed", endpoint);
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function emitState() {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        w.webContents.send("updates:state", { ...state });
      } catch {}
    }
  } catch {}
}

function setState(partial: Partial<UpdateState>) {
  state = { ...state, ...partial };
  emitState();
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function getFeedUrl(channel: UpdateChannel): string {
  return `${getUpdateBaseUrl()}/${channel}`;
}

function getManifestUrl(channel: UpdateChannel): string {
  const platform = process.platform;
  const ext = platform === "win32" ? "latest.yml" : platform === "darwin" ? "latest-mac.yml" : "latest-linux.yml";
  return `${getFeedUrl(channel)}/${ext}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel Persistence
// ─────────────────────────────────────────────────────────────────────────────

function getChannelFromPrefs(): UpdateChannel {
  try {
    const prefsPath = path.join(app.getPath("userData"), "update-channel.txt");
    if (fs.existsSync(prefsPath)) {
      const ch = fs.readFileSync(prefsPath, "utf8").trim();
      if (ch === "beta" || ch === "stable" || ch === "staging") return ch;
    }
  } catch {}
  return DEFAULT_CHANNEL;
}

function saveChannelToPrefs(channel: UpdateChannel) {
  try {
    const prefsPath = path.join(app.getPath("userData"), "update-channel.txt");
    fs.writeFileSync(prefsPath, channel, "utf8");
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows-Specific: Parse YAML manifest + download installer
// ─────────────────────────────────────────────────────────────────────────────

interface WindowsManifest {
  version: string;
  path: string;
  sha512?: string;
  releaseNotes?: string;
}

async function parseWindowsManifest(channel: UpdateChannel): Promise<WindowsManifest | null> {
  try {
    const url = getManifestUrl(channel);
    const resp = await net.fetch(url, { cache: "no-store" });
    if (!resp.ok) return null;
    const yaml = await resp.text();
    
    // Simple YAML parsing for electron-builder format
    const version = yaml.match(/version:\s*(.+)/)?.[1]?.trim();
    const filePath = yaml.match(/path:\s*(.+)/)?.[1]?.trim();
    const sha512 = yaml.match(/sha512:\s*(.+)/)?.[1]?.trim();
    const releaseNotes = yaml.match(/releaseNotes:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
    
    if (!version || !filePath) return null;
    return { version, path: filePath, sha512, releaseNotes };
  } catch {
    return null;
  }
}

async function checkWindowsUpdate(): Promise<void> {
  setState({ status: "checking" });
  
  const manifest = await parseWindowsManifest(state.channel);
  if (!manifest) {
    setState({ status: "error", error: "Failed to fetch update manifest" });
    return;
  }
  
  const cmp = compareVersions(manifest.version, state.currentVersion);
  if (cmp <= 0) {
    setState({ status: "up-to-date", latestVersion: manifest.version });
    return;
  }
  
  const downloadUrl = `${getFeedUrl(state.channel)}/${manifest.path}`;
  setState({
    status: "available",
    latestVersion: manifest.version,
    releaseNotes: manifest.releaseNotes,
    downloadUrl,
  });
}

async function downloadWindowsUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!state.downloadUrl || !state.latestVersion) {
    return { ok: false, error: "No update available" };
  }
  
  setState({ status: "downloading", downloadProgress: 0 });
  
  try {
    const res = await net.fetch(state.downloadUrl);
    if (!res.ok) {
      setState({ status: "error", error: `Download failed: ${res.status}` });
      return { ok: false, error: `HTTP ${res.status}` };
    }
    
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    const reader = res.body?.getReader();
    if (!reader) {
      setState({ status: "error", error: "No response body" });
      return { ok: false, error: "No response body" };
    }
    
    const chunks: Uint8Array[] = [];
    let received = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (contentLength > 0) {
        setState({ downloadProgress: Math.round((received / contentLength) * 100) });
      }
    }
    
    const buffer = Buffer.concat(chunks);
    const tmpPath = path.join(app.getPath("temp"), `StuardAI-Setup-${state.latestVersion}.exe`);
    fs.writeFileSync(tmpPath, buffer);
    winInstallerPath = tmpPath;
    
    setState({ status: "downloaded", downloadProgress: 100 });
    return { ok: true };
  } catch (e: any) {
    setState({ status: "error", error: e.message });
    return { ok: false, error: e.message };
  }
}

async function installWindowsUpdate(): Promise<{ ok: boolean; error?: string }> {
  let installerPath = winInstallerPath;
  
  // If installer not downloaded yet, download it
  if (!installerPath || !fs.existsSync(installerPath)) {
    if (state.downloadUrl && state.latestVersion) {
      const result = await downloadWindowsUpdate();
      if (!result.ok) return result;
      installerPath = winInstallerPath;
    } else {
      return { ok: false, error: "No update available" };
    }
  }
  
  if (!installerPath || !fs.existsSync(installerPath)) {
    return { ok: false, error: "Installer not found" };
  }
  
  // Stop agents gracefully
  try {
    const { stopAllAgents } = require("./agent");
    await stopAllAgents();
  } catch {}
  
  // Wait for file handles to release
  await new Promise((r) => setTimeout(r, 1000));
  
  // Launch installer in update mode:
  //   /VERYSILENT = no UI at all (mini-updater feel)
  //   /SUPPRESSMSGBOXES = suppress any confirmation dialogs
  //   /NORESTART = don't reboot the machine
  //   /CLOSEAPPLICATIONS = close running instances
  //   /UPDATE = custom flag that tells setup.iss to show "Updating" UI
  //             and auto-relaunch the app after install
  const args = [
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/CLOSEAPPLICATIONS",
    "/CURRENTUSER",
    "/UPDATE",
  ];
  
  console.log(`[Updates] Launching installer: ${installerPath} ${args.join(" ")}`);
  
  try {
    const child = spawn(installerPath, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
  
  // Quit app after short delay to let the installer take over
  setTimeout(() => {
    try {
      app.quit();
    } catch {}
  }, 500);
  
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// macOS/Linux: Use electron-updater
// ─────────────────────────────────────────────────────────────────────────────

function setupElectronUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  
  // Set feed URL based on channel
  autoUpdater.setFeedURL({
    provider: "generic",
    url: getFeedUrl(state.channel),
    useMultipleRangeRequest: false,
  });
  
  autoUpdater.on("checking-for-update", () => {
    setState({ status: "checking" });
  });
  
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    setState({
      status: "available",
      latestVersion: info.version,
      releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    });
  });
  
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    setState({ status: "up-to-date", latestVersion: info.version });
  });
  
  autoUpdater.on("download-progress", (progress) => {
    setState({
      status: "downloading",
      downloadProgress: Math.round(progress.percent),
    });
  });
  
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    setState({
      status: "downloaded",
      latestVersion: info.version,
      downloadProgress: 100,
    });
  });
  
  autoUpdater.on("error", (err) => {
    setState({ status: "error", error: err.message });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function initUpdates() {
  state.channel = getChannelFromPrefs();
  state.currentVersion = safeGetVersion();
  state.apiEndpoint = getApiEndpointForChannel(state.channel);
  
  if (process.platform !== "win32") {
    setupElectronUpdater();
  }
  
  // Initial check after 5 seconds
  setTimeout(() => {
    updates_check().catch(() => {});
  }, 5000);
  
  // Check every hour
  checkTimer = setInterval(() => {
    updates_check().catch(() => {});
  }, 3600000);
  
  console.log(`[Updates] Initialized: channel=${state.channel}, apiEndpoint=${state.apiEndpoint}`);
}

export function disposeUpdates() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

export function updates_getState(): UpdateState {
  return { ...state };
}

export async function updates_setChannel(channel: UpdateChannel): Promise<{ ok: boolean; apiEndpoint?: string }> {
  if (channel !== "beta" && channel !== "stable" && channel !== "staging") {
    return { ok: false };
  }

  const newApiEndpoint = getApiEndpointForChannel(channel);
  saveChannelToPrefs(channel);
  setState({ 
    channel, 
    status: "idle", 
    latestVersion: undefined, 
    error: undefined,
    apiEndpoint: newApiEndpoint,
  });

  // Notify renderers about API endpoint change
  notifyApiEndpointChange(newApiEndpoint);

  // Reconfigure electron-updater for macOS/Linux
  if (process.platform !== "win32") {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: getFeedUrl(channel),
      useMultipleRangeRequest: false,
    });
  }
  // For Windows: clear cached installer path so new channel is used
  else {
    winInstallerPath = null;
  }

  return { ok: true, apiEndpoint: newApiEndpoint };
}

export async function updates_check(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (process.platform === "win32") {
      await checkWindowsUpdate();
    } else {
      await autoUpdater.checkForUpdates();
    }
    return { ok: true };
  } catch (e: any) {
    setState({ status: "error", error: e.message });
    return { ok: false, error: e.message };
  }
}

export async function updates_download(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (process.platform === "win32") {
      return await downloadWindowsUpdate();
    } else {
      setState({ status: "downloading", downloadProgress: 0 });
      await autoUpdater.downloadUpdate();
      return { ok: true };
    }
  } catch (e: any) {
    setState({ status: "error", error: e.message });
    return { ok: false, error: e.message };
  }
}

export async function updates_install(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (process.platform === "win32") {
      return await installWindowsUpdate();
    } else {
      // Stop agents before installing
      try {
        const { stopAllAgents } = require("./agent");
        await stopAllAgents();
      } catch {}
      
      setImmediate(() => {
        autoUpdater.quitAndInstall(false, true);
      });
      return { ok: true };
    }
  } catch (e: any) {
    setState({ status: "error", error: e.message });
    return { ok: false, error: e.message };
  }
}
