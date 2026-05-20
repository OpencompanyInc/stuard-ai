import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { clsx } from "clsx";
import { VoiceScreenFrame } from "./components/voice/VoiceScreenFrame";
import { VoicePill } from "./components/voice/VoicePill";
import { VoiceMarkdownText } from "./components/voice/VoiceMarkdownText";
import type { VoiceState } from "./components/voice/VoiceOrb";
import type { TranscriptLine, VoiceModeState } from "./hooks/useVoiceMode";
import "./styles.css";

function toOrbState(s: VoiceModeState | VoiceState | string | undefined): VoiceState {
  if (s === "connecting") return "thinking";
  if (s === "idle" || s === "listening" || s === "thinking" || s === "speaking") return s;
  return "idle";
}

interface BorderPayload {
  state?: VoiceModeState;
  audioLevel?: number;
  muted?: boolean;
  sharingScreen?: boolean;
  activeTool?: string | null;
  transcripts?: TranscriptLine[];
}

/**
 * Full-screen voice border window. Renders:
 *   â€¢ VoiceScreenFrame  â€” pulsing red ambient halo at the screen edge.
 *   â€¢ Top caption overlay â€” translucent translucent rectangle that fades
 *     in whenever a transcript line is active. Lives near the top so it
 *     doesn't compete with the pill.
 *   â€¢ Pill â€” mute / share screen / close, dead-center along the bottom.
 *
 * The window is click-through by default; only the pill area toggles
 * pointer events on while the cursor is over it.
 */
function VoiceBorderApp() {
  const [state, setState] = useState<VoiceModeState>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptLine[]>([]);
  const interactiveRef = useRef(false);

  useEffect(() => {
    const api: any = (window as any).desktopAPI;
    if (!api?.onVoiceBorderUpdate) return;
    const cleanup = api.onVoiceBorderUpdate((payload: BorderPayload) => {
      if (!payload) return;
      if (payload.state !== undefined) setState(payload.state);
      if (typeof payload.audioLevel === "number") setAudioLevel(payload.audioLevel);
      if (typeof payload.muted === "boolean") setMuted(payload.muted);
      if (typeof payload.sharingScreen === "boolean") setSharingScreen(payload.sharingScreen);
      if (payload.activeTool !== undefined) setActiveTool(payload.activeTool);
      if (Array.isArray(payload.transcripts)) setTranscripts(payload.transcripts);
    });
    return () => { try { cleanup?.(); } catch { } };
  }, []);

  const setInteractive = (interactive: boolean) => {
    if (interactiveRef.current === interactive) return;
    interactiveRef.current = interactive;
    const api: any = (window as any).desktopAPI;
    try { api?.setVoiceBorderInteractive?.(interactive); } catch { }
  };

  const sendControl = (action: "mute" | "close" | "shareScreen") => {
    const api: any = (window as any).desktopAPI;
    try { api?.sendVoiceBorderControl?.(action); } catch { }
  };

  const orbState = toOrbState(state);
  const latestTranscript = transcripts[transcripts.length - 1];

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
      <VoiceScreenFrame audioLevel={audioLevel} state={orbState} />

      {/* Caption overlay â€” translucent rectangle sitting directly above the
          pill, fades in only when there is real transcript text.
          KEY: keyed by role only, NOT by transcript id, so streamed partials
          from the same role update text in place instead of remounting the
          motion.div (which caused the caption to fly in from off-screen on
          every delta). A new line for the *other* role re-keys, giving us a
          natural cross-fade between speaker turns. */}
      <div
        className="fixed left-0 right-0 flex justify-center px-6"
        style={{ bottom: 96, pointerEvents: "none", zIndex: 15 }}
      >
        <AnimatePresence mode="wait">
          {latestTranscript?.text && (
            <motion.div
              key={`cap-${latestTranscript.role}`}
              initial={{ opacity: 0, y: 8, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.985 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className="px-6 py-3.5 rounded-2xl backdrop-blur-xl max-w-[760px]"
              style={{
                background: "rgba(19, 18, 16, 0.55)",
                border: "1px solid rgba(255, 39, 56, 0.16)",
                boxShadow:
                  "0 14px 50px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 4, 22, 0.05) inset",
              }}
            >
              <div
                className={clsx(
                  "text-[15px] leading-relaxed text-center",
                  latestTranscript.role === "user"
                    ? "text-white font-medium"
                    : "text-white/85",
                  !latestTranscript.isFinal && "opacity-85",
                )}
              >
                {latestTranscript.role === "assistant" ? (
                  <VoiceMarkdownText text={latestTranscript.text} />
                ) : (
                  latestTranscript.text
                )}
                {!latestTranscript.isFinal && (
                  <span className="inline-block w-[1.5px] h-[0.85em] bg-white/70 ml-0.5 align-baseline animate-[pulse_1s_ease-in-out_infinite]" />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Pill â€” centered along the bottom of the monitor.
          Wrapper handles centering (left:0 right:0 + flex) so framer-motion
          transforms on the inner motion.div don't fight Tailwind's
          -translate-x-1/2. */}
      <div
        className="fixed bottom-8 left-0 right-0 flex justify-center"
        style={{ pointerEvents: "none", zIndex: 20 }}
      >
        <div
          style={{ pointerEvents: "auto" }}
          onMouseEnter={() => setInteractive(true)}
          onMouseLeave={() => setInteractive(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <VoicePill
              state={orbState}
              audioLevel={audioLevel}
              muted={muted}
              sharingScreen={sharingScreen}
              toolName={activeTool || undefined}
              onMuteToggle={() => sendControl("mute")}
              onShareScreen={() => sendControl("shareScreen")}
              onClose={() => sendControl("close")}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VoiceBorderApp />
  </React.StrictMode>,
);
