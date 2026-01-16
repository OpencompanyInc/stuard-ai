
import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { verifyToken } from '../supabase';
import { writeLog } from '../utils/logger';

// AssemblyAI Universal-Streaming v3 endpoint. 16 kHz, PCM S16LE.
// Request formatted turns and explicitly select the English model.
const AAI_ENDPOINT =
  'wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&format_turns=true&speech_model=universal-streaming-english&language=en&keyterms_prompt=' +
  encodeURIComponent(JSON.stringify(['Stuard', 'StuardAI', 'send stuard']));

export function handleSpeechConnection(ws: WebSocket, req: IncomingMessage) {
  let aaiWs: WebSocket | null = null;
  let authenticated = false;
  let userId: string | null = null;
  let isClosed = false;

  // Timeout to force auth within 10 seconds
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      send(ws, { type: 'error', message: 'auth_timeout' });
      ws.close();
    }
  }, 10000);

  ws.on('message', async (data: WebSocket.RawData) => {
    if (isClosed) return;

    // First message must be auth
    if (!authenticated) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth' && msg.accessToken) {
          const user = await verifyToken(msg.accessToken);
          if (user) {
            authenticated = true;
            userId = user.userId;
            clearTimeout(authTimeout);
            writeLog('speech_connected', { userId });
            
            // Initialize AssemblyAI connection
            connectToAssemblyAI();
          } else {
            console.error('[speech-proxy] Token verification failed. Check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
            send(ws, { type: 'error', message: 'unauthorized' });
            ws.close();
          }
        } else {
          console.error('[speech-proxy] Auth message missing or invalid:', msg);
          send(ws, { type: 'error', message: 'auth_required' });
          ws.close();
        }
      } catch (e) {
        console.error('[speech-proxy] Failed to parse auth message:', e);
        send(ws, { type: 'error', message: 'invalid_auth_payload' });
        ws.close();
      }
      return;
    }

    // If authenticated, forward audio data / control messages to AssemblyAI
    if (aaiWs && aaiWs.readyState === WebSocket.OPEN) {
      // Binary PCM audio from client -> raw frames to v3 endpoint
      if (Buffer.isBuffer(data)) {
        aaiWs.send(data);
      } else {
        // Could be control messages like 'stop_recording'
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'stop_recording') {
            // Universal-Streaming uses a Terminate control message
            aaiWs.send(JSON.stringify({ type: 'Terminate' }));
          }
        } catch {}
      }
    }
  });

  ws.on('close', () => {
    isClosed = true;
    if (aaiWs) {
      try {
        aaiWs.close();
      } catch {}
    }
    writeLog('speech_disconnected', { userId: userId || 'unauth' });
  });

  ws.on('error', (err) => {
    console.error('[speech-proxy] Client WS error:', err);
  });

  function connectToAssemblyAI() {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      console.error('[speech-proxy] Missing ASSEMBLYAI_API_KEY');
      send(ws, { type: 'error', message: 'server_configuration_error' });
      ws.close();
      return;
    }

    try {
      aaiWs = new WebSocket(AAI_ENDPOINT, {
        headers: { Authorization: apiKey }
      });

      aaiWs.on('open', () => {
        send(ws, { type: 'ready' });
      });

      aaiWs.on('message', (data) => {
        if (isClosed) return;
        try {
          const msg = JSON.parse(data.toString());
          const msgType = msg.type || msg.message_type;

          // Universal-Streaming v3 uses "Begin" / "Turn" / "Termination" messages.
          // We normalize "Turn" into a simple { type: 'transcript', text, is_final }.
          // IMPORTANT: Only mark as final when turn_is_final is true (speaker finished utterance).
          // turn_is_formatted just means punctuation was applied - NOT that the turn ended.
          if (msgType === 'Turn') {
            const transcript = msg.transcript || '';
            const isFinal = Boolean(msg.turn_is_final);
            send(ws, {
              type: 'transcript',
              text: transcript,
              is_final: isFinal,
            });
          } else if (msgType === 'Begin' || msgType === 'SessionBegins') {
            // Optional: could notify client that upstream session began
          } else if (msgType === 'Termination') {
            // Session has ended; notify downstream client and close so local tools can clean up.
            send(ws, { type: 'info', message: 'session_terminated' });
            try {
              ws.close();
            } catch {}
            try {
              aaiWs?.close();
            } catch {}
          }
        } catch (e) {
          console.error('[speech-proxy] AAI message parse error:', e);
        }
      });

      aaiWs.on('close', () => {
        if (!isClosed) {
          send(ws, { type: 'info', message: 'upstream_closed' });
          ws.close();
        }
      });

      aaiWs.on('error', (err) => {
        console.error('[speech-proxy] AAI WS error:', err);
        if (!isClosed) {
          send(ws, { type: 'error', message: 'upstream_error' });
          ws.close();
        }
      });

    } catch (e) {
      console.error('[speech-proxy] Failed to connect to AAI:', e);
      send(ws, { type: 'error', message: 'upstream_connection_failed' });
      ws.close();
    }
  }
}

function send(ws: WebSocket, data: any) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch {}
}
