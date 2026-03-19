import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Notification,
  globalShortcut,
  nativeImage,
} from "electron";
import * as path from "path";
import {
  selectFiles,
  selectImages,
  listDirectory,
  selectFolder,
} from "../utils/files";
import {
  openDashboardWindow,
  openOnboardingWindow,
  closeOnboardingWindow,
  openWorkflowsWindow,
  openSpacesWindow,
  closeSpacesWindow,
  toggleSpacesWindow,
  openSidebarWindow,
  closeSidebarWindow,
  toggleSidebarWindow,
  getSidebarWindow,
  setOverlayMode,
  setOverlaySize,
  setOverlayBounds,
  moveOverlayBy,
  showWindow,
  hideWindow,
  toggleWindow,
  createBoardWindow,
  updateBoardWindow,
  deleteBoardWindow,
  listBoardWindows,
  clearBoardWindows,
  hideBoardWindow,
  focusBoardWindow,
  showBoardWindow,
  getOverlaySize,
  getOverlayMode,
  toggleInternalSidebar,
  getInternalSidebarState,
  getNotificationWindow,
  setScreenCaptureInvisible,
} from "../windows";
import { settleNotificationResponse } from "../tools/handlers/electron";
import {
  getLocalWebhookPort,
  handleCloudWebhookEvent,
  workflows_list,
  workflows_read,
  workflows_save,
  workflows_delete,
  workflows_run,
  workflows_stop,
  workflows_deploy,
  workflows_undeploy,
  workflows_getDeployStatus,
  workflows_runStep,
  workflows_runFromStep,
  workflowToStuardSpec,
  WorkflowDefinition,
  workflows_createFolder,
  workflows_renameFolder,
  workflows_deleteFolder,
  workflows_moveToFolder,
  workflows_ensureWorkspace,
  workflows_getWorkspaceInfo,
  workflows_listWorkspaceFiles,
  workflows_readWorkspaceFile,
  workflows_readWorkspaceFileBinary,
  workflows_writeWorkspaceFile,
  workflows_deleteWorkspaceFile,
  workflows_createWorkspaceSubdir,
  workflows_renameWorkspaceFile,
  workflows_moveWorkspaceFile,
  workflows_createWorkspaceStuard,
  workflows_readWorkspaceStuard,
  workflows_saveWorkspaceStuard,
  workflows_listWorkspaceFunctions,
} from "../workflows";
import {
  stuards_list,
  stuards_read,
  stuards_save,
  stuards_deploy,
  stuards_stop,
  stuards_run,
  safeStuardId,
  execLocalTool,
} from "../stuards";
import { execTool as execUnifiedTool, RouterContext } from "../tool-router";
import {
  getOutlookAccessTokenLocal,
  startOutlookConnect,
  getOutlookStatus,
} from "../integrations/outlook";
import {
  updates_getState,
  updates_check,
  updates_download,
  updates_install,
  updates_setChannel,
  startAgent,
  stopAgent,
  listAgents,
  listRoots,
  addRoot,
  removeRoot,
  getStats as getFileIndexStats,
  scanRoot,
  searchFiles,
  getPendingCount,
  getScanStatus,
  reinitializeDefaultFolders,
  runStartupIndexing,
  processSemanticIndexing,
  createCheckout,
  getCustomer,
  listProducts,
  openCustomerPortal,
  purchaseCredits,
  unifiedTasksService,
  offlineCalendarService,
  getInstalledApps,
  refreshAppCache,
  unifiedSearch,
  getFileIconCached,
  syncMainAuthSession,
} from "../services";
import { setupSpeechIpc } from "./speech";
import { setupTerminalIpc } from "../terminal";
import logger from "../utils/logger";
import * as fs from "fs";
import { Buffer } from "node:buffer";
import {
  getGlobalHotkey,
  setGlobalHotkey as saveGlobalHotkey,
  getTimezone,
  setTimezone,
  loadSettings,
  saveSettings,
  getRendererPrefs,
  setRendererPrefs,
} from "../settings";
import {
  skills_list,
  skills_get,
  skills_save,
  skills_delete,
  skills_toggle,
  loadSkills,
  type Skill,
} from "../skills";
import { proactiveService } from "../services/proactive-service";
import {
  handleProactiveReply,
  isProactiveSchedulerRunning,
  triggerManualWakeUp,
} from "../services/proactive-scheduler";
import { TOOL_REGISTRY } from "../tools/registry";

let nodeNotifier: any = null;
try {
  nodeNotifier = require("node-notifier");
} catch {}

function pickChromeProfileDisplayName(
  profilePath: string,
  fallbackName: string,
) {
  const genericNames = new Set(["default", "your chrome"]);
  const isGenericName = (value: string) => {
    const normalized = value.trim().toLowerCase();
    return (
      !normalized ||
      genericNames.has(normalized) ||
      /^profile\s+\d+$/i.test(normalized) ||
      /^person\s+\d+$/i.test(normalized)
    );
  };

  const prefsPath = path.join(profilePath, "Preferences");
  if (!fs.existsSync(prefsPath)) return fallbackName;

  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
    const profile = prefs?.profile || {};
    const accountInfo = Array.isArray(prefs?.account_info)
      ? prefs.account_info
      : [];
    const primaryAccount = accountInfo.find((entry: any) => {
      const email = String(entry?.email || "").trim();
      const fullName = String(
        entry?.full_name || entry?.given_name || "",
      ).trim();
      return !!email || !!fullName;
    });

    const candidates = [
      profile?.gaia_name,
      profile?.gaia_given_name,
      primaryAccount?.full_name,
      primaryAccount?.given_name,
      profile?.shortcut_name,
      profile?.name,
      primaryAccount?.email,
    ];

    for (const candidate of candidates) {
      const value = String(candidate || "").trim();
      if (!value || isGenericName(value)) continue;
      return value;
    }
  } catch {}

  return fallbackName;
}

function listChromeProfilesLocal() {
  const home = app.getPath("home");
  const localAppData =
    process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const candidates =
    process.platform === "win32"
      ? [
          {
            browser: "Chrome",
            userDataDir: path.join(
              localAppData,
              "Google",
              "Chrome",
              "User Data",
            ),
          },
          {
            browser: "Chrome Beta",
            userDataDir: path.join(
              localAppData,
              "Google",
              "Chrome Beta",
              "User Data",
            ),
          },
          {
            browser: "Edge",
            userDataDir: path.join(
              localAppData,
              "Microsoft",
              "Edge",
              "User Data",
            ),
          },
          {
            browser: "Brave",
            userDataDir: path.join(
              localAppData,
              "BraveSoftware",
              "Brave-Browser",
              "User Data",
            ),
          },
        ]
      : process.platform === "darwin"
        ? [
            {
              browser: "Chrome",
              userDataDir: path.join(
                home,
                "Library",
                "Application Support",
                "Google",
                "Chrome",
              ),
            },
            {
              browser: "Chrome Beta",
              userDataDir: path.join(
                home,
                "Library",
                "Application Support",
                "Google",
                "Chrome Beta",
              ),
            },
            {
              browser: "Edge",
              userDataDir: path.join(
                home,
                "Library",
                "Application Support",
                "Microsoft Edge",
              ),
            },
            {
              browser: "Brave",
              userDataDir: path.join(
                home,
                "Library",
                "Application Support",
                "BraveSoftware",
                "Brave-Browser",
              ),
            },
          ]
        : [
            {
              browser: "Chrome",
              userDataDir: path.join(home, ".config", "google-chrome"),
            },
            {
              browser: "Chrome Beta",
              userDataDir: path.join(home, ".config", "google-chrome-beta"),
            },
            {
              browser: "Edge",
              userDataDir: path.join(home, ".config", "microsoft-edge"),
            },
            {
              browser: "Brave",
              userDataDir: path.join(
                home,
                ".config",
                "BraveSoftware",
                "Brave-Browser",
              ),
            },
          ];

  return candidates.flatMap(({ browser, userDataDir }) => {
    try {
      if (
        !fs.existsSync(userDataDir) ||
        !fs.statSync(userDataDir).isDirectory()
      )
        return [];
      const profiles: Array<{ name: string; path: string }> = [];
      const defaultProfilePath = path.join(userDataDir, "Default");
      const defaultCookies =
        fs.existsSync(
          path.join(userDataDir, "Default", "Network", "Cookies"),
        ) || fs.existsSync(path.join(userDataDir, "Default", "Cookies"));
      if (defaultCookies) {
        profiles.push({
          name: pickChromeProfileDisplayName(defaultProfilePath, "Default"),
          path: defaultProfilePath,
        });
      }
      for (const entry of fs.readdirSync(userDataDir, {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory() || !entry.name.startsWith("Profile "))
          continue;
        const profilePath = path.join(userDataDir, entry.name);
        const hasCookies =
          fs.existsSync(path.join(profilePath, "Network", "Cookies")) ||
          fs.existsSync(path.join(profilePath, "Cookies"));
        if (!hasCookies) continue;
        const displayName = pickChromeProfileDisplayName(
          profilePath,
          entry.name,
        );
        profiles.push({ name: displayName, path: profilePath });
      }
      if (!profiles.length) return [];
      return [{ browser, userDataDir, profiles }];
    } catch {
      return [];
    }
  });
}

// SECURITY: SSRF protection - block requests to private/internal IP addresses
function isPrivateOrInternalUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // Block localhost variants
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    ) {
      return true;
    }

    // Block .local and .internal domains
    if (
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".localhost")
    ) {
      return true;
    }

    // Block file:// and other non-http protocols
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return true;
    }

    // Parse IP address and check for private ranges
    const ipv4Match = hostname.match(
      /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
    );
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);

      // 10.0.0.0/8 - Private
      if (a === 10) return true;

      // 172.16.0.0/12 - Private
      if (a === 172 && b >= 16 && b <= 31) return true;

      // 192.168.0.0/16 - Private
      if (a === 192 && b === 168) return true;

      // 127.0.0.0/8 - Loopback
      if (a === 127) return true;

      // 169.254.0.0/16 - Link-local
      if (a === 169 && b === 254) return true;

      // 0.0.0.0/8 - Current network
      if (a === 0) return true;

      // 224.0.0.0/4 - Multicast
      if (a >= 224 && a <= 239) return true;

      // 240.0.0.0/4 - Reserved
      if (a >= 240) return true;
    }

    // Block IPv6 private/internal addresses
    if (hostname.startsWith("[")) {
      const ipv6 = hostname.slice(1, -1).toLowerCase();
      // ::1 loopback
      if (ipv6 === "::1") return true;
      // fe80::/10 link-local
      if (ipv6.startsWith("fe80:")) return true;
      // fc00::/7 unique local
      if (ipv6.startsWith("fc") || ipv6.startsWith("fd")) return true;
    }

    return false;
  } catch {
    // If we can't parse the URL, block it to be safe
    return true;
  }
}

export function setupIpc() {
  setupSpeechIpc();
  setupTerminalIpc();
  ipcMain.handle("auth:syncSession", (_e, session: any) =>
    syncMainAuthSession(session ?? null),
  );
  // Overlay
  ipcMain.handle("overlay:show", () => showWindow());
  ipcMain.handle("overlay:hide", () => hideWindow());
  ipcMain.handle("overlay:toggle", () => toggleWindow());
  ipcMain.handle(
    "overlay:setMode",
    (_e, mode: "compact" | "sidebar" | "window") => setOverlayMode(mode),
  );
  ipcMain.handle(
    "overlay:resize",
    (_e, w: number, h: number, anchor?: "top" | "bottom") =>
      setOverlaySize(w, h, false, anchor),
  );
  ipcMain.handle("overlay:setBounds", (_e, bounds: any) =>
    setOverlayBounds(bounds),
  );
  ipcMain.handle("overlay:moveBy", (_e, dx: number, dy: number) =>
    moveOverlayBy(dx, dy),
  );
  ipcMain.handle("overlay:getSize", () => getOverlaySize());
  ipcMain.handle("overlay:getMode", () => getOverlayMode());

  // Internal sidebar (rendered inside overlay window, expands window width)
  ipcMain.handle("overlay:toggleInternalSidebar", (_e, open?: boolean) =>
    toggleInternalSidebar(open),
  );
  ipcMain.handle("overlay:getInternalSidebarState", () =>
    getInternalSidebarState(),
  );

  // System windows
  ipcMain.handle("system:openDashboard", (_e, options?: { tab?: string }) =>
    openDashboardWindow(options),
  );
  ipcMain.handle(
    "system:openWorkflows",
    (_e, options?: { marketplaceSlug?: string }) =>
      openWorkflowsWindow(options),
  );
  ipcMain.handle("system:openOnboarding", () => openOnboardingWindow());
  ipcMain.handle("system:closeOnboarding", () => closeOnboardingWindow());

  // Spaces window (legacy - redirects to sidebar)
  ipcMain.handle("spaces:open", () => openSpacesWindow());
  ipcMain.handle("spaces:close", () => closeSpacesWindow());
  ipcMain.handle("spaces:toggle", () => toggleSpacesWindow());

  // Sidebar window (new unified sidebar with Spaces, Canvas, Terminal)
  ipcMain.handle(
    "sidebar:open",
    (
      _e,
      options?: { tab?: "spaces" | "canvas" | "terminal"; expanded?: boolean },
    ) => openSidebarWindow(options),
  );
  ipcMain.handle("sidebar:close", () => closeSidebarWindow());
  ipcMain.handle(
    "sidebar:toggle",
    (
      _e,
      options?: { tab?: "spaces" | "canvas" | "terminal"; expanded?: boolean },
    ) => toggleSidebarWindow(options),
  );
  ipcMain.handle(
    "sidebar:navigate",
    (_e, tab: "spaces" | "canvas" | "terminal") => {
      const sidebar = getSidebarWindow();
      if (sidebar && !sidebar.isDestroyed()) {
        sidebar.webContents.send("sidebar:navigate", { tab });
      }
    },
  );
  ipcMain.handle("sidebar:toggleExpanded", () => {
    const { toggleSidebarExpanded } = require("../windows");
    return toggleSidebarExpanded();
  });
  ipcMain.handle("sidebar:isExpanded", () => {
    const { isSidebarExpanded } = require("../windows");
    return { expanded: isSidebarExpanded() };
  });

  // Canvas document storage (persisted locally)
  const canvasDocsPath = () => {
    const userDataPath = app.getPath("userData");
    const docsPath = require("path").join(
      userDataPath,
      "canvas-documents.json",
    );
    return docsPath;
  };

  const loadCanvasDocs = (): any[] => {
    try {
      const p = canvasDocsPath();
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
      }
    } catch (e) {
      logger.warn("Failed to load canvas documents:", e);
    }
    return [];
  };

  const saveCanvasDocs = (docs: any[]) => {
    try {
      fs.writeFileSync(
        canvasDocsPath(),
        JSON.stringify(docs, null, 2),
        "utf-8",
      );
    } catch (e) {
      logger.warn("Failed to save canvas documents:", e);
    }
  };

  ipcMain.handle("canvas:listDocuments", () => {
    return { ok: true, documents: loadCanvasDocs() };
  });

  ipcMain.handle("canvas:createDocument", (_e, doc: any) => {
    const docs = loadCanvasDocs();
    const now = new Date().toISOString();
    const normalizedDoc = {
      ...doc,
      id: String(doc?.id || `canvas_${Date.now()}`),
      title: String(doc?.title || "Quick Note"),
      content: String(doc?.content || ""),
      createdAt: doc?.createdAt || now,
      updatedAt: doc?.updatedAt || now,
    };
    docs.unshift(normalizedDoc);
    saveCanvasDocs(docs);
    return { ok: true, document: normalizedDoc };
  });

  ipcMain.handle("canvas:saveDocument", (_e, doc: any) => {
    const docs = loadCanvasDocs();
    const existing = docs.find((d: any) => d.id === doc.id);
    const normalizedDoc = {
      ...(existing || {}),
      ...doc,
      id: String(doc?.id || existing?.id || `canvas_${Date.now()}`),
      title: String(doc?.title ?? existing?.title ?? "Quick Note"),
      content: String(doc?.content ?? existing?.content ?? ""),
      createdAt:
        doc?.createdAt || existing?.createdAt || new Date().toISOString(),
      updatedAt: doc?.updatedAt || new Date().toISOString(),
    };
    const idx = docs.findIndex((d: any) => d.id === normalizedDoc.id);
    if (idx >= 0) {
      docs[idx] = normalizedDoc;
    } else {
      docs.unshift(normalizedDoc);
    }
    saveCanvasDocs(docs);
    return { ok: true, document: normalizedDoc };
  });

  ipcMain.handle("canvas:deleteDocument", (_e, docId: string) => {
    const docs = loadCanvasDocs();
    const filtered = docs.filter((d: any) => d.id !== docId);
    saveCanvasDocs(filtered);
    return { ok: true };
  });

  ipcMain.handle("canvas:getDocument", (_e, docId: string) => {
    const docs = loadCanvasDocs();
    const doc = docs.find((d: any) => d.id === docId);
    return { ok: true, document: doc || null };
  });

  // Canvas AI read/write (for AI to access canvas content)
  ipcMain.handle("canvas:read", (_e, docId?: string) => {
    const docs = loadCanvasDocs();
    if (docId) {
      const doc = docs.find((d: any) => d.id === docId);
      return { ok: true, document: doc || null };
    }
    // Return the most recent document if no ID specified
    return { ok: true, document: docs[0] || null };
  });

  ipcMain.handle(
    "canvas:write",
    (
      _e,
      data: {
        documentId?: string;
        content?: string;
        title?: string;
        action?: "append" | "replace" | "insert";
        position?: number;
      },
    ) => {
      const sidebar = getSidebarWindow();
      if (sidebar && !sidebar.isDestroyed()) {
        sidebar.webContents.send("canvas:update", data);
      }
      return { ok: true };
    },
  );

  // Local webhook URL
  ipcMain.handle("webhooks:localUrl", (_e, id?: string) => {
    const token = "";
    const topic = typeof id === "string" && id ? `/${id}` : "";
    const port = getLocalWebhookPort();
    return {
      ok: true,
      url: `http://127.0.0.1:${port}/webhooks/incoming${topic}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    };
  });

  // Cloud webhook events (received via cloud-ai websocket -> renderer -> preload -> main)
  ipcMain.handle("webhooks:cloudEvent", async (_e, payload: any) => {
    return handleCloudWebhookEvent(payload);
  });

  // Files
  ipcMain.handle("files:select", () => selectFiles());
  ipcMain.handle("files:selectImages", () => selectImages());
  ipcMain.handle(
    "files:selectFolder",
    (_e, options?: { title?: string; multiple?: boolean }) =>
      selectFolder(options),
  );
  ipcMain.handle("files:showItemInFolder", (_e, filePath: string) => {
    try {
      const p = String(filePath || "").trim();
      if (!p) return { ok: false, error: "invalid_path" };
      try {
        shell.showItemInFolder(p);
      } catch {}
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });
  ipcMain.handle("files:listDirectory", async (_e, dirPath?: string) => {
    try {
      const entries = await listDirectory(dirPath);
      return { ok: true, entries };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  // System helpers

  ipcMain.handle("system:getLinkPreview", async (_e, url: string) => {
    try {
      const UA = "StuardAI-LinkBot/1.0";
      const normalizeUrl = (raw: string) => {
        const s = String(raw || "")
          .trim()
          .replace(/^<|>$/g, "");
        return s.replace(/[\.,!?;:]+$/g, "");
      };
      const targetUrl = normalizeUrl(url);
      if (!targetUrl || !targetUrl.startsWith("http"))
        return { ok: false, error: "invalid_url" };

      // SECURITY: Block SSRF attempts to internal/private networks
      if (isPrivateOrInternalUrl(targetUrl)) {
        console.warn(`[getLinkPreview] SSRF blocked: ${targetUrl}`);
        return {
          ok: false,
          error: "blocked_internal_url",
          message: "Cannot fetch preview for internal/private URLs",
        };
      }

      const response = await fetch(targetUrl, {
        headers: { "User-Agent": UA },
      });
      if (!response.ok) return { ok: false, error: "fetch_failed" };
      const html = await response.text();

      const getMeta = (prop: string) => {
        const metas = html.match(/<meta\b[^>]*>/gi) || [];
        for (const tag of metas) {
          const attrs: Record<string, string> = {};
          const attrRe = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
          let m: RegExpExecArray | null;
          while ((m = attrRe.exec(tag)) !== null) {
            const key = String(m[1] || "").toLowerCase();
            const val = String(m[3] ?? m[4] ?? m[5] ?? "");
            attrs[key] = val;
          }
          const k = String(attrs.property || attrs.name || "").toLowerCase();
          if (k === prop.toLowerCase()) {
            return attrs.content;
          }
        }
        return undefined;
      };

      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const title =
        getMeta("og:title") || (titleMatch ? titleMatch[1] : "") || "";
      const description =
        getMeta("og:description") || getMeta("description") || "";
      const siteName = getMeta("og:site_name") || "";
      let image = getMeta("og:image:secure_url") || getMeta("og:image") || "";

      const resolveAgainst = (maybeUrl: string, base: string) => {
        const v = String(maybeUrl || "").trim();
        if (!v) return "";
        if (v.startsWith("data:")) return v;
        try {
          return new URL(v, base).toString();
        } catch {
          return v;
        }
      };

      const tryFetchImageAsDataUrl = async (imgUrl: string) => {
        try {
          const r = await fetch(imgUrl, {
            headers: { "User-Agent": UA, Accept: "image/*,*/*;q=0.8" },
          });
          if (!r.ok) return undefined;
          const contentType = String(r.headers.get("content-type") || "")
            .split(";")[0]
            .trim();
          const ab = await r.arrayBuffer();
          if (ab.byteLength > 2_000_000) return undefined;
          const b64 = Buffer.from(ab).toString("base64");
          const ct = contentType || "image/jpeg";
          return `data:${ct};base64,${b64}`;
        } catch {
          return undefined;
        }
      };

      if (image) {
        const resolved = resolveAgainst(image, targetUrl);
        const proxied = resolved.startsWith("http")
          ? await tryFetchImageAsDataUrl(resolved)
          : undefined;
        image = proxied || resolved;
      }

      if (!image) {
        let screenshotWin: BrowserWindow | null = null;
        try {
          // Use a real browser User-Agent to avoid bot detection
          const browserUA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
          screenshotWin = new BrowserWindow({
            width: 1280,
            height: 800,
            show: false,
            webPreferences: {
              offscreen: true,
              javascript: true,
              webSecurity: true,
            },
          });

          // Wait for page to finish loading with timeout
          const loadPromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => resolve(), 8000); // 8s max timeout
            screenshotWin!.webContents.once("did-finish-load", () => {
              clearTimeout(timeout);
              resolve();
            });
            screenshotWin!.webContents.once(
              "did-fail-load",
              (_e, code, desc) => {
                clearTimeout(timeout);
                reject(new Error(`Load failed: ${code} ${desc}`));
              },
            );
          });

          screenshotWin.loadURL(targetUrl, { userAgent: browserUA });
          await loadPromise;

          // Wait for images and animations to settle
          await new Promise((resolve) => setTimeout(resolve, 1500));

          // Scroll to top to ensure we capture the header/hero area
          await screenshotWin.webContents.executeJavaScript(
            "window.scrollTo(0, 0)",
          );
          await new Promise((resolve) => setTimeout(resolve, 300));

          const nativeImage = await screenshotWin.webContents.capturePage();
          if (!nativeImage.isEmpty()) {
            const resized = nativeImage.resize({ width: 600, quality: "good" });
            image = resized.toDataURL();
          }
        } catch (screenshotErr: any) {
          console.warn(
            "[getLinkPreview] Screenshot failed:",
            screenshotErr?.message,
          );
        } finally {
          try {
            screenshotWin?.destroy();
          } catch {}
        }
      }

      return {
        ok: true,
        data: { title, description, image, url: targetUrl, siteName },
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  ipcMain.handle("system:openExternal", (_e, url: string) => {
    if (typeof url === "string") {
      try {
        shell.openExternal(url);
      } catch {}
    }
  });
  ipcMain.handle("system:notify", (_e, payload: any) => {
    try {
      const title = String(payload?.title || "Stuard AI");
      // Normalize body/message
      const message = String(payload?.message || payload?.body || "");
      // Defaults
      const variant = payload?.variant || "info";
      const position = payload?.position || "top-right"; // User preferred position
      const duration =
        typeof payload?.duration === "number" ? payload.duration : 5000;

      const config = {
        ...payload,
        title,
        message,
        variant,
        position,
        duration,
      };

      const notifWin = getNotificationWindow();
      if (notifWin && !notifWin.isDestroyed()) {
        notifWin.webContents.send("notification:show", config);
      } else {
        // Fallback to native
        if (
          Notification &&
          typeof (Notification as any).isSupported === "function" &&
          Notification.isSupported()
        ) {
          const n = new Notification({ title, body: message });
          n.show();
        }
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e || "failed") };
    }
  });
  ipcMain.handle(
    "notification:respond",
    (
      _e,
      payload: {
        responseId: string;
        type: "submit" | "cancel" | "dismiss";
        value?: string;
      },
    ) => {
      try {
        const settled = settleNotificationResponse(payload);
        return { ok: settled };
      } catch (e: any) {
        return {
          ok: false,
          error: String(e?.message || "notification_response_failed"),
        };
      }
    },
  );

  // Permission approval relay: notification window → main overlay window
  ipcMain.on(
    "permission:respond",
    (_event, payload: { id: string; allow: boolean }) => {
      // Broadcast to all windows so the main overlay (which holds the WS) picks it up
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) {
          try {
            w.webContents.send("permission:response", payload);
          } catch {}
        }
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Security & Privacy
  // ═══════════════════════════════════════════════════════════════════════════

  ipcMain.handle("security:getSettings", async () => {
    try {
      return await execLocalTool("security_get_settings", {});
    } catch (e: any) {
      return { ok: false, error: e?.message || "security_get_settings failed" };
    }
  });

  ipcMain.handle(
    "security:setPassword",
    async (_e, password: string, currentPassword?: string) => {
      try {
        return await execLocalTool("security_set_password", {
          password,
          current_password: currentPassword,
        });
      } catch (e: any) {
        return {
          ok: false,
          error: e?.message || "security_set_password failed",
        };
      }
    },
  );

  ipcMain.handle("security:verifyPassword", async (_e, password: string) => {
    try {
      return await execLocalTool("security_verify_password", { password });
    } catch (e: any) {
      return {
        ok: false,
        error: e?.message || "security_verify_password failed",
      };
    }
  });

  ipcMain.handle("security:updateSettings", async (_e, updates: any) => {
    try {
      return await execLocalTool("security_update_settings", updates || {});
    } catch (e: any) {
      return {
        ok: false,
        error: e?.message || "security_update_settings failed",
      };
    }
  });

  ipcMain.handle(
    "security:removePassword",
    async (_e, currentPassword: string) => {
      try {
        return await execLocalTool("security_remove_password", {
          current_password: currentPassword,
        });
      } catch (e: any) {
        return {
          ok: false,
          error: e?.message || "security_remove_password failed",
        };
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Secure Vault (Credential Management)
  // Routes to Python agent vault tools via execLocalTool
  // ═══════════════════════════════════════════════════════════════════════════

  ipcMain.handle("vault:list", async (_e, options?: any) => {
    try {
      return await execLocalTool("vault_list", options || {});
    } catch (e: any) {
      return { ok: false, error: e?.message || "vault_list failed" };
    }
  });

  ipcMain.handle("vault:get", async (_e, id: string) => {
    try {
      return await execLocalTool("vault_get", { id });
    } catch (e: any) {
      return { ok: false, error: e?.message || "vault_get failed" };
    }
  });

  ipcMain.handle("vault:add", async (_e, entry: any) => {
    try {
      return await execLocalTool("vault_add", entry || {});
    } catch (e: any) {
      return { ok: false, error: e?.message || "vault_add failed" };
    }
  });

  ipcMain.handle("vault:update", async (_e, id: string, fields: any) => {
    try {
      return await execLocalTool("vault_update", { id, ...fields });
    } catch (e: any) {
      return { ok: false, error: e?.message || "vault_update failed" };
    }
  });

  ipcMain.handle("vault:delete", async (_e, id: string) => {
    try {
      return await execLocalTool("vault_delete", { id });
    } catch (e: any) {
      return { ok: false, error: e?.message || "vault_delete failed" };
    }
  });

  ipcMain.handle("vault:search", async (_e, query: string) => {
    try {
      return await execLocalTool("vault_search", { query });
    } catch (e: any) {
      return { ok: false, error: e?.message || "vault_search failed" };
    }
  });

  ipcMain.handle("vault:stats", async () => {
    try {
      return await execLocalTool("vault_stats", {});
    } catch (e: any) {
      return { ok: false, error: e?.message || "vault_stats failed" };
    }
  });

  ipcMain.on("window:ignore-mouse-events", (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.setIgnoreMouseEvents(ignore, options);
  });

  // Logs
  ipcMain.handle("system:openLogs", () => {
    try {
      const logDir = logger.getLogDir();
      shell.openPath(logDir);
      return { ok: true, path: logDir };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });
  ipcMain.handle("system:getLogPath", () => {
    return { ok: true, path: logger.getLogPath(), dir: logger.getLogDir() };
  });
  ipcMain.handle("system:readLogs", (_e, lines?: number) => {
    try {
      const logPath = logger.getLogPath();
      if (!fs.existsSync(logPath)) {
        return { ok: true, content: "", path: logPath };
      }
      const content = fs.readFileSync(logPath, "utf-8");
      const allLines = content.split("\n");
      const n = typeof lines === "number" && lines > 0 ? lines : 200;
      const lastLines = allLines.slice(-n).join("\n");
      return {
        ok: true,
        content: lastLines,
        path: logPath,
        totalLines: allLines.length,
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });
  ipcMain.handle("system:getAppInfo", () => {
    return {
      ok: true,
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      userData: app.getPath("userData"),
      resources: process.resourcesPath,
      logPath: logger.getLogPath(),
    };
  });

  ipcMain.handle(
    "system:getFileIcon",
    async (
      _e,
      filePath: string,
      options?: { size?: "small" | "normal" | "large" },
    ) => {
      return getFileIconCached(filePath, options);
    },
  );

  // Theme
  ipcMain.handle("prefs:applyTheme", (_e, data: any) => {
    try {
      const raw = String(data?.themeMode || "").toLowerCase();
      const mode =
        raw === "custom" ? "custom" : raw === "dark" ? "dark" : "light";
      const dark =
        typeof data?.themeDarkShade === "string"
          ? data.themeDarkShade
          : undefined;
      const light =
        typeof data?.themeLightShade === "string"
          ? data.themeLightShade
          : undefined;
      const txt =
        data?.themeText === "black" || data?.themeText === "white"
          ? data.themeText
          : undefined;
      const payload: any = { themeMode: mode };
      if (dark != null) payload.themeDarkShade = dark;
      if (light != null) payload.themeLightShade = light;
      if (txt != null) payload.themeText = txt;
      for (const w of BrowserWindow.getAllWindows()) {
        try {
          w.webContents.send("prefs:themeUpdated", payload);
        } catch {}
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  // Screen capture invisibility
  ipcMain.handle("prefs:setScreenCaptureInvisible", (_e, enabled: boolean) => {
    try {
      setScreenCaptureInvisible(!!enabled);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  // Timezone
  ipcMain.handle("prefs:getTimezone", () => {
    return { ok: true, timezone: getTimezone() };
  });
  ipcMain.handle("prefs:setTimezone", (_e, tz: string | null) => {
    try {
      setTimezone(typeof tz === "string" && tz.trim() ? tz.trim() : null);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  // ── Renderer preferences (persist across restarts) ──
  ipcMain.handle("prefs:getAll", () => {
    try {
      return { ok: true, prefs: getRendererPrefs() };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  ipcMain.handle("prefs:set", (_e, key: string, value: any) => {
    try {
      setRendererPrefs({ [key]: value });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  ipcMain.handle("prefs:setMany", (_e, prefs: Record<string, any>) => {
    try {
      if (prefs && typeof prefs === "object") {
        setRendererPrefs(prefs);
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  ipcMain.handle("browserUse:getChromeSyncSettings", () => {
    try {
      const settings = loadSettings();
      return {
        ok: true,
        settings: {
          chromeSyncEnabled: settings.chromeSyncEnabled !== false,
          chromeSyncBrowserName: settings.chromeSyncBrowserName || "Chrome",
          chromeSyncProfileName: settings.chromeSyncProfileName || "Default",
          chromeSyncProfilePath: settings.chromeSyncProfilePath || null,
          chromeSyncUserDataDir: settings.chromeSyncUserDataDir || null,
        },
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  ipcMain.handle("browserUse:listChromeProfiles", () => {
    try {
      return { ok: true, browsers: listChromeProfilesLocal() };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  ipcMain.handle("browserUse:updateChromeSyncSettings", (_e, updates: any) => {
    try {
      const next = {
        chromeSyncEnabled: updates?.chromeSyncEnabled !== false,
        chromeSyncBrowserName:
          typeof updates?.chromeSyncBrowserName === "string" &&
          updates.chromeSyncBrowserName.trim()
            ? updates.chromeSyncBrowserName.trim()
            : null,
        chromeSyncProfileName:
          typeof updates?.chromeSyncProfileName === "string" &&
          updates.chromeSyncProfileName.trim()
            ? updates.chromeSyncProfileName.trim()
            : null,
        chromeSyncProfilePath:
          typeof updates?.chromeSyncProfilePath === "string" &&
          updates.chromeSyncProfilePath.trim()
            ? updates.chromeSyncProfilePath.trim()
            : null,
        chromeSyncUserDataDir:
          typeof updates?.chromeSyncUserDataDir === "string" &&
          updates.chromeSyncUserDataDir.trim()
            ? updates.chromeSyncUserDataDir.trim()
            : null,
      };
      saveSettings(next);
      return {
        ok: true,
        settings: {
          ...next,
          chromeSyncEnabled: next.chromeSyncEnabled !== false,
        },
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  // Outlook
  ipcMain.handle("outlook:getToken", async () => {
    const r = await getOutlookAccessTokenLocal();
    if (!r.ok) return { ok: false, error: "not_connected" };
    return r;
  });
  ipcMain.handle("outlook:connect", async () => {
    try {
      const r = await startOutlookConnect();
      return r;
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e || "failed") };
    }
  });
  ipcMain.handle("outlook:status", async () => getOutlookStatus());

  // Canvas/Board windows management
  ipcMain.handle("canvas:create", (_e, item: any) => {
    try {
      createBoardWindow(item);
    } catch {}
  });
  ipcMain.handle("canvas:update", (_e, item: any) => {
    try {
      updateBoardWindow(item);
    } catch {}
  });
  ipcMain.handle("canvas:delete", (_e, id: string) => {
    try {
      deleteBoardWindow(id);
    } catch {}
  });
  ipcMain.handle("canvas:show", (_e, id: string) => {
    try {
      showBoardWindow(id);
    } catch {}
  });
  ipcMain.handle("canvas:hide", (_e, id: string) => {
    try {
      hideBoardWindow(id);
    } catch {}
  });
  ipcMain.handle("canvas:focus", (_e, id: string) => {
    try {
      focusBoardWindow(id);
    } catch {}
  });
  ipcMain.handle("canvas:clear", () => {
    try {
      clearBoardWindows();
    } catch {}
  });
  ipcMain.handle("canvas:list", () => {
    try {
      return listBoardWindows();
    } catch {
      return [];
    }
  });

  // Workflows
  ipcMain.handle("workflows:list", () => workflows_list());
  ipcMain.handle("workflows:read", (_e, id: string) => workflows_read(id));
  ipcMain.handle(
    "workflows:save",
    (_e, payload: { id: string; content: string }) => workflows_save(payload),
  );
  ipcMain.handle("workflows:delete", (_e, id: string) => workflows_delete(id));
  ipcMain.handle(
    "workflows:run",
    (_e, id: string, triggerId?: string, options?: { accessToken?: string }) =>
      workflows_run(id, triggerId, options),
  );
  ipcMain.handle("workflows:stop", (_e, id: string) => workflows_stop(id));
  ipcMain.handle("workflows:deploy", (_e, id: string) => workflows_deploy(id));
  ipcMain.handle("workflows:undeploy", (_e, id: string) =>
    workflows_undeploy(id),
  );
  ipcMain.handle("workflows:getDeployStatus", (_e, id: string) =>
    workflows_getDeployStatus(id),
  );
  ipcMain.handle(
    "workflows:runStep",
    (
      _e,
      id: string,
      options: {
        step: { id: string; tool: string; args: any };
        accessToken?: string;
      },
    ) => workflows_runStep(id, options),
  );
  ipcMain.handle(
    "workflows:runFromStep",
    (_e, id: string, options: { startStepId: string; accessToken?: string }) =>
      workflows_runFromStep(id, options),
  );
  ipcMain.handle("workflows:export", async (_e, id: string) => {
    return await execLocalTool("export_workflow", { id });
  });
  ipcMain.handle("workflows:import", async (_e, path: string) => {
    return await execLocalTool("import_workflow", { path });
  });
  ipcMain.handle("workflows:validate", async (_e, id: string) => {
    return await execLocalTool("validate_workflow_requirements", { id });
  });
  // Folder operations
  ipcMain.handle("workflows:createFolder", (_e, name: string) =>
    workflows_createFolder(name),
  );
  ipcMain.handle(
    "workflows:renameFolder",
    (_e, oldName: string, newName: string) =>
      workflows_renameFolder(oldName, newName),
  );
  ipcMain.handle(
    "workflows:deleteFolder",
    (_e, name: string, deleteContents?: boolean) =>
      workflows_deleteFolder(name, deleteContents),
  );
  ipcMain.handle(
    "workflows:moveToFolder",
    (_e, id: string, folder: string | null) =>
      workflows_moveToFolder(id, folder),
  );
  // Workspace file management
  ipcMain.handle("workflows:ensureWorkspace", (_e, id: string) =>
    workflows_ensureWorkspace(id),
  );
  ipcMain.handle("workflows:getWorkspaceInfo", (_e, id: string) =>
    workflows_getWorkspaceInfo(id),
  );
  ipcMain.handle(
    "workflows:listWorkspaceFiles",
    (_e, id: string, subpath?: string) =>
      workflows_listWorkspaceFiles(id, subpath),
  );
  ipcMain.handle(
    "workflows:readWorkspaceFile",
    (_e, id: string, filePath: string) =>
      workflows_readWorkspaceFile(id, filePath),
  );
  ipcMain.handle(
    "workflows:readWorkspaceFileBinary",
    (_e, id: string, filePath: string) =>
      workflows_readWorkspaceFileBinary(id, filePath),
  );
  ipcMain.handle(
    "workflows:writeWorkspaceFile",
    (_e, id: string, filePath: string, content: string) =>
      workflows_writeWorkspaceFile(id, filePath, content),
  );
  ipcMain.handle(
    "workflows:deleteWorkspaceFile",
    (_e, id: string, filePath: string) =>
      workflows_deleteWorkspaceFile(id, filePath),
  );
  ipcMain.handle(
    "workflows:createWorkspaceSubdir",
    (_e, id: string, subpath: string) =>
      workflows_createWorkspaceSubdir(id, subpath),
  );
  ipcMain.handle(
    "workflows:renameWorkspaceFile",
    (_e, id: string, oldPath: string, newName: string) =>
      workflows_renameWorkspaceFile(id, oldPath, newName),
  );
  ipcMain.handle(
    "workflows:moveWorkspaceFile",
    (_e, id: string, sourcePath: string, destFolder: string) =>
      workflows_moveWorkspaceFile(id, sourcePath, destFolder),
  );
  // Sub-workflow (.stuard) management
  ipcMain.handle(
    "workflows:createWorkspaceStuard",
    (_e, id: string, subPath: string, name?: string) =>
      workflows_createWorkspaceStuard(id, subPath, name),
  );
  ipcMain.handle(
    "workflows:readWorkspaceStuard",
    (_e, id: string, subPath: string) =>
      workflows_readWorkspaceStuard(id, subPath),
  );
  ipcMain.handle(
    "workflows:saveWorkspaceStuard",
    (_e, id: string, subPath: string, content: string) =>
      workflows_saveWorkspaceStuard(id, subPath, content),
  );
  ipcMain.handle("workflows:listWorkspaceFunctions", (_e, id: string) =>
    workflows_listWorkspaceFunctions(id),
  );

  // Dynamic agent tool options — built from the desktop TOOL_REGISTRY
  ipcMain.handle("workflows:getAgentToolOptions", () => {
    try {
      // Tools to exclude from the agent tool picker (internal/orchestration/UI-only)
      const EXCLUDED = new Set([
        'end', 'return_value', 'log', 'stop_workflow', 'test_run_steps',
        'run_sequential', 'run_parallel', 'loop_executor',
        'custom_ui', 'update_custom_ui', 'close_custom_ui',
        'send_notification', 'send_ui_event', 'run_ui_script',
        'list_custom_ui_windows', 'invoke_workflow', 'call_workflow',
        'call_function', 'call_workspace_function', 'list_workspace_functions',
        'ask_confirmation', 'show_choices', 'pick_date', 'request_files',
        'show_table', 'show_info', 'show_details', 'show_files',
        'show_command', 'show_json', 'show_link', 'show_colors',
        'show_progress', 'show_info_card', 'show_feedback_form',
        'sidebar_canvas_list', 'sidebar_canvas_read', 'sidebar_canvas_write',
        'sidebar_canvas_create', 'sidebar_canvas_delete',
        'ai_inference', 'analyze_image', 'analyze_current_screen',
        'find_text', 'find_text_on_screen', 'find_and_click_text',
        'google_cloud_ocr', 'browser_status',
      ]);

      // Prefix → group mapping
      const PREFIX_GROUPS: [string, string][] = [
        ['gmail_', 'Google'],
        ['google_', 'Google'],
        ['calendar_', 'Google'],
        ['drive_', 'Google'],
        ['docs_', 'Google'],
        ['sheets_', 'Google'],
        ['tasks_', 'Google'],
        ['outlook_', 'Outlook'],
        ['github_', 'GitHub'],
        ['discord_', 'Discord'],
        ['reddit_', 'Reddit'],
        ['facebook_', 'Meta Social'],
        ['instagram_', 'Meta Social'],
        ['threads_', 'Meta Social'],
        ['whatsapp_', 'WhatsApp'],
        ['telnyx_', 'Telnyx'],
        ['browser_use_', 'Browser Automation'],
        ['browser_', 'Browser Control'],
        ['terminal_', 'Terminal'],
        ['canvas_', 'Canvas'],
        ['ollama_', 'Ollama (Local AI)'],
        ['cloud_storage_', 'Cloud Storage'],
        ['workspace_', 'Workspace'],
        ['proactive_', 'Proactive'],
        ['embed_', 'Embeddings'],
        ['vector_', 'Embeddings'],
        ['elevenlabs_', 'ElevenLabs'],
        ['youtube_', 'YouTube'],
        ['mediapipe_', 'MediaPipe'],
      ];

      // Kind → fallback group
      const KIND_GROUPS: Record<string, string> = {
        electron: 'Desktop',
        cloud: 'Cloud AI',
        orchestration: 'Orchestration',
        local: 'System',
      };

      function snakeToLabel(name: string): string {
        // Remove common prefixes for cleaner labels
        for (const [prefix] of PREFIX_GROUPS) {
          if (name.startsWith(prefix)) {
            name = name.slice(prefix.length);
            break;
          }
        }
        return name
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
      }

      function getGroup(name: string, kind: string): string {
        for (const [prefix, group] of PREFIX_GROUPS) {
          if (name.startsWith(prefix)) return group;
        }
        // Fallback: group by kind
        return KIND_GROUPS[kind] || 'Other';
      }

      const options: Array<{ value: string; label: string; description: string; group: string }> = [];

      for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
        if (EXCLUDED.has(name)) continue;
        const group = getGroup(name, entry.kind);
        options.push({
          value: name,
          label: snakeToLabel(name),
          description: `${group} tool`,
          group,
        });
      }

      // Sort by group then label
      options.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));

      return { ok: true, tools: options };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || 'failed'), tools: [] };
    }
  });

  // Skills
  loadSkills();
  ipcMain.handle("skills:list", () => skills_list());
  ipcMain.handle("skills:get", (_e, id: string) => skills_get(id));
  ipcMain.handle("skills:save", (_e, skill: Skill) => skills_save(skill));
  ipcMain.handle("skills:delete", (_e, id: string) => skills_delete(id));
  ipcMain.handle("skills:toggle", (_e, id: string) => skills_toggle(id));

  // Unified Tasks
  ipcMain.handle("unified-tasks:list", () => unifiedTasksService.list());
  ipcMain.handle("unified-tasks:get", (_e, taskId: string) =>
    unifiedTasksService.get(taskId),
  );
  ipcMain.handle("unified-tasks:add", (_e, task: any) =>
    unifiedTasksService.add(task),
  );
  ipcMain.handle("unified-tasks:update", (_e, task: any) =>
    unifiedTasksService.update(task),
  );
  ipcMain.handle("unified-tasks:delete", (_e, taskId: string) =>
    unifiedTasksService.delete(taskId),
  );
  ipcMain.handle("unified-tasks:toggle-status", (_e, taskId: string) =>
    unifiedTasksService.toggleStatus(taskId),
  );
  ipcMain.handle(
    "unified-tasks:add-subtodo",
    (_e, taskId: string, subtodo: any) =>
      unifiedTasksService.addSubtodo(taskId, subtodo),
  );
  ipcMain.handle(
    "unified-tasks:update-subtodo",
    (_e, taskId: string, subtodoId: string, updates: any) =>
      unifiedTasksService.updateSubtodo(taskId, subtodoId, updates),
  );
  ipcMain.handle(
    "unified-tasks:toggle-subtodo",
    (_e, taskId: string, subtodoId: string) =>
      unifiedTasksService.toggleSubtodo(taskId, subtodoId),
  );
  ipcMain.handle(
    "unified-tasks:delete-subtodo",
    (_e, taskId: string, subtodoId: string) =>
      unifiedTasksService.deleteSubtodo(taskId, subtodoId),
  );
  ipcMain.handle(
    "unified-tasks:add-agent-assignment",
    (_e, taskId: string, assignment: any) =>
      unifiedTasksService.addAgentAssignment(taskId, assignment),
  );
  ipcMain.handle(
    "unified-tasks:update-agent-assignment",
    (_e, taskId: string, assignmentId: string, updates: any) =>
      unifiedTasksService.updateAgentAssignment(taskId, assignmentId, updates),
  );
  ipcMain.handle(
    "unified-tasks:delete-agent-assignment",
    (_e, taskId: string, assignmentId: string) =>
      unifiedTasksService.deleteAgentAssignment(taskId, assignmentId),
  );
  ipcMain.handle("unified-tasks:get-pending-assignments", () =>
    unifiedTasksService.getPendingAssignments(),
  );
  ipcMain.handle("unified-tasks:get-calendar-items", () =>
    unifiedTasksService.getCalendarItems(),
  );

  // Offline Calendar
  ipcMain.handle("offline-calendar:list", () => offlineCalendarService.list());
  ipcMain.handle("offline-calendar:get", (_e, eventId: string) =>
    offlineCalendarService.get(eventId),
  );
  ipcMain.handle("offline-calendar:add", (_e, eventData: any) =>
    offlineCalendarService.add(eventData),
  );
  ipcMain.handle("offline-calendar:update", (_e, eventData: any) =>
    offlineCalendarService.update(eventData),
  );
  ipcMain.handle("offline-calendar:delete", (_e, eventId: string) =>
    offlineCalendarService.delete(eventId),
  );
  ipcMain.handle(
    "offline-calendar:get-for-range",
    (_e, startIso: string, endIso: string) =>
      offlineCalendarService.getForRange(startIso, endIso),
  );
  ipcMain.handle(
    "offline-calendar:get-calendar-blocks",
    (_e, startIso: string, endIso: string) =>
      offlineCalendarService.getCalendarBlocks(startIso, endIso),
  );

  // Python Environment Management
  ipcMain.handle("python:status", async () => {
    return await execLocalTool("python_status", {});
  });
  ipcMain.handle("python:setup", async () => {
    return await execLocalTool("python_setup", {});
  });
  ipcMain.handle("python:install", async (_e, args: any) => {
    return await execLocalTool("python_install", args);
  });

  // Stuards
  ipcMain.handle("stuards:list", () => stuards_list());
  ipcMain.handle("stuards:read", (_e, id: string) => stuards_read(id));
  ipcMain.handle(
    "stuards:save",
    (_e, payload: { id: string; content: string }) => stuards_save(payload),
  );
  ipcMain.handle("stuards:deploy", (_e, id: string) => stuards_deploy(id));
  ipcMain.handle("stuards:stop", (_e, id: string) => stuards_stop(id));
  ipcMain.handle("stuards:run", (_e, id: string) => stuards_run(id));
  ipcMain.handle("stuards:importWorkflow", (_e, def: WorkflowDefinition) => {
    try {
      const spec = workflowToStuardSpec(def, {});
      const rawId =
        spec?.id || def?.name || "workflow_" + Date.now().toString(36);
      const id = safeStuardId(String(rawId));
      if (!id) return { ok: false, error: "invalid_id" };
      const content = JSON.stringify({ ...spec, id }, null, 2);
      const res = stuards_save({ id, content });
      if (!res?.ok) return res;
      return { ok: true, id };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });

  // Agent Instance Management
  ipcMain.handle("agent:start", async (_e, id?: string) => {
    try {
      const finalId = id || "default";
      const port = await startAgent(finalId);
      return { ok: true, port, id: finalId };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("agent:stop", async (_e, id: string) => {
    try {
      stopAgent(id);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("agent:list", async () => {
    try {
      return { ok: true, agents: listAgents() };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Updates
  ipcMain.handle("updates:getState", () => updates_getState());
  ipcMain.handle("updates:check", async () => updates_check());
  ipcMain.handle("updates:download", async () => updates_download());
  ipcMain.handle("updates:install", async () => updates_install());
  ipcMain.handle("updates:setChannel", async (_e, channel: string) =>
    updates_setChannel(channel as any),
  );
  ipcMain.handle("updates:onState", (_e) => {
    try {
      return updates_getState();
    } catch {
      return { status: "idle" };
    }
  });
  ipcMain.handle("updates:getApiEndpoint", () => {
    const { getCurrentApiEndpoint } = require("../services/updates");
    return { ok: true, endpoint: getCurrentApiEndpoint() };
  });

  // Tools execution (Renderer → Main → Local Agent/System)
  ipcMain.handle("tools:exec", async (_e, tool: string, args: any) => {
    try {
      logger.info("Initializing custom UI IPC...");
      // Initialize custom UI IPC with a function to get the router context
      const agentWsUrl =
        String(process.env.AGENT_WS || process.env.AGENT_WS_URL || "").trim() ||
        "ws://127.0.0.1:8765/ws";
      const cloudAiUrl = String(
        process.env.CLOUD_AI_HTTP ||
          process.env.CLOUD_PUBLIC_URL ||
          process.env.VITE_CLOUD_AI_URL ||
          "",
      )
        .trim()
        .replace(/\/+$/, "");

      const ctx: RouterContext = {
        agentWsUrl,
        cloudAiUrl,
        logFn: (msg: string) => {
          try {
            logger.info(`[tool] ${msg}`);
          } catch {}
        },
      };

      return await execUnifiedTool(String(tool || ""), args, ctx);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Custom UI prebuilt assets (for UI builder preview — avoids CDN)
  ipcMain.handle("customUi:getPrebuiltAssets", async () => {
    try {
      const {
        getReactUmd,
        getReactDomUmd,
      } = require("../custom-ui/assets/react-runtime");
      const {
        TAILWIND_PREBUILT_CSS,
      } = require("../custom-ui/assets/tailwind-prebuilt");
      const { EXTRA_CSS } = require("../custom-ui/assets/utility-css");
      return {
        ok: true,
        reactUmd: getReactUmd(),
        reactDomUmd: getReactDomUmd(),
        tailwindCss: TAILWIND_PREBUILT_CSS,
        extraCss: EXTRA_CSS,
      };
    } catch (e: any) {
      logger.error("[customUi:getPrebuiltAssets] Failed:", e);
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Transform JSX component code (for UI builder preview)
  ipcMain.handle("customUi:transformJsx", async (_e, code: string) => {
    try {
      const { prepareComponentCode } = require("../custom-ui/jsx-transform");
      const result = prepareComponentCode(code);
      return { ok: true, code: result.code, syntax: result.syntax };
    } catch (e: any) {
      logger.error("[customUi:transformJsx] Failed:", e);
      return { ok: false, error: String(e?.message || e), code };
    }
  });

  // Open chat in overlay
  ipcMain.handle("overlay:openChat", (_e, conversationId: string) => {
    try {
      setOverlayMode("window");
      showWindow();
      // Send event to renderer to open the specific chat
      const wins = BrowserWindow.getAllWindows();
      for (const w of wins) {
        w.webContents.send("overlay:open-chat", conversationId);
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Proactive Agent System

  /** Sync proactive config to VM so it can run its own standalone scheduler. */
  async function syncProactiveConfigToVM(config: any): Promise<void> {
    const cloudAiUrl = String(
      process.env.CLOUD_AI_HTTP ||
      process.env.CLOUD_PUBLIC_URL ||
      process.env.VITE_CLOUD_AI_URL ||
      "",
    ).trim().replace(/\/+$/, "");
    if (!cloudAiUrl) return;

    // Get auth token from renderer (same pattern as proactive-scheduler)
    let token: string | null = null;
    const { BrowserWindow } = await import("electron");
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        try {
          token = await win.webContents.executeJavaScript(
            `(async () => { try { const { data } = await window.supabase?.auth?.getSession(); return data?.session?.access_token || null; } catch { return null; } })()`,
            true
          );
          if (token) break;
        } catch { /* ignore */ }
      }
    }
    if (!token) return;

    const { net } = await import("electron");
    await net.fetch(`${cloudAiUrl}/v1/proactive/vm-config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        enabled: config.enabled,
        interval: config.interval,
        modelMode: config.modelMode,
        instructions: config.instructions,
        notificationChannels: config.notificationChannels,
      }),
    });
  }

  ipcMain.handle("proactive:getConfig", () => proactiveService.getConfig());
  ipcMain.handle("proactive:updateConfig", async (_e, updates: any) => {
    try {
      const result = proactiveService.updateConfig(updates || {});

      // When executionTarget changes to 'cloud', sync proactive config to VM
      // so its standalone scheduler runs independently of the desktop.
      const config = result.config;
      if (config.executionTarget === "cloud") {
        syncProactiveConfigToVM(config).catch((e: any) => {
          logger.warn("[proactive] VM config sync failed:", e?.message);
        });
      } else if (updates.executionTarget === "local") {
        // Disable VM scheduler when switching back to local
        syncProactiveConfigToVM({ ...config, enabled: false }).catch(() => {});
      }

      return result;
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });
  ipcMain.handle("proactive:listTasks", () => proactiveService.listTasks());
  ipcMain.handle("proactive:addTask", (_e, task: any) => {
    try {
      return proactiveService.addTask(task || {});
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });
  ipcMain.handle("proactive:updateTask", (_e, taskId: string, updates: any) => {
    try {
      return proactiveService.updateTask(taskId, updates || {});
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });
  ipcMain.handle("proactive:deleteTask", (_e, taskId: string) => {
    try {
      return proactiveService.deleteTask(taskId);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });
  ipcMain.handle("proactive:getWakeUpLog", (_e, limit?: number) => {
    try {
      return proactiveService.getWakeUpLog(
        typeof limit === "number" ? limit : 20,
      );
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });
  ipcMain.handle("proactive:triggerNow", () => triggerManualWakeUp());
  ipcMain.handle("proactive:getAvailableTools", () => {
    try {
      return {
        ok: true,
        tools: Object.keys(TOOL_REGISTRY).sort((a, b) => a.localeCompare(b)),
      };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || "failed") };
    }
  });
  ipcMain.handle("proactive:submitResult", () => ({ ok: true }));
  ipcMain.handle("proactive:isRunning", () => ({
    ok: true,
    running: isProactiveSchedulerRunning(),
  }));
  ipcMain.handle(
    "proactive:reply",
    async (_e, payload: { wakeUpId: string; text: string }) => {
      const wakeUpId = String(payload?.wakeUpId || "").trim();
      const text = String(payload?.text || "").trim();
      if (!wakeUpId) return { ok: false, error: "wakeUpId is required" };
      if (!text) return { ok: false, error: "text is required" };
      return handleProactiveReply(wakeUpId, text);
    },
  );

  ipcMain.handle("search:unified", async (_e, query: string, options?: any) => {
    try {
      const results = await unifiedSearch(query, options || {});
      return { ok: true, results };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("fileIndex:getPendingCount", async () => {
    try {
      const count = await getPendingCount();
      return { ok: true, count };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("fileIndex:getScanStatus", () => {
    try {
      return { ok: true, ...getScanStatus() };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("fileIndex:initDefaults", async () => {
    try {
      const result = await reinitializeDefaultFolders();
      return { ok: true, ...result };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("fileIndex:scanAll", async () => {
    try {
      // Run indexing in background, don't await
      runStartupIndexing().catch((e) => {
        logger.error("[fileIndex:scanAll] Error:", e);
      });
      // Also refresh app cache in background
      refreshAppCache().catch(() => {});
      return { ok: true, message: "Scan started in background" };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle(
    "fileIndex:processSemanticIndexing",
    async (_e, token: string, limit: number) => {
      try {
        const progress = await processSemanticIndexing(token, limit, (p) => {
          // Send progress updates to all windows
          BrowserWindow.getAllWindows().forEach((win) => {
            try {
              win.webContents.send("file-index:semantic-progress", p);
            } catch {}
          });
        });
        return { ok: true, progress };
      } catch (e: any) {
        logger.error("[fileIndex:processSemanticIndexing] Error:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    },
  );

  // Polar Billing
  ipcMain.handle("billing:createCheckout", async (_e, options: any) => {
    try {
      return await createCheckout(options);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("billing:getCustomer", async (_e, email: string) => {
    try {
      return await getCustomer(email);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("billing:listProducts", async () => {
    try {
      return await listProducts();
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("billing:openPortal", async (_e, customerId: string) => {
    try {
      return await openCustomerPortal(customerId);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle("billing:purchaseCredits", async (_e, options: any) => {
    try {
      return await purchaseCredits(options);
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Quick Shortcuts / Bookmarks
  const bookmarksPath = () => {
    const userDataPath = app.getPath("userData");
    return require("path").join(userDataPath, "quick-shortcuts.json");
  };

  // Track registered bookmark keybinds so we can unregister them
  const registeredBookmarkKeybinds = new Set<string>();

  const executeBookmarkById = async (bookmarkId: string) => {
    const bookmarks = loadBookmarks();
    const bookmark = bookmarks.find((b: any) => b.id === bookmarkId);
    if (!bookmark) return;
    // Reuse the bookmarks:execute handler logic inline
    try {
      const type = String(bookmark.type || "").toLowerCase();
      const target = String(bookmark.target || "").trim();
      switch (type) {
        case "url":
          if (target) shell.openExternal(target);
          break;
        case "app":
        case "file":
        case "folder":
          if (target) shell.openPath(target);
          break;
        case "workflow":
          if (target) await workflows_run(target);
          break;
        case "dashboard":
          openDashboardWindow({ tab: target || undefined });
          break;
        case "space":
          openSidebarWindow({ tab: "spaces", expanded: true });
          break;
        case "canvas":
          openSidebarWindow({ tab: "canvas", expanded: true });
          break;
        case "tasks":
          setOverlayMode("window");
          showWindow();
          for (const w of BrowserWindow.getAllWindows()) {
            try {
              w.webContents.send("overlay:view-mode", {
                mode: "tasks",
                subTab: target === "agent" ? "agent" : "todo",
              });
            } catch {}
          }
          break;
        case "terminal":
          openSidebarWindow({ tab: "terminal", expanded: true });
          break;
        case "overlay":
          setOverlayMode("window");
          showWindow();
          break;
        case "semantic-search":
          setOverlayMode("window");
          showWindow();
          for (const w of BrowserWindow.getAllWindows()) {
            try {
              w.webContents.send("overlay:semantic-search");
            } catch {}
          }
          break;
      }
    } catch (e) {
      logger.warn("Failed to execute bookmark via keybind:", e);
    }
  };

  const registerBookmarkKeybinds = (bookmarks: any[]) => {
    // Unregister all previously registered bookmark keybinds
    for (const accel of registeredBookmarkKeybinds) {
      try {
        globalShortcut.unregister(accel);
      } catch {}
    }
    registeredBookmarkKeybinds.clear();

    // Register new keybinds
    for (const bm of bookmarks) {
      if (!bm.keybind || typeof bm.keybind !== "string") continue;
      const accel = bm.keybind;
      const bmId = bm.id;
      try {
        const ok = globalShortcut.register(accel, () => {
          executeBookmarkById(bmId);
        });
        if (ok) {
          registeredBookmarkKeybinds.add(accel);
          logger.info(`Registered bookmark keybind: ${accel} → ${bm.name}`);
        } else {
          logger.warn(
            `Failed to register bookmark keybind (may be in use): ${accel}`,
          );
        }
      } catch (e) {
        logger.warn(`Error registering bookmark keybind ${accel}:`, e);
      }
    }
  };

  const loadBookmarks = (): any[] => {
    try {
      const p = bookmarksPath();
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
      }
    } catch (e) {
      logger.warn("Failed to load bookmarks:", e);
    }
    return [];
  };

  const saveBookmarks = (bookmarks: any[]) => {
    try {
      fs.writeFileSync(
        bookmarksPath(),
        JSON.stringify(bookmarks, null, 2),
        "utf-8",
      );
      // Re-register all bookmark keybinds whenever bookmarks change
      registerBookmarkKeybinds(bookmarks);
    } catch (e) {
      logger.warn("Failed to save bookmarks:", e);
    }
  };

  // Register bookmark keybinds on startup
  try {
    registerBookmarkKeybinds(loadBookmarks());
  } catch {}

  ipcMain.handle("bookmarks:list", () => {
    return { ok: true, bookmarks: loadBookmarks() };
  });

  ipcMain.handle("bookmarks:save", (_e, bookmarks: any[]) => {
    saveBookmarks(bookmarks);
    return { ok: true };
  });

  ipcMain.handle("bookmarks:add", (_e, bookmark: any) => {
    const bookmarks = loadBookmarks();
    bookmarks.push(bookmark);
    saveBookmarks(bookmarks);
    return { ok: true, bookmarks };
  });

  ipcMain.handle("bookmarks:update", (_e, bookmark: any) => {
    const bookmarks = loadBookmarks();
    const idx = bookmarks.findIndex((b: any) => b.id === bookmark.id);
    if (idx >= 0) {
      bookmarks[idx] = bookmark;
      saveBookmarks(bookmarks);
      return { ok: true, bookmarks };
    }
    return { ok: false, error: "Bookmark not found" };
  });

  ipcMain.handle("bookmarks:delete", (_e, bookmarkId: string) => {
    const bookmarks = loadBookmarks();
    const filtered = bookmarks.filter((b: any) => b.id !== bookmarkId);
    saveBookmarks(filtered);
    return { ok: true, bookmarks: filtered };
  });

  ipcMain.handle("bookmarks:reorder", (_e, bookmarkIds: string[]) => {
    const bookmarks = loadBookmarks();
    const ordered = bookmarkIds
      .map((id) => bookmarks.find((b: any) => b.id === id))
      .filter(Boolean);
    // Add any bookmarks not in the order list at the end
    const orderedIds = new Set(bookmarkIds);
    for (const b of bookmarks) {
      if (!orderedIds.has(b.id)) {
        ordered.push(b);
      }
    }
    saveBookmarks(ordered);
    return { ok: true, bookmarks: ordered };
  });

  ipcMain.handle("bookmarks:execute", async (_e, bookmark: any) => {
    try {
      const type = String(bookmark.type || "").toLowerCase();
      const target = String(bookmark.target || "").trim();

      const sendSidebarSelectItem = (payload: {
        type: "space" | "canvas";
        id: string;
      }) => {
        try {
          const sidebar = getSidebarWindow();
          if (!sidebar || sidebar.isDestroyed()) return;
          const wc = sidebar.webContents;
          const send = () => {
            try {
              wc.send("sidebar:selectItem", payload);
            } catch {}
          };
          if (
            typeof (wc as any).isLoadingMainFrame === "function" &&
            (wc as any).isLoadingMainFrame()
          ) {
            wc.once("did-finish-load", send);
          } else {
            send();
          }
        } catch {}
      };

      const sendOverlayViewMode = (payload: {
        mode: "chat" | "tasks";
        subTab?: string;
      }) => {
        for (const w of BrowserWindow.getAllWindows()) {
          try {
            w.webContents.send("overlay:view-mode", payload);
          } catch {}
        }
      };

      switch (type) {
        case "url":
          if (target) shell.openExternal(target);
          return { ok: true };

        case "app":
          if (target) shell.openPath(target);
          return { ok: true };

        case "file":
        case "folder":
          if (target) shell.openPath(target);
          return { ok: true };

        case "workflow":
          // Run a workflow by ID
          if (target) {
            const result = await workflows_run(target);
            return result;
          }
          return { ok: false, error: "No workflow ID specified" };

        case "space":
          // Open sidebar to spaces tab in expanded mode and select specific space
          openSidebarWindow({ tab: "spaces", expanded: true });
          // Navigate to specific space if target is space ID
          if (target && target !== "spaces") {
            sendSidebarSelectItem({ type: "space", id: target });
          }
          return { ok: true };

        case "canvas": {
          const docs = loadCanvasDocs();
          let note =
            target && target !== "_new" && target !== "canvas"
              ? docs.find((d: any) => d.id === target)
              : null;

          if (!note) {
            const now = new Date().toISOString();
            note = {
              id: `canvas_${Date.now()}`,
              title: "Quick Note",
              content: "",
              createdAt: now,
              updatedAt: now,
            };
            docs.unshift(note);
            saveCanvasDocs(docs);
          }

          createBoardWindow({
            ...note,
            template: "notes",
            size: { width: 300, height: 220 },
          });
          focusBoardWindow(note.id);

          return { ok: true, documentId: note.id };
        }

        case "dashboard":
          openDashboardWindow({ tab: target || undefined });
          return { ok: true };

        case "tasks":
          // Open overlay in window mode and switch to tasks view with subtab
          setOverlayMode("window");
          showWindow();
          sendOverlayViewMode({
            mode: "tasks",
            subTab: target === "reminders" ? "reminders" : "todo",
          });
          return { ok: true };

        case "terminal":
          openSidebarWindow({ tab: "terminal", expanded: true });
          return { ok: true };

        case "overlay":
          setOverlayMode("window");
          showWindow();
          return { ok: true };

        case "semantic-search":
          // Open overlay in window mode and trigger semantic search UI
          setOverlayMode("window");
          showWindow();
          for (const w of BrowserWindow.getAllWindows()) {
            try {
              w.webContents.send("overlay:semantic-search");
            } catch {}
          }
          return { ok: true };

        default:
          return { ok: false, error: `Unknown bookmark type: ${type}` };
      }
    } catch (e: any) {
      logger.error("Failed to execute bookmark:", e);
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // Global hotkey management
  ipcMain.handle("system:setGlobalHotkey", (_e, accelerator: string) => {
    try {
      // Validate the accelerator format
      if (!accelerator || typeof accelerator !== "string") {
        return { ok: false, error: "Invalid accelerator format" };
      }

      // Try to register the new shortcut first
      const testSuccess = globalShortcut.register(accelerator, () => {
        // This is just a test registration, we'll unregister immediately
      });

      if (!testSuccess) {
        return {
          ok: false,
          error: "Shortcut may be in use by another application",
        };
      }

      // Unregister the test
      globalShortcut.unregister(accelerator);

      // Unregister the current overlay shortcuts
      const oldHotkey = getGlobalHotkey();
      try {
        globalShortcut.unregister(oldHotkey);
      } catch {}
      // Also try common variants
      const variants = [
        "Control+Space",
        "Ctrl+Space",
        "Control+Shift+Space",
        "Ctrl+Shift+Space",
        "CommandOrControl+Shift+Space",
      ];
      for (const v of variants) {
        try {
          globalShortcut.unregister(v);
        } catch {}
      }

      // Register the new shortcut
      const success = globalShortcut.register(accelerator, () => {
        const { handleOverlayHotkey } = require("../windows");
        handleOverlayHotkey();
      });

      if (success) {
        // Save to settings
        saveGlobalHotkey(accelerator);
        logger.info(`Global hotkey changed to: ${accelerator}`);
        return { ok: true };
      } else {
        // Re-register the default
        const { registerGlobalShortcuts } = require("../windows");
        registerGlobalShortcuts();
        return { ok: false, error: "Failed to register new shortcut" };
      }
    } catch (e: any) {
      logger.error("Error setting global hotkey:", e);
      return { ok: false, error: String(e?.message || "Unknown error") };
    }
  });

  ipcMain.handle("system:getGlobalHotkey", () => {
    return { ok: true, hotkey: getGlobalHotkey() };
  });

  // ── Upload agent databases to cloud for VM sync ─────────────────────────
  ipcMain.handle("cloud:uploadAgentData", async (_e, cloudAiUrl: string, token: string) => {
    try {
      const fs = require('fs');
      const os = require('os');
      const { execFileSync } = require('child_process');

      // Resolve agent data directory
      const base = process.platform === 'win32'
        ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
        : process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library', 'Application Support')
          : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
      const agentDir = process.env.AGENT_DATA_DIR || path.join(base, 'StuardAI', 'agent');
      const stuardRoot = path.dirname(agentDir); // %APPDATA%/StuardAI

      // Check if agent databases exist
      const knowledgePath = path.join(agentDir, 'knowledge.db');
      const memoryPath = path.join(agentDir, 'memory.db');
      const hasKnowledge = fs.existsSync(knowledgePath);
      const hasMemory = fs.existsSync(memoryPath);
      if (!hasKnowledge && !hasMemory) {
        logger.info('[cloud:uploadAgentData] No knowledge.db or memory.db found — skipping');
        return { ok: true, skipped: true, reason: 'no_agent_databases' };
      }

      // Skip file_index.db — it's the local file index (often 300MB+), not memories.
      // The VM doesn't need the desktop's file index.
      const SKIP_FILES = new Set(['file_index.db']);

      // Build list of files to include from agent/ directory
      const filesToInclude: string[] = [];
      try {
        const files = fs.readdirSync(agentDir);
        for (const f of files) {
          if (SKIP_FILES.has(f)) continue;
          // Include .db files and their WAL/SHM journal files for SQLite consistency
          if (f.endsWith('.db') || f.endsWith('.db-wal') || f.endsWith('.db-shm')) {
            filesToInclude.push(f);
          }
        }
      } catch {}

      if (filesToInclude.length === 0) {
        logger.info('[cloud:uploadAgentData] No eligible database files found');
        return { ok: true, skipped: true, reason: 'no_eligible_files' };
      }

      logger.info(`[cloud:uploadAgentData] Packaging ${filesToInclude.length} files: ${filesToInclude.join(', ')}`);

      // Also check for lancedb directory (vector embeddings for semantic search)
      const lancedbDir = path.join(stuardRoot, 'lancedb');
      const hasLancedb = fs.existsSync(lancedbDir) && fs.statSync(lancedbDir).isDirectory();

      // Also check for workflow.db in the root StuardAI directory
      const workflowDbPath = path.join(stuardRoot, 'workflow.db');
      const hasWorkflowDb = fs.existsSync(workflowDbPath);

      // Create tar.gz of all agent data
      const tmpDir = os.tmpdir();
      const archivePath = path.join(tmpDir, `stuard-agent-data-${Date.now()}.tar.gz`);

      // Build tar arguments: include agent/*.db files, optionally lancedb/ and workflow.db
      // We tar from stuardRoot so paths are relative: agent/knowledge.db, lancedb/..., workflow.db
      const tarItems: string[] = filesToInclude.map(f => `agent/${f}`);
      if (hasLancedb) tarItems.push('lancedb');
      if (hasWorkflowDb) tarItems.push('workflow.db');

      logger.info(`[cloud:uploadAgentData] Creating archive with items: ${tarItems.join(', ')}`);

      try {
        execFileSync('tar', ['-czf', archivePath, ...tarItems], {
          cwd: stuardRoot,
          timeout: 120_000,
        });
      } catch (tarErr: any) {
        logger.warn('[cloud:uploadAgentData] tar command failed, trying without lancedb:', tarErr?.message);
        // Fallback: just the agent .db files (skip lancedb which may have issues)
        const fallbackItems = filesToInclude.map(f => `agent/${f}`);
        if (hasWorkflowDb) fallbackItems.push('workflow.db');
        try {
          execFileSync('tar', ['-czf', archivePath, ...fallbackItems], {
            cwd: stuardRoot,
            timeout: 120_000,
          });
        } catch (tarErr2: any) {
          logger.error('[cloud:uploadAgentData] tar fallback also failed:', tarErr2?.message);
          // Last resort: tar just from the agent directory
          try {
            execFileSync('tar', ['-czf', archivePath, ...filesToInclude], {
              cwd: agentDir,
              timeout: 120_000,
            });
          } catch (tarErr3: any) {
            logger.error('[cloud:uploadAgentData] All tar attempts failed:', tarErr3?.message);
            return { ok: false, error: 'tar_creation_failed: ' + String(tarErr3?.message) };
          }
        }
      }

      // Read the archive
      const archiveBuffer = fs.readFileSync(archivePath);
      try { fs.unlinkSync(archivePath); } catch {}

      const sizeMB = (archiveBuffer.length / (1024 * 1024)).toFixed(1);
      logger.info(`[cloud:uploadAgentData] Archive created: ${sizeMB} MB`);

      // Step 1: Request a signed GCS upload URL from the backend (tiny request)
      logger.info(`[cloud:uploadAgentData] Requesting signed upload URL from ${cloudAiUrl}...`);
      const urlResp = await fetch(`${cloudAiUrl}/v1/cloud-engine/upload-agent-data`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}), // empty body → server returns signed URL
      });
      if (!urlResp.ok) {
        const errText = await urlResp.text().catch(() => 'unknown');
        logger.error(`[cloud:uploadAgentData] Failed to get signed URL: HTTP ${urlResp.status}: ${errText}`);
        return { ok: false, error: `signed_url_http_${urlResp.status}`, details: errText };
      }
      const urlResult = await urlResp.json();
      if (!urlResult.ok || !urlResult.uploadUrl) {
        logger.error(`[cloud:uploadAgentData] No upload URL returned:`, urlResult);
        return { ok: false, error: 'no_upload_url', details: JSON.stringify(urlResult) };
      }

      // Step 2: Upload tar.gz binary directly to GCS via signed URL (no size limit)
      logger.info(`[cloud:uploadAgentData] Uploading ${sizeMB} MB directly to GCS...`);
      const gcsResp = await fetch(urlResult.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/gzip',
        },
        body: archiveBuffer,
      });
      if (!gcsResp.ok) {
        const gcsErr = await gcsResp.text().catch(() => 'unknown');
        logger.error(`[cloud:uploadAgentData] GCS upload failed: HTTP ${gcsResp.status}: ${gcsErr}`);
        return { ok: false, error: `gcs_upload_http_${gcsResp.status}`, details: gcsErr };
      }

      logger.info(`[cloud:uploadAgentData] Upload complete: ${sizeMB} MB to ${urlResult.objectName}`);
      return { ok: true, objectName: urlResult.objectName, bytes: archiveBuffer.length };
    } catch (e: any) {
      logger.error('[cloud:uploadAgentData] Error:', e);
      return { ok: false, error: String(e?.message || 'upload_failed') };
    }
  });
}
