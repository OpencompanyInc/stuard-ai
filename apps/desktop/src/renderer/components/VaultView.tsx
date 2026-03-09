import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Shield,
  Plus,
  Search,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Edit3,
  Star,
  Key,
  Globe,
  Database,
  Server,
  FileText,
  Wifi,
  Lock,
  X,
  Check,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { clsx } from "clsx";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface VaultEntry {
  id: string;
  name: string;
  category: string;
  service?: string;
  created_at: string;
  updated_at: string;
  last_used_at?: string;
  favorite: boolean;
  tags?: string[];
  // masked list mode
  has_url?: boolean;
  has_username?: boolean;
  has_password?: boolean;
  has_notes?: boolean;
  has_metadata?: boolean;
  // decrypted detail mode
  url?: string;
  username?: string;
  password?: string;
  notes?: string;
  metadata?: Record<string, any>;
}

interface VaultStats {
  total: number;
  by_category: Record<string, number>;
  favorites: number;
  categories: string[];
}

const CATEGORY_CONFIG: Record<string, { icon: typeof Key; label: string; color: string }> = {
  login: { icon: Globe, label: "Login", color: "text-blue-400" },
  api_key: { icon: Key, label: "API Key", color: "text-amber-400" },
  database: { icon: Database, label: "Database", color: "text-emerald-400" },
  ssh: { icon: Server, label: "SSH", color: "text-purple-400" },
  certificate: { icon: Shield, label: "Certificate", color: "text-rose-400" },
  wifi: { icon: Wifi, label: "Wi-Fi", color: "text-cyan-400" },
  note: { icon: FileText, label: "Secure Note", color: "text-orange-400" },
  other: { icon: Lock, label: "Other", color: "text-gray-400" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function maskPassword(pw: string): string {
  if (!pw) return "";
  if (pw.length <= 4) return "****";
  return pw.slice(0, 2) + "*".repeat(Math.min(pw.length - 4, 12)) + pw.slice(-2);
}

function timeAgo(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Add/Edit Modal
// ─────────────────────────────────────────────────────────────────────────────

interface EntryFormProps {
  initial?: VaultEntry | null;
  onSave: (data: any) => Promise<void>;
  onCancel: () => void;
}

function EntryForm({ initial, onSave, onCancel }: EntryFormProps) {
  const [name, setName] = useState(initial?.name || "");
  const [category, setCategory] = useState(initial?.category || "login");
  const [service, setService] = useState(initial?.service || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [username, setUsername] = useState(initial?.username || "");
  const [password, setPassword] = useState(initial?.password || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [tags, setTags] = useState(initial?.tags?.join(", ") || "");
  const [favorite, setFavorite] = useState(initial?.favorite || false);
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data: any = {
        name: name.trim(),
        category,
        service: service.trim() || undefined,
        url: url.trim() || undefined,
        username: username.trim() || undefined,
        password: password || undefined,
        notes: notes.trim() || undefined,
        favorite,
        tags: tags.trim() ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      };
      await onSave(data);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full bg-theme-hover border border-theme rounded-xl px-3 py-2.5 text-sm text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-theme-bg border border-theme rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 space-y-4"
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-theme-fg flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            {initial ? "Edit Credential" : "Add Credential"}
          </h3>
          <button type="button" onClick={onCancel} className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="text-xs font-semibold text-theme-muted mb-1 block">Name *</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GitHub Personal" required />
        </div>

        {/* Category */}
        <div>
          <label className="text-xs font-semibold text-theme-muted mb-1 block">Category</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
              const Icon = cfg.icon;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCategory(key)}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5",
                    category === key
                      ? "bg-primary/10 border-primary/50 text-primary"
                      : "bg-theme-hover border-theme text-theme-muted hover:text-theme-fg"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Service */}
        <div>
          <label className="text-xs font-semibold text-theme-muted mb-1 block">Service</label>
          <input className={inputCls} value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. GitHub, AWS, PostgreSQL" />
        </div>

        {/* URL */}
        <div>
          <label className="text-xs font-semibold text-theme-muted mb-1 block">URL</label>
          <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </div>

        {/* Username */}
        <div>
          <label className="text-xs font-semibold text-theme-muted mb-1 block">Username / Email</label>
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="user@example.com" />
        </div>

        {/* Password */}
        <div>
          <label className="text-xs font-semibold text-theme-muted mb-1 block">Password / Secret / API Key</label>
          <div className="relative">
            <input
              className={clsx(inputCls, "pr-10")}
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-fg transition-colors"
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-semibold text-theme-muted mb-1 block">Notes</label>
          <textarea className={clsx(inputCls, "min-h-[60px] resize-y")} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." />
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-semibold text-theme-muted mb-1 block">Tags (comma-separated)</label>
          <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="work, production, aws" />
        </div>

        {/* Favorite */}
        <label className="flex items-center gap-2 cursor-pointer">
          <button
            type="button"
            onClick={() => setFavorite(!favorite)}
            className={clsx("p-1 rounded-lg transition-all", favorite ? "text-amber-400" : "text-theme-muted hover:text-amber-400")}
          >
            <Star className={clsx("w-4 h-4", favorite && "fill-current")} />
          </button>
          <span className="text-sm text-theme-fg">Favorite</span>
        </label>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-bold border border-theme text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="px-5 py-2 rounded-xl text-sm font-bold bg-primary text-primary-fg hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {saving ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
            {initial ? "Update" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Row
// ─────────────────────────────────────────────────────────────────────────────

interface EntryRowProps {
  entry: VaultEntry;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string, current: boolean) => void;
}

function EntryRow({ entry, onView, onEdit, onDelete, onToggleFavorite }: EntryRowProps) {
  const cat = CATEGORY_CONFIG[entry.category] || CATEGORY_CONFIG.other;
  const Icon = cat.icon;

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 rounded-xl border border-transparent hover:border-theme hover:bg-theme-hover/50 transition-all cursor-pointer"
      onClick={() => onView(entry.id)}
    >
      <div className={clsx("p-2 rounded-xl bg-theme-hover", cat.color)}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-theme-fg truncate">{entry.name}</span>
          {entry.favorite && <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
        </div>
        <div className="flex items-center gap-2 text-xs text-theme-muted">
          {entry.service && <span>{entry.service}</span>}
          {entry.service && entry.has_username && <span className="opacity-30">|</span>}
          {entry.has_username && <span>Has credentials</span>}
        </div>
      </div>

      <div className="text-xs text-theme-muted/60 hidden sm:block">{timeAgo(entry.updated_at)}</div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onToggleFavorite(entry.id, entry.favorite)}
          className={clsx("p-1.5 rounded-lg transition-all", entry.favorite ? "text-amber-400 hover:text-amber-300" : "text-theme-muted hover:text-amber-400")}
          title="Toggle favorite"
        >
          <Star className={clsx("w-3.5 h-3.5", entry.favorite && "fill-current")} />
        </button>
        <button onClick={() => onEdit(entry.id)} className="p-1.5 rounded-lg text-theme-muted hover:text-primary transition-all" title="Edit">
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(entry.id)} className="p-1.5 rounded-lg text-theme-muted hover:text-red-400 transition-all" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail View
// ─────────────────────────────────────────────────────────────────────────────

interface DetailViewProps {
  entry: VaultEntry;
  onClose: () => void;
  onEdit: () => void;
}

function DetailView({ entry, onClose, onEdit }: DetailViewProps) {
  const [showPw, setShowPw] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const cat = CATEGORY_CONFIG[entry.category] || CATEGORY_CONFIG.other;
  const Icon = cat.icon;

  const handleCopy = async (field: string, value: string) => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const FieldRow = ({ label, value, secret, field }: { label: string; value?: string | null; secret?: boolean; field: string }) => {
    if (!value) return null;
    const displayed = secret && !showPw ? maskPassword(value) : value;
    return (
      <div className="flex items-start gap-3 py-2">
        <span className="text-xs font-semibold text-theme-muted w-24 pt-0.5 flex-shrink-0">{label}</span>
        <span className="flex-1 text-sm text-theme-fg font-mono break-all">{displayed}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {secret && (
            <button onClick={() => setShowPw(!showPw)} className="p-1 rounded-lg text-theme-muted hover:text-theme-fg transition-colors">
              {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
          <button
            onClick={() => handleCopy(field, value)}
            className={clsx("p-1 rounded-lg transition-colors", copiedField === field ? "text-emerald-400" : "text-theme-muted hover:text-theme-fg")}
          >
            {copiedField === field ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-theme-bg border border-theme rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={clsx("p-2.5 rounded-xl bg-theme-hover", cat.color)}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-theme-fg">{entry.name}</h3>
              <div className="flex items-center gap-2 text-xs text-theme-muted">
                <span className={cat.color}>{cat.label}</span>
                {entry.service && (
                  <>
                    <span className="opacity-30">|</span>
                    <span>{entry.service}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-2 rounded-lg text-theme-muted hover:text-primary hover:bg-theme-hover transition-all">
              <Edit3 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="border-t border-theme pt-3 space-y-0.5">
          <FieldRow label="URL" value={entry.url} field="url" />
          <FieldRow label="Username" value={entry.username} field="username" />
          <FieldRow label="Password" value={entry.password} secret field="password" />
          <FieldRow label="Notes" value={entry.notes} field="notes" />
          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
            <div className="py-2">
              <span className="text-xs font-semibold text-theme-muted block mb-1">Metadata</span>
              <pre className="text-xs text-theme-fg bg-theme-hover rounded-xl p-3 font-mono overflow-auto max-h-32">
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {entry.tags && entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-3 border-t border-theme mt-3">
            {entry.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 rounded-lg bg-theme-hover text-xs text-theme-muted font-medium">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-theme-muted/60 pt-3 border-t border-theme mt-3">
          <span>Created {timeAgo(entry.created_at)}</span>
          <span>Updated {timeAgo(entry.updated_at)}</span>
          {entry.last_used_at && <span>Used {timeAgo(entry.last_used_at)}</span>}
        </div>

        {entry.url && (
          <button
            onClick={() => window.desktopAPI?.openExternal?.(entry.url!)}
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-theme text-theme-muted hover:text-primary hover:border-primary/30 transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open URL
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Vault View
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Password Gate
// ─────────────────────────────────────────────────────────────────────────────

function PasswordGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setVerifying(true);
    setError("");
    try {
      const res = await window.desktopAPI?.securityVerifyPassword?.(password);
      if (res?.ok && res.valid) {
        onUnlocked();
      } else {
        setError("Incorrect password");
        setPassword("");
      }
    } catch {
      setError("Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full py-20">
      <div className="bg-theme-card border border-theme rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="p-4 rounded-2xl bg-primary/10 mb-3">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-bold text-theme-fg">Vault Locked</h3>
          <p className="text-xs text-theme-muted mt-1 text-center">Enter your security password to access credentials.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password..."
            autoFocus
            className="w-full bg-theme-hover border border-theme rounded-xl px-4 py-3 text-sm text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all text-center"
          />
          {error && <p className="text-xs text-red-400 text-center font-medium">{error}</p>}
          <button
            type="submit"
            disabled={!password || verifying}
            className="w-full px-4 py-3 rounded-xl text-sm font-bold bg-primary text-primary-fg hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {verifying ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Shield className="w-4 h-4" />}
            Unlock Vault
          </button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Vault View (with password gate)
// ─────────────────────────────────────────────────────────────────────────────

export function VaultView() {
  // Password gate state
  const [securityLoading, setSecurityLoading] = useState(true);
  const [vaultLocked, setVaultLocked] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  // Check if vault lock is enabled
  useEffect(() => {
    (async () => {
      try {
        const res = await window.desktopAPI?.securityGetSettings?.();
        if (res?.ok && res.settings) {
          const locked = res.settings.vault_lock_enabled && res.settings.has_password;
          setVaultLocked(locked);
          setHasPassword(res.settings.has_password);
          if (!locked) setUnlocked(true);
        } else {
          setUnlocked(true);
        }
      } catch {
        setUnlocked(true);
      } finally {
        setSecurityLoading(false);
      }
    })();
  }, []);

  // Show password gate if locked
  if (securityLoading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (vaultLocked && !unlocked) {
    return <PasswordGate onUnlocked={() => setUnlocked(true)} />;
  }

  return <VaultContent />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vault Content (after unlock)
// ─────────────────────────────────────────────────────────────────────────────

function VaultContent() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<VaultEntry | null>(null);
  const [viewingEntry, setViewingEntry] = useState<VaultEntry | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    try {
      const res = await window.desktopAPI?.vaultList?.({
        search: search || undefined,
        category: categoryFilter || undefined,
        favorites_only: favoritesOnly,
      });
      if (res?.ok) {
        setEntries(res.entries || []);
        setTotal(res.total || 0);
      }
    } catch (e) {
      console.error("[vault] loadEntries error:", e);
    }
  }, [search, categoryFilter, favoritesOnly]);

  const loadStats = useCallback(async () => {
    try {
      const res = await window.desktopAPI?.vaultStats?.();
      if (res?.ok) {
        setStats({
          total: res.total || 0,
          by_category: res.by_category || {},
          favorites: res.favorites || 0,
          categories: res.categories || [],
        });
      }
    } catch (e) {
      console.error("[vault] loadStats error:", e);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadEntries(), loadStats()]).finally(() => setLoading(false));
  }, [loadEntries, loadStats]);

  const handleAdd = async (data: any) => {
    const res = await window.desktopAPI?.vaultAdd?.(data);
    if (res?.ok) {
      setShowForm(false);
      loadEntries();
      loadStats();
    }
  };

  const handleEdit = async (id: string) => {
    const res = await window.desktopAPI?.vaultGet?.(id);
    if (res?.ok && res.entry) {
      setEditingEntry(res.entry as VaultEntry);
      setEditingId(id);
    }
  };

  const handleUpdate = async (data: any) => {
    if (!editingId) return;
    const res = await window.desktopAPI?.vaultUpdate?.(editingId, data);
    if (res?.ok) {
      setEditingId(null);
      setEditingEntry(null);
      loadEntries();
      loadStats();
      // Refresh detail view if open
      if (viewingEntry?.id === editingId) {
        const fresh = await window.desktopAPI?.vaultGet?.(editingId);
        if (fresh?.ok && fresh.entry) setViewingEntry(fresh.entry as VaultEntry);
      }
    }
  };

  const handleView = async (id: string) => {
    const res = await window.desktopAPI?.vaultGet?.(id);
    if (res?.ok && res.entry) {
      setViewingEntry(res.entry as VaultEntry);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await window.desktopAPI?.vaultDelete?.(id);
    if (res?.ok) {
      setDeleteConfirmId(null);
      if (viewingEntry?.id === id) setViewingEntry(null);
      loadEntries();
      loadStats();
    }
  };

  const handleToggleFavorite = async (id: string, current: boolean) => {
    await window.desktopAPI?.vaultUpdate?.(id, { favorite: !current });
    loadEntries();
    loadStats();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-6 border-b border-theme/50 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-stuard text-theme-fg tracking-tight mb-1 flex items-center gap-2">
              <Shield className="w-6 h-6 text-primary" />
              Security Vault
            </h3>
            <p className="text-sm text-theme-muted font-medium">
              Encrypted credential storage for passwords, API keys, and secrets.
              {stats && <span className="ml-1 opacity-60">({stats.total} entries)</span>}
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2.5 rounded-xl text-sm font-bold bg-primary text-primary-fg hover:opacity-90 transition-all flex items-center gap-2 shadow-primary/20 shadow-md"
          >
            <Plus className="w-4 h-4" />
            Add Credential
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-theme-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className="w-full bg-theme-hover border border-theme rounded-xl pl-9 pr-3 py-2.5 text-sm text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/50 transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search credentials..."
          />
        </div>

        <button
          onClick={() => setFavoritesOnly(!favoritesOnly)}
          className={clsx(
            "p-2.5 rounded-xl border transition-all",
            favoritesOnly ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-theme-hover border-theme text-theme-muted hover:text-amber-400"
          )}
          title="Favorites only"
        >
          <Star className={clsx("w-4 h-4", favoritesOnly && "fill-current")} />
        </button>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setCategoryFilter(null)}
          className={clsx(
            "px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
            !categoryFilter ? "bg-primary/10 border-primary/50 text-primary" : "bg-theme-hover border-theme text-theme-muted hover:text-theme-fg"
          )}
        >
          All{stats ? ` (${stats.total})` : ""}
        </button>
        {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
          const count = stats?.by_category?.[key] || 0;
          if (count === 0 && !categoryFilter) return null;
          const Icon = cfg.icon;
          return (
            <button
              key={key}
              onClick={() => setCategoryFilter(categoryFilter === key ? null : key)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5",
                categoryFilter === key ? "bg-primary/10 border-primary/50 text-primary" : "bg-theme-hover border-theme text-theme-muted hover:text-theme-fg"
              )}
            >
              <Icon className="w-3 h-3" />
              {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Shield className="w-12 h-12 text-theme-muted/30 mb-3" />
            <p className="text-sm text-theme-muted font-medium">
              {search || categoryFilter || favoritesOnly ? "No matching credentials found." : "No credentials stored yet."}
            </p>
            {!search && !categoryFilter && !favoritesOnly && (
              <button onClick={() => setShowForm(true)} className="mt-3 text-sm text-primary hover:underline font-bold">
                Add your first credential
              </button>
            )}
          </div>
        ) : (
          entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onView={handleView}
              onEdit={handleEdit}
              onDelete={(id) => setDeleteConfirmId(id)}
              onToggleFavorite={handleToggleFavorite}
            />
          ))
        )}
      </div>

      {/* Encryption notice */}
      <div className="mt-4 pt-3 border-t border-theme flex items-center gap-2 text-xs text-theme-muted/50">
        <Lock className="w-3 h-3" />
        All data encrypted with AES-256-GCM. Keys stored in OS keychain (DPAPI / Keychain / Secret Service).
      </div>

      {/* Add form modal */}
      {showForm && <EntryForm onSave={handleAdd} onCancel={() => setShowForm(false)} />}

      {/* Edit form modal */}
      {editingId && editingEntry && (
        <EntryForm initial={editingEntry} onSave={handleUpdate} onCancel={() => { setEditingId(null); setEditingEntry(null); }} />
      )}

      {/* Detail view modal */}
      {viewingEntry && (
        <DetailView
          entry={viewingEntry}
          onClose={() => setViewingEntry(null)}
          onEdit={() => {
            handleEdit(viewingEntry.id);
            setViewingEntry(null);
          }}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDeleteConfirmId(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-theme-bg border border-red-500/30 rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-theme-fg mb-2 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" />
              Delete Credential
            </h3>
            <p className="text-sm text-theme-muted mb-4">
              This will permanently delete this credential. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 rounded-xl text-sm font-bold border border-theme text-theme-muted hover:text-theme-fg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-red-500 text-white hover:bg-red-600 transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
