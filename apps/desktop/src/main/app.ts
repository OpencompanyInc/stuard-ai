import { app, globalShortcut, protocol } from "electron";
import fs from "node:fs";
import path from "path";
import { Readable } from "node:stream";
import { initEnv } from "./env";
import { createWindow, registerGlobalShortcuts, createTray, showWindow, openNotificationWindow } from "./windows/index";
import { setupIpc } from "./ipc/index";
import { startAgentIfNeeded, stopAgent, stopAllAgents, initUpdates, disposeUpdates, runStartupIndexing, startIndexingScheduler, stopIndexingScheduler, startBrowserExtensionServer, refreshAppCache, startReminderScheduler, stopReminderScheduler, startProactiveScheduler, stopProactiveScheduler, startCloudWebhooks, stopCloudWebhooks } from "./services/index";
import { startLocalWebhookServer, workflows_autostart } from "./workflows/index";
import { stuards_autostart } from "./stuards";
import { initCustomUiIpc } from "./tools/index";
import logger from "./utils/logger";

initEnv();

// Force consistent userData path in dev mode (package.json name is @stuardai/desktop, but we want "Stuard AI")
// app.setName only affects display, we need app.setPath to change actual userData location
app.setName("Stuard AI");

// Override userData path to always use "Stuard AI" folder (not @stuardai/desktop in dev)
const targetUserData = (() => {
  const base = process.platform === 'win32'
    ? (process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'))
    : process.platform === 'darwin'
      ? path.join(require('os').homedir(), 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config'));
  return path.join(base, 'Stuard AI');
})();
app.setPath('userData', targetUserData);
console.log('[app] userData path set to:', targetUserData);

// Register custom protocol for local file access (must be before app.ready)
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
]);

function setupSingleInstance() {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    logger.warn("Another instance is running, quitting...");
    app.quit();
  } else {
    app.on("second-instance", () => {
      logger.info("Second instance detected, showing window");
      try { showWindow(); } catch (e) { logger.error("Failed to show window on second-instance:", e); }
    });
  }
}

app.setAppUserModelId("Stuard AI");
setupSingleInstance();

// Migrate workflows from old dev path (@stuardai/desktop) to unified path (Stuard AI)
function migrateDevWorkflows() {
  try {
    const base = process.platform === 'win32'
      ? (process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? path.join(require('os').homedir(), 'Library', 'Application Support')
        : (process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config'));

    const oldDevPath = path.join(base, '@stuardai', 'desktop', 'workflows');
    const newPath = path.join(base, 'Stuard AI', 'workflows');

    // Only migrate if old path exists and has files
    if (!fs.existsSync(oldDevPath)) return;

    const oldFiles = fs.readdirSync(oldDevPath).filter(f => f.endsWith('.json'));
    if (oldFiles.length === 0) return;

    // Ensure new directory exists
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }

    let migrated = 0;
    for (const file of oldFiles) {
      const oldFilePath = path.join(oldDevPath, file);
      const newFilePath = path.join(newPath, file);

      // Only copy if doesn't already exist in new location
      if (!fs.existsSync(newFilePath)) {
        fs.copyFileSync(oldFilePath, newFilePath);
        migrated++;
        logger.info(`[migration] Copied workflow: ${file}`);
      }
    }

    if (migrated > 0) {
      logger.info(`[migration] Migrated ${migrated} workflow(s) from dev path to unified path`);
    }
  } catch (e) {
    logger.warn('[migration] Failed to migrate dev workflows:', e);
  }
}

// Run migration before app ready (userData path is now set)
migrateDevWorkflows();

app.whenReady().then(async () => {
  // Register local-file:// protocol handler to serve local files in renderer
  protocol.handle('local-file', async (request) => {
    // URL format: local-file://C:/path or local-file:///C:/path
    // When using local-file://C:/path, the browser treats "C:" as hostname
    const url = new URL(request.url);
    let filePath: string;

    if (url.hostname) {
      // Browser parsed "C:" as hostname, so reconstruct: hostname + pathname
      // hostname = "c" (lowercase), pathname = "/Users/..."
      filePath = url.hostname.toUpperCase() + ':' + decodeURIComponent(url.pathname);
    } else {
      // Format was local-file:///C:/path, pathname contains full path
      filePath = decodeURIComponent(url.pathname);
    }

    // Remove leading slashes for Windows paths
    filePath = filePath.replace(/^\/+/, '');
    // Ensure forward slashes
    filePath = filePath.replace(/\\/g, '/');

    logger.debug('[local-file protocol] Serving:', filePath);

    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === '.mp4' ? 'video/mp4' :
        ext === '.webm' ? 'video/webm' :
          ext === '.mov' ? 'video/quicktime' :
            ext === '.m4v' ? 'video/x-m4v' :
              ext === '.mp3' ? 'audio/mpeg' :
                ext === '.wav' ? 'audio/wav' :
                  ext === '.ogg' ? 'audio/ogg' :
                    ext === '.m4a' ? 'audio/mp4' :
                      ext === '.aac' ? 'audio/aac' :
                        ext === '.png' ? 'image/png' :
                          ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                            ext === '.gif' ? 'image/gif' :
                              ext === '.webp' ? 'image/webp' :
                                'application/octet-stream';

    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        return new Response('Not Found', { status: 404 });
      }

      const totalSize = stat.size;
      const range = request.headers.get('range');
      const method = (request.method || 'GET').toUpperCase();

      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
        if (!match) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: {
              'Content-Range': `bytes */${totalSize}`,
            },
          });
        }

        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : totalSize - 1;

        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= totalSize) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: {
              'Content-Range': `bytes */${totalSize}`,
            },
          });
        }

        const chunkSize = end - start + 1;
        const headers: Record<string, string> = {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Content-Length': String(chunkSize),
        };

        if (method === 'HEAD') {
          return new Response(null, { status: 206, headers });
        }

        const nodeStream = fs.createReadStream(filePath, { start, end });
        const webStream = Readable.toWeb(nodeStream);
        return new Response(webStream as any, { status: 206, headers });
      }

      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(totalSize),
      };

      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }

      const nodeStream = fs.createReadStream(filePath);
      const webStream = Readable.toWeb(nodeStream);
      return new Response(webStream as any, { status: 200, headers });
    } catch (e) {
      logger.error('[local-file protocol] Failed to serve:', filePath, e);
      return new Response('Not Found', { status: 404 });
    }
  });

  // Log startup info (after app is ready so userData path is available)
  logger.info("========================================");
  logger.info("Stuard AI Starting");
  logger.info("========================================");
  logger.info("Version:", app.getVersion());
  logger.info("Electron:", process.versions.electron);
  logger.info("Node:", process.versions.node);
  logger.info("Platform:", process.platform, process.arch);
  logger.info("Packaged:", app.isPackaged);
  logger.info("User Data:", app.getPath("userData"));
  logger.info("Resources:", process.resourcesPath);
  logger.info("Log file:", logger.getLogPath());
  logger.info("App ready, initializing...");

  try {
    logger.info("Initializing updates...");
    initUpdates();
    logger.info("Updates initialized");
  } catch (e) {
    logger.error("Failed to init updates:", e);
  }

  try {
    logger.info("Starting agent...");
    await startAgentIfNeeded();
    logger.info("Agent start requested");
  } catch (e) {
    logger.error("Failed to start agent:", e);
  }

  try {
    logger.info("Starting local webhook server...");
    startLocalWebhookServer();
    logger.info("Webhook server started");
  } catch (e) {
    logger.error("Failed to start webhook server:", e);
  }

  try {
    logger.info("Starting browser extension server...");
    startBrowserExtensionServer();
    logger.info("Browser extension server started");
  } catch (e) {
    logger.error("Failed to start browser extension server:", e);
  }

  try {
    logger.info("Running stuards autostart...");
    stuards_autostart();
    logger.info("Stuards autostart done");
  } catch (e) {
    logger.error("Failed stuards autostart:", e);
  }

  try {
    logger.info("Creating window...");
    createWindow();
    openNotificationWindow();
    logger.info("Window created");
  } catch (e) {
    logger.error("Failed to create window:", e);
  }

  try {
    logger.info("Registering global shortcuts...");
    registerGlobalShortcuts();
    logger.info("Shortcuts registered");
  } catch (e) {
    logger.error("Failed to register shortcuts:", e);
  }

  try {
    logger.info("Creating tray...");
    createTray();
    logger.info("Tray created");
  } catch (e) {
    logger.error("Failed to create tray:", e);
  }

  try {
    logger.info("Setting up IPC...");
    setupIpc();
    logger.info("IPC setup complete");
  } catch (e) {
    logger.error("Failed to setup IPC:", e);
  }

  try {
    logger.info("Initializing custom UI IPC...");
    // Initialize custom UI IPC with a function to get the router context
    const agentWsUrl = String(process.env.AGENT_WS || process.env.AGENT_WS_URL || '').trim() || 'ws://127.0.0.1:8765/ws';
    const cloudAiUrl = String(
      process.env.CLOUD_AI_HTTP ||
      process.env.CLOUD_PUBLIC_URL ||
      process.env.VITE_CLOUD_AI_URL ||
      ''
    ).trim().replace(/\/+$/, '');

    initCustomUiIpc(() => ({
      agentWsUrl,
      cloudAiUrl,
      logFn: (msg: string) => {
        try { logger.info(`[custom_ui] ${msg}`); } catch { }
      },
    }));
    logger.info("Custom UI IPC initialized");
  } catch (e) {
    logger.error("Failed to initialize custom UI IPC:", e);
  }

  // Note: The window will auto-show after the renderer finishes loading
  // via the 'did-finish-load' handler in window.ts. This ensures
  // the transparent overlay is visible (has content painted) when shown.

  // Run workflows autostart AFTER window, shortcuts, and IPC are fully initialized
  // This ensures globalShortcut is ready for workflow hotkeys
  try {
    logger.info("Running workflows autostart...");
    workflows_autostart();
    logger.info("Workflows autostart done");
  } catch (e) {
    logger.error("Failed workflows autostart:", e);
  }

  logger.info("=== Initialization complete ===");

  // Start the offline reminder scheduler (works without internet)
  try {
    startReminderScheduler();
    logger.info("Reminder scheduler started");
  } catch (e) {
    logger.error("Failed to start reminder scheduler:", e);
  }

  // Start the proactive agent scheduler
  try {
    startProactiveScheduler();
    logger.info("Proactive scheduler started");
  } catch (e) {
    logger.error("Failed to start proactive scheduler:", e);
  }

  // Start the cloud webhooks listener
  try {
    startCloudWebhooks();
    logger.info("Cloud webhooks listener started");
  } catch (e) {
    logger.error("Failed to start cloud webhooks listener:", e);
  }

  // Run file indexing in the background after a short delay
  // This allows the agent to fully initialize first
  setTimeout(async () => {
    try {
      logger.info("Starting background file indexing...");
      await runStartupIndexing();
      logger.info("Background file indexing complete");
    } catch (e) {
      logger.error("Background file indexing failed:", e);
    }
  }, 5000); // 5 second delay to let agent fully start

  // Discover installed applications immediately (no agent dependency)
  refreshAppCache().catch((e) => {
    logger.warn("Background app discovery failed:", e);
  });
});

app.on("browser-window-focus", () => {
  // re-register just in case
  // no-op
});

app.on("will-quit", () => {
  logger.info("App quitting...");
  globalShortcut.unregisterAll();
  disposeUpdates();
  stopAllAgents();
  stopReminderScheduler();
  stopProactiveScheduler();
  stopCloudWebhooks();
  // Flush any debounced variable saves before exit
  try { require('./workflow-variables').saveVariablesSync(); } catch { }
  logger.info("Cleanup complete");
});

app.on("window-all-closed", () => {
  logger.debug("All windows closed");
});

// Catch uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection:", reason);
});
