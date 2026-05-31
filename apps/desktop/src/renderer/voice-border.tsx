import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { motion } from "framer-motion";
import { VoiceScreenFrame } from "./components/voice/VoiceScreenFrame";
import { VoicePill } from "./components/voice/VoicePill";
import { VoiceTranscriptBox } from "./components/voice/VoiceTranscriptBox";
import { usePreferences } from "./hooks/usePreferences";
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

function useVoiceBorderTheme() {
  const { themeMode, themeDarkShade, themeLightShade, themeText } = usePreferences();

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === "dark" || themeMode === "custom") {
      root.setAttribute("data-theme", "dark");
      root.classList.add("dark");
    } else {
      root.setAttribute("data-theme", "light");
      root.classList.remove("dark");
    }

    if (themeMode === "custom") {
      root.style.setProperty("--custom-gradient-start", themeDarkShade);
      root.style.setProperty("--custom-gradient-end", themeLightShade);
      root.style.setProperty("--custom-text-color", themeText === "white" ? "#ffffff" : "#000000");
    } else {
      root.style.removeProperty("--custom-gradient-start");
      root.style.removeProperty("--custom-gradient-end");
      root.style.removeProperty("--custom-text-color");
    }
  }, [themeMode, themeDarkShade, themeLightShade, themeText]);

  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onThemeUpdated?.(() => {
      // usePreferences picks up localStorage changes from the main window broadcast.
    });
    return () => { try { (typeof unsub === "function") && unsub(); } catch { } };
  }, []);
}

/**
 * Full-screen voice border window. Renders:
 *   • VoiceScreenFrame  — pulsing red ambient halo at the screen edge.
 *   • Transcript card   — compact-pill surface above the pill.
 *   • VoicePill         — mute / share screen / close, bottom center.
 *
 * The window is click-through by default; only the pill area toggles
 * pointer events on while the cursor is over it.
 */
function VoiceBorderApp() {
  useVoiceBorderTheme();

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

      <div
        className="fixed left-0 right-0 flex justify-center px-6"
        style={{ bottom: 96, pointerEvents: "none", zIndex: 15 }}
      >
        <div className="pointer-events-auto w-full max-w-[760px]">
          <VoiceTranscriptBox transcript={latestTranscript} centered />
        </div>
      </div>

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
