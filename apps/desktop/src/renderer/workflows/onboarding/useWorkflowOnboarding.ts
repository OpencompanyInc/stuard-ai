import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "workflow.onboarding_v1";

export type OnboardingPhase = "idle" | "welcome" | "guided" | "done";

export type OnboardingTrack = "ai" | "manual";

export type OnboardingStepId =
  // AI track
  | "describe"
  | "understand"
  // Manual track
  | "intro"
  | "palette"
  | "wire"
  | "timestampArgs"
  | "setVariableArgs"
  | "storeWire"
  | "notificationArgs"
  | "notifyWire"
  // Shared
  | "variables"
  | "save"
  | "run"
  | "logs"
  | "docs";

export interface OnboardingState {
  seen: boolean;
  completedAt?: number;
  lastTrack?: OnboardingTrack;
  lastStep?: OnboardingStepId;
}

function readPersisted(): OnboardingState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { seen: false };
    const parsed = JSON.parse(raw);
    return {
      seen: Boolean(parsed?.seen),
      completedAt: typeof parsed?.completedAt === "number" ? parsed.completedAt : undefined,
      lastTrack: parsed?.lastTrack === "ai" || parsed?.lastTrack === "manual" ? parsed.lastTrack : undefined,
      lastStep: typeof parsed?.lastStep === "string" ? parsed.lastStep : undefined,
    };
  } catch {
    return { seen: false };
  }
}

function writePersisted(state: OnboardingState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // best-effort
  }
}

export const AI_TRACK_STEPS: OnboardingStepId[] = [
  "describe",
  "understand",
  "variables",
  "save",
  "run",
  "logs",
  "docs",
];

export const MANUAL_TRACK_STEPS: OnboardingStepId[] = [
  "intro",
  "variables",
  "timestampArgs",
  "wire",
  "setVariableArgs",
  "storeWire",
  "palette",
  "notificationArgs",
  "notifyWire",
  "save",
  "run",
  "logs",
  "docs",
];

function stepsFor(track: OnboardingTrack | null): OnboardingStepId[] {
  if (track === "manual") return MANUAL_TRACK_STEPS;
  if (track === "ai") return AI_TRACK_STEPS;
  return [];
}

export interface UseWorkflowOnboardingResult {
  phase: OnboardingPhase;
  track: OnboardingTrack | null;
  stepIndex: number;
  stepId: OnboardingStepId | null;
  totalSteps: number;
  seen: boolean;
  openWelcome: () => void;
  beginAiTour: () => void;
  beginManualTour: () => void;
  advance: () => void;
  skip: () => void;
  finish: () => void;
  replay: () => void;
}

export function useWorkflowOnboarding(): UseWorkflowOnboardingResult {
  const [persisted, setPersisted] = useState<OnboardingState>(() => readPersisted());
  const [phase, setPhase] = useState<OnboardingPhase>(() => (readPersisted().seen ? "idle" : "welcome"));
  const [track, setTrack] = useState<OnboardingTrack | null>(null);
  const [stepIndex, setStepIndex] = useState<number>(0);

  const markedSeenRef = useRef(false);
  useEffect(() => {
    if (phase === "welcome" && !markedSeenRef.current && !persisted.seen) {
      markedSeenRef.current = true;
      const next: OnboardingState = { ...persisted, seen: true };
      setPersisted(next);
      writePersisted(next);
    }
  }, [phase, persisted]);

  const openWelcome = useCallback(() => {
    setPhase("welcome");
    setTrack(null);
    setStepIndex(0);
  }, []);

  const beginAiTour = useCallback(() => {
    setTrack("ai");
    setStepIndex(0);
    setPhase("guided");
  }, []);

  const beginManualTour = useCallback(() => {
    setTrack("manual");
    setStepIndex(0);
    setPhase("guided");
  }, []);

  const advance = useCallback(() => {
    setStepIndex((i) => {
      const steps = stepsFor(track);
      if (steps.length === 0) return i;
      const next = i + 1;
      if (next >= steps.length) {
        setPhase("done");
        const completed: OnboardingState = {
          seen: true,
          completedAt: Date.now(),
          lastTrack: track ?? undefined,
          lastStep: steps[steps.length - 1],
        };
        setPersisted(completed);
        writePersisted(completed);
        return steps.length - 1;
      }
      const lastStep = steps[next];
      const updated: OnboardingState = {
        ...readPersisted(),
        seen: true,
        lastTrack: track ?? undefined,
        lastStep,
      };
      setPersisted(updated);
      writePersisted(updated);
      return next;
    });
  }, [track]);

  const skip = useCallback(() => {
    setPhase("idle");
    setTrack(null);
    const updated: OnboardingState = { ...readPersisted(), seen: true };
    setPersisted(updated);
    writePersisted(updated);
  }, []);

  const finish = useCallback(() => {
    setPhase("done");
    const completed: OnboardingState = {
      seen: true,
      completedAt: Date.now(),
      lastTrack: track ?? undefined,
      lastStep: stepsFor(track)[stepsFor(track).length - 1],
    };
    setPersisted(completed);
    writePersisted(completed);
  }, [track]);

  const replay = useCallback(() => {
    markedSeenRef.current = false;
    setStepIndex(0);
    setTrack(null);
    setPhase("welcome");
  }, []);

  const stepId = useMemo<OnboardingStepId | null>(() => {
    if (phase !== "guided") return null;
    return stepsFor(track)[stepIndex] ?? null;
  }, [phase, track, stepIndex]);

  const totalSteps = useMemo(() => stepsFor(track).length, [track]);

  return {
    phase,
    track,
    stepIndex,
    stepId,
    totalSteps,
    seen: persisted.seen,
    openWelcome,
    beginAiTour,
    beginManualTour,
    advance,
    skip,
    finish,
    replay,
  };
}
