import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Crown,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { clsx } from "clsx";
import { supabase } from "../lib/supabaseClient";
import { getApiEndpoint } from "../utils/apiEndpoint";

const CUSTOM_WAKEWORD_PATH_KEY = "stuard.pref.wakeword_custom_weights_path";
const CUSTOM_WAKEWORD_VERSION_KEY = "stuard.pref.wakeword_custom_weights_version";

const ToggleSwitch: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}> = ({ checked, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={clsx(
      "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg disabled:cursor-not-allowed disabled:opacity-50",
      checked ? "bg-primary" : "bg-theme-hover",
    )}
  >
    <span
      className={clsx(
        "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-300 ease-in-out",
        checked ? "translate-x-5" : "translate-x-0",
      )}
    />
  </button>
);

interface EnrollmentStatus {
  enrolled: boolean;
  status: "pending" | "processing" | "completed" | "failed" | null;
  wakePhrase?: string;
  hasCustomWeights?: boolean;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface WakewordSettingsProps {
  wakewordEnabled: boolean;
  setWakewordEnabled: (v: boolean) => void;
  sensitivity: number;
  setSensitivity: (v: number) => void;
}

const SENSITIVITY_LABELS: Record<string, string> = {
  low: "Low, fewer false activations",
  medium: "Medium, balanced",
  high: "High, more responsive",
};

function sensitivityLabel(v: number): string {
  if (v <= 0.55) return SENSITIVITY_LABELS.low;
  if (v <= 0.8) return SENSITIVITY_LABELS.medium;
  return SENSITIVITY_LABELS.high;
}

function readStoredValue(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string | null) {
  try {
    if (!value) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function clearStoredCustomWeights() {
  writeStoredValue(CUSTOM_WAKEWORD_PATH_KEY, null);
  writeStoredValue(CUSTOM_WAKEWORD_VERSION_KEY, null);
}

export const WakewordSettings: React.FC<WakewordSettingsProps> = ({
  wakewordEnabled,
  setWakewordEnabled,
  sensitivity,
  setSensitivity,
}) => {
  const [enrollment, setEnrollment] = useState<EnrollmentStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isPaid, setIsPaid] = useState(true);
  const [recordings, setRecordings] = useState<File[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollSuccess, setEnrollSuccess] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyingWeights, setApplyingWeights] = useState(false);
  const [customWeightsPath, setCustomWeightsPath] = useState<string | null>(() =>
    readStoredValue(CUSTOM_WAKEWORD_PATH_KEY),
  );
  const [customWeightsVersion, setCustomWeightsVersion] = useState<string | null>(() =>
    readStoredValue(CUSTOM_WAKEWORD_VERSION_KEY),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const syncAttemptedVersionRef = useRef<string | null>(null);

  const startWakewordWithWeights = useCallback(
    async (weightsPath?: string | null) => {
      if (!wakewordEnabled) return;
      try {
        const args: Record<string, any> = {
          sensitivity,
          cooldown: 1.0,
        };
        if (weightsPath) args.weightsPath = weightsPath;
        const result = await (window as any).desktopAPI?.execTool?.("wakeword_start", args);
        if (result?.ok === false && weightsPath) {
          writeStoredValue(CUSTOM_WAKEWORD_PATH_KEY, null);
          setCustomWeightsPath(null);
          // Don't clear customWeightsVersion — it prevents re-sync loops.
          // The version stays so the auto-sync effect won't re-trigger for the same enrollment.
          await (window as any).desktopAPI?.execTool?.("wakeword_start", {
            sensitivity,
            cooldown: 1.0,
          });
        }
      } catch {}
    },
    [sensitivity, wakewordEnabled],
  );

  const syncCustomWeights = useCallback(
    async (accessToken: string) => {
      try {
        setApplyingWeights(true);
        setApplyError(null);

        const endpoint = getApiEndpoint();
        const res = await fetch(`${endpoint}/v1/wakeword/weights`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.ok || typeof json.downloadUrl !== "string") {
          throw new Error(json?.message || "Could not download your voice model.");
        }

        const localPath = await (window as any).desktopAPI?.downloadWakewordWeights?.(
          json.downloadUrl,
        );

        if (!localPath || typeof localPath !== "string") {
          throw new Error("Downloaded model could not be saved locally.");
        }

        const version = enrollment?.updatedAt || enrollment?.createdAt || "completed";
        writeStoredValue(CUSTOM_WAKEWORD_PATH_KEY, localPath);
        writeStoredValue(CUSTOM_WAKEWORD_VERSION_KEY, version);

        setCustomWeightsPath(localPath);
        setCustomWeightsVersion(version);
        await startWakewordWithWeights(localPath);
      } catch (e: any) {
        setApplyError(e?.message || "Could not apply your custom wakeword model.");
        // Mark version as attempted even on failure to prevent re-sync loops
        const failVersion = enrollment?.updatedAt || enrollment?.createdAt || "completed";
        setCustomWeightsVersion(failVersion);
      } finally {
        setApplyingWeights(false);
      }
    },
    [enrollment?.createdAt, enrollment?.updatedAt, startWakewordWithWeights],
  );

  const checkStatus = useCallback(async () => {
    try {
      setLoadingStatus(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const endpoint = getApiEndpoint();
      const res = await fetch(`${endpoint}/v1/wakeword/status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) return;

      setEnrollment({
        enrolled: json.enrolled,
        status: json.status,
        wakePhrase: json.wakePhrase,
        hasCustomWeights: json.hasCustomWeights,
        errorMessage: json.errorMessage,
        createdAt: json.createdAt,
        updatedAt: json.updatedAt,
      });
      setIsPaid(true);
    } catch {
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    if (enrollment?.status !== "processing") return;
    const timer = setInterval(checkStatus, 8000);
    return () => clearInterval(timer);
  }, [checkStatus, enrollment?.status]);

  useEffect(() => {
    if (
      enrollment?.status !== "completed" ||
      !enrollment.hasCustomWeights ||
      !enrollment.updatedAt ||
      enrollment.updatedAt === customWeightsVersion
    ) {
      return;
    }

    // Prevent re-sync loops: only attempt once per enrollment version
    if (syncAttemptedVersionRef.current === enrollment.updatedAt) {
      return;
    }
    syncAttemptedVersionRef.current = enrollment.updatedAt;

    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      await syncCustomWeights(session.access_token);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    customWeightsVersion,
    enrollment?.hasCustomWeights,
    enrollment?.status,
    enrollment?.updatedAt,
    syncCustomWeights,
  ]);

  useEffect(() => {
    if (!wakewordEnabled || !customWeightsPath || enrollment?.status !== "completed") return;
    startWakewordWithWeights(customWeightsPath);
  }, [
    customWeightsPath,
    enrollment?.status,
    startWakewordWithWeights,
    wakewordEnabled,
  ]);

  const startRecordingSample = useCallback(async () => {
    try {
      setEnrollError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const clipNumber = recordings.length + 1;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `hey-stuard-${clipNumber}.webm`, {
          type: "audio/webm",
        });
        setRecordings((prev) => [...prev, file]);
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecording(true);
      setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
          setIsRecording(false);
        }
      }, 3000);
    } catch {
      setEnrollError("Microphone access is required to record a sample.");
    }
  }, [recordings.length]);

  const stopRecordingSample = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      setIsRecording(false);
    }
  }, []);

  const removeRecording = useCallback((index: number) => {
    setRecordings((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const handleEnroll = useCallback(async () => {
    if (recordings.length < 2) {
      setEnrollError("Record or upload at least 2 short clips first.");
      return;
    }

    try {
      setEnrolling(true);
      setEnrollError(null);
      setEnrollSuccess(false);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setEnrollError("Sign in first to train a custom wakeword model.");
        return;
      }

      const endpoint = getApiEndpoint();
      const form = new FormData();
      recordings.forEach((file) => form.append("audio", file, file.name));

      const res = await fetch(`${endpoint}/v1/wakeword/enroll`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        if (json?.error === "plan_not_eligible") {
          setIsPaid(false);
          setEnrollError(
            json?.message || "Custom wakeword training requires Starter or above.",
          );
        } else {
          setEnrollError(json?.message || json?.error || "Enrollment failed.");
        }
        return;
      }

      setEnrollSuccess(true);
      setRecordings([]);
      await checkStatus();
    } catch (e: any) {
      setEnrollError(e?.message || "Network error while starting training.");
    } finally {
      setEnrolling(false);
    }
  }, [checkStatus, recordings]);

  const handleDelete = useCallback(async () => {
    try {
      setDeleting(true);
      setApplyError(null);
      syncAttemptedVersionRef.current = null;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const endpoint = getApiEndpoint();
      await fetch(`${endpoint}/v1/wakeword/weights`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      clearStoredCustomWeights();
      setCustomWeightsPath(null);
      setCustomWeightsVersion(null);
      await startWakewordWithWeights(null);
      await checkStatus();
    } catch {
    } finally {
      setDeleting(false);
    }
  }, [checkStatus, startWakewordWithWeights]);

  const handleApplyLatest = useCallback(async () => {
    syncAttemptedVersionRef.current = null; // allow retry
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    await syncCustomWeights(session.access_token);
  }, [syncCustomWeights]);

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) return;
      const files = Array.from(event.target.files).filter((file) => {
        return (
          file.type.startsWith("audio/") ||
          file.name.endsWith(".wav") ||
          file.name.endsWith(".webm")
        );
      });
      setRecordings((prev) => [...prev, ...files]);
      event.target.value = "";
    },
    [],
  );

  const customModelReady =
    enrollment?.status === "completed" && !!enrollment?.hasCustomWeights;
  const customModelActive = customModelReady && !!customWeightsPath;
  const clipsReady = recordings.length >= 2;

  const modelTitle = applyingWeights
    ? "Applying your voice model"
    : customModelActive
      ? "Your voice model is active"
      : enrollment?.status === "processing"
        ? "Training your voice model"
        : "Default Hey Stuard model";

  const modelDescription = applyingWeights
    ? "Downloading the trained weights and switching wakeword detection."
    : customModelActive
      ? "Wakeword detection is using the latest trained model on this device."
      : enrollment?.status === "processing"
        ? "Training usually finishes in a few minutes and then applies automatically."
        : "The local Hey Stuard model is active. Add your voice below if you want a more personalized trigger.";

  return (
    <div className="relative overflow-hidden rounded-theme-card border border-theme bg-theme-card p-8 shadow-lg transition-all duration-300 hover:border-primary/30 hover:shadow-xl group">
      <div className="absolute top-0 left-0 p-32 rounded-full bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 blur-3xl -ml-16 -mt-16 opacity-50 transition-opacity duration-500 pointer-events-none group-hover:opacity-70" />
      <div className="relative z-10 space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 shadow-inner">
            <Mic className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-theme-fg tracking-tight">
              Wakeword Detection
            </h3>
            <p className="text-[12px] text-theme-muted font-medium">
              Say "Hey Stuard" to pop open the UI and start voice input.
            </p>
          </div>
        </div>

        <div
          className={clsx(
            "rounded-2xl border p-5 transition-all duration-300",
            wakewordEnabled
              ? "bg-primary/5 border-primary/20"
              : "bg-theme-hover/50 border-theme/50",
          )}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div
                className={clsx(
                  "rounded-xl border p-2 transition-colors duration-300",
                  wakewordEnabled
                    ? "bg-primary/10 border-primary/20"
                    : "bg-theme-card border-theme/50",
                )}
              >
                {wakewordEnabled ? (
                  <Mic className="w-5 h-5 text-primary" />
                ) : (
                  <MicOff className="w-5 h-5 text-theme-muted" />
                )}
              </div>
              <div>
                <div className="text-[13px] font-bold text-theme-fg">
                  Enable wakeword
                </div>
                <p className="text-[11px] text-theme-muted font-medium mt-0.5">
                  Listens in the background and opens the main voice UI when detected.
                </p>
              </div>
            </div>
            <ToggleSwitch checked={wakewordEnabled} onChange={setWakewordEnabled} />
          </div>
        </div>

        {wakewordEnabled && (
          <div className="rounded-2xl border border-theme/50 bg-theme-hover/50 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Volume2 className="w-4 h-4 text-primary/70" />
              <label className="text-[10px] font-black uppercase tracking-widest text-theme-muted">
                Sensitivity
              </label>
              <span className="ml-auto rounded-lg border border-theme/50 bg-theme-card px-2 py-0.5 text-[11px] font-bold font-mono text-theme-fg">
                {sensitivity.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.3}
              max={0.95}
              step={0.05}
              value={sensitivity}
              onChange={(event) => setSensitivity(parseFloat(event.target.value))}
              className="w-full h-2 rounded-full appearance-none bg-theme-hover cursor-pointer accent-primary"
            />
            <p className="text-[11px] text-theme-muted font-medium mt-2">
              {sensitivityLabel(sensitivity)}
            </p>
          </div>
        )}

        <div
          className={clsx(
            "rounded-2xl border p-5",
            customModelActive
              ? "border-emerald-500/25 bg-emerald-500/5"
              : enrollment?.status === "processing" || applyingWeights
                ? "border-amber-500/20 bg-amber-500/5"
                : "border-theme/50 bg-theme-hover/30",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-widest text-theme-muted">
                  Active Model
                </span>
              </div>
              <div className="text-[14px] font-bold text-theme-fg">{modelTitle}</div>
              <p className="text-[11px] text-theme-muted font-medium mt-1 leading-relaxed">
                {modelDescription}
              </p>
            </div>
            <div
              className={clsx(
                "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                customModelActive
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : enrollment?.status === "processing" || applyingWeights
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-theme/50 bg-theme-card text-theme-muted",
              )}
            >
              {customModelActive
                ? "Custom"
                : enrollment?.status === "processing" || applyingWeights
                  ? "Syncing"
                  : "Default"}
            </div>
          </div>

          {applyError && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <span className="text-[11px] font-medium text-red-500">{applyError}</span>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-theme/50 bg-theme-hover/30 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Crown className="w-4 h-4 text-amber-500" />
            <span className="text-[12px] font-black uppercase tracking-widest text-theme-fg">
              Add Your Voice
            </span>
            <span className="ml-auto rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-500">
              Starter+
            </span>
          </div>

          <p className="text-[11px] text-theme-muted font-medium leading-relaxed">
            Keep this simple: record 2 short clips of yourself saying "Hey Stuard",
            we train the model in the cloud, then the desktop downloads and applies it.
          </p>

          {!isPaid && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
              <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <span className="text-[11px] font-medium text-amber-500">
                Custom wakeword training requires Starter or above.
              </span>
            </div>
          )}

          {loadingStatus ? (
            <div className="mt-4 flex items-center gap-2 text-theme-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[12px] font-medium">Checking training status...</span>
            </div>
          ) : enrollment?.status === "processing" ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500 mt-0.5 shrink-0" />
              <div>
                <div className="text-[12px] font-bold text-amber-500">Training in progress</div>
                <div className="text-[11px] text-theme-muted font-medium mt-0.5">
                  Leave this window open if you want it to auto-apply as soon as the model is ready.
                </div>
              </div>
            </div>
          ) : enrollment?.status === "completed" ? (
            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[12px] font-bold text-emerald-500">
                    {customModelActive ? "Custom model active" : "Custom model ready"}
                  </div>
                  <div className="text-[11px] text-theme-muted font-medium mt-0.5">
                    Phrase: "{enrollment.wakePhrase || "hey stuard"}"
                    {enrollment.createdAt
                      ? `, trained ${new Date(enrollment.createdAt).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleApplyLatest}
                  disabled={applyingWeights}
                  className="flex items-center gap-2 rounded-xl border border-theme/50 px-4 py-2 text-[12px] font-bold text-theme-fg transition-all hover:bg-theme-hover disabled:opacity-50"
                >
                  {applyingWeights ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {applyingWeights ? "Applying..." : "Apply Latest Model"}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-[12px] font-bold text-red-500 transition-all hover:bg-red-500/10 disabled:opacity-50"
                >
                  {deleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Use Default Model
                </button>
              </div>
            </div>
          ) : enrollment?.status === "failed" ? (
            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[12px] font-bold text-red-500">Training failed</div>
                  <div className="text-[11px] text-theme-muted font-medium mt-0.5">
                    {enrollment.errorMessage || "Try recording cleaner samples and start again."}
                  </div>
                </div>
              </div>
              {renderRecordingUI(clipsReady, isPaid)}
            </div>
          ) : (
            <div className="mt-4">{renderRecordingUI(clipsReady, isPaid)}</div>
          )}
        </div>
      </div>
    </div>
  );

  function renderRecordingUI(ready: boolean, canTrain: boolean) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-xl border border-theme/50 bg-theme-card px-3 py-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-theme-muted">
              1. Record
            </div>
            <div className="text-[12px] font-bold text-theme-fg mt-1">
              Two short clips
            </div>
          </div>
          <div className="rounded-xl border border-theme/50 bg-theme-card px-3 py-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-theme-muted">
              2. Train
            </div>
            <div className="text-[12px] font-bold text-theme-fg mt-1">
              Cloud fine-tunes it
            </div>
          </div>
          <div className="rounded-xl border border-theme/50 bg-theme-card px-3 py-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-theme-muted">
              3. Apply
            </div>
            <div className="text-[12px] font-bold text-theme-fg mt-1">
              Desktop switches automatically
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={isRecording ? stopRecordingSample : startRecordingSample}
            disabled={enrolling || !canTrain}
            className={clsx(
              "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[12px] font-bold transition-all duration-300 disabled:opacity-50",
              isRecording
                ? "animate-pulse border-red-500/30 bg-red-500/10 text-red-500"
                : "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10",
            )}
          >
            <Mic className="w-3.5 h-3.5" />
            {isRecording ? "Recording 3 second clip..." : "Record 3 second clip"}
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={enrolling || !canTrain}
            className="flex items-center gap-2 rounded-xl border border-theme/50 px-4 py-2.5 text-[12px] font-bold text-theme-muted transition-all duration-300 hover:bg-theme-hover/50 disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload clips
          </button>

          <div
            className={clsx(
              "ml-auto rounded-xl border px-3 py-2 text-[11px] font-bold",
              ready
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-theme/50 bg-theme-card text-theme-muted",
            )}
          >
            {recordings.length}/2 clips ready
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.wav,.webm"
          multiple
          onChange={handleFileUpload}
          className="hidden"
        />

        {recordings.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-black uppercase tracking-widest text-theme-muted">
              Selected Clips
            </div>
            <div className="flex flex-wrap gap-2">
              {recordings.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-1.5 rounded-lg border border-theme/50 bg-theme-card px-3 py-1.5 text-[11px] font-medium text-theme-fg"
                >
                  <Mic className="w-3 h-3 text-primary" />
                  <span>{file.name}</span>
                  <button
                    onClick={() => removeRecording(index)}
                    className="ml-1 text-theme-muted transition-colors hover:text-red-500"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {enrollError && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <span className="text-[11px] font-medium text-red-500">{enrollError}</span>
          </div>
        )}

        {enrollSuccess && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
            <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
            <span className="text-[11px] font-medium text-emerald-500">
              Training started. The model will download and apply here when it is ready.
            </span>
          </div>
        )}

        <button
          onClick={handleEnroll}
          disabled={enrolling || !ready || !canTrain}
          className={clsx(
            "flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-black transition-all duration-300",
            ready && canTrain
              ? "bg-primary text-primary-fg hover:scale-105 hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-95"
              : "bg-theme-hover text-theme-muted cursor-not-allowed",
          )}
        >
          {enrolling ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Crown className="w-4 h-4" />
          )}
          {enrolling ? "Starting training..." : "Train with my voice"}
        </button>

        <p className="text-[10px] font-medium text-theme-muted">
          Use two quick, clear takes. It is cheaper and faster than uploading a long recording.
        </p>
      </div>
    );
  }
};
