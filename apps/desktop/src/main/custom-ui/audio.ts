import * as fs from 'fs';
import { BrowserWindow } from 'electron';
import { pathToFileURL } from 'url';
import type { RouterContext } from '../tool-router';

// Audio player (hidden window for audio playback)
let audioPlayerWindow: BrowserWindow | null = null;
let audioPlayerReady: Promise<BrowserWindow> | null = null;

// Audio player window management
async function ensureAudioPlayerWindow(): Promise<BrowserWindow> {
  if (audioPlayerWindow && !audioPlayerWindow.isDestroyed()) return audioPlayerWindow;
  if (audioPlayerReady) return audioPlayerReady;

  audioPlayerReady = (async () => {
    const win = new BrowserWindow({
      width: 200,
      height: 120,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required' as any,
      },
    });

    win.on('closed', () => {
      if (audioPlayerWindow === win) audioPlayerWindow = null;
      audioPlayerReady = null;
    });

    const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body>
      <script>
        window.__stuardPlayAudio = async function(url) {
          return await new Promise(async (resolve, reject) => {
            try {
              const a = new Audio(url);
              a.onended = () => resolve({ ok: true, status: 'ended' });
              a.onerror = () => reject(new Error('audio_error'));
              await a.play();
            } catch (e) {
              reject(e);
            }
          });
        };
      <\/script>
    </body></html>`;

    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    audioPlayerWindow = win;
    return win;
  })();

  return audioPlayerReady;
}

export async function execPlayAudio(args: any, ctx: RouterContext): Promise<any> {
  try {
    const filePath = String(args?.path || args?.filePath || '').trim();
    const block = args?.block !== false;

    if (!filePath) return { ok: false, error: 'missing_file_path' };
    if (!fs.existsSync(filePath)) return { ok: false, error: 'file_not_found', path: filePath };

    const win = await ensureAudioPlayerWindow();
    const url = pathToFileURL(filePath).toString();

    const js = `window.__stuardPlayAudio(${JSON.stringify(url)})`;

    if (block) {
      await win.webContents.executeJavaScript(js, true);
      return { ok: true, played: filePath, method: 'electron' };
    }

    win.webContents.executeJavaScript(js, true).catch(() => {});
    return { ok: true, status: 'playing', path: filePath, method: 'electron' };
  } catch (e: any) {
    ctx.logFn(`play_audio failed: ${e?.message || 'unknown'}`);
    return { ok: false, error: String(e?.message || 'play_audio_failed') };
  }
}
