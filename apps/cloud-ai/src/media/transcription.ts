// ─── Audio transcription via OpenAI Whisper ─────────────────────────────────

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

/** Map MIME type to a Whisper-friendly file extension */
function extFromMime(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('flac')) return 'flac';
  if (mime.includes('webm')) return 'webm';
  return 'mp3'; // safe default — Whisper handles most formats
}

export interface TranscriptionResult {
  transcript: string;
  language?: string;
  duration?: number;
}

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 * Returns the transcript text, detected language, and duration.
 */
export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  language?: string,
): Promise<TranscriptionResult> {
  const openaiKey = process.env.OPENAI_API_KEY || '';
  if (!openaiKey) throw new Error('OPENAI_API_KEY not configured for transcription');

  const ext = extFromMime(mimeType);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`);
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  if (language) form.append('language', language);

  const res = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Whisper transcription failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  return {
    transcript: String(json.text || '').trim(),
    language: json.language,
    duration: json.duration,
  };
}
