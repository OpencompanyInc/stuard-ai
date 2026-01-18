import { app, globalShortcut, protocol, net } from "electron";
import path from "path";
import { initEnv } from "./env";
import { createWindow, registerGlobalShortcuts, createTray, showWindow } from "./windows/index";
import { setupIpc } from "./ipc/index";
import { startAgentIfNeeded, stopAgent, stopAllAgents, initUpdates, disposeUpdates, runStartupIndexing, startIndexingScheduler, stopIndexingScheduler, startBrowserExtensionServer } from "./services/index";
import { startLocalWebhookServer, workflows_autostart } from "./workflows/index";
import { stuards_autostart } from "./stuards";
import { initCustomUiIpc } from "./tools/index";
import logger from "./utils/logger";

initEnv();

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

app.whenReady().then(async () => {
  // Register local-file:// protocol handler to serve local files in renderer
  protocol.handle('local-file', (request) => {
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
    return net.fetch(`file:///${filePath}`);
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
    startAgentIfNeeded();
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
    const agentWsUrl = String(process.env.AGENT_WS || '').trim() || 'ws://127.0.0.1:8765/ws';
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
});

app.on("browser-window-focus", () => {
  // re-register just in case
  registerGlobalShortcuts();
});

app.on("will-quit", () => {
  logger.info("App quitting...");
  globalShortcut.unregisterAll();
  disposeUpdates();
  stopAllAgents();
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
