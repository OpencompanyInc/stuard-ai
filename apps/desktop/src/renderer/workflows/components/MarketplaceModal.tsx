import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { getMarketplaceApi, MarketplaceWorkflow, MarketplaceCategory, MarketplaceVersion, MarketplaceUpdate, MarketplaceCreatorProfile, MarketplaceWorkflowMedia } from "../../utils/cloud";
import { supabase } from "../../lib/supabaseClient";
import {
  Search, Download, Star, Tag, User, Calendar, X, AlertCircle, Loader2, Globe, Check, ChevronRight,
  Hash, Sparkles, Rocket, Plus, CheckCircle2, Pencil, Trash2, Clock, History, ArrowUpCircle, Package,
  Lock, Unlock, RefreshCw, ExternalLink, Info, Eye, EyeOff, Upload, ImagePlus, PlayCircle, Users,
  Shield, ShieldAlert, ShieldCheck, ChevronDown, Layers, Box, Zap, Brain, Database, Mail, Code,
  Wand2, Terminal, FileText, MessageSquare, Image as ImageIcon, Cloud, ArrowRight, ArrowDown
} from "lucide-react";
import { useWorkflowTheme, WorkflowPortal } from "../WorkflowThemeContext";
import { FUNCTION_NODE_ICONS, FUNCTION_NODE_COLORS } from "../constants/functionNodeStyle";
import { withWorkspaceBundle } from "../utils/workspaceBundle";
import { FilesReviewStep, useBundleSelection } from "./FilesReviewStep";
import { confirmDialog } from "./ConfirmDialog";
import {
  getMarketplaceUsername,
  setMarketplaceUsername,
  normalizeUsername,
  onMarketplaceUsernameChanged,
  creatorProfileFromUsername,
} from "../utils/marketplaceIdentity";
import "../../scrollbar.css";

// Helper to get token from Supabase auth
async function getToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id || null;
  } catch {
    return null;
  }
}

// ─── Per-workflow marketplace link persistence ──────────────────────────────
// After a publish/update we write the assigned slug + version back onto the
// local workflow file. Without this the model never learns it's already on the
// marketplace, so the next publish creates a brand-new listing instead of a new
// version of the same one. This is the core of workflow version control.
async function persistMarketplaceLink(
  model: any,
  slug: string | undefined,
  version: string | undefined,
): Promise<void> {
  try {
    if (!model?.id || !slug) return;
    const updated = { ...model, marketplaceSlug: slug };
    if (version) (updated as any).marketplaceVersion = version;
    await (window as any).desktopAPI?.workflowsSave?.(model.id, JSON.stringify(updated, null, 2));
    // Keep the in-memory object in sync so re-opening the modal sees the link.
    model.marketplaceSlug = slug;
    if (version) model.marketplaceVersion = version;
  } catch (e) {
    console.warn('[marketplace] failed to persist marketplace link', e);
  }
}

async function uploadMarketplaceAsset(file: File, kind: 'thumbnail' | 'cover' | 'media'): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('Please sign in to upload marketplace media');
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const path = `${userId}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  const { error } = await supabase.storage
    .from('marketplace-media')
    .upload(path, file, { upsert: false, contentType: file.type || undefined });

  if (error) {
    throw new Error(error.message || 'Failed to upload media');
  }

  const { data } = supabase.storage.from('marketplace-media').getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error('Failed to get uploaded media URL');
  }

  return data.publicUrl;
}

function getMediaPreviewUrl(item: MarketplaceWorkflowMedia): string {
  return item.thumbnail_url || item.url;
}

function isVideoMedia(item: MarketplaceWorkflowMedia): boolean {
  return item.media_type === 'video';
}

// Toast notification component
function Toast({ message, type = 'success', onClose }: { message: string; type?: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className="wf-bg-elevated fixed bottom-6 right-6 z-[1100] px-4 py-3 rounded-xl shadow-2xl border flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300"
      style={{
        borderColor: type === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(244,63,94,0.35)',
        color: 'var(--wf-fg)',
      }}
    >
      {type === 'success'
        ? <CheckCircle2 className="w-5 h-5" style={{ color: '#22c55e' }} />
        : <AlertCircle className="w-5 h-5" style={{ color: '#fb7185' }} />}
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="p-0.5 rounded wf-hover-bg wf-fg-muted">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
  maxWidth = "max-w-2xl"
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const { isDark } = useWorkflowTheme();
  const d = isDark;
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center backdrop-blur-md p-4 animate-in fade-in duration-200"
      style={{ background: d ? "rgba(2, 6, 23, 0.78)" : "rgba(15, 23, 42, 0.18)" }}
    >
      <div
        className={`w-full ${maxWidth} rounded-[28px] border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200`}
        style={{ background: d ? "#0f1117" : "#ffffff", borderColor: "var(--wf-border)", color: "var(--wf-fg)" }}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0" style={{ background: d ? "#0c0f14" : "#ffffff", borderColor: "var(--wf-border)" }}>
          <div className="text-[16px] font-semibold wf-fg">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "var(--wf-fg-faint)" }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto custom-scrollbar">{children}</div>
      </div>
    </div>
  );
}

// ─── Marketplace identity panel ──────────────────────────────────────────────
// The one-time publisher @username. Set once here (or in My Published), reused
// for every publish. Replaces the old per-publish display-name + handle fields.
function MarketplaceIdentityPanel({
  onChange,
  compact = false,
}: {
  onChange?: (username: string) => void;
  compact?: boolean;
}) {
  const [username, setUsername] = useState(() => getMarketplaceUsername());
  const [editing, setEditing] = useState(() => !getMarketplaceUsername());
  const [draft, setDraft] = useState(username);

  useEffect(() => {
    return onMarketplaceUsernameChanged((u) => {
      setUsername(u);
      setDraft(u);
      setEditing(!u);
    });
  }, []);

  const commit = () => {
    const u = setMarketplaceUsername(draft);
    setUsername(u);
    setDraft(u);
    setEditing(!u);
    onChange?.(u);
  };

  return (
    <div className={`wf-card rounded-2xl border wf-border ${compact ? "p-3.5" : "p-4"}`}>
      <div className="flex items-center gap-2 text-[13px] font-semibold wf-fg">
        <User className="w-4 h-4" style={{ color: "var(--wf-accent)" }} />
        Marketplace identity
      </div>
      <p className="mt-1 text-xs wf-fg-muted">
        Everything you publish goes out under this one username — set it once, it's reused for every workflow.
      </p>
      {editing ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-1 items-center wf-input rounded-xl px-3 py-2 text-sm">
            <span className="wf-fg-faint mr-0.5">@</span>
            <input
              value={draft}
              onChange={(e) => setDraft(normalizeUsername(e.target.value))}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
              placeholder="your-username"
              className="flex-1 bg-transparent outline-none wf-fg"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={commit}
            disabled={!normalizeUsername(draft)}
            className="wf-primary-btn rounded-full px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
          >
            Save
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold wf-fg">@{username}</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[12px] font-medium wf-fg-muted hover:wf-fg"
          >
            <Pencil className="w-3 h-3" /> Edit
          </button>
        </div>
      )}
    </div>
  );
}

type MarketplaceSelectOption = { value: string; label: string };

function MarketplaceSelect({
  value,
  onChange,
  options,
  disabled,
  placeholder = "Select...",
}: {
  value: string;
  onChange: (value: string) => void;
  options: MarketplaceSelectOption[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const updateDropdownPos = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dropdownHeight = Math.min(options.length * 40 + 8, 240);
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceBelow < dropdownHeight && rect.top > spaceBelow;
    setDropdownPos({
      top: showAbove ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, [options.length]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (!open) updateDropdownPos();
          setOpen(!open);
        }}
        className="w-full px-3 py-2 border rounded-xl text-sm wf-input flex items-center justify-between gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wf-accent)_30%,transparent)]"
      >
        <span className={selected ? "wf-fg font-medium" : "wf-fg-faint"}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 wf-fg-faint shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && dropdownPos && (
        <WorkflowPortal>
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 10001,
          }}
          className="wf-bg-elevated border wf-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="p-1 max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm rounded-lg flex items-center justify-between gap-2 transition-colors mb-0.5 ${
                  opt.value === value ? "wf-accent-chip font-medium" : "wf-fg wf-hover-bg"
                }`}
              >
                <span>{opt.label}</span>
                {opt.value === value && <Check className="w-4 h-4 wf-accent-fg shrink-0" />}
              </button>
            ))}
          </div>
        </div>
        </WorkflowPortal>
      )}
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[], onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");
  const { isDark } = useWorkflowTheme();
  const d = isDark;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.trim().replace(/,/g, '');
      if (val && !tags.includes(val)) {
        onChange([...tags, val]);
        setInput("");
      }
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div
      className="flex flex-wrap gap-2 p-2 border rounded-lg focus-within:ring-2 focus-within:ring-indigo-500/20 min-h-[42px] transition-all"
      style={{ background: d ? "rgba(255,255,255,0.04)" : "#ffffff", borderColor: "var(--wf-input-border)" }}
    >
      {tags.map(tag => (
        <span key={tag} className="flex items-center gap-1 pl-2 pr-1 py-1 text-xs font-medium rounded-md border animate-in zoom-in-95 duration-200" style={{ background: d ? "rgba(96,165,250,0.12)" : "#eef2ff", color: d ? "#bfdbfe" : "#4338ca", borderColor: d ? "rgba(96,165,250,0.18)" : "#c7d2fe" }}>
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter(t => t !== tag))}
            className="p-0.5 rounded transition-colors"
            style={{ color: d ? "#93c5fd" : "#6366f1" }}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          const val = input.trim();
          if (val && !tags.includes(val)) {
            onChange([...tags, val]);
            setInput("");
          }
        }}
        className="flex-1 min-w-[120px] text-sm outline-none bg-transparent"
        style={{ color: "var(--wf-fg)" }}
        placeholder={tags.length === 0 ? "Add tags (press Enter)..." : ""}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY REVIEW PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function SecurityReviewPanel({
  analysis,
  reason,
  code,
  isDark,
}: {
  analysis?: any;
  reason?: string;
  code?: string;
  isDark: boolean;
}) {
  const d = isDark;
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);

  const alertSurface = {
    background: d
      ? "color-mix(in srgb, #ef4444 10%, var(--wf-bg-elevated))"
      : "color-mix(in srgb, #ef4444 6%, var(--wf-bg-elevated))",
    borderColor: "color-mix(in srgb, #ef4444 28%, var(--wf-border))",
  };

  // Simple blocked message (quick static check failed)
  if (code === "SECURITY_BLOCKED") {
    return (
      <div
        className="wf-card rounded-2xl p-5 space-y-3 animate-in slide-in-from-top-2 duration-300"
        style={alertSurface}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: "color-mix(in srgb, #ef4444 14%, transparent)",
              color: d ? "#fca5a5" : "#dc2626",
            }}
          >
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-sm" style={{ color: d ? "#fca5a5" : "#b91c1c" }}>
              Security Check Blocked
            </h4>
            <p className="text-xs mt-1 leading-relaxed wf-fg-muted">
              {reason || "Your workflow was blocked by our security checks."}
            </p>
          </div>
        </div>
        <p className="text-xs leading-relaxed wf-fg-faint">
          Please review your workflow and remove any patterns that access sensitive system files,
          contain destructive commands, or could be used for data exfiltration. Then try publishing again.
        </p>
      </div>
    );
  }

  // No analysis data - generic error
  if (!analysis) {
    return (
      <div
        className="wf-card p-4 rounded-2xl flex items-start gap-3 animate-in slide-in-from-top-2 duration-300"
        style={alertSurface}
      >
        <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" style={{ color: d ? "#fca5a5" : "#dc2626" }} />
        <div>
          <span className="text-sm font-medium" style={{ color: d ? "#fca5a5" : "#b91c1c" }}>
            {reason || "Security review failed. Please try again."}
          </span>
        </div>
      </div>
    );
  }

  // Full detailed security review results
  const { score, riskLevel, issues, warnings, summary, recommendations } = analysis;
  const scorePercent = Math.max(0, Math.min(100, score || 0));

  const riskPalette: Record<string, { hue: string; text: string }> = {
    critical: { hue: "#ef4444", text: d ? "#fca5a5" : "#b91c1c" },
    high: { hue: "#f97316", text: d ? "#fdba74" : "#c2410c" },
    medium: { hue: "#f59e0b", text: d ? "#fcd34d" : "#b45309" },
    low: { hue: "#22c55e", text: d ? "#86efac" : "#15803d" },
  };
  const palette = riskPalette[riskLevel] || riskPalette.high;

  const severityConfig: Record<string, { hue: string; label: string }> = {
    critical: { hue: "#ef4444", label: "CRITICAL" },
    high: { hue: "#f97316", label: "HIGH" },
    medium: { hue: "#f59e0b", label: "MEDIUM" },
    low: { hue: "#22c55e", label: "LOW" },
  };

  const scoreBarColor =
    scorePercent >= 70 ? "#22c55e" : scorePercent >= 50 ? "#f59e0b" : scorePercent >= 30 ? "#f97316" : "#ef4444";

  return (
    <div
      className="wf-card rounded-2xl p-5 space-y-4 animate-in slide-in-from-top-2 duration-300"
      style={{
        background: `color-mix(in srgb, ${palette.hue} 8%, var(--wf-bg-elevated))`,
        borderColor: `color-mix(in srgb, ${palette.hue} 24%, var(--wf-border))`,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: `color-mix(in srgb, ${palette.hue} 14%, transparent)`,
              color: palette.text,
            }}
          >
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-semibold text-sm" style={{ color: palette.text }}>
              Security Review Failed
            </h4>
            <p className="text-xs mt-0.5 wf-fg-muted">
              Your workflow did not pass the automated security review. Fix the issues below and try again.
            </p>
          </div>
        </div>
        <span
          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border shrink-0"
          style={{
            background: `color-mix(in srgb, ${palette.hue} 12%, transparent)`,
            color: palette.text,
            borderColor: `color-mix(in srgb, ${palette.hue} 28%, transparent)`,
          }}
        >
          {riskLevel}
        </span>
      </div>

      {/* Score bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium wf-fg">Security Score</span>
          <span className="text-xs font-bold" style={{ color: palette.text }}>{scorePercent}/100</span>
        </div>
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ background: "color-mix(in srgb, var(--wf-fg) 8%, transparent)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${scorePercent}%`, background: scoreBarColor }}
          />
        </div>
        <p className="text-[11px] wf-fg-faint">
          A score of 40+ with no critical issues is required to publish.
        </p>
      </div>

      {/* AI Summary */}
      {summary && (
        <div className="wf-surface-muted rounded-xl p-3">
          <p className="text-xs leading-relaxed wf-fg-muted">{summary}</p>
        </div>
      )}

      {/* Issues */}
      {issues && issues.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-[11px] font-semibold uppercase tracking-wide wf-fg-faint">
            Issues ({issues.length})
          </h5>
          <div className="space-y-2">
            {issues.map((issue: any, i: number) => {
              const sev = severityConfig[issue.severity] || severityConfig.medium;
              const isExpanded = expandedIssue === i;
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => setExpandedIssue(isExpanded ? null : i)}
                  className="w-full rounded-xl p-3 border text-left transition-all wf-hover-bg"
                  style={{
                    background: `color-mix(in srgb, ${sev.hue} 6%, var(--wf-bg-elevated))`,
                    borderColor: `color-mix(in srgb, ${sev.hue} 18%, var(--wf-border))`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background: `color-mix(in srgb, ${sev.hue} 12%, transparent)`,
                        color: d
                          ? `color-mix(in srgb, ${sev.hue} 72%, white)`
                          : `color-mix(in srgb, ${sev.hue} 78%, black)`,
                        border: `1px solid color-mix(in srgb, ${sev.hue} 30%, transparent)`,
                      }}
                    >
                      {sev.label}
                    </span>
                    <span
                      className="text-xs font-semibold flex-1"
                      style={{
                        color: d
                          ? `color-mix(in srgb, ${sev.hue} 70%, white)`
                          : `color-mix(in srgb, ${sev.hue} 75%, black)`,
                      }}
                    >
                      {issue.title}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 wf-fg-faint transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    />
                  </div>
                  {isExpanded && (
                    <div className="mt-2 space-y-1.5 animate-in slide-in-from-top-1 duration-200">
                      <p className="text-xs leading-relaxed wf-fg-muted">{issue.description}</p>
                      {issue.remediation && (
                        <p className="text-xs flex items-start gap-1.5 pt-0.5 wf-accent-text">
                          <span className="font-semibold shrink-0">Fix:</span> {issue.remediation}
                        </p>
                      )}
                      {issue.location && (
                        <p className="text-[10px] font-mono wf-fg-faint">Node: {issue.location}</p>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-[11px] font-semibold uppercase tracking-wide wf-fg-faint">
            Warnings ({warnings.length})
          </h5>
          <div className="space-y-1.5">
            {warnings.map((w: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-xs rounded-lg p-2.5 wf-surface-muted">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: d ? "#fcd34d" : "#d97706" }} />
                <div>
                  <span className="font-medium wf-fg">{w.category}: </span>
                  <span className="wf-fg-muted">{w.message}</span>
                  {w.suggestion && (
                    <p className="mt-0.5 wf-accent-text">{w.suggestion}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations && recommendations.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="text-[11px] font-semibold uppercase tracking-wide wf-fg-faint">
            Recommendations
          </h5>
          <ul className="space-y-1">
            {recommendations.map((rec: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-xs wf-fg-muted">
                <ShieldCheck className="w-3 h-3 shrink-0 mt-0.5" style={{ color: d ? "#86efac" : "#16a34a" }} />
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLISHING PROGRESS BANNER
// ═══════════════════════════════════════════════════════════════════════════════

function PublishingProgress({ phase }: { phase: string; isDark: boolean }) {
  const steps = [
    { key: "reviewing", label: "Security Review", description: "AI is analyzing your workflow for security issues..." },
    { key: "publishing", label: "Publishing", description: "Saving and indexing your workflow..." },
  ];
  const currentIndex = steps.findIndex((s) => s.key === phase);

  return (
    <div
      className="wf-card rounded-2xl p-5 animate-in fade-in duration-300"
      style={{
        background: "color-mix(in srgb, var(--wf-accent) 8%, var(--wf-bg-elevated))",
        borderColor: "color-mix(in srgb, var(--wf-accent) 22%, var(--wf-border))",
      }}
    >
      <div className="flex items-center gap-4">
        <div className="relative">
          <Loader2 className="w-8 h-8 animate-spin wf-accent-text" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold wf-fg">
            {steps[currentIndex]?.label || "Processing"}...
          </h4>
          <p className="text-xs mt-0.5 wf-fg-muted">
            {steps[currentIndex]?.description || "Please wait..."}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        {steps.map((step, i) => (
          <div
            key={step.key}
            className="flex-1 h-1.5 rounded-full overflow-hidden"
            style={{ background: "color-mix(in srgb, var(--wf-fg) 8%, transparent)" }}
          >
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                i < currentIndex
                  ? "w-full"
                  : i === currentIndex
                  ? "w-full animate-pulse"
                  : "w-0"
              }`}
              style={{
                background: i <= currentIndex ? "var(--wf-accent)" : "transparent",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {steps.map((step, i) => (
          <div key={step.key} className="flex-1">
            <span
              className={`text-[10px] font-medium ${i <= currentIndex ? "wf-accent-text" : "wf-fg-faint"}`}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PublishModal({
  model,
  onClose,
  onSuccess,
}: {
  model: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [publishPhase, setPublishPhase] = useState<'idle' | 'reviewing' | 'publishing' | 'done' | 'failed'>('idle');
  const [securityResult, setSecurityResult] = useState<{ code?: string; reason?: string; analysis?: any } | null>(null);
  const [name, setName] = useState(model.name || "");
  const [description, setDescription] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [tags, setTags] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const initialPublishAs = React.useMemo<'workflow' | 'function'>(() => detectIsFunction(model) ? 'function' : 'workflow', [model]);
  const [publishAs] = useState<'workflow' | 'function'>(initialPublishAs);
  const [functionNode, setFunctionNode] = useState<FunctionNodeSpec>(() => deriveDefaultFunctionNode(model));
  const [autoDetectFlash, setAutoDetectFlash] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [maxReachedStep, setMaxReachedStep] = useState(0);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [media, setMedia] = useState<MarketplaceWorkflowMedia[]>([]);
  // Publisher identity is a single one-time @username (set in Showcase / My
  // Published), not a per-publish name + handle.
  const [username, setUsername] = useState<string>(() => getMarketplaceUsername());
  const [uploadingAsset, setUploadingAsset] = useState<'thumbnail' | 'cover' | 'media' | null>(null);
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [fetchingCats, setFetchingCats] = useState(true);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const { isDark } = useWorkflowTheme();
  const d = isDark;
  const cardStyle = { background: d ? "rgba(255,255,255,0.03)" : "#ffffff", borderColor: "var(--wf-border)" };
  const subtleCardStyle = { background: d ? "rgba(255,255,255,0.02)" : "var(--wf-bg)", borderColor: "var(--wf-border)" };
  const inputStyle = { background: d ? "rgba(255,255,255,0.04)" : "#ffffff", borderColor: "var(--wf-input-border)", color: "var(--wf-fg)" } as React.CSSProperties;
  const footerStyle = { background: d ? "#0c0f14" : "#ffffff", borderColor: "var(--wf-border)" };

  // State for handling existing published workflows
  const [existingWorkflow, setExistingWorkflow] = useState<MarketplaceWorkflow | null>(null);
  const [checkingOwnership, setCheckingOwnership] = useState(false);
  const [showUpdateMode, setShowUpdateMode] = useState(false);
  const [unpublishLoading, setUnpublishLoading] = useState(false);

  // Check if this workflow is already published by the current user
  useEffect(() => {
    if (!model.marketplaceSlug) return;

    const checkOwnership = async () => {
      setCheckingOwnership(true);
      try {
        const token = await getToken();
        if (!token) return; // User not logged in, can't be owner

        const api = getMarketplaceApi(() => token);
        const res = await api.getMyWorkflows();

        if (res.ok) {
          const found = res.workflows.find(w => w.slug === model.marketplaceSlug);
          if (found) {
            setExistingWorkflow(found);
            // Pre-fill form if we decide to publish as new, but mostly for "update" context
            setName(found.name);
            setDescription(found.description);
            setShortDescription(found.short_description || "");
            setCategory(found.category || "general");
            if (found.tags) setTags(found.tags);
            setThumbnailUrl(found.thumbnail_url || "");
            setCoverImageUrl(found.cover_image_url || "");
            setMedia(found.media || []);
            setLocked(Boolean(found.locked));
            // Seed the username from the existing listing if the user hasn't set
            // one yet (keeps their established handle).
            setUsername((prev) => prev || normalizeUsername(found.creator?.handle || found.publisher_name || ""));
          }
        }
      } catch (e) {
        console.error("Failed to check ownership", e);
      } finally {
        setCheckingOwnership(false);
      }
    };

    checkOwnership();
  }, [model.marketplaceSlug]);

  // Fetch categories on mount
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const api = getMarketplaceApi(() => token);
        const res = await api.getCategories();
        if (res.ok) {
          setCategories(res.categories);
        }
      } catch (e) {
        console.error("Failed to load categories", e);
      } finally {
        setFetchingCats(false);
      }
    })();
  }, []);

  const handleUploadFiles = useCallback(async (files: FileList | null, kind: 'thumbnail' | 'cover' | 'media') => {
    if (!files || files.length === 0) return;
    setUploadingAsset(kind);
    setError(null);

    try {
      if (kind === 'media') {
        const uploaded = await Promise.all(
          Array.from(files).map(async (file, index) => {
            const url = await uploadMarketplaceAsset(file, 'media');
            const mediaType: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';
            return {
              media_type: mediaType,
              url,
              thumbnail_url: mediaType === 'image' ? url : undefined,
              alt_text: file.name,
              sort_order: media.length + index,
            } as MarketplaceWorkflowMedia;
          })
        );
        setMedia(prev => [...prev, ...uploaded].map((item, index) => ({ ...item, sort_order: index })));
      } else {
        const file = files[0];
        const url = await uploadMarketplaceAsset(file, kind);
        if (kind === 'thumbnail') setThumbnailUrl(url);
        if (kind === 'cover') setCoverImageUrl(url);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to upload asset');
    } finally {
      setUploadingAsset(null);
      if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
      if (coverInputRef.current) coverInputRef.current.value = '';
      if (mediaInputRef.current) mediaInputRef.current.value = '';
    }
  }, [media.length]);

  const removeMediaAt = useCallback((index: number) => {
    setMedia(prev => prev.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, sort_order: itemIndex })));
  }, []);

  // ─── Wizard steps & navigation ───────────────────────────────────────────
  const wizardSteps = React.useMemo(() => {
    const base: Array<{ id: 'type' | 'details' | 'node' | 'files' | 'showcase' | 'review'; label: string; icon: any }> = [
      { id: 'type',     label: 'Type',     icon: Layers },
      { id: 'details',  label: 'Details',  icon: FileText },
    ];
    if (publishAs === 'function') base.push({ id: 'node', label: 'Function Node', icon: Box });
    base.push({ id: 'files', label: 'Files & Deps', icon: Package });
    base.push({ id: 'showcase', label: 'Showcase', icon: ImagePlus });
    base.push({ id: 'review', label: 'Review', icon: CheckCircle2 });
    return base;
  }, [publishAs]);

  // Auto-detect which workspace files this workflow references → pre-select only
  // those for the bundle (leak prevention). Creator can adjust on the Files step.
  const bundleSelection = useBundleSelection(model.id, model);

  // Clamp current step if the steps array shrinks
  React.useEffect(() => {
    if (wizardStep > wizardSteps.length - 1) {
      setWizardStep(wizardSteps.length - 1);
    }
  }, [wizardSteps.length, wizardStep]);

  // When the modal opens having auto-detected the workflow as a function,
  // pre-fill the function node designer so the user lands on a sensible default.
  React.useEffect(() => {
    if (initialPublishAs === 'function') {
      setFunctionNode((prev) => autoDetectFunctionNode(model, prev));
    }
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentStepId = wizardSteps[wizardStep]?.id || 'type';

  const canProceed = React.useMemo(() => {
    switch (currentStepId) {
      case 'type':    return !!publishAs;
      case 'details': return name.trim().length > 0 && description.trim().length > 0;
      case 'node':    return functionNode.label.trim().length > 0 && functionNode.inputs.length + functionNode.outputs.length > 0;
      case 'files':   return true;
      case 'showcase':return true;
      case 'review':  return true;
      default:        return false;
    }
  }, [currentStepId, publishAs, name, description, functionNode.label, functionNode.inputs.length, functionNode.outputs.length]);

  const goNext = () => {
    if (!canProceed) return;
    const next = Math.min(wizardStep + 1, wizardSteps.length - 1);
    setWizardStep(next);
    setMaxReachedStep((m) => Math.max(m, next));
  };
  const goBack = () => setWizardStep((s) => Math.max(0, s - 1));
  const goToStep = (idx: number) => {
    if (idx <= maxReachedStep) setWizardStep(idx);
  };

  // ─── Auto-detect ────────────────────────────────────────────────────────
  const runAutoDetect = useCallback(() => {
    const detected = autoDetectFunctionNode(model, functionNode);
    setFunctionNode(detected);
    setAutoDetectFlash(true);
    window.setTimeout(() => setAutoDetectFlash(false), 1500);
  }, [model, functionNode]);

  const handlePublish = async () => {
    if (!name.trim() || !description.trim()) {
      setError("Name and description are required.");
      return;
    }

    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) {
      setError("Set your marketplace @username before publishing.");
      const showcaseIdx = wizardSteps.findIndex((s) => s.id === "showcase");
      if (showcaseIdx >= 0) setWizardStep(showcaseIdx);
      return;
    }
    // Persist the one-time identity so every future publish reuses it.
    setMarketplaceUsername(cleanUsername);

    setLoading(true);
    setError(null);
    setSecurityResult(null);
    setPublishPhase('reviewing');

    try {
      const token = await getToken();
      if (!token) throw new Error("Please sign in to publish workflows");

      const api = getMarketplaceApi(() => token);

      // Functions are flat workflow specs with a `functionNode` metadata field
      // (so installers/security analyzer can read spec.nodes directly). The
      // `kind: 'function'` marker lets consumers tell them apart from
      // event-driven workflows.
      const baseSpec = publishAs === 'function'
        ? { ...model, kind: 'function', functionNode }
        : model;
      // Make the published workflow self-contained: bundle only the workspace
      // files the creator approved on the Files step (auto-detected references by
      // default), plus an install manifest of its script dependencies, so
      // downloaders get everything provisioned without leaking unrelated files.
      const spec = await withWorkspaceBundle(model.id, baseSpec, {
        includePaths: bundleSelection.selected,
      });

      const res = await api.publish({
        name,
        description,
        shortDescription: shortDescription.trim() || undefined,
        spec,
        category: publishAs === 'function' ? 'functions' : category,
        tags: publishAs === 'function' && !tags.includes('function') ? [...tags, 'function'] : tags,
        icon: publishAs === 'function' ? functionNode.icon : undefined,
        thumbnailUrl: thumbnailUrl || undefined,
        coverImageUrl: coverImageUrl || undefined,
        media,
        creatorProfile: creatorProfileFromUsername(cleanUsername),
        locked,
      }) as any;

      if (res.ok) {
        setPublishPhase('done');
        setSuccess(true);
        // Link the local workflow to its new marketplace listing so the next
        // publish updates THIS listing (a new version) instead of creating a
        // duplicate. Also remember the creator for future publishes.
        await persistMarketplaceLink(model, res.workflow?.slug, res.workflow?.version);
        try { (window as any).desktopAPI?.notify?.('Published!', `${name} is now live on the marketplace.`); } catch { }
        onSuccess();
        setTimeout(() => onClose(), 1200);
      } else if (res.code === 'SECURITY_BLOCKED' || res.code === 'SECURITY_REVIEW_FAILED') {
        setPublishPhase('failed');
        setSecurityResult({
          code: res.code,
          reason: res.reason || res.error,
          analysis: res.analysis,
        });
      } else {
        setPublishPhase('failed');
        setError(res.error || "Failed to publish workflow. Please try again.");
      }
    } catch (e: any) {
      setPublishPhase('failed');
      setError(e.message || "An error occurred while publishing. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleUnpublish = async () => {
    if (!existingWorkflow) return;
    const ok = await confirmDialog({
      title: `Unpublish "${existingWorkflow.name}"?`,
      message: "This removes it from the marketplace. People who already installed it keep their copy. You can publish it again later.",
      confirmLabel: "Unpublish",
      tone: "danger",
    });
    if (!ok) return;

    setUnpublishLoading(true);
    try {
      const token = await getToken();
      const api = getMarketplaceApi(() => token);
      const res = await api.deleteWorkflow(existingWorkflow.slug);

      if (res.ok) {
        try { (window as any).desktopAPI?.notify?.('Unpublished', `${existingWorkflow.name} has been removed.`); } catch { }
        onSuccess();
        onClose();
      } else {
        setError(res.error || "Failed to unpublish");
      }
    } catch (e: any) {
      setError(e.message || "Failed to unpublish");
    } finally {
      setUnpublishLoading(false);
    }
  };

  // If we decided to update, show the UpdateWorkflowModal
  if (showUpdateMode && existingWorkflow) {
    return (
      <UpdateWorkflowModal
        workflow={existingWorkflow}
        newSpec={model}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );
  }

  // Success state handling for new publish
  if (success) {
    return (
      <ModalShell title="Published!" onClose={onClose} maxWidth="max-w-3xl">
        <div className="p-10 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-6 animate-in zoom-in duration-300">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold wf-fg mb-2">Successfully Published!</h3>
          <p className="text-sm wf-fg-muted max-w-xs">
            Your workflow "{name}" is now live on the Stuard Marketplace and available for others to discover.
          </p>
        </div>
      </ModalShell>
    );
  }

  // Ownership checking loading state
  if (checkingOwnership) {
    return (
      <ModalShell title="Checking Status..." onClose={onClose} maxWidth="max-w-3xl">
        <div className="h-[300px] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin wf-accent-text" />
        </div>
      </ModalShell>
    );
  }

  // If already published (and we own it), show the "Manage" screen
  if (existingWorkflow) {
    return (
      <ModalShell title="Manage Published Workflow" onClose={onClose} maxWidth="max-w-3xl">
        <div className="p-6 space-y-6">
          <div className="rounded-2xl p-5 flex items-start gap-4 shadow-sm border" style={cardStyle}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm border" style={{ background: d ? "rgba(96,165,250,0.12)" : "#eef2ff", borderColor: d ? "rgba(96,165,250,0.18)" : "#c7d2fe", color: d ? "#93c5fd" : "#4f46e5" }}>
              <Globe className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold wf-fg text-lg">{existingWorkflow.name}</h3>
              <p className="text-sm wf-fg-muted mt-1 line-clamp-2">{existingWorkflow.description}</p>
              <div className="flex items-center gap-3 mt-3 text-xs wf-fg-muted font-medium">
                <span className="px-2 py-0.5 rounded-full border" style={{ background: d ? "rgba(96,165,250,0.12)" : "#eef2ff", color: d ? "#bfdbfe" : "#4338ca", borderColor: d ? "rgba(96,165,250,0.18)" : "#c7d2fe" }}>
                  v{existingWorkflow.version}
                </span>
                <span>{existingWorkflow.download_count} downloads</span>
                <span>Last updated: {new Date(existingWorkflow.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-700 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={() => setShowUpdateMode(true)}
              className="flex items-center justify-between p-4 rounded-2xl border text-left group transition-all"
              style={{ background: d ? "rgba(96,165,250,0.08)" : "#eef2ff", borderColor: d ? "rgba(96,165,250,0.18)" : "#c7d2fe" }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform" style={{ background: d ? "rgba(96,165,250,0.14)" : "#dbeafe", color: d ? "#93c5fd" : "#2563eb" }}>
                  <ArrowUpCircle className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold" style={{ color: d ? "#dbeafe" : "#1e40af" }}>Update Workflow</div>
                  <div className="text-xs" style={{ color: d ? "rgba(219,234,254,0.72)" : "rgba(30,64,175,0.72)" }}>Publish a new version with your current changes</div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 group-hover:wf-accent-text" style={{ color: d ? "rgba(147,197,253,0.7)" : "#818cf8" }} />
            </button>

            <button
              onClick={handleUnpublish}
              disabled={unpublishLoading}
              className="flex items-center justify-between p-4 rounded-2xl border text-left group transition-all disabled:opacity-50"
              style={subtleCardStyle}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors" style={{ background: d ? "rgba(255,255,255,0.05)" : "#f1f5f9", color: d ? "rgba(255,255,255,0.55)" : "#64748b" }}>
                  {unpublishLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                </div>
                <div>
                  <div className="font-semibold wf-fg">Unpublish from Marketplace</div>
                  <div className="text-xs wf-fg-muted">Remove this workflow permanently from the store</div>
                </div>
              </div>
            </button>
          </div>
        </div>

        <div className="p-5 border-t rounded-b-[28px] flex justify-between gap-3" style={footerStyle}>
          <button
            onClick={() => setExistingWorkflow(null)}
            className="text-xs wf-fg-muted hover:opacity-80 font-medium px-2"
          >
            Publish as new instead
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm border font-medium transition-all"
            style={{ background: d ? "rgba(255,255,255,0.03)" : "#ffffff", borderColor: "var(--wf-input-border)", color: "var(--wf-fg)" }}
          >
            Close
          </button>
        </div>
      </ModalShell>
    );
  }

  // STANDARD PUBLISH FORM (for new workflows or "Publish as new") — wizard mode
  return (
    <ModalShell title={publishAs === 'function' ? 'Publish Function' : 'Publish to Marketplace'} onClose={onClose} maxWidth="max-w-5xl">
      {/* Hidden file inputs (kept at root so refs survive step changes) */}
      <input
        ref={thumbnailInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleUploadFiles(e.target.files, 'thumbnail')}
      />
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleUploadFiles(e.target.files, 'cover')}
      />
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => void handleUploadFiles(e.target.files, 'media')}
      />

      {/* Wizard Stepper */}
      <WizardStepper
        d={d}
        steps={wizardSteps}
        currentIndex={wizardStep}
        maxReached={maxReachedStep}
        onStepClick={goToStep}
      />

      <div className="px-6 pt-5 pb-2 space-y-5 min-h-[440px]">
        {/* Publishing progress / security / error — always visible */}
        {loading && <PublishingProgress phase={publishPhase} isDark={d} />}
        {securityResult && !loading && (
          <SecurityReviewPanel
            analysis={securityResult.analysis}
            reason={securityResult.reason}
            code={securityResult.code}
            isDark={d}
          />
        )}
        {error && !securityResult && !loading && (
          <div
            className="p-4 rounded-2xl border flex items-start gap-3 animate-in slide-in-from-top-2 duration-300"
            style={{
              background: d ? "rgba(239,68,68,0.08)" : "#fef2f2",
              borderColor: d ? "rgba(239,68,68,0.22)" : "#fecaca",
            }}
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: d ? "#fca5a5" : "#dc2626" }} />
            <div>
              <span className="text-sm font-medium" style={{ color: d ? "#fca5a5" : "#991b1b" }}>{error}</span>
            </div>
          </div>
        )}

        {/* ─── STEP: Type ────────────────────────────────────────── */}
        {currentStepId === 'type' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-200">
            <StepHeader
              icon={publishAs === 'function' ? Box : Layers}
              title="What you're publishing"
              subtitle="Stuard inspected your workflow and picked the listing type automatically."
            />

            <DetectionPanel d={d} detectedAs={publishAs} model={model} />

            <div className="rounded-2xl p-4 border text-xs leading-relaxed" style={{
              background: d ? "rgba(96,165,250,0.05)" : "#eff6ff",
              borderColor: d ? "rgba(96,165,250,0.15)" : "#bfdbfe",
              color: d ? "rgba(219,234,254,0.78)" : "rgba(29,78,216,0.78)",
            }}>
              {publishAs === 'function'
                ? 'Functions are compacted single-node building blocks. Other users install your function and drop it into their workflows as a reusable node.'
                : 'Publishing makes your workflow available to other users in the Stuard Marketplace.'}
              {' '}Make sure to remove any sensitive API keys or personal data before publishing.
            </div>
          </div>
        )}

        {/* ─── STEP: Details ─────────────────────────────────────── */}
        {currentStepId === 'details' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-200">
            <StepHeader
              icon={FileText}
              title="Describe it"
              subtitle="A clear name and description help users decide whether to install."
            />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium wf-fg">Workflow Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wf-accent)_30%,transparent)] text-sm transition-all"
              style={inputStyle}
              placeholder="e.g., Smart Inbox Assistant"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium wf-fg">Short Store Description</label>
            <input
              type="text"
              maxLength={160}
              value={shortDescription}
              onChange={e => setShortDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wf-accent)_30%,transparent)] text-sm transition-all"
              style={inputStyle}
              placeholder="A concise one-line summary shown on cards"
            />
            <div className="flex justify-end">
              <span className="text-xs wf-fg-faint">{shortDescription.length}/160</span>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium wf-fg">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wf-accent)_30%,transparent)] text-sm min-h-[110px] resize-none transition-all"
            style={inputStyle}
            placeholder="Describe what your workflow does, how it works, and any setup users should know about..."
          />
          <div className="flex justify-end">
            <span className="text-xs wf-fg-faint">{description.length} chars</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium wf-fg">Category</label>
            <MarketplaceSelect
              value={category}
              onChange={setCategory}
              disabled={fetchingCats}
              placeholder={fetchingCats ? "Loading categories..." : "Select category"}
              options={[
                { value: "general", label: "General" },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium wf-fg">Tags</label>
            <TagInput tags={tags} onChange={setTags} />
          </div>
        </div>
          </div>
        )}

        {/* ─── STEP: Function Node ────────────────────────────────── */}
        {currentStepId === 'node' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-200">
            <StepHeader
              icon={Box}
              title="Design the compacted node"
              subtitle="Customize how your function appears on another user's canvas after install."
              actionRight={
                <button
                  type="button"
                  onClick={runAutoDetect}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    autoDetectFlash
                      ? d ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : d ? 'bg-gradient-to-r from-violet-500/15 to-fuchsia-500/15 text-violet-200 border border-violet-500/30 hover:from-violet-500/25 hover:to-fuchsia-500/25'
                          : 'bg-gradient-to-r from-violet-50 to-fuchsia-50 text-violet-700 border border-violet-200 hover:from-violet-100 hover:to-fuchsia-100'
                  }`}
                  title="Detect inputs, outputs, icon and color from your workflow"
                >
                  {autoDetectFlash ? <Check className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {autoDetectFlash ? 'Detected!' : 'Auto-detect'}
                </button>
              }
            />
            <FunctionNodeDesigner
              d={d}
              workflowName={name || (model.name as string) || 'Untitled'}
              node={functionNode}
              onChange={setFunctionNode}
              inputStyle={inputStyle}
              cardStyle={cardStyle}
            />
          </div>
        )}

        {/* ─── STEP: Files & dependencies ─────────────────────────── */}
        {currentStepId === 'files' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-200">
            <StepHeader
              icon={Package}
              title="Files & dependencies"
              subtitle="We bundle only the files your workflow references so nothing personal leaks. Dependencies install for you."
            />
            <FilesReviewStep spec={model} selection={bundleSelection} isDark={d} />
          </div>
        )}

        {/* ─── STEP: Showcase ─────────────────────────────────────── */}
        {currentStepId === 'showcase' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-200">
            <StepHeader
              icon={ImagePlus}
              title="Showcase yourself"
              subtitle="Your creator profile and store artwork. All optional, but a polished listing gets more installs."
            />

        <MarketplaceIdentityPanel onChange={setUsername} />

        <div className="rounded-2xl border p-5 space-y-4 shadow-sm" style={cardStyle}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold wf-fg flex items-center gap-2">
                <ImagePlus className="w-4 h-4 wf-accent-text" />
                Store Artwork & Media
              </div>
              <p className="text-xs wf-fg-muted mt-1">Add thumbnail art, a cover image, and screenshots or videos like a store listing.</p>
            </div>
            {uploadingAsset && (
              <div className="flex items-center gap-2 text-xs wf-accent-chip px-3 py-1.5 rounded-full">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Uploading {uploadingAsset}...
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => thumbnailInputRef.current?.click()}
              className="group rounded-2xl border border-dashed p-4 text-left transition-all"
              style={subtleCardStyle}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl wf-icon-chip wf-accent-text flex items-center justify-center">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold wf-fg">Thumbnail</div>
                  <div className="text-xs wf-fg-muted">Used on search cards and compact listings</div>
                </div>
              </div>
              {thumbnailUrl && (
                <img src={thumbnailUrl} alt="Thumbnail" className="mt-4 w-full h-28 object-cover rounded-xl border wf-border" />
              )}
            </button>

            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="group rounded-2xl border border-dashed p-4 text-left transition-all"
              style={subtleCardStyle}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl wf-icon-chip wf-accent-text flex items-center justify-center">
                  <ImagePlus className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold wf-fg">Hero Cover</div>
                  <div className="text-xs wf-fg-muted">Large banner shown on the detail page</div>
                </div>
              </div>
              {coverImageUrl && (
                <img src={coverImageUrl} alt="Cover" className="mt-4 w-full h-28 object-cover rounded-xl border wf-border" />
              )}
            </button>
          </div>

          <div className="rounded-2xl border p-4 space-y-4" style={subtleCardStyle}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold wf-fg">Gallery</div>
                <div className="text-xs wf-fg-muted">Upload screenshots or short preview videos</div>
              </div>
              <button
                type="button"
                onClick={() => mediaInputRef.current?.click()}
                className="px-3 py-2 rounded-lg wf-primary-btn text-sm font-medium transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Media
              </button>
            </div>
            {media.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {media.map((item, index) => (
                  <div key={`${item.url}-${index}`} className="relative rounded-2xl overflow-hidden border group shadow-sm" style={cardStyle}>
                    {isVideoMedia(item) ? (
                      <div className="h-28 flex items-center justify-center bg-slate-900 text-white/70">
                        <PlayCircle className="w-8 h-8" />
                      </div>
                    ) : (
                      <img src={getMediaPreviewUrl(item)} alt={item.alt_text || `Media ${index + 1}`} className="w-full h-28 object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeMediaAt(index)}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/65 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <div className="p-2 text-[11px] wf-fg-muted truncate">{item.alt_text || item.media_type}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed wf-border p-6 text-center text-sm wf-fg-muted">
                Add screenshots or preview clips so your workflow looks like a proper store listing.
              </div>
            )}
          </div>
        </div>
          </div>
        )}

        {/* ─── STEP: Review ───────────────────────────────────────── */}
        {currentStepId === 'review' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-right-2 duration-200">
            <StepHeader
              icon={CheckCircle2}
              title="Review & publish"
              subtitle="Double-check the listing, then ship it to the marketplace."
            />

            <ReviewSummary
              d={d}
              publishAs={publishAs}
              name={name}
              shortDescription={shortDescription}
              description={description}
              category={category}
              tags={tags}
              functionNode={functionNode}
              thumbnailUrl={thumbnailUrl}
              coverImageUrl={coverImageUrl}
              mediaCount={media.length}
              creatorProfile={creatorProfileFromUsername(username)}
              onJumpTo={(stepId) => {
                const idx = wizardSteps.findIndex(s => s.id === stepId);
                if (idx >= 0) goToStep(idx);
              }}
            />

            {/* Lock toggle (kept here as the final pre-publish decision) */}
            <div className={`rounded-xl p-4 border transition-all ${locked ? 'bg-amber-50/50 border-amber-200' : 'wf-surface-muted wf-border'}`}>
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => setLocked(!locked)}
                  className={`mt-0.5 w-10 h-6 rounded-full transition-all flex items-center px-1 ${locked ? 'bg-amber-500' : 'wf-surface-muted'
                    }`}
                >
                  <div className={`w-4 h-4 rounded-full wf-bg-elevated shadow-sm transition-transform ${locked ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {locked ? <Lock className="w-4 h-4 text-amber-600" /> : <Unlock className="w-4 h-4 wf-fg-faint" />}
                    <span className={`text-sm font-semibold ${locked ? '' : 'wf-fg'}`} style={locked ? { color: d ? "#fde68a" : "#78350f" } : undefined}>
                      {locked ? (publishAs === 'function' ? 'Locked Function' : 'Locked Workflow') : (publishAs === 'function' ? 'Open Function' : 'Open Workflow')}
                    </span>
                  </div>
                  <p className={`text-xs mt-1 leading-relaxed ${locked ? '' : 'wf-fg-muted'}`} style={locked ? { color: d ? "rgba(253,230,138,0.82)" : "rgba(146,64,14,0.82)" } : undefined}>
                    {locked
                      ? 'Users who download this will not be able to view the code, use AI to modify it, or manually edit it. They can only run it and wait for your updates.'
                      : 'Users can view, modify, and customize this after downloading.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Wizard footer */}
      <div className="p-5 border-t rounded-b-[28px] flex items-center justify-between gap-3" style={footerStyle}>
        <div className="flex items-center gap-2 text-[11px] font-medium wf-fg-faint">
          <span className="px-2 py-0.5 rounded-md" style={{ background: d ? "rgba(255,255,255,0.04)" : "#f1f5f9" }}>
            Step {wizardStep + 1} of {wizardSteps.length}
          </span>
          {!canProceed && currentStepId !== 'review' && (
            <span className="hidden sm:inline">· {currentStepId === 'details' ? 'Name and description required' : currentStepId === 'node' ? 'Label and at least one port required' : ''}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm border font-medium transition-all"
            style={{ background: d ? "rgba(255,255,255,0.03)" : "#ffffff", borderColor: "var(--wf-input-border)", color: "var(--wf-fg)" }}
          >
            Cancel
          </button>
          {wizardStep > 0 && (
            <button
              type="button"
              onClick={goBack}
              disabled={loading}
              className="px-4 py-2 rounded-xl text-sm border font-medium transition-all flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: d ? "rgba(255,255,255,0.03)" : "#ffffff", borderColor: "var(--wf-input-border)", color: "var(--wf-fg)" }}
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              Back
            </button>
          )}
          {currentStepId !== 'review' ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canProceed}
              className="px-5 py-2.5 rounded-xl text-sm wf-primary-btn font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePublish}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl text-sm wf-primary-btn font-medium flex items-center gap-2 disabled:opacity-50 transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {publishPhase === 'reviewing' ? 'Reviewing...' : 'Publishing...'}
                </>
              ) : securityResult ? (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Fix & Retry
                </>
              ) : (
                <>
                  {publishAs === 'function' ? <Box className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                  {publishAs === 'function' ? 'Publish Function' : 'Publish Workflow'}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE WORKFLOW MODAL
// ═══════════════════════════════════════════════════════════════════════════════

export function UpdateWorkflowModal({
  workflow,
  newSpec,
  onClose,
  onSuccess,
}: {
  workflow: MarketplaceWorkflow;
  newSpec: any; // The updated workflow spec
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<'idle' | 'reviewing' | 'publishing' | 'done' | 'failed'>('idle');
  const [securityResult, setSecurityResult] = useState<{ code?: string; reason?: string; analysis?: any } | null>(null);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [shortDescription, setShortDescription] = useState(workflow.short_description || "");
  const [category, setCategory] = useState(workflow.category || "general");
  const [tags, setTags] = useState<string[]>(workflow.tags || []);
  const [changelog, setChangelog] = useState("");
  const [locked, setLocked] = useState(Boolean(workflow.locked));
  const [thumbnailUrl, setThumbnailUrl] = useState(workflow.thumbnail_url || "");
  const [coverImageUrl, setCoverImageUrl] = useState(workflow.cover_image_url || "");
  const [media, setMedia] = useState<MarketplaceWorkflowMedia[]>(workflow.media || []);
  const [username, setUsername] = useState<string>(() => getMarketplaceUsername() || normalizeUsername(workflow.creator?.handle || workflow.publisher_name || ""));
  const [uploadingAsset, setUploadingAsset] = useState<'thumbnail' | 'cover' | 'media' | null>(null);
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [versions, setVersions] = useState<MarketplaceVersion[]>([]);
  const [fetchingData, setFetchingData] = useState(true);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const { isDark } = useWorkflowTheme();
  const d = isDark;
  const cardStyle = { background: d ? "rgba(255,255,255,0.03)" : "#ffffff", borderColor: "var(--wf-border)" };
  const subtleCardStyle = { background: d ? "rgba(255,255,255,0.02)" : "var(--wf-bg)", borderColor: "var(--wf-border)" };
  const inputStyle = { background: d ? "rgba(255,255,255,0.04)" : "#ffffff", borderColor: "var(--wf-input-border)", color: "var(--wf-fg)" } as React.CSSProperties;
  const footerStyle = { background: d ? "#0c0f14" : "#ffffff", borderColor: "var(--wf-border)" };

  // Auto-detect referenced workspace files for this new version (leak prevention).
  const bundleSelection = useBundleSelection(newSpec?.id, newSpec);

  // Fetch categories and versions on mount
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const api = getMarketplaceApi(() => token);

        const [catRes, verRes] = await Promise.all([
          api.getCategories(),
          api.getVersions(workflow.slug),
        ]);

        if (catRes.ok) setCategories(catRes.categories);
        if (verRes.ok) setVersions(verRes.versions);
      } catch (e) {
        console.error("Failed to load data", e);
      } finally {
        setFetchingData(false);
      }
    })();
  }, [workflow.slug]);

  const handleUploadFiles = useCallback(async (files: FileList | null, kind: 'thumbnail' | 'cover' | 'media') => {
    if (!files || files.length === 0) return;
    setUploadingAsset(kind);
    setError(null);

    try {
      if (kind === 'media') {
        const uploaded = await Promise.all(
          Array.from(files).map(async (file, index) => {
            const url = await uploadMarketplaceAsset(file, 'media');
            const mediaType: 'image' | 'video' = file.type.startsWith('video/') ? 'video' : 'image';
            return {
              media_type: mediaType,
              url,
              thumbnail_url: mediaType === 'image' ? url : undefined,
              alt_text: file.name,
              sort_order: media.length + index,
            } as MarketplaceWorkflowMedia;
          })
        );
        setMedia(prev => [...prev, ...uploaded].map((item, index) => ({ ...item, sort_order: index })));
      } else {
        const file = files[0];
        const url = await uploadMarketplaceAsset(file, kind);
        if (kind === 'thumbnail') setThumbnailUrl(url);
        if (kind === 'cover') setCoverImageUrl(url);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to upload asset');
    } finally {
      setUploadingAsset(null);
      if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
      if (coverInputRef.current) coverInputRef.current.value = '';
      if (mediaInputRef.current) mediaInputRef.current.value = '';
    }
  }, [media.length]);

  const removeMediaAt = useCallback((index: number) => {
    setMedia(prev => prev.filter((_, itemIndex) => itemIndex !== index).map((item, itemIndex) => ({ ...item, sort_order: itemIndex })));
  }, []);

  const handleUpdate = async () => {
    setLoading(true);
    setError(null);
    setSecurityResult(null);
    setUpdatePhase('reviewing');

    try {
      const token = await getToken();
      if (!token) throw new Error("Please sign in to update workflows");

      const api = getMarketplaceApi(() => token);

      // Re-bundle workspace deps so each published version stays self-contained,
      // restricted to the creator-approved (auto-detected) file set.
      const bundledSpec = await withWorkspaceBundle(newSpec?.id, newSpec, {
        includePaths: bundleSelection.selected,
      });

      const res = await api.update(workflow.slug, {
        name: name !== workflow.name ? name : undefined,
        description: description !== workflow.description ? description : undefined,
        shortDescription: shortDescription !== (workflow.short_description || "") ? shortDescription : undefined,
        spec: bundledSpec,
        category: category !== workflow.category ? category : undefined,
        tags: JSON.stringify(tags) !== JSON.stringify(workflow.tags) ? tags : undefined,
        thumbnailUrl: thumbnailUrl !== (workflow.thumbnail_url || "") ? thumbnailUrl : undefined,
        coverImageUrl: coverImageUrl !== (workflow.cover_image_url || "") ? coverImageUrl : undefined,
        media: JSON.stringify(media) !== JSON.stringify(workflow.media || []) ? media : undefined,
        creatorProfile: username ? creatorProfileFromUsername(username) : undefined,
        changelog: changelog.trim() || undefined,
        locked: locked !== Boolean(workflow.locked) ? locked : undefined,
      }) as any;

      if (res.ok) {
        setUpdatePhase('done');
        setSuccess(true);
        // Keep the local workflow pinned to this listing + its new version so
        // the version history stays accurate and the next edit updates in place.
        await persistMarketplaceLink(newSpec, workflow.slug, res.workflow?.version);
        if (username) setMarketplaceUsername(username);
        try { (window as any).desktopAPI?.notify?.('Updated!', `${name} v${res.workflow?.version} is now live.`); } catch { }
        onSuccess();
        setTimeout(() => onClose(), 1200);
      } else if (res.code === 'SECURITY_BLOCKED' || res.code === 'SECURITY_REVIEW_FAILED') {
        setUpdatePhase('failed');
        setSecurityResult({
          code: res.code,
          reason: res.reason || res.error,
          analysis: res.analysis,
        });
      } else {
        setUpdatePhase('failed');
        setError(res.error || "Failed to update workflow. Please try again.");
      }
    } catch (e: any) {
      setUpdatePhase('failed');
      setError(e.message || "An error occurred while updating.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <ModalShell title="Updated!" onClose={onClose}>
        <div className="p-10 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-6 animate-in zoom-in duration-300">
            <ArrowUpCircle className="w-10 h-10 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold wf-fg mb-2">Successfully Updated!</h3>
          <p className="text-sm wf-fg-muted max-w-xs">
            Your workflow "{name}" has been updated to a new version and is now live on the marketplace.
          </p>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Update Published Workflow" onClose={onClose} maxWidth="max-w-5xl">
      <div className="p-6 space-y-6">
        <input
          ref={thumbnailInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleUploadFiles(e.target.files, 'thumbnail')}
        />
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleUploadFiles(e.target.files, 'cover')}
        />
        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => void handleUploadFiles(e.target.files, 'media')}
        />
        <div className="rounded-2xl p-5 border" style={{ background: d ? "rgba(245,158,11,0.10)" : "#fffbeb", borderColor: d ? "rgba(245,158,11,0.20)" : "#fde68a" }}>
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-2" style={{ color: d ? "#fde68a" : "#92400e" }}>
            <ArrowUpCircle className="w-4 h-4" />
            Publishing an Update
          </h3>
          <p className="text-xs leading-relaxed" style={{ color: d ? "rgba(253,230,138,0.82)" : "rgba(146,64,14,0.82)" }}>
            This will create a new version of your workflow. Users who downloaded previous versions will be notified of the update.
            Current version: <span className="font-semibold">{workflow.version}</span>
          </p>
        </div>

        {/* Publishing progress */}
        {loading && (
          <PublishingProgress phase={updatePhase} isDark={d} />
        )}

        {/* Security review results */}
        {securityResult && !loading && (
          <SecurityReviewPanel
            analysis={securityResult.analysis}
            reason={securityResult.reason}
            code={securityResult.code}
            isDark={d}
          />
        )}

        {/* Generic error (non-security) */}
        {error && !securityResult && !loading && (
          <div
            className="p-4 rounded-2xl border flex items-start gap-3 animate-in slide-in-from-top-2 duration-300"
            style={{
              background: d ? "rgba(239,68,68,0.08)" : "#fef2f2",
              borderColor: d ? "rgba(239,68,68,0.22)" : "#fecaca",
            }}
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: d ? "#fca5a5" : "#dc2626" }} />
            <div>
              <span className="text-sm font-medium" style={{ color: d ? "#fca5a5" : "#991b1b" }}>{error}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium wf-fg">Workflow Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wf-accent)_30%,transparent)] text-sm transition-all"
              style={inputStyle}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium wf-fg">Short Store Description</label>
            <input
              type="text"
              maxLength={160}
              value={shortDescription}
              onChange={e => setShortDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wf-accent)_30%,transparent)] text-sm transition-all"
              style={inputStyle}
            />
            <div className="flex justify-end">
              <span className="text-xs wf-fg-faint">{shortDescription.length}/160</span>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium wf-fg">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wf-accent)_30%,transparent)] text-sm min-h-[100px] resize-none transition-all"
            style={inputStyle}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium wf-fg">What's New (Changelog)</label>
          <textarea
            value={changelog}
            onChange={e => setChangelog(e.target.value)}
            className="w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-sm min-h-[80px] resize-none transition-all"
            style={{ background: d ? "rgba(245,158,11,0.10)" : "#fffbeb", borderColor: d ? "rgba(245,158,11,0.20)" : "#fcd34d", color: "var(--wf-fg)" }}
            placeholder="Describe what changed in this update..."
          />
        </div>

        {/* Files & dependencies — bundle only referenced files, install deps for downloaders. */}
        <div className="rounded-2xl border p-5 space-y-3 shadow-sm" style={cardStyle}>
          <div className="text-sm font-semibold wf-fg flex items-center gap-2">
            <Package className="w-4 h-4 wf-accent-text" />
            Files &amp; dependencies
          </div>
          <FilesReviewStep spec={newSpec} selection={bundleSelection} isDark={d} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium wf-fg">Category</label>
            <MarketplaceSelect
              value={category}
              onChange={setCategory}
              disabled={fetchingData}
              placeholder={fetchingData ? "Loading categories..." : "Select category"}
              options={[
                { value: "general", label: "General" },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium wf-fg">Tags</label>
            <TagInput tags={tags} onChange={setTags} />
          </div>
        </div>

        <MarketplaceIdentityPanel onChange={setUsername} />

        <div className="rounded-2xl border p-5 space-y-4 shadow-sm" style={cardStyle}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold wf-fg flex items-center gap-2">
                <ImagePlus className="w-4 h-4 wf-accent-text" />
                Store Artwork & Media
              </div>
              <p className="text-xs wf-fg-muted mt-1">Refresh your cover art, thumbnails, screenshots, or preview clips.</p>
            </div>
            {uploadingAsset && (
              <div className="flex items-center gap-2 text-xs wf-accent-chip px-3 py-1.5 rounded-full">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Uploading {uploadingAsset}...
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => thumbnailInputRef.current?.click()}
              className="group rounded-2xl border border-dashed p-4 text-left transition-all"
              style={subtleCardStyle}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl wf-icon-chip wf-accent-text flex items-center justify-center">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold wf-fg">Thumbnail</div>
                  <div className="text-xs wf-fg-muted">Updated compact card artwork</div>
                </div>
              </div>
              {thumbnailUrl && (
                <img src={thumbnailUrl} alt="Thumbnail" className="mt-4 w-full h-28 object-cover rounded-xl border wf-border" />
              )}
            </button>

            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="group rounded-2xl border border-dashed p-4 text-left transition-all"
              style={subtleCardStyle}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl wf-icon-chip wf-accent-text flex items-center justify-center">
                  <ImagePlus className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold wf-fg">Hero Cover</div>
                  <div className="text-xs wf-fg-muted">Update your detail page banner</div>
                </div>
              </div>
              {coverImageUrl && (
                <img src={coverImageUrl} alt="Cover" className="mt-4 w-full h-28 object-cover rounded-xl border wf-border" />
              )}
            </button>
          </div>

          <div className="rounded-2xl border p-4 space-y-4" style={subtleCardStyle}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold wf-fg">Gallery</div>
                <div className="text-xs wf-fg-muted">Keep your listing fresh with media previews</div>
              </div>
              <button
                type="button"
                onClick={() => mediaInputRef.current?.click()}
                className="px-3 py-2 rounded-lg wf-primary-btn text-sm font-medium transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Media
              </button>
            </div>
            {media.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {media.map((item, index) => (
                  <div key={`${item.url}-${index}`} className="relative rounded-2xl overflow-hidden border group shadow-sm" style={cardStyle}>
                    {isVideoMedia(item) ? (
                      <div className="h-28 flex items-center justify-center bg-slate-900 text-white/70">
                        <PlayCircle className="w-8 h-8" />
                      </div>
                    ) : (
                      <img src={getMediaPreviewUrl(item)} alt={item.alt_text || `Media ${index + 1}`} className="w-full h-28 object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeMediaAt(index)}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/65 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <div className="p-2 text-[11px] wf-fg-muted truncate">{item.alt_text || item.media_type}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm wf-fg-muted" style={{ borderColor: "var(--wf-input-border)" }}>
                Add screenshots or preview clips for your updated listing.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl p-4 border transition-all" style={locked ? { background: d ? "rgba(245, 158, 11, 0.10)" : "#fffbeb", borderColor: d ? "rgba(245,158,11,0.22)" : "#fcd34d" } : subtleCardStyle}>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setLocked(!locked)}
              className={`mt-0.5 w-10 h-6 rounded-full transition-all flex items-center px-1 ${locked ? 'bg-amber-500' : 'wf-surface-muted'}`}
            >
              <div className={`w-4 h-4 rounded-full wf-bg-elevated shadow-sm transition-transform ${locked ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {locked ? <Lock className="w-4 h-4 text-amber-600" /> : <Unlock className="w-4 h-4 wf-fg-faint" />}
                <span className={`text-sm font-semibold ${locked ? '' : 'wf-fg'}`} style={locked ? { color: d ? "#fde68a" : "#78350f" } : undefined}>
                  {locked ? 'Locked Workflow' : 'Open Workflow'}
                </span>
              </div>
              <p className={`text-xs mt-1 leading-relaxed ${locked ? '' : 'wf-fg-muted'}`} style={locked ? { color: d ? "rgba(253,230,138,0.82)" : "rgba(146,64,14,0.82)" } : undefined}>
                {locked
                  ? 'Downloaders will only be able to run this workflow and receive updates from you.'
                  : 'Downloaders can inspect and customize the workflow after installing it.'}
              </p>
            </div>
          </div>
        </div>

        {versions.length > 1 && (
          <div className="space-y-2">
            <label className="text-sm font-medium wf-fg flex items-center gap-2">
              <History className="w-4 h-4 wf-fg-faint" />
              Version History
            </label>
            <div className="rounded-xl border p-3 max-h-32 overflow-y-auto shadow-sm" style={cardStyle}>
              {versions.slice(0, 5).map((v, i) => (
                <div key={v.version + i} className={`flex items-center justify-between py-1.5 ${i > 0 ? 'border-t' : ''}`} style={i > 0 ? { borderColor: "var(--wf-border)" } : undefined}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono font-semibold ${v.current ? 'wf-accent-text' : 'wf-fg-muted'}`}>
                      v{v.version}
                    </span>
                    {v.current && (
                      <span className="text-[10px] bg-[color-mix(in_srgb,var(--wf-accent)_14%,transparent)] wf-accent-text px-1.5 py-0.5 rounded font-medium">Current</span>
                    )}
                  </div>
                  <span className="text-xs wf-fg-faint">
                    {new Date(v.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-5 border-t rounded-b-[28px] flex justify-end gap-3" style={footerStyle}>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-sm border font-medium transition-all"
          style={{ background: d ? "rgba(255,255,255,0.03)" : "#ffffff", borderColor: "var(--wf-input-border)", color: "var(--wf-fg)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl text-sm bg-amber-600 text-white hover:bg-amber-700 font-medium flex items-center gap-2 disabled:opacity-50 transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {updatePhase === 'reviewing' ? 'Reviewing...' : 'Updating...'}
            </>
          ) : securityResult ? (
            <>
              <RefreshCw className="w-4 h-4" />
              Fix & Retry
            </>
          ) : (
            <>
              <ArrowUpCircle className="w-4 h-4" />
              Publish Update
            </>
          )}
        </button>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MY PUBLISHED WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════════

export function MyPublishedWorkflowsModal({
  onClose,
  onUpdateWorkflow,
}: {
  onClose: () => void;
  onUpdateWorkflow?: (workflow: MarketplaceWorkflow) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState<MarketplaceWorkflow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError('Please sign in to view your published workflows');
        setLoading(false);
        return;
      }

      const api = getMarketplaceApi(() => token);
      const res = await api.getMyWorkflows();

      if (res.ok) {
        setWorkflows(res.workflows);
      } else {
        setError(res.error || 'Failed to load workflows');
      }
    } catch (e: any) {
      setError(e.message || 'Connection error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleDelete = async (slug: string, name: string) => {
    const ok = await confirmDialog({
      title: `Unpublish "${name}"?`,
      message: "It's removed from the marketplace. People who already installed it keep their copy. You can publish it again anytime.",
      confirmLabel: "Unpublish",
      tone: "danger",
    });
    if (!ok) return;

    setDeletingSlug(slug);
    try {
      const token = await getToken();
      const api = getMarketplaceApi(() => token);
      const res = await api.deleteWorkflow(slug);

      if (res.ok) {
        setWorkflows(prev => prev.filter(w => w.slug !== slug));
        setToast({ message: `"${name}" has been unpublished`, type: 'success' });
      } else {
        setToast({ message: res.error || 'Failed to unpublish', type: 'error' });
      }
    } catch (e) {
      setToast({ message: 'Failed to unpublish workflow', type: 'error' });
    } finally {
      setDeletingSlug(null);
    }
  };

  // Calculate total stats
  const totalStats = workflows.reduce((acc, w) => ({
    downloads: acc.downloads + (w.download_count || 0),
    ratings: acc.ratings + (w.rating_count || 0),
  }), { downloads: 0, ratings: 0 });

  return (
    <>
      <ModalShell title="My Published Workflows" onClose={onClose} maxWidth="max-w-3xl">
        <div className="min-h-[400px] flex flex-col">
          {/* Marketplace identity — the one-time @username every publish ships under. */}
          <div className="px-5 pt-5">
            <MarketplaceIdentityPanel compact />
          </div>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 wf-fg-muted py-16">
              <Loader2 className="w-8 h-8 animate-spin wf-accent-text" />
              <span className="text-sm">Loading your workflows...</span>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(244,63,94,0.12)" }}>
                <AlertCircle className="w-8 h-8" style={{ color: "#fb7185" }} />
              </div>
              <div className="text-center">
                <p className="font-medium wf-fg">Something went wrong</p>
                <p className="text-sm wf-fg-muted mt-1">{error}</p>
                <button
                  onClick={loadWorkflows}
                  className="mt-4 px-4 py-2 wf-primary-btn rounded-full text-sm font-semibold transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : workflows.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8 py-12">
              <div className="w-20 h-20 rounded-2xl wf-icon-chip flex items-center justify-center">
                <Package className="w-10 h-10 wf-accent-text" />
              </div>
              <div>
                <h3 className="text-lg font-bold wf-fg mb-2">No published workflows yet</h3>
                <p className="text-sm wf-fg-muted max-w-sm leading-relaxed">
                  Share your workflows with the community! Open a workflow and click "Publish to Marketplace" to get started.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Stats Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="wf-card rounded-xl p-4 border wf-border">
                  <div className="text-2xl font-bold wf-fg">{workflows.length}</div>
                  <div className="text-xs wf-fg-muted font-medium mt-1">Published</div>
                </div>
                <div className="wf-accent-soft-bg rounded-xl p-4">
                  <div className="text-2xl font-bold wf-accent-text">{totalStats.downloads}</div>
                  <div className="text-xs wf-fg-muted font-medium mt-1">Total Downloads</div>
                </div>
                <div className="wf-card rounded-xl p-4 border wf-border">
                  <div className="text-2xl font-bold" style={{ color: "#f59e0b" }}>{totalStats.ratings}</div>
                  <div className="text-xs wf-fg-muted font-medium mt-1">Total Reviews</div>
                </div>
              </div>

              <div className="h-px wf-border" style={{ borderTopWidth: 1, height: 1, background: "var(--wf-border)" }} />

              <div className="space-y-3">
                {workflows.map(w => {
                  const isExpanded = expandedId === w.id;
                  return (
                    <div
                      key={w.id}
                      className={`wf-card wf-card-interactive border wf-border rounded-xl overflow-hidden ${w.status === 'published' ? '' : 'opacity-70'}`}
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-4 flex-1 min-w-0">
                            <div className="w-12 h-12 rounded-xl wf-icon-chip flex items-center justify-center wf-accent-text shrink-0">
                              {w.icon ? <span className="text-2xl">{w.icon}</span> : <Globe className="w-6 h-6" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold wf-fg truncate">{w.name}</h3>
                                <span className="text-xs font-mono wf-fg-muted wf-surface-muted px-1.5 py-0.5 rounded">
                                  v{w.version}
                                </span>
                                {w.locked && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium flex items-center gap-1" style={{ background: "rgba(245,158,11,0.14)", color: "#d97706" }}>
                                    <Lock className="w-2.5 h-2.5" /> Locked
                                  </span>
                                )}
                                {w.status !== 'published' && (
                                  <span className="text-[10px] wf-surface-muted wf-fg-muted px-1.5 py-0.5 rounded font-medium uppercase">
                                    {w.status}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm wf-fg-muted mt-0.5 line-clamp-1">{w.description}</p>
                              <div className="flex items-center gap-4 mt-2 text-xs wf-fg-muted">
                                <div className="flex items-center gap-1">
                                  <Download className="w-3.5 h-3.5" />
                                  {w.download_count} downloads
                                </div>
                                {w.rating_avg > 0 && (
                                  <div className="flex items-center gap-1" style={{ color: "#d97706" }}>
                                    <Star className="w-3.5 h-3.5 fill-current" />
                                    {Number(w.rating_avg).toFixed(1)} ({w.rating_count})
                                  </div>
                                )}
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5" />
                                  {new Date(w.created_at).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : w.id)}
                              className="p-2 rounded-lg border wf-border wf-fg-muted hover:wf-fg wf-hover-bg transition-colors"
                              title={isExpanded ? "Hide details" : "Show details"}
                            >
                              <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                            {w.status === 'published' && onUpdateWorkflow && (
                              <button
                                onClick={() => onUpdateWorkflow(w)}
                                className="p-2 rounded-lg border wf-border wf-fg-muted hover:wf-accent-text wf-hover-bg transition-colors"
                                title="Push an update"
                              >
                                <ArrowUpCircle className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(w.slug, w.name)}
                              disabled={deletingSlug === w.slug}
                              className="p-2 rounded-lg border wf-border wf-fg-muted wf-hover-bg transition-colors disabled:opacity-50"
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#fb7185"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = ""; }}
                              title="Unpublish workflow"
                            >
                              {deletingSlug === w.slug ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 border-t wf-border wf-bg-overlay animate-in slide-in-from-top-2 duration-200">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-[10px] font-bold wf-fg-faint uppercase tracking-wider mb-1">Category</div>
                              <div className="text-sm wf-fg capitalize">{w.category || 'General'}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold wf-fg-faint uppercase tracking-wider mb-1">Slug</div>
                              <div className="text-xs font-mono wf-fg-muted wf-surface-muted px-2 py-1 rounded border wf-border truncate">{w.slug}</div>
                            </div>
                            {w.tags && w.tags.length > 0 && (
                              <div className="col-span-2">
                                <div className="text-[10px] font-bold wf-fg-faint uppercase tracking-wider mb-1.5">Tags</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {w.tags.map(tag => (
                                    <span key={tag} className="text-xs px-2 py-0.5 wf-accent-chip rounded-full">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="col-span-2">
                              <div className="text-[10px] font-bold wf-fg-faint uppercase tracking-wider mb-1">Description</div>
                              <p className="text-sm wf-fg-muted leading-relaxed">{w.description}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </ModalShell>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOWNLOADED WORKFLOW UPDATE MODAL
// ═══════════════════════════════════════════════════════════════════════════════

export function WorkflowUpdateModal({
  update,
  currentWorkflowName,
  onClose,
  onUpdate,
}: {
  update: MarketplaceUpdate;
  currentWorkflowName: string;
  onClose: () => void;
  onUpdate: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [versions, setVersions] = useState<MarketplaceVersion[]>([]);
  const [loadingInfo, setLoadingInfo] = useState(true);

  // Fetch version history and changelog on mount
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const api = getMarketplaceApi(() => token);
        const res = await api.getVersions(update.slug);
        if (res.ok) {
          setVersions(res.versions);
          // Find changelog from the latest version
          const latest = res.versions.find(v => v.current);
          if (latest?.changelog) {
            setChangelog(latest.changelog);
          }
        }
      } catch (e) {
        console.error("Failed to load version info", e);
      } finally {
        setLoadingInfo(false);
      }
    })();
  }, [update.slug]);

  const handleUpdate = async () => {
    setLoading(true);
    setError(null);
    try {
      await onUpdate();
      setSuccess(true);
      setTimeout(() => onClose(), 1500);
    } catch (e: any) {
      setError(e.message || "Update failed");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <ModalShell title="Updated!" onClose={onClose}>
        <div className="p-10 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-6 animate-in zoom-in duration-300">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Successfully Updated!</h3>
          <p className="text-sm text-white/70 max-w-xs">
            "{currentWorkflowName}" has been updated to version {update.latestVersion}.
          </p>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Update Available" onClose={onClose}>
      <div className="p-6 space-y-6">
        {/* Update Banner */}
<div className="wf-accent-soft-bg rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-white/[0.04] border wf-border flex items-center justify-center wf-accent-text shadow-sm">
              <ArrowUpCircle className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-white text-lg">{update.name}</h3>
              <p className="text-sm text-white/70 mt-1">
                A new version is available from the Marketplace
              </p>
              <div className="flex items-center gap-4 mt-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50">Current:</span>
                  <span className="text-xs font-mono bg-white/[0.06] px-2 py-0.5 rounded text-white/70">
                    v{update.currentVersion}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 wf-fg-faint" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50">Latest:</span>
                  <span className="text-xs font-mono bg-emerald-100 px-2 py-0.5 rounded text-emerald-700 font-semibold">
                    v{update.latestVersion}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-700 text-sm animate-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* What's New Section */}
        {loadingInfo ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin wf-accent-text" />
          </div>
        ) : (
          <>
            {changelog && (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-white/80 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  What's New
                </label>
                <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-4">
                  <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
                    {changelog}
                  </p>
                </div>
              </div>
            )}

            {/* Version History */}
            {versions.length > 1 && (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-white/80 flex items-center gap-2">
                  <History className="w-4 h-4 text-white/40" />
                  Version History
                </label>
                <div className="bg-white/[0.06] rounded-lg border border-white/[0.08] p-3 max-h-40 overflow-y-auto">
                  {versions.slice(0, 6).map((v, i) => (
                    <div key={v.version + i} className={`flex items-center justify-between py-2 ${i > 0 ? 'border-t border-white/[0.04]' : ''}`}>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${v.current ? 'bg-emerald-100 text-emerald-700' :
                          v.version === update.currentVersion ? 'wf-surface-muted text-white/70' : 'text-white/50'
                          }`}>
                          v{v.version}
                        </span>
                        {v.current && (
                          <span className="text-[10px] bg-[color-mix(in_srgb,var(--wf-accent)_14%,transparent)] wf-accent-text px-1.5 py-0.5 rounded font-medium">Latest</span>
                        )}
                        {v.version === update.currentVersion && (
                          <span className="text-[10px] wf-surface-muted text-white/70 px-1.5 py-0.5 rounded font-medium">Your version</span>
                        )}
                      </div>
                      <span className="text-xs text-white/40">
                        {new Date(v.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Warning */}
        <div className="flex items-start gap-2 p-3 bg-white/[0.06] border border-white/[0.08] rounded-lg">
          <Info className="w-4 h-4 text-white/40 mt-0.5 shrink-0" />
          <p className="text-xs text-white/50 leading-relaxed">
            Updating will replace your current workflow with the latest version from the Marketplace.
            Any local changes you've made may be overwritten.
          </p>
        </div>
      </div>

      <div className="p-5 border-t border-white/[0.08] bg-white/[0.06] rounded-b-2xl flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm border border-white/[0.12] text-white/80 hover:bg-white/[0.04] hover:shadow-sm font-medium transition-all"
        >
          Not Now
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={loading}
          className="px-5 py-2 rounded-lg text-sm wf-primary-btn font-medium flex items-center gap-2 disabled:opacity-50 transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Update Workflow
        </button>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW CARDS & BROWSER
// ═══════════════════════════════════════════════════════════════════════════════

function WorkflowCard({ workflow, onClick }: { workflow: MarketplaceWorkflow; onClick: () => void }) {
  const heroMedia = workflow.media?.[0];
  const cover = workflow.thumbnail_url || workflow.cover_image_url || (heroMedia ? getMediaPreviewUrl(heroMedia) : null);
  const creatorName = workflow.creator?.display_name || workflow.publisher_name;

  return (
    <button
      onClick={onClick}
      className="flex h-full flex-col overflow-hidden rounded-[24px] border wf-border wf-bg-elevated text-left shadow-sm transition-all hover:-translate-y-1 hover:border-[color-mix(in_srgb,var(--wf-accent)_45%,transparent)] hover:shadow-xl"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-rose-500 via-rose-600 to-red-700">
        {cover ? (
          <img src={cover} alt={workflow.name} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/90">
            {workflow.icon ? <span className="text-5xl">{workflow.icon}</span> : <Globe className="h-10 w-10" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-3">
          <div className="rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] wf-fg shadow-sm">
            {workflow.category || 'General'}
          </div>
          <div className="flex items-center gap-2">
            {workflow.locked && (
              <div className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-700 shadow-sm">
                Locked
              </div>
            )}
            <div className="rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm">
              v{workflow.version}
            </div>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
          <div className="line-clamp-1 text-lg font-semibold">{workflow.name}</div>
          <div className="mt-1 line-clamp-2 text-sm text-white/85">{workflow.short_description || workflow.description}</div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl wf-surface-muted wf-fg shadow-inner">
            {workflow.creator?.avatar_url ? (
              <img src={workflow.creator.avatar_url} alt={creatorName} className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm font-semibold">{creatorName.slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <div>
            <div className="text-sm font-semibold wf-fg">{creatorName}</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs wf-fg-muted">
              <span>@{workflow.creator?.handle || creatorName.toLowerCase().replace(/\s+/g, '')}</span>
              {workflow.creator?.follower_count ? <span>{workflow.creator.follower_count} followers</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between border-t wf-border pt-3 text-xs font-medium wf-fg-muted">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Download className="h-3.5 w-3.5" />
              {workflow.download_count}
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(workflow.created_at).toLocaleDateString()}
            </div>
          </div>
          {workflow.rating_avg > 0 && (
            <div className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">
              <Star className="h-3.5 w-3.5 fill-current" />
              {Number(workflow.rating_avg).toFixed(1)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function WorkflowDetail({
  workflow,
  onBack,
  onImport,
  onRate,
  onOpenCreator,
  onToggleFollow,
  followLoading,
}: {
  workflow: MarketplaceWorkflow;
  onBack: () => void;
  onImport: (w: MarketplaceWorkflow) => void;
  onRate: (rating: number, review?: string) => Promise<void>;
  onOpenCreator: (handle: string) => void;
  onToggleFollow: (creator: MarketplaceCreatorProfile) => Promise<void>;
  followLoading: boolean;
}) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [isRating, setIsRating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);

  const isFunctionListing =
    workflow.category === 'functions' ||
    (workflow.spec && (workflow.spec as any).kind === 'function') ||
    (Array.isArray(workflow.tags) && workflow.tags.includes('function'));
  const importLabel = isFunctionListing ? 'Import Function' : 'Import Workflow';
  const creator = workflow.creator;
  const gallery = workflow.media && workflow.media.length > 0
    ? workflow.media
    : workflow.cover_image_url || workflow.thumbnail_url
      ? [{ media_type: 'image', url: workflow.cover_image_url || workflow.thumbnail_url || '', thumbnail_url: workflow.thumbnail_url || workflow.cover_image_url || '', alt_text: workflow.name } as MarketplaceWorkflowMedia]
      : [];
  const activeMedia = gallery[activeMediaIndex] || gallery[0] || null;

  const handleImport = async () => {
    setImporting(true);
    try {
      await onImport(workflow);
    } finally {
      setImporting(false);
    }
  };

  const handleRate = async (r: number) => {
    setIsRating(true);
    try {
      await onRate(r);
      setRating(r);
    } catch {
      // ignore
    } finally {
      setIsRating(false);
    }
  };

  return (
    <div className="flex h-full flex-col wf-surface-muted">
      <div className="relative overflow-hidden border-b wf-border bg-slate-950 text-white">
        {workflow.cover_image_url || workflow.thumbnail_url ? (
          <img src={workflow.cover_image_url || workflow.thumbnail_url || ''} alt={workflow.name} className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/85 to-slate-950/40" />
        <div className="relative p-6 md:p-8">
          <button
            onClick={onBack}
            className="mb-6 flex items-center gap-1 text-xs font-medium text-white/70 transition-colors hover:text-white"
          >
            <ChevronRight className="h-3 w-3 rotate-180" />
            Back to browsing
          </button>

          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex max-w-3xl gap-5">
              <div className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-white/10 text-white shadow-xl backdrop-blur">
                {workflow.icon ? <span className="text-4xl">{workflow.icon}</span> : <Globe className="h-10 w-10" />}
              </div>
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
                  <span className="rounded-full bg-white/10 px-3 py-1">{workflow.category || 'General'}</span>
                  {workflow.locked ? <span className="rounded-full bg-amber-400/15 px-3 py-1 text-amber-200">Locked</span> : null}
                </div>
                <h2 className="text-3xl font-bold tracking-tight">{workflow.name}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/80">{workflow.short_description || workflow.description}</p>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-white/75">
                  <span className="flex items-center gap-1.5"><Download className="h-3.5 w-3.5" />{workflow.download_count} downloads</span>
                  <span className="flex items-center gap-1.5"><Star className="h-3.5 w-3.5 fill-current text-amber-300" />{workflow.rating_count ? Number(workflow.rating_avg).toFixed(1) : 'New'}{workflow.rating_count ? ` · ${workflow.rating_count} ratings` : ''}</span>
                  <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{new Date(workflow.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleImport}
              disabled={importing}
              className="inline-flex items-center justify-center gap-2.5 rounded-2xl bg-[color:var(--wf-accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-[color:var(--wf-accent)] disabled:opacity-70"
            >
              {importing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
              {importLabel}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="mx-auto grid max-w-6xl gap-6 xl:grid-cols-[minmax(0,1.4fr)_360px]">
          <div className="space-y-6">
            {activeMedia ? (
              <div className="overflow-hidden rounded-[28px] border wf-border wf-bg-elevated shadow-sm">
                <div className="aspect-[16/9] bg-slate-900">
                  {isVideoMedia(activeMedia) ? (
                    <video src={activeMedia.url} controls poster={activeMedia.thumbnail_url || undefined} className="h-full w-full object-cover" />
                  ) : (
                    <img src={getMediaPreviewUrl(activeMedia)} alt={activeMedia.alt_text || workflow.name} className="h-full w-full object-cover" />
                  )}
                </div>
                {gallery.length > 1 ? (
                  <div className="flex gap-3 overflow-x-auto border-t wf-border p-4">
                    {gallery.map((item, index) => (
                      <button
                        key={`${item.url}-${index}`}
                        type="button"
                        onClick={() => setActiveMediaIndex(index)}
                        className={`relative h-20 w-32 shrink-0 overflow-hidden rounded-2xl border transition-all ${index === activeMediaIndex ? 'border-[color:var(--wf-accent)] ring-2 ring-[color-mix(in_srgb,var(--wf-accent)_22%,transparent)]' : 'wf-border hover:border-[color-mix(in_srgb,var(--wf-accent)_45%,transparent)]'}`}
                      >
                        {isVideoMedia(item) ? (
                          <div className="flex h-full w-full items-center justify-center bg-slate-900 text-white/80"><PlayCircle className="h-8 w-8" /></div>
                        ) : (
                          <img src={getMediaPreviewUrl(item)} alt={item.alt_text || `Media ${index + 1}`} className="h-full w-full object-cover" />
                        )}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-[28px] border wf-border wf-bg-elevated p-6 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] wf-fg-muted">About this workflow</h3>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 wf-fg">{workflow.description}</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-[28px] border wf-border wf-bg-elevated p-6 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] wf-fg-muted">Tags & category</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {workflow.category ? <span className="rounded-full wf-surface-muted px-3 py-1.5 text-xs font-semibold wf-fg">{workflow.category}</span> : null}
                  {workflow.tags?.map(tag => (
                    <span key={tag} className="flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--wf-accent)_12%,transparent)] px-3 py-1.5 text-xs font-medium wf-accent-text">
                      <Hash className="h-3 w-3 opacity-60" />
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-[28px] border wf-border wf-bg-elevated p-6 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] wf-fg-muted">Rate this workflow</h3>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((r) => (
                      <button
                        key={r}
                        onMouseEnter={() => setHoverRating(r)}
                        onMouseLeave={() => setHoverRating(0)}
                        onClick={() => handleRate(r)}
                        disabled={isRating}
                        className="p-1 transition-transform hover:scale-110 active:scale-95"
                      >
                        <Star className={`h-8 w-8 transition-colors ${(hoverRating || rating || Math.round(workflow.rating_avg)) >= r ? 'fill-amber-400 text-amber-400' : 'wf-fg-faint'}`} />
                      </button>
                    ))}
                  </div>
                  <div className="rounded-full wf-surface-muted px-3 py-1.5 text-sm font-medium wf-fg-muted">{workflow.rating_count} ratings</div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[28px] border wf-border wf-bg-elevated p-6 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] wf-fg-muted">Creator</h3>
              <div className="mt-4 flex items-start gap-4">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl wf-surface-muted wf-fg shadow-inner">
                  {creator?.avatar_url ? <img src={creator.avatar_url} alt={creator.display_name} className="h-full w-full object-cover" /> : <span className="text-xl font-semibold">{(creator?.display_name || workflow.publisher_name).slice(0, 1).toUpperCase()}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => creator?.handle && onOpenCreator(creator.handle)}
                    className="text-left text-lg font-semibold wf-fg hover:wf-accent-text"
                  >
                    {creator?.display_name || workflow.publisher_name}
                  </button>
                  <div className="mt-1 text-sm wf-fg-muted">@{creator?.handle || workflow.publisher_name.toLowerCase().replace(/\s+/g, '')}</div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs wf-fg-muted">
                    <span>{creator?.follower_count || 0} followers</span>
                    <span>{creator?.workflow_count || 1} workflows</span>
                  </div>
                </div>
              </div>
              {creator?.bio ? <p className="mt-4 text-sm leading-6 wf-fg-muted">{creator.bio}</p> : null}
              <div className="mt-4 flex flex-wrap gap-3">
                {creator?.handle ? (
                  <button
                    type="button"
                    onClick={() => onToggleFollow(creator)}
                    disabled={followLoading}
                    className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition-colors ${creator.is_following ? 'bg-slate-900 text-white hover:opacity-90' : 'bg-[color:var(--wf-accent)] text-white hover:bg-[color:var(--wf-accent)]'} disabled:opacity-60`}
                  >
                    {followLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                    {creator.is_following ? 'Following' : 'Follow creator'}
                  </button>
                ) : null}
                {creator?.website_url ? (
                  <a href={creator.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl border wf-border px-4 py-2 text-sm font-medium wf-fg hover:border-[color-mix(in_srgb,var(--wf-accent)_45%,transparent)] hover:wf-accent-text">
                    <ExternalLink className="h-4 w-4" />
                    Website
                  </a>
                ) : null}
              </div>
            </div>

            <div className="rounded-[28px] border wf-border wf-bg-elevated p-6 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] wf-fg-muted">Store details</h3>
              <dl className="mt-4 space-y-3 text-sm wf-fg-muted">
                <div className="flex items-center justify-between gap-3"><dt>Version</dt><dd className="font-medium wf-fg">{workflow.version}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt>Downloads</dt><dd className="font-medium wf-fg">{workflow.download_count}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt>Published</dt><dd className="font-medium wf-fg">{new Date(workflow.created_at).toLocaleDateString()}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt>Access</dt><dd className="font-medium wf-fg">{workflow.locked ? 'Locked listing' : 'Open listing'}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreatorDetail({
  creator,
  workflows,
  onBack,
  onSelectWorkflow,
  onToggleFollow,
  followLoading,
}: {
  creator: MarketplaceCreatorProfile;
  workflows: MarketplaceWorkflow[];
  onBack: () => void;
  onSelectWorkflow: (workflow: MarketplaceWorkflow) => void;
  onToggleFollow: (creator: MarketplaceCreatorProfile) => Promise<void>;
  followLoading: boolean;
}) {
  return (
    <div className="flex h-full flex-col wf-surface-muted">
      <div className="relative overflow-hidden border-b wf-border bg-slate-950 text-white">
        {creator.hero_image_url ? <img src={creator.hero_image_url} alt={creator.display_name} className="absolute inset-0 h-full w-full object-cover" /> : null}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/85 to-slate-950/30" />
        <div className="relative p-6 md:p-8">
          <button onClick={onBack} className="mb-6 flex items-center gap-1 text-xs font-medium text-white/70 hover:text-white"><ChevronRight className="h-3 w-3 rotate-180" />Back to marketplace</button>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex gap-5">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-[28px] bg-white/10 shadow-xl backdrop-blur">
                {creator.avatar_url ? <img src={creator.avatar_url} alt={creator.display_name} className="h-full w-full object-cover" /> : <span className="text-3xl font-semibold">{creator.display_name.slice(0, 1).toUpperCase()}</span>}
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/65">Creator</div>
                <h2 className="mt-2 text-3xl font-bold tracking-tight">{creator.display_name}</h2>
                <div className="mt-2 text-sm text-white/75">@{creator.handle}</div>
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-white/75">
                  <span>{creator.follower_count} followers</span>
                  <span>{creator.workflow_count} workflows</span>
                </div>
                {creator.bio ? <p className="mt-4 max-w-2xl text-sm leading-7 text-white/80">{creator.bio}</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onToggleFollow(creator)}
                disabled={followLoading}
                className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition-colors ${creator.is_following ? 'wf-bg-elevated wf-fg hover:wf-surface-muted' : 'bg-[color:var(--wf-accent)] text-white hover:bg-[color:var(--wf-accent)]'} disabled:opacity-60`}
              >
                {followLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                {creator.is_following ? 'Following' : 'Follow creator'}
              </button>
              {creator.website_url ? <a href={creator.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl border border-white/20 px-5 py-3 text-sm font-medium text-white hover:bg-white/10"><ExternalLink className="h-4 w-4" />Website</a> : null}
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold wf-fg">Published by {creator.display_name}</h3>
              <p className="mt-1 text-sm wf-fg-muted">Browse this creator’s workflow catalog.</p>
            </div>
          </div>
          {workflows.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {workflows.map((workflow) => (
                <WorkflowCard key={workflow.id} workflow={workflow} onClick={() => onSelectWorkflow(workflow)} />
              ))}
            </div>
          ) : (
            <div className="rounded-[28px] border border-dashed wf-border wf-bg-elevated p-10 text-center text-sm wf-fg-muted">This creator hasn’t published anything yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MarketplaceBrowser({
  onClose,
  onImport,
  initialSlug,
}: {
  onClose: () => void;
  onImport: (spec: any) => void;
  initialSlug?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<MarketplaceWorkflow[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [selectedWorkflow, setSelectedWorkflow] = useState<MarketplaceWorkflow | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<MarketplaceCreatorProfile | null>(null);
  const [creatorWorkflows, setCreatorWorkflows] = useState<MarketplaceWorkflow[]>([]);
  const [followLoading, setFollowLoading] = useState(false);
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial data
  useEffect(() => {
    loadCategories();
    if (initialSlug) {
      loadSpecificWorkflow(initialSlug);
    } else {
      loadFeatured();
    }
  }, [initialSlug]);

  const loadSpecificWorkflow = async (slug: string) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const api = getMarketplaceApi(() => token);
      const res = await api.getWorkflow(slug);
      if (res.ok && res.workflow) {
        setSelectedCreator(null);
        setSelectedWorkflow(res.workflow);
      } else {
        setError(res.error || 'Failed to load workflow');
        loadFeatured(); // Fallback
      }
    } catch (e: any) {
      console.error(e);
      loadFeatured();
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  const syncCreatorState = useCallback((creator: MarketplaceCreatorProfile) => {
    setSelectedCreator(prev => (prev && prev.id === creator.id ? creator : prev));
    setSelectedWorkflow(prev => {
      if (!prev) return prev;
      const creatorId = prev.creator?.id || prev.publisher_id;
      if (creatorId !== creator.id) return prev;
      return {
        ...prev,
        creator,
        publisher_name: creator.display_name || prev.publisher_name,
      };
    });
    setWorkflows(prev => prev.map((workflow) => {
      const creatorId = workflow.creator?.id || workflow.publisher_id;
      if (creatorId !== creator.id) return workflow;
      return {
        ...workflow,
        creator,
        publisher_name: creator.display_name || workflow.publisher_name,
      };
    }));
    setCreatorWorkflows(prev => prev.map((workflow) => {
      const creatorId = workflow.creator?.id || workflow.publisher_id;
      if (creatorId !== creator.id) return workflow;
      return {
        ...workflow,
        creator,
        publisher_name: creator.display_name || workflow.publisher_name,
      };
    }));
  }, []);

  const handleOpenCreator = useCallback(async (handle: string) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const api = getMarketplaceApi(() => token);
      const res = await api.getCreator(handle);
      if (res.ok && res.creator) {
        setSelectedWorkflow(null);
        setSelectedCreator(res.creator);
        setCreatorWorkflows(res.workflows || []);
      } else {
        setToast({ message: res.error || 'Failed to load creator', type: 'error' });
      }
    } catch (e: any) {
      console.error(e);
      setToast({ message: e?.message || 'Failed to load creator', type: 'error' });
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, []);

  const handleToggleFollow = useCallback(async (creator: MarketplaceCreatorProfile) => {
    setFollowLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        setToast({ message: 'Please sign in to follow creators', type: 'error' });
        return;
      }

      const api = getMarketplaceApi(() => token);
      const res = creator.is_following
        ? await api.unfollowCreator(creator.handle)
        : await api.followCreator(creator.handle);

      if (res.ok && res.creator) {
        syncCreatorState(res.creator);
        setToast({ message: res.creator.is_following ? `Following ${res.creator.display_name}` : `Unfollowed ${res.creator.display_name}`, type: 'success' });
      } else {
        setToast({ message: res.error || 'Failed to update follow status', type: 'error' });
      }
    } catch (e: any) {
      console.error(e);
      setToast({ message: e?.message || 'Failed to update follow status', type: 'error' });
    } finally {
      setFollowLoading(false);
    }
  }, [syncCreatorState]);

  const loadCategories = async () => {
    try {
      const token = await getToken();
      const api = getMarketplaceApi(() => token);
      const res = await api.getCategories();
      if (res.ok) setCategories(res.categories);
    } catch (e) { console.error(e); }
  };

  const loadFeatured = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const api = getMarketplaceApi(() => token);
      const res = await api.getFeatured();
      if (res.ok) {
        setSelectedCreator(null);
        setWorkflows(res.workflows);
      } else {
        setError(res.error || 'Failed to load workflows');
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Connection error');
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  };

  const handleSearch = useCallback(async (searchQuery: string, categoryFilter: string) => {
    if (!searchQuery.trim() && categoryFilter === 'all') {
      loadFeatured();
      return;
    }

    setLoading(true);
    setError(null);
    setSelectedCreator(null);
    try {
      const token = await getToken();
      const api = getMarketplaceApi(() => token);
      const res = await api.search({
        query: searchQuery,
        category: categoryFilter === 'all' ? undefined : categoryFilter,
        limit: 24
      });
      if (res.ok) {
        setWorkflows(res.results);
      } else {
        setError(res.error || 'Search failed');
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search when typing
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      handleSearch(search, category);
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [search, category, handleSearch]);

  const handleImportWorkflow = async (w: MarketplaceWorkflow) => {
    try {
      const token = await getToken();
      const api = getMarketplaceApi(() => token);

      // If we don't have the spec loaded (e.g. from search results), fetch it
      let spec = w.spec;
      let isLocked = w.locked;
      if (!spec) {
        const full = await api.getWorkflow(w.slug);
        if (full.ok && full.workflow) {
          spec = full.workflow.spec;
          isLocked = full.workflow.locked;
        }
      }

      if (spec) {
        // Track download
        await api.download(w.slug);
        // Add locked flag and marketplace slug to the spec for tracking
        const importedSpec = {
          ...spec,
          locked: isLocked || false,
          marketplaceSlug: w.slug,
        };
        const isFn =
          w.category === 'functions' ||
          (spec as any).kind === 'function' ||
          (Array.isArray(w.tags) && w.tags.includes('function'));
        // Notify
        try {
          (window as any).desktopAPI?.notify?.(
            'Imported!',
            isFn
              ? `${w.name} is now available in the toolbox under Installed Functions.`
              : `${w.name} has been added to your workflows.`
          );
        } catch { }
        onImport(importedSpec);
        onClose();
      } else {
        setToast({ message: 'Failed to load workflow data', type: 'error' });
      }
    } catch (e) {
      console.error("Import failed", e);
      setToast({ message: 'Failed to import workflow', type: 'error' });
    }
  };

  const handleRateWorkflow = async (rating: number, review?: string) => {
    if (!selectedWorkflow) return;
    try {
      const token = await getToken();
      if (!token) {
        setToast({ message: 'Please sign in to rate workflows', type: 'error' });
        return;
      }

      const api = getMarketplaceApi(() => token);
      const res = await api.rate(selectedWorkflow.slug, rating, review);

      if (res.ok) {
        // Refresh local state
        setSelectedWorkflow(prev => prev ? {
          ...prev,
          rating_avg: prev.rating_count === 0 ? rating : ((prev.rating_avg * prev.rating_count) + rating) / (prev.rating_count + 1),
          rating_count: prev.rating_count + 1
        } : null);
        setToast({ message: 'Rating saved!', type: 'success' });
      } else {
        setToast({ message: res.error || 'Failed to save rating', type: 'error' });
      }
    } catch (e) {
      console.error("Rating failed", e);
      setToast({ message: 'Failed to save rating', type: 'error' });
    }
  };

  const featuredHero = !search.trim() && category === 'all' ? workflows[0] : null;
  const browseWorkflows = featuredHero ? workflows.slice(1) : workflows;

  return (
    <>
      <ModalShell title="Workflow Marketplace" onClose={onClose} maxWidth="max-w-6xl">
        {selectedCreator ? (
          <CreatorDetail
            creator={selectedCreator}
            workflows={creatorWorkflows}
            onBack={() => setSelectedCreator(null)}
            onSelectWorkflow={(workflow) => {
              setSelectedCreator(null);
              setSelectedWorkflow(workflow);
            }}
            onToggleFollow={handleToggleFollow}
            followLoading={followLoading}
          />
        ) : selectedWorkflow ? (
          <WorkflowDetail
            workflow={selectedWorkflow}
            onBack={() => setSelectedWorkflow(null)}
            onImport={handleImportWorkflow}
            onRate={handleRateWorkflow}
            onOpenCreator={handleOpenCreator}
            onToggleFollow={handleToggleFollow}
            followLoading={followLoading}
          />
        ) : (
          <div className="flex flex-col h-[74vh] wf-surface-muted">
            {/* Search Header */}
            <div className="shrink-0 border-b wf-border wf-bg-elevated px-6 py-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] wf-accent-text">Stuard Store</div>
                  <h2 className="mt-1 text-2xl font-bold wf-fg">Discover workflows from creators</h2>
                  <p className="mt-1 text-sm wf-fg-muted">Browse featured automations, follow creators, and install polished workflows.</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 w-5 h-5 wf-fg-faint" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full rounded-xl border wf-border wf-bg-elevated py-2.5 pl-10 pr-4 text-sm wf-fg shadow-sm transition-all focus:border-[color:var(--wf-accent)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wf-accent)_30%,transparent)]"
                    placeholder="Search for workflows..."
                  />
                </div>
                <div className="min-w-[170px]">
                  <MarketplaceSelect
                    value={category}
                    onChange={setCategory}
                    options={[
                      { value: "all", label: "All Categories" },
                      ...categories.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                <button
                  onClick={() => { setCategory('all'); setSearch(''); }}
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${category === 'all' && !search ? 'border-[color:var(--wf-accent)] bg-[color:var(--wf-accent)] text-white shadow-sm' : 'wf-border wf-bg-elevated wf-fg-muted hover:border-[color-mix(in_srgb,var(--wf-accent)_35%,transparent)] hover:wf-accent-text'}`}
                >
                  All
                </button>
                {categories.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${category === c.id ? 'border-[color:var(--wf-accent)] bg-[color:var(--wf-accent)] text-white shadow-sm' : 'wf-border wf-bg-elevated wf-fg-muted hover:border-[color-mix(in_srgb,var(--wf-accent)_35%,transparent)] hover:wf-accent-text'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Results Grid */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8">
              {loading ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 wf-fg-muted">
                  <Loader2 className="w-8 h-8 animate-spin wf-accent-text" />
                  <span className="text-sm">{initialLoad ? 'Loading marketplace...' : 'Searching...'}</span>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-rose-400" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium wf-fg">Something went wrong</p>
                    <p className="mt-1 max-w-xs text-sm wf-fg-muted">{error}</p>
                    <button
                      onClick={loadFeatured}
                      className="mt-4 rounded-lg bg-[color:var(--wf-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[color:var(--wf-accent)]"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              ) : workflows.length > 0 ? (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  {featuredHero ? (
                    <button
                      type="button"
                      onClick={() => setSelectedWorkflow(featuredHero)}
                      className="relative overflow-hidden rounded-[32px] border wf-border bg-slate-950 text-left text-white shadow-xl"
                    >
                      {featuredHero.cover_image_url || featuredHero.thumbnail_url ? (
                        <img src={featuredHero.cover_image_url || featuredHero.thumbnail_url || ''} alt={featuredHero.name} className="absolute inset-0 h-full w-full object-cover" />
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/80 to-slate-950/35" />
                      <div className="relative grid gap-6 p-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
                        <div className="max-w-2xl">
                          <div className="mb-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">Featured workflow</div>
                          <h3 className="text-3xl font-bold tracking-tight">{featuredHero.name}</h3>
                          <p className="mt-3 text-sm leading-7 text-white/85">{featuredHero.description}</p>
                          <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-white/80">
                            <span className="flex items-center gap-1.5"><User className="h-4 w-4" />{featuredHero.creator?.display_name || featuredHero.publisher_name}</span>
                            <span className="flex items-center gap-1.5"><Download className="h-4 w-4" />{featuredHero.download_count} installs</span>
                            <span className="flex items-center gap-1.5"><Star className="h-4 w-4 fill-current text-amber-300" />{featuredHero.rating_count ? Number(featuredHero.rating_avg).toFixed(1) : 'New'}</span>
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <div className="inline-flex items-center gap-2 rounded-2xl bg-[color:var(--wf-accent)] px-5 py-3 text-sm font-semibold shadow-lg">
                            View listing
                            <ChevronRight className="h-4 w-4" />
                          </div>
                        </div>
                      </div>
                    </button>
                  ) : null}

                  <div>
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold wf-fg">{search.trim() || category !== 'all' ? 'Results' : 'Popular workflows'}</h3>
                        <p className="mt-1 text-sm wf-fg-muted">Discover ready-to-install automations from the Stuard community.</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                      {browseWorkflows.map(w => (
                        <WorkflowCard
                          key={w.id}
                          workflow={w}
                          onClick={() => setSelectedWorkflow(w)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : search.trim() || category !== 'all' ? (
                // Search with no results
                <div className="flex h-full flex-col items-center justify-center gap-4 wf-fg-muted">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full wf-bg-elevated shadow-sm">
                    <Search className="w-8 h-8 wf-fg-faint" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium wf-fg">No workflows found</p>
                    <p className="mt-1 text-sm">Try different search terms or browse all categories</p>
                    <button
                      onClick={() => { setSearch(''); setCategory('all'); }}
                      className="mt-4 rounded-lg border wf-border wf-bg-elevated px-4 py-2 text-sm font-medium wf-fg transition-all hover:border-[color-mix(in_srgb,var(--wf-accent)_35%,transparent)] hover:wf-accent-text"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              ) : (
                // Empty marketplace - encourage publishing
                <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-2xl wf-icon-chip shadow-sm">
                    <Rocket className="w-12 h-12 wf-accent-text" />
                  </div>
                  <div>
                    <h3 className="mb-2 text-xl font-bold wf-fg">The marketplace is waiting for you!</h3>
                    <p className="max-w-md text-sm leading-relaxed wf-fg-muted">
                      Be the first to share your workflows with the community.
                      Create powerful automations and help others save time.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={onClose}
                      className="px-5 py-2.5 bg-[color:var(--wf-accent)] text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-all shadow-lg  flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Create a Workflow
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </ModalShell>

      {/* Toast notifications */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
}

// ============================================================================
// FUNCTION NODE DESIGNER
// ============================================================================

interface FunctionPort {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
}

interface FunctionNodeSpec {
  label: string;
  tagline: string;
  icon: string;
  color: string;
  inputs: FunctionPort[];
  outputs: FunctionPort[];
}


function deriveDefaultFunctionNode(model: any): FunctionNodeSpec {
  return autoDetectFunctionNode(model, {
    label: '',
    tagline: '',
    icon: 'Box',
    color: 'indigo',
    inputs: [],
    outputs: [],
  });
}

// Smarter detection used by the "Auto-detect" button. Falls back to the
// current values when the workflow doesn't yield a strong signal.
const TOOL_TO_ICON: Record<string, string> = {
  gmail_send_message: 'Mail', gmail_search: 'Mail',
  http_request: 'Globe', web_search: 'Globe',
  run_python_script: 'Code', run_node_script: 'Code', run_command: 'Terminal',
  ai_inference: 'Brain', ollama_chat: 'Brain', ollama_generate: 'Brain', ollama_agent: 'Brain', agent_node: 'Brain',
  db_query: 'Database', db_store: 'Database',
  take_screenshot: 'Image', capture_screen: 'Image', analyze_image: 'Image', analyze_current_screen: 'Image',
  send_notification: 'MessageSquare', custom_ui: 'Sparkles', text_to_speech: 'MessageSquare',
  read_file: 'FileText', write_file: 'FileText',
};

const TOOL_TO_COLOR: Record<string, string> = {
  gmail_send_message: 'rose', gmail_search: 'rose',
  http_request: 'cyan', web_search: 'cyan',
  run_python_script: 'amber', run_node_script: 'amber', run_command: 'slate',
  ai_inference: 'violet', ollama_chat: 'violet', ollama_generate: 'violet', ollama_agent: 'violet', agent_node: 'violet',
  db_query: 'emerald', db_store: 'emerald',
  take_screenshot: 'blue', capture_screen: 'blue', analyze_image: 'blue', analyze_current_screen: 'blue',
};

function mapDesignerType(t: string | undefined): FunctionPort['type'] {
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object' || t === 'array') return t;
  if (t === 'json') return 'object';
  if (t === 'list') return 'array';
  return 'any';
}

function autoDetectFunctionNode(model: any, current: FunctionNodeSpec): FunctionNodeSpec {
  // ── Inputs ─────────────────────────────────────────────────────────────
  const inputs: FunctionPort[] = [];
  try {
    for (const t of model?.triggers || []) {
      if (Array.isArray(t?.inputParams) && t.inputParams.length > 0) {
        for (const p of t.inputParams) {
          if (!p?.name) continue;
          inputs.push({ id: `in_${inputs.length + 1}`, name: String(p.name), type: mapDesignerType(p.type) });
        }
      }
    }
    if (inputs.length === 0) {
      for (const t of (model?.triggers || []).slice(0, 3)) {
        const fallback = (t?.label || t?.type || `input_${inputs.length + 1}`).toString().toLowerCase().replace(/\s+/g, '_');
        inputs.push({ id: `in_${inputs.length + 1}`, name: fallback, type: 'any' });
      }
    }
  } catch {}

  // ── Outputs ────────────────────────────────────────────────────────────
  const outputs: FunctionPort[] = [];
  try {
    if (Array.isArray(model?.outputSchema) && model.outputSchema.length > 0) {
      for (const o of model.outputSchema) {
        if (!o?.name) continue;
        outputs.push({ id: `out_${outputs.length + 1}`, name: String(o.name), type: mapDesignerType(o.type) });
      }
    } else {
      const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
      const last = nodes[nodes.length - 1];
      if (last) outputs.push({ id: 'out_1', name: (last?.label || 'result').toString().toLowerCase().replace(/\s+/g, '_'), type: 'any' });
    }
  } catch {}

  if (inputs.length === 0) inputs.push({ id: 'in_1', name: 'input', type: 'any' });
  if (outputs.length === 0) outputs.push({ id: 'out_1', name: 'output', type: 'any' });

  // ── Icon + color from the dominant tool ────────────────────────────────
  let dominantTool: string | undefined;
  try {
    const counts: Record<string, number> = {};
    for (const n of model?.nodes || []) {
      const tool = n?.tool || n?.type;
      if (typeof tool === 'string' && tool) counts[tool] = (counts[tool] || 0) + 1;
    }
    dominantTool = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  } catch {}

  const icon = dominantTool && TOOL_TO_ICON[dominantTool] ? TOOL_TO_ICON[dominantTool] : (current.icon || 'Box');
  const color = dominantTool && TOOL_TO_COLOR[dominantTool] ? TOOL_TO_COLOR[dominantTool] : (current.color || 'indigo');

  // ── Label + tagline ────────────────────────────────────────────────────
  const rawName = (model?.name || 'My Function').toString();
  const label = rawName.length <= 32 ? rawName : rawName.slice(0, 30) + '…';

  const stepCount = Array.isArray(model?.nodes) ? model.nodes.length : 0;
  const tagline = model?.description
    ? String(model.description).slice(0, 70)
    : stepCount > 0
      ? `Compacted ${stepCount}-step workflow as a single node`
      : 'Reusable workflow node';

  return { label, tagline, icon, color, inputs, outputs };
}

function DetectionPanel({
  d, detectedAs, model,
}: { d: boolean; detectedAs: 'workflow' | 'function'; model: any }) {
  const isFn = detectedAs === 'function';
  const Icon = isFn ? Box : Layers;

  const tintBg = isFn
    ? d ? 'rgba(139,92,246,0.08)' : '#f5f3ff'
    : d ? 'rgba(59,130,246,0.08)' : '#eff6ff';
  const tintBorder = isFn
    ? d ? 'rgba(139,92,246,0.25)' : '#ddd6fe'
    : d ? 'rgba(59,130,246,0.25)' : '#bfdbfe';
  const iconBg = isFn ? 'linear-gradient(135deg, #8b5cf6, #ec4899)' : 'linear-gradient(135deg, #3b82f6, #06b6d4)';
  const labelColor = isFn ? (d ? '#ddd6fe' : '#6d28d9') : (d ? '#dbeafe' : '#1d4ed8');

  // Compute signals (used for the check list).
  const triggers = Array.isArray(model?.triggers) ? model.triggers : [];
  const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
  const hasInputParams = triggers.some((t: any) => Array.isArray(t?.inputParams) && t.inputParams.length > 0);
  const hasOutputSchema = Array.isArray(model?.outputSchema) && model.outputSchema.length > 0;
  const nameLower = (model?.name || '').toString().toLowerCase();
  const nameTaggedFunction = /^(fn[:\-_ ]|function[:\-_ ])/i.test(nameLower)
    || nameLower.endsWith(' fn') || nameLower.endsWith(' function');
  const hasEventTrigger = triggers.some((t: any) => {
    const ty = (t?.type || '').toString();
    return ty.startsWith('schedule.') || ty.startsWith('fs.') || ty.startsWith('gmail.') || ty.startsWith('drive.') || ty === 'hotkey';
  });
  const stepCount = nodes.length;

  const checks: Array<{ id: string; label: string; passed: boolean }> = isFn
    ? [
        { id: 'inputs',  label: 'Trigger declares input parameters',  passed: hasInputParams },
        { id: 'outputs', label: 'Workflow declares an output schema', passed: hasOutputSchema },
        { id: 'naming',  label: 'Name is tagged as a function',       passed: nameTaggedFunction },
        { id: 'callable',label: 'Designed to be called from a flow',  passed: hasInputParams || hasOutputSchema },
      ]
    : [
        { id: 'eventDriven', label: 'Event-driven trigger (schedule, file, email, hotkey)', passed: hasEventTrigger },
        { id: 'multiStep',   label: `Multi-step automation (${stepCount} step${stepCount === 1 ? '' : 's'})`, passed: stepCount > 1 },
        { id: 'noInputs',    label: 'No explicit input parameters',   passed: !hasInputParams },
        { id: 'noOutputs',   label: 'No explicit output schema',      passed: !hasOutputSchema },
      ];

  const passedCount = checks.filter(c => c.passed).length;

  return (
    <div className="rounded-2xl border p-5 space-y-4 shadow-sm" style={{ background: tintBg, borderColor: tintBorder }}>
      {/* Hero */}
      <div className="flex items-center gap-4">
        <div className="relative w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shrink-0" style={{ background: iconBg, color: '#ffffff' }}>
          <Icon className="w-7 h-7" />
          <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center bg-emerald-500 ring-2 ring-white">
            <Check className="w-3 h-3 text-white" />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider wf-fg-faint flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            Auto-detected as
          </div>
          <div className="text-xl font-bold mt-0.5" style={{ color: labelColor }}>
            {isFn ? 'Function' : 'Workflow'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider wf-fg-faint">Signals</div>
          <div className="text-sm font-bold" style={{ color: labelColor }}>{passedCount} / {checks.length}</div>
        </div>
      </div>

      {/* Check list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {checks.map((c) => (
          <DetectionCheck key={c.id} d={d} label={c.label} passed={c.passed} />
        ))}
      </div>
    </div>
  );
}

function DetectionCheck({ d, label, passed }: { d: boolean; label: string; passed: boolean }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg border"
      style={{
        background: passed
          ? d ? 'rgba(16,185,129,0.08)' : '#ecfdf5'
          : d ? 'rgba(255,255,255,0.02)' : '#ffffff',
        borderColor: passed
          ? d ? 'rgba(16,185,129,0.22)' : '#a7f3d0'
          : 'var(--wf-border)',
      }}
    >
      <div
        className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: passed ? '#10b981' : 'transparent',
          border: passed ? 'none' : `1.5px solid ${d ? 'rgba(255,255,255,0.18)' : '#cbd5e1'}`,
        }}
      >
        {passed && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
      </div>
      <span className={`text-xs leading-tight ${passed ? 'wf-fg font-medium' : 'wf-fg-muted'}`}>{label}</span>
    </div>
  );
}

// Heuristic — decide whether the workflow model looks like a "function" (a
// reusable building block with explicit inputs/outputs) rather than a full
// event-driven workflow. We only return true on strong signals so we don't
// surprise users with a wrong default.
function detectIsFunction(model: any): boolean {
  try {
    const triggers = Array.isArray(model?.triggers) ? model.triggers : [];
    // Strong signal #1: any trigger declares inputParams.
    const hasInputParams = triggers.some((t: any) => Array.isArray(t?.inputParams) && t.inputParams.length > 0);
    if (hasInputParams) return true;

    // Strong signal #2: workflow declares an outputSchema.
    const hasOutputSchema = Array.isArray(model?.outputSchema) && model.outputSchema.length > 0;
    if (hasOutputSchema) return true;

    // Soft signal: workflow name explicitly tagged as a function.
    const nameLower = (model?.name || '').toString().toLowerCase();
    if (/^(fn[:\-_ ]|function[:\-_ ])/i.test(nameLower) || nameLower.endsWith(' fn') || nameLower.endsWith(' function')) {
      return true;
    }
  } catch {}
  return false;
}


function FunctionNodeDesigner({
  d, workflowName, node, onChange, inputStyle, cardStyle,
}: {
  d: boolean;
  workflowName: string;
  node: FunctionNodeSpec;
  onChange: (next: FunctionNodeSpec) => void;
  inputStyle: React.CSSProperties;
  cardStyle: React.CSSProperties;
}) {
  const update = (patch: Partial<FunctionNodeSpec>) => onChange({ ...node, ...patch });
  const updatePort = (kind: 'inputs' | 'outputs', idx: number, patch: Partial<FunctionPort>) => {
    const list = node[kind].map((p, i) => i === idx ? { ...p, ...patch } : p);
    onChange({ ...node, [kind]: list });
  };
  const addPort = (kind: 'inputs' | 'outputs') => {
    const list = node[kind];
    const next: FunctionPort = { id: `${kind === 'inputs' ? 'in' : 'out'}_${Date.now()}`, name: kind === 'inputs' ? `input_${list.length + 1}` : `output_${list.length + 1}`, type: 'any' };
    onChange({ ...node, [kind]: [...list, next] });
  };
  const removePort = (kind: 'inputs' | 'outputs', idx: number) => {
    const list = node[kind].filter((_, i) => i !== idx);
    onChange({ ...node, [kind]: list });
  };

  return (
    <div className="rounded-2xl border p-5 space-y-5 shadow-sm" style={cardStyle}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold wf-fg">
          <Box className="w-4 h-4 text-violet-400" />
          Function Node Designer
        </div>
        <span className="text-[11px] wf-fg-faint">This is what other users will see when they install your function.</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* LEFT: Form */}
        <div className="lg:col-span-3 space-y-4">
          {/* Label + Tagline */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium wf-fg">Compact Label</label>
              <input
                type="text"
                maxLength={32}
                value={node.label}
                onChange={(e) => update({ label: e.target.value })}
                placeholder={workflowName.slice(0, 32)}
                className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                style={inputStyle}
              />
              <span className="text-[10px] wf-fg-faint">{node.label.length}/32 · shown on the node header</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium wf-fg">Tagline</label>
              <input
                type="text"
                maxLength={70}
                value={node.tagline}
                onChange={(e) => update({ tagline: e.target.value })}
                placeholder="What this node does in one line"
                className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                style={inputStyle}
              />
              <span className="text-[10px] wf-fg-faint">{node.tagline.length}/70 · one-line subtitle</span>
            </div>
          </div>

          {/* Icon picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium wf-fg">Icon</label>
            <div className="flex flex-wrap gap-1.5">
              {FUNCTION_NODE_ICONS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => update({ icon: id })}
                  className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-all ${
                    node.icon === id
                      ? d ? 'bg-violet-500/15 border-violet-500/40 text-violet-200 shadow-sm'
                          : 'bg-violet-50 border-violet-300 text-violet-700 shadow-sm'
                      : d ? 'bg-white/[0.02] border-white/[0.08] text-white/55 hover:bg-white/[0.05]'
                          : 'wf-bg-elevated wf-border wf-fg-muted hover:wf-surface-muted'
                  }`}
                  title={id}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          {/* Color picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium wf-fg">Accent Color</label>
            <div className="flex flex-wrap gap-2">
              {FUNCTION_NODE_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => update({ color: c.id })}
                  className={`w-7 h-7 rounded-full transition-transform ${node.color === c.id ? `ring-2 ring-offset-2 ${c.ring} ${d ? 'ring-offset-slate-900' : 'ring-offset-white'} scale-110` : 'hover:scale-110'}`}
                  style={{ background: c.bg }}
                  title={c.id}
                />
              ))}
            </div>
          </div>

          {/* Inputs */}
          <PortListEditor
            d={d}
            label="Inputs"
            kind="inputs"
            ports={node.inputs}
            onAdd={() => addPort('inputs')}
            onRemove={(i) => removePort('inputs', i)}
            onUpdate={(i, patch) => updatePort('inputs', i, patch)}
            inputStyle={inputStyle}
          />

          {/* Outputs */}
          <PortListEditor
            d={d}
            label="Outputs"
            kind="outputs"
            ports={node.outputs}
            onAdd={() => addPort('outputs')}
            onRemove={(i) => removePort('outputs', i)}
            onUpdate={(i, patch) => updatePort('outputs', i, patch)}
            inputStyle={inputStyle}
          />
        </div>

        {/* RIGHT: Preview */}
        <div className="lg:col-span-2">
          <div className="sticky top-0 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider wf-fg-faint flex items-center gap-1.5">
              <Eye className="w-3 h-3" />
              Live Preview
            </div>
            <FunctionNodePreview d={d} node={node} />
            <p className="text-[11px] wf-fg-muted leading-relaxed">
              This is how your function will appear on another user's canvas after install. Inputs flow in from the left, outputs flow out to the right.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PortListEditor({
  d, label, kind, ports, onAdd, onRemove, onUpdate, inputStyle,
}: {
  d: boolean;
  label: string;
  kind: 'inputs' | 'outputs';
  ports: FunctionPort[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, patch: Partial<FunctionPort>) => void;
  inputStyle: React.CSSProperties;
}) {
  const Icon = kind === 'inputs' ? ArrowRight : ArrowDown;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium wf-fg flex items-center gap-1.5">
          <Icon className={`w-3.5 h-3.5 ${kind === 'inputs' ? 'text-emerald-500' : 'wf-accent-text'}`} />
          {label}
          <span className="text-[10px] wf-fg-faint font-normal">({ports.length})</span>
        </label>
        <button
          type="button"
          onClick={onAdd}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
            d ? 'text-white/70 hover:bg-white/[0.06]' : 'wf-fg-muted hover:wf-surface-muted'
          }`}
        >
          <Plus className="w-3 h-3" />
          Add {kind === 'inputs' ? 'Input' : 'Output'}
        </button>
      </div>
      <div className="space-y-1.5">
        {ports.map((p, i) => (
          <div key={p.id} className="flex items-center gap-2">
            <input
              type="text"
              value={p.name}
              onChange={(e) => onUpdate(i, { name: e.target.value.replace(/\s+/g, '_') })}
              className="flex-1 px-2.5 py-1.5 border rounded-lg text-xs focus:outline-none focus:ring-1 font-mono"
              style={inputStyle}
              placeholder="port_name"
            />
            <div className="w-[108px] shrink-0">
              <MarketplaceSelect
                value={p.type}
                onChange={(type) => onUpdate(i, { type: type as FunctionPort["type"] })}
                options={[
                  { value: "any", label: "any" },
                  { value: "string", label: "string" },
                  { value: "number", label: "number" },
                  { value: "boolean", label: "boolean" },
                  { value: "object", label: "object" },
                  { value: "array", label: "array" },
                ]}
              />
            </div>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className={`p-1.5 rounded-md transition-colors ${
                d ? 'text-white/40 hover:text-red-400 hover:bg-red-500/10' : 'wf-fg-faint hover:text-red-600 hover:bg-red-50'
              }`}
              title="Remove port"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {ports.length === 0 && (
          <div className={`text-[11px] italic px-2.5 py-2 rounded-lg border border-dashed ${d ? 'border-white/[0.08] text-white/40' : 'wf-border wf-fg-faint'}`}>
            No {label.toLowerCase()} defined.
          </div>
        )}
      </div>
    </div>
  );
}

function FunctionNodePreview({ d, node }: { d: boolean; node: FunctionNodeSpec }) {
  const IconDef = FUNCTION_NODE_ICONS.find(i => i.id === node.icon) || FUNCTION_NODE_ICONS[0];
  const Icon = IconDef.icon;
  const color = FUNCTION_NODE_COLORS.find(c => c.id === node.color) || FUNCTION_NODE_COLORS[0];
  const previewBg = d ? '#0c0f14' : '#f8fafc';
  return (
    <div
      className="relative rounded-2xl border p-5 overflow-hidden"
      style={{ background: previewBg, borderColor: 'var(--wf-border)' }}
    >
      {/* Faux grid backdrop */}
      <div
        className="absolute inset-0 opacity-[0.35] pointer-events-none"
        style={{
          backgroundImage: d
            ? 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)'
            : 'radial-gradient(circle, rgba(15,23,42,0.10) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      />

      <div className="relative flex items-center justify-center min-h-[170px]">
        {/* Input port stubs */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col gap-2 -translate-x-1">
          {node.inputs.slice(0, 4).map((p) => (
            <div key={p.id} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full border-2" style={{ background: previewBg, borderColor: color.bg }} />
              <span className="text-[9px] font-mono wf-fg-faint">{p.name}</span>
            </div>
          ))}
        </div>

        {/* The Node */}
        <div
          className="relative rounded-xl shadow-lg overflow-hidden min-w-[200px] max-w-[240px]"
          style={{
            background: d ? 'rgba(255,255,255,0.04)' : '#ffffff',
            border: `1px solid ${color.border}`,
            boxShadow: `0 4px 20px -8px ${color.bg}55, 0 0 0 3px ${color.bg}18`,
          }}
        >
          {/* Header */}
          <div
            className="px-3 py-2 flex items-center gap-2"
            style={{ background: color.bg, color: color.fg }}
          >
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.20)' }}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold leading-tight truncate">{node.label || 'My Function'}</div>
              <div className="text-[9px] uppercase tracking-wider opacity-80 font-semibold">Function</div>
            </div>
          </div>
          {/* Body */}
          <div className="px-3 py-2.5 space-y-1.5">
            <p className="text-[11px] wf-fg-muted line-clamp-2 leading-snug">{node.tagline || 'Reusable workflow node'}</p>
            <div className="flex items-center justify-between text-[9px] wf-fg-faint pt-1 border-t" style={{ borderColor: d ? 'rgba(255,255,255,0.06)' : '#e2e8f0' }}>
              <span className="inline-flex items-center gap-1"><ArrowRight className="w-2.5 h-2.5" /> {node.inputs.length} in</span>
              <span className="inline-flex items-center gap-1">{node.outputs.length} out <ArrowRight className="w-2.5 h-2.5" /></span>
            </div>
          </div>
        </div>

        {/* Output port stubs */}
        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col gap-2 translate-x-1 items-end">
          {node.outputs.slice(0, 4).map((p) => (
            <div key={p.id} className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono wf-fg-faint">{p.name}</span>
              <div className="w-2.5 h-2.5 rounded-full border-2" style={{ background: previewBg, borderColor: color.bg }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// WIZARD HELPERS
// ============================================================================

function WizardStepper({
  d, steps, currentIndex, maxReached, onStepClick,
}: {
  d: boolean;
  steps: Array<{ id: string; label: string; icon: any }>;
  currentIndex: number;
  maxReached: number;
  onStepClick: (idx: number) => void;
}) {
  return (
    <div className="px-6 pt-5 pb-3 border-b" style={{ borderColor: 'var(--wf-border)' }}>
      <div className="flex items-center justify-between gap-2">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isCurrent = i === currentIndex;
          const isCompleted = i < currentIndex;
          const isReachable = i <= maxReached;
          return (
            <React.Fragment key={step.id}>
              <button
                type="button"
                onClick={() => onStepClick(i)}
                disabled={!isReachable}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${
                  isReachable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                }`}
              >
                <div className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-all border-2 ${
                  isCurrent
                    ? d ? 'bg-[color:var(--wf-accent)] border-[color:var(--wf-accent)] text-white shadow-lg ' : 'bg-[color:var(--wf-accent)] border-[color:var(--wf-accent)] text-white shadow-md '
                    : isCompleted
                      ? d ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-600'
                      : d ? 'bg-white/[0.03] border-white/[0.10] text-white/40' : 'wf-surface-muted wf-border wf-fg-faint'
                }`}>
                  {isCompleted ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                </div>
                <div className="flex flex-col items-start leading-tight">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                    isCurrent ? d ? 'wf-accent-text' : 'wf-accent-text' : 'wf-fg-faint'
                  }`}>
                    Step {i + 1}
                  </span>
                  <span className={`text-xs font-medium ${
                    isCurrent ? 'wf-fg' : isCompleted ? d ? 'text-white/65' : 'wf-fg-muted' : 'wf-fg-faint'
                  }`}>
                    {step.label}
                  </span>
                </div>
              </button>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-px transition-colors ${
                  i < currentIndex
                    ? d ? 'bg-emerald-500/40' : 'bg-emerald-300'
                    : d ? 'bg-white/[0.06]' : 'wf-surface-muted'
                }`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function StepHeader({
  icon: Icon, title, subtitle, actionRight,
}: {
  icon: any;
  title: string;
  subtitle?: string;
  actionRight?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center wf-icon-chip shrink-0">
          <Icon className="w-5 h-5 wf-accent-text" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold wf-fg leading-tight">{title}</h2>
          {subtitle && <p className="text-xs wf-fg-muted mt-0.5 leading-relaxed">{subtitle}</p>}
        </div>
      </div>
      {actionRight && <div className="shrink-0">{actionRight}</div>}
    </div>
  );
}

function ReviewSummary({
  d, publishAs, name, shortDescription, description, category, tags, functionNode,
  thumbnailUrl, coverImageUrl, mediaCount, creatorProfile, onJumpTo,
}: {
  d: boolean;
  publishAs: 'workflow' | 'function';
  name: string;
  shortDescription: string;
  description: string;
  category: string;
  tags: string[];
  functionNode: FunctionNodeSpec;
  thumbnailUrl: string;
  coverImageUrl: string;
  mediaCount: number;
  creatorProfile: Partial<MarketplaceCreatorProfile>;
  onJumpTo: (stepId: 'type' | 'details' | 'node' | 'showcase') => void;
}) {
  const cardBg = d ? 'rgba(255,255,255,0.03)' : '#ffffff';
  const cardBorder = 'var(--wf-border)' as any;
  const IconDef = FUNCTION_NODE_ICONS.find(i => i.id === functionNode.icon) || FUNCTION_NODE_ICONS[0];
  const FnIcon = IconDef.icon;
  const fnColor = FUNCTION_NODE_COLORS.find(c => c.id === functionNode.color) || FUNCTION_NODE_COLORS[0];

  return (
    <div className="space-y-3">
      {/* Hero summary */}
      <div className="rounded-2xl border p-5 flex items-start gap-4" style={{ background: cardBg, borderColor: cardBorder }}>
        <div
          className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${publishAs === 'function' ? '' : 'wf-icon-chip'}`}
          style={publishAs === 'function' ? { background: fnColor.bg, color: fnColor.fg } : undefined}
        >
          {publishAs === 'function' ? <FnIcon className="w-6 h-6" /> : <Globe className="w-6 h-6 wf-accent-text" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold wf-fg truncate">{name || 'Untitled'}</h3>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
              publishAs === 'function'
                ? d ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25' : 'bg-violet-100 text-violet-700 border border-violet-200'
                : 'wf-accent-chip'
            }`}>
              {publishAs === 'function' ? <Box className="w-2.5 h-2.5" /> : <Layers className="w-2.5 h-2.5" />}
              {publishAs}
            </span>
          </div>
          {shortDescription && <p className="text-sm wf-fg-muted mt-1 line-clamp-2">{shortDescription}</p>}
        </div>
      </div>

      {/* Grid of section cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ReviewCard d={d} label="Details" onEdit={() => onJumpTo('details')}>
          <ReviewRow label="Name" value={name || '—'} />
          <ReviewRow label="Category" value={category || 'general'} />
          <ReviewRow label="Tags" value={tags.length ? tags.map(t => `#${t}`).join(' ') : '—'} />
          <ReviewRow label="Description" value={description ? description.slice(0, 100) + (description.length > 100 ? '…' : '') : '—'} />
        </ReviewCard>

        {publishAs === 'function' && (
          <ReviewCard d={d} label="Function Node" onEdit={() => onJumpTo('node')}>
            <ReviewRow label="Label" value={functionNode.label || '—'} />
            <ReviewRow label="Tagline" value={functionNode.tagline || '—'} />
            <ReviewRow label="Inputs" value={functionNode.inputs.map(p => `${p.name}:${p.type}`).join(', ') || '—'} />
            <ReviewRow label="Outputs" value={functionNode.outputs.map(p => `${p.name}:${p.type}`).join(', ') || '—'} />
          </ReviewCard>
        )}

        <ReviewCard d={d} label="Showcase" onEdit={() => onJumpTo('showcase')}>
          <ReviewRow label="Creator" value={creatorProfile.display_name || '—'} />
          <ReviewRow label="Handle" value={creatorProfile.handle ? `@${creatorProfile.handle}` : '—'} />
          <ReviewRow label="Thumbnail" value={thumbnailUrl ? 'Uploaded' : '—'} />
          <ReviewRow label="Cover" value={coverImageUrl ? 'Uploaded' : '—'} />
          <ReviewRow label="Media" value={mediaCount > 0 ? `${mediaCount} item${mediaCount === 1 ? '' : 's'}` : '—'} />
        </ReviewCard>

        {publishAs === 'workflow' && <div />}
      </div>
    </div>
  );
}

function ReviewCard({
  d, label, onEdit, children,
}: { d: boolean; label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4 space-y-2" style={{ background: d ? 'rgba(255,255,255,0.02)' : '#ffffff', borderColor: 'var(--wf-border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider wf-fg-faint">{label}</span>
        <button
          type="button"
          onClick={onEdit}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
            d ? 'wf-accent-text hover:bg-[color-mix(in_srgb,var(--wf-accent)_10%,transparent)]0/10' : 'wf-accent-text hover:bg-[color-mix(in_srgb,var(--wf-accent)_10%,transparent)]'
          }`}
        >
          <Pencil className="w-2.5 h-2.5" />
          Edit
        </button>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="wf-fg-faint shrink-0 w-[72px]">{label}</span>
      <span className="wf-fg flex-1 truncate" title={value}>{value}</span>
    </div>
  );
}
