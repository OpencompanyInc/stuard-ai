import React, { useMemo, useRef, useEffect, useState, useCallback } from "react";
import {
  X, Send, Trash2, AlertCircle, AlertTriangle, CheckCircle2,
  Radio, Repeat, ArrowRight, Info, Flag, CircleDot, ListFilter,
} from "lucide-react";
import { useWorkflowTheme } from "../WorkflowThemeContext";

/**
 * Execution Logs — a clean, themed timeline of a workflow run.
 *
 * The engine emits very verbose, emoji-prefixed lines (per-step start/complete,
 * a flood of 📡 stream events, 🔄 loop iterations …). Rather than dump them raw,
 * we parse each line into a structured event and render two views:
 *
 *   • Essential (default): the meaningful timeline — lifecycle, step start/finish,
 *     warnings, errors. Each step's streaming is coalesced into ONE live
 *     "Streaming · N chunks" row instead of dozens of lines.
 *   • Detailed: every line, with consecutive duplicates collapsed (×N).
 */

type LogKind =
  | "error" | "warn" | "success" | "step" | "lifecycle"
  | "stream" | "loop" | "flow" | "info";

interface ParsedLog {
  ts: string;
  stepId?: string;
  kind: LogKind;
  text: string;
  durationMs?: number;
  raw: string;
}

const STEP_RE = /^\[([^\]]+)\]\s*/;
const DUR_RE = /\((\d+)\s*ms\)/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

function classify(text: string): LogKind {
  const t = text;
  if (t.includes("❌") || /(?:^|\b)(?:error|failed)\b/i.test(t)) return "error";
  if (t.includes("⚠") || /\bwarn(?:ing)?\b/i.test(t)) return "warn";
  if (t.includes("✓") || /\bcompleted\b/i.test(t)) return "success";
  if (t.includes("📡")) return "stream";
  if (t.includes("🔄")) return "loop";
  if (/^run (?:started|completed)/i.test(t) || /^triggered\b/i.test(t) || /^workspace:/i.test(t)) return "lifecycle";
  if (/\bstarting\b/i.test(t)) return "step";
  if (
    t.includes("⚡") || t.trimStart().startsWith("→") ||
    /^waitforall/i.test(t) || /^next step/i.test(t) ||
    /\binterpolated\b/i.test(t) || /^loop target/i.test(t)
  ) return "flow";
  return "info";
}

function cleanText(text: string): string {
  return text
    .replace(EMOJI_RE, "")
    .replace(DUR_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s:–—-]+/, "")
    .trim();
}

function parseLog(l: { ts: string; msg: string }): ParsedLog {
  const raw = String(l?.msg ?? "");
  let rest = raw;
  let stepId: string | undefined;
  const m = rest.match(STEP_RE);
  if (m) { stepId = m[1]; rest = rest.slice(m[0].length); }
  const kind = classify(rest);
  const dm = rest.match(DUR_RE);
  const durationMs = dm ? Number(dm[1]) : undefined;
  const text = cleanText(rest) || cleanText(raw) || raw;
  return { ts: l.ts, stepId, kind, text, durationMs, raw };
}

// Trace-level kinds are hidden in the Essential view (streaming is summarised
// separately, the rest is low-level routing noise).
const TRACE_KINDS = new Set<LogKind>(["stream", "loop", "flow", "info"]);

interface StreamSummary {
  stepId: string;
  events: number;
  chunks: number;
  active: boolean;
  firstIndex: number;
  ts: string;
}

function buildStreamSummaries(parsed: ParsedLog[]): Map<string, StreamSummary> {
  const map = new Map<string, StreamSummary>();
  parsed.forEach((p, i) => {
    if (p.kind !== "stream") return;
    const key = p.stepId || "stream";
    let s = map.get(key);
    if (!s) {
      s = { stepId: key, events: 0, chunks: 0, active: true, firstIndex: i, ts: p.ts };
      map.set(key, s);
    }
    s.events += 1;
    s.ts = p.ts;
    const afterN = p.raw.match(/after\s+(\d+)\s+chunks?/i);
    const chunkN = p.raw.match(/chunk\s+(\d+)/i);
    if (afterN) s.chunks = Math.max(s.chunks, Number(afterN[1]));
    if (chunkN) s.chunks = Math.max(s.chunks, Number(chunkN[1]));
    if (/closed|finished|idle timeout/i.test(p.raw)) s.active = false;
  });
  return map;
}

type DisplayRow =
  | { type: "log"; entry: ParsedLog; count: number; key: string }
  | { type: "stream"; summary: StreamSummary; key: string };

function timeOf(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour12: false });
}

function signature(p: ParsedLog): string {
  return `${p.kind}|${p.stepId || ""}|${p.text.replace(/\d+/g, "#")}`;
}

export function WorkflowLogsPanel({
  logs,
  onClear,
  onSendToChat,
  onClose,
}: {
  logs: Array<{ ts: string; msg: string }>;
  onClear: () => void;
  onSendToChat: (text: string) => void;
  onClose: () => void;
}) {
  const { isDark } = useWorkflowTheme();
  const d = isDark;
  const [detailed, setDetailed] = useState(false);

  const parsed = useMemo(() => (logs || []).map(parseLog), [logs]);
  const streamSummaries = useMemo(() => buildStreamSummaries(parsed), [parsed]);
  const errorCount = useMemo(() => parsed.filter((p) => p.kind === "error").length, [parsed]);

  const rows = useMemo<DisplayRow[]>(() => {
    const out: DisplayRow[] = [];
    const insertedStream = new Set<string>();

    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];

      if (!detailed && TRACE_KINDS.has(p.kind)) {
        // Essential view: replace each step's stream burst with a single summary
        // row (placed at the first stream event); drop the rest of the trace.
        if (p.kind === "stream") {
          const key = p.stepId || "stream";
          if (!insertedStream.has(key)) {
            insertedStream.add(key);
            const summary = streamSummaries.get(key);
            if (summary) out.push({ type: "stream", summary, key: `stream-${key}` });
          }
        }
        continue;
      }

      // Collapse consecutive identical lines (loops, repeated warnings …).
      const sig = signature(p);
      const last = out[out.length - 1];
      if (last && last.type === "log" && signature(last.entry) === sig) {
        last.count += 1;
        last.entry = p; // keep the latest timestamp/duration
        continue;
      }
      out.push({ type: "log", entry: p, count: 1, key: `log-${i}` });
    }
    return out;
  }, [parsed, detailed, streamSummaries]);

  // Stick-to-bottom auto-scroll.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [rows]);

  const handleSend = useCallback(() => {
    const text = (logs || []).map((l) => `[${timeOf(l.ts)}] ${l.msg}`).join("\n");
    onSendToChat(text || "");
  }, [logs, onSendToChat]);

  const iconBtn = "p-1.5 rounded-lg wf-fg-faint wf-hover-fg wf-hover-bg transition-colors";

  return (
    <div className="flex flex-col h-full w-full rounded-r-xl overflow-hidden wf-bg-sunken wf-fg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b wf-border-subtle" style={{ background: "var(--wf-bg-overlay)" }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold wf-fg text-sm">Execution Logs</span>
          {errorCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold inline-flex items-center gap-1"
              style={{ background: d ? "rgba(239,68,68,0.14)" : "#fef2f2", color: d ? "#fca5a5" : "#dc2626" }}>
              <AlertCircle className="w-2.5 h-2.5" />{errorCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleSend} className={iconBtn} title="Send to Chat"><Send className="w-4 h-4" /></button>
          <button onClick={onClear} className="p-1.5 rounded-lg wf-fg-faint transition-colors wf-menu-item-danger" title="Clear Logs"><Trash2 className="w-4 h-4" /></button>
          <button onClick={onClose} className={`${iconBtn} ml-1`} title="Close"><X className="w-4 h-4" /></button>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b wf-border-subtle">
        <div className="inline-flex items-center rounded-lg p-0.5 text-[11px] font-medium" style={{ background: d ? "rgba(255,255,255,0.04)" : "#f1f5f9" }}>
          {([["Essential", false], ["Detailed", true]] as const).map(([label, val]) => {
            const active = detailed === val;
            return (
              <button
                key={label}
                onClick={() => setDetailed(val)}
                className="px-2.5 py-1 rounded-[6px] transition-colors"
                style={active
                  ? { background: d ? "rgba(244,63,94,0.16)" : "#ffffff", color: d ? "#fda4af" : "#e11d48", boxShadow: d ? "none" : "0 1px 2px rgba(0,0,0,0.06)" }
                  : { color: "var(--wf-fg-faint)" }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] wf-fg-faint inline-flex items-center gap-1">
          <ListFilter className="w-3 h-3" />
          {detailed ? "All events" : "Key events"}
        </span>
      </div>

      {/* Timeline */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-auto px-2 py-2 scrollbar-minimal">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-3" style={{ background: d ? "rgba(255,255,255,0.04)" : "#f1f5f9" }}>
              <CircleDot className={`w-5 h-5 ${d ? "text-white/30" : "text-slate-300"}`} />
            </div>
            <p className="text-sm wf-fg font-medium">No activity yet</p>
            <p className="text-xs wf-fg-muted mt-1">Run or deploy this workflow to see its execution timeline here.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {rows.map((row) =>
              row.type === "stream"
                ? <StreamRow key={row.key} summary={row.summary} d={d} />
                : <LogRow key={row.key} entry={row.entry} count={row.count} d={d} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function kindStyle(kind: LogKind, d: boolean): { icon: React.ReactNode; color: string } {
  switch (kind) {
    case "error": return { icon: <AlertCircle className="w-3.5 h-3.5" />, color: d ? "#f87171" : "#dc2626" };
    case "warn": return { icon: <AlertTriangle className="w-3.5 h-3.5" />, color: d ? "#fbbf24" : "#d97706" };
    case "success": return { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: d ? "#34d399" : "#059669" };
    case "lifecycle": return { icon: <Flag className="w-3.5 h-3.5" />, color: d ? "#fda4af" : "#e11d48" };
    case "step": return { icon: <CircleDot className="w-3.5 h-3.5" />, color: d ? "#94a3b8" : "#64748b" };
    case "stream": return { icon: <Radio className="w-3.5 h-3.5" />, color: d ? "#38bdf8" : "#0284c7" };
    case "loop": return { icon: <Repeat className="w-3.5 h-3.5" />, color: d ? "#a78bfa" : "#7c3aed" };
    case "flow": return { icon: <ArrowRight className="w-3.5 h-3.5" />, color: d ? "#64748b" : "#94a3b8" };
    default: return { icon: <Info className="w-3.5 h-3.5" />, color: d ? "#64748b" : "#94a3b8" };
  }
}

function StepChip({ stepId, d }: { stepId?: string; d: boolean }) {
  if (!stepId) return null;
  return (
    <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium max-w-[120px] truncate"
      style={{ background: d ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: "var(--wf-fg-faint)" }}
      title={stepId}>
      {stepId}
    </span>
  );
}

function LogRow({ entry, count, d }: { entry: ParsedLog; count: number; d: boolean }) {
  const { icon, color } = kindStyle(entry.kind, d);
  const emphasize = entry.kind === "error" || entry.kind === "warn";
  return (
    <div className="group flex items-start gap-2.5 px-2 py-1.5 rounded-lg wf-hover-bg transition-colors">
      <span className="mt-0.5 shrink-0" style={{ color }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <StepChip stepId={entry.stepId} d={d} />
          <span className={`text-[12.5px] leading-snug break-words ${emphasize ? "" : "wf-fg-muted"}`} style={emphasize ? { color } : undefined}>
            {entry.text}
          </span>
          {entry.durationMs != null && (
            <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-mono" style={{ background: d ? "rgba(255,255,255,0.04)" : "#f1f5f9", color: "var(--wf-fg-faint)" }}>
              {entry.durationMs}ms
            </span>
          )}
          {count > 1 && (
            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: d ? "rgba(255,255,255,0.06)" : "#e2e8f0", color: "var(--wf-fg-faint)" }}>
              ×{count}
            </span>
          )}
        </div>
      </div>
      <span className="shrink-0 text-[10px] font-mono wf-fg-faint opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
        {timeOf(entry.ts)}
      </span>
    </div>
  );
}

function StreamRow({ summary, d }: { summary: StreamSummary; d: boolean }) {
  const color = d ? "#38bdf8" : "#0284c7";
  const detail = summary.chunks > 0
    ? `${summary.chunks} chunk${summary.chunks !== 1 ? "s" : ""}`
    : `${summary.events} event${summary.events !== 1 ? "s" : ""}`;
  return (
    <div className="group flex items-start gap-2.5 px-2 py-1.5 rounded-lg wf-hover-bg transition-colors">
      <span className="mt-0.5 shrink-0 relative" style={{ color }}>
        <Radio className="w-3.5 h-3.5" />
        {summary.active && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full" style={{ background: color }}>
            <span className="absolute inset-0 rounded-full animate-ping" style={{ background: color }} />
          </span>
        )}
      </span>
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <StepChip stepId={summary.stepId === "stream" ? undefined : summary.stepId} d={d} />
        <span className="text-[12.5px] leading-snug font-medium" style={{ color }}>
          {summary.active ? "Streaming…" : "Streamed"}
        </span>
        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono" style={{ background: d ? "rgba(56,189,248,0.12)" : "#e0f2fe", color }}>
          {detail}
        </span>
      </div>
      <span className="shrink-0 text-[10px] font-mono wf-fg-faint opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
        {timeOf(summary.ts)}
      </span>
    </div>
  );
}
