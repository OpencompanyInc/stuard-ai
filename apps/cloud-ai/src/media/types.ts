// ─── Unified media types for all inbound channels ───────────────────────────

/** Channel-agnostic descriptor for an inbound media item */
export interface InboundMedia {
  /** Unique channel-specific reference (Telnyx URL, WhatsApp media ID, Discord URL) */
  ref: string;
  /** How to resolve this reference to bytes */
  source: 'url' | 'whatsapp_media_id';
  /** Original MIME type reported by the channel */
  mimeType: string;
  /** High-level classification */
  mediaType: 'image' | 'audio' | 'video' | 'document';
  /** Original filename if available */
  filename?: string;
  /** Caption/text accompanying this media */
  caption?: string;
}

/** Result of processing a single media item */
export interface ProcessedMedia {
  original: InboundMedia;
  buffer: Buffer;
  mimeType: string;
  /** base64 data URI for images */
  base64DataUri?: string;
  /** Transcription text for audio/voice notes */
  transcript?: string;
  transcriptLanguage?: string;
  transcriptDuration?: number;
}

/** Attachment format accepted by the cloud WS chat handler */
export interface AttachmentPayload {
  type: 'image' | 'file';
  name?: string;
  mimeType: string;
  /** base64 data URI or URL */
  data: string;
}

/** Full result of processing all media items for a message */
export interface MediaResult {
  /** Ready-to-send attachments for the cloud WS `attachments` field */
  attachments: AttachmentPayload[];
  /** Text to prepend to the user message (e.g. voice transcriptions) */
  supplementaryText: string;
  /** Individual results for detailed access */
  items: ProcessedMedia[];
}
