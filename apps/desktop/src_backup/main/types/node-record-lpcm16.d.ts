declare module 'node-record-lpcm16' {
  interface RecordOptions {
    sampleRate?: number;
    channels?: number;
    compress?: boolean;
    threshold?: number;
    thresholdStart?: number;
    thresholdEnd?: number;
    silence?: string;
    verbose?: boolean;
    recordProgram?: string;
    device?: string;
  }

  interface Recording {
    stream(): any;
    stop(): void;
  }

  export function record(options?: RecordOptions): Recording;
}
