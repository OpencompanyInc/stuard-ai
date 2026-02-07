import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

interface SpeechToTextState {
  isRecording: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
}

// Inline AudioWorklet processor to avoid build complexity
const WORKLET_CODE = `
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bytesWritten = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    
    const channel0 = input[0];
    
    // Post raw float data to main thread for downsampling (simplest approach)
    this.port.postMessage(channel0);
    return true;
  }
}
registerProcessor('recorder-worklet', AudioProcessor);
`;

export function useSpeechToText(cloudUrl?: string) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null); // Fallback or primary
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const serverReadyRef = useRef<boolean>(false); // Track if server is ready to receive audio

  // Build WebSocket URL for speech endpoint from cloud HTTP URL
  // Convert https://api.stuard.ai -> wss://api.stuard.ai/speech
  const buildSpeechUrl = () => {
    if (cloudUrl) return cloudUrl;
    // Check for injected cloud URL (set during build)
    const httpUrl = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_HTTP_URL || '';
    if (httpUrl) {
      return httpUrl.replace(/^https?:\/\//, (m: string) => m.startsWith('https') ? 'wss://' : 'ws://') + '/speech';
    }
    // Fallback for local dev
    return 'ws://127.0.0.1:8082/speech';
  };
  const TARGET_URL = buildSpeechUrl();

  // Clear transcript state (useful after sending a message)
  const clearTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    serverReadyRef.current = false;
    
    // Stop audio tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Disconnect nodes
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Send stop message and close WS
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop_recording' }));
      }
      // Delay closing slightly to receive final transcripts
      setTimeout(() => {
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
          setIsConnected(false);
        }
      }, 1000);
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    serverReadyRef.current = false;

    try {
      // 1. Get Auth Token
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      // 2. Connect WebSocket
      const ws = new WebSocket(TARGET_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // Send Auth
        ws.send(JSON.stringify({ type: 'auth', accessToken: token }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ready') {
            // Server is ready for audio - now we can start sending PCM data
            console.log('[useSpeechToText] Server ready');
            serverReadyRef.current = true;
          } else if (msg.type === 'transcript') {
            if (msg.is_final) {
              setTranscript(prev => {
                  const spacer = (prev && /[a-z0-9]$/i.test(prev) && /^[a-z0-9]/i.test(msg.text)) ? " " : (prev ? " " : "");
                  return prev + spacer + msg.text;
              });
              setInterimTranscript('');
            } else {
              setInterimTranscript(msg.text);
            }
          } else if (msg.type === 'error') {
            console.error('[useSpeechToText] Server error:', msg.message);
            setError(msg.message);
            stopRecording();
          }
        } catch (e) {
            console.error(e);
        }
      };

      ws.onerror = (e) => {
        console.error('[useSpeechToText] WS Error', e);
        setError('Connection error');
        stopRecording();
      };
      
      ws.onclose = () => {
        setIsConnected(false);
        setIsRecording(false);
      };

      // 3. Capture Audio
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 }); // Request 16k directly if possible
      audioContextRef.current = audioContext;
      await audioContext.resume();
      
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Use ScriptProcessor for simplicity (broad compatibility, easy resample logic)
      // Buffer size 4096 = ~250ms at 16k, or ~85ms at 48k.
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioContext.destination); // Required for script processor to run

      processor.onaudioprocess = (e) => {
        // Only send audio after server confirms ready (auth complete)
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !serverReadyRef.current) return;

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Downsample to 16000 if needed
        const targetRate = 16000;
        const currentRate = e.inputBuffer.sampleRate;
        
        let finalData = inputData;

        if (currentRate !== targetRate) {
            // Simple linear interpolation or decimation
            // If context was created with 16000, browser handles it.
            // But often browsers ignore the sampleRate param and give hardware rate (44.1/48k)
            if (currentRate > targetRate) {
                const ratio = currentRate / targetRate;
                const newLength = Math.floor(inputData.length / ratio);
                const result = new Float32Array(newLength);
                for (let i = 0; i < newLength; i++) {
                    result[i] = inputData[Math.floor(i * ratio)];
                }
                finalData = result;
            }
        }

        // Convert to Int16
        const pcmData = new Int16Array(finalData.length);
        for (let i = 0; i < finalData.length; i++) {
          let s = Math.max(-1, Math.min(1, finalData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Send raw PCM
        wsRef.current.send(pcmData.buffer);
      };

      setIsRecording(true);

    } catch (err: any) {
      console.error('[useSpeechToText] Start failed', err);
      setError(err.message || 'Failed to start recording');
      stopRecording();
    }
  }, [TARGET_URL, stopRecording]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []); // cleanup on unmount

  return {
    isRecording,
    transcript,
    interimTranscript,
    error,
    startRecording,
    stopRecording,
    clearTranscript,
    isConnected
  };
}

