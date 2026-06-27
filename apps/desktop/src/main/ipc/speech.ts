
import { ipcMain, BrowserWindow } from 'electron';
import { WebSocket, createWebSocketStream } from 'ws';
import record from 'node-record-lpcm16';

let speechWs: WebSocket | null = null;
let audioStream: any | null = null;

export function setupSpeechIpc() {
  ipcMain.handle('speech:start', async (_e, { url, token }: { url: string, token: string }) => {
    if (speechWs) {
      try { speechWs.close(); } catch {}
    }
    if (audioStream) {
      try { audioStream.stop(); } catch {}
    }

    console.log('[Speech] Starting stream to', url);

    return new Promise<{ ok: boolean, error?: string }>((resolve) => {
      try {
        speechWs = new WebSocket(url);

        speechWs.on('open', () => {
          // Authenticate
          speechWs?.send(JSON.stringify({ type: 'auth', accessToken: token }));
          
          // Start recording
          try {
            audioStream = record.record({
              sampleRate: 16000,
              threshold: 0,
              verbose: false,
              // On Windows, SoX must be in PATH
            });
            
            // Pipe audio to WS
            const wsStream = createWebSocketStream(speechWs as any);
            audioStream.stream().pipe(wsStream);
            
            resolve({ ok: true });
          } catch (e: any) {
            console.error('[Speech] Recording error:', e);
            resolve({ ok: false, error: 'recording_failed: ' + e.message + '. Is SoX installed?' });
            try { speechWs?.close(); } catch {}
          }
        });

        speechWs.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
          try {
            const msg = JSON.parse(data.toString());
            // Broadcast to all windows
            BrowserWindow.getAllWindows().forEach(w => {
              w.webContents.send('speech:event', msg);
            });
          } catch {}
        });

        speechWs.on('error', (e: Error) => {
          console.error('[Speech] WS error:', e);
          BrowserWindow.getAllWindows().forEach(w => {
            w.webContents.send('speech:error', e.message);
          });
        });

        speechWs.on('close', () => {
          console.log('[Speech] WS closed');
          stopRecording();
          BrowserWindow.getAllWindows().forEach(w => {
            w.webContents.send('speech:stopped');
          });
        });

      } catch (e: any) {
        resolve({ ok: false, error: e.message });
      }
    });
  });

  ipcMain.handle('speech:stop', async () => {
    stopRecording();
    return { ok: true };
  });
}

function stopRecording() {
  if (audioStream) {
    try { audioStream.stop(); } catch {}
    audioStream = null;
  }
  if (speechWs) {
    try { 
      speechWs.send(JSON.stringify({ type: 'stop_recording' }));
      setTimeout(() => {
          try { speechWs?.close(); } catch {}
          speechWs = null;
      }, 200);
    } catch {
      try { speechWs?.close(); } catch {}
      speechWs = null;
    }
  }
}
