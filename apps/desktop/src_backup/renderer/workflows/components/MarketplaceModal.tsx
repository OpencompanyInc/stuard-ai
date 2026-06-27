import React, { useState, useEffect, useCallback, useRef } from "react";
import { getMarketplaceApi, MarketplaceWorkflow, MarketplaceCategory, MarketplaceVersion, MarketplaceUpdate } from "../../utils/cloud";
import { supabase } from "../../lib/supabaseClient";
import { Search, Download, Star, Tag, User, Calendar, X, AlertCircle, Loader2, Globe, Check, ChevronRight, Hash, Sparkles, Rocket, Plus, CheckCircle2, Pencil, Trash2, Clock, History, ArrowUpCircle, Package, Lock, Unlock, RefreshCw, ExternalLink, Info, Eye, EyeOff } from "lucide-react";

// Helper to get token from Supabase auth
async function getToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

// Toast notification component
function Toast({ message, type = 'success', onClose }: { message: string; type?: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed bottom-6 right-6 z-[1100] px-4 py-3 rounded-xl shadow-lg border flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-300 ${type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
      }`}>
      {type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-rose-600" />}
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="p-0.5 hover:bg-white/50 rounded">
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
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className={`w-full ${maxWidth} bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200`}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/50">
          <div className="text-[15px] font-semibold text-slate-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[], onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");

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
    <div className="flex flex-wrap gap-2 p-2 border border-slate-300 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 bg-white min-h-[42px] transition-all">
      {tags.map(tag => (
        <span key={tag} className="flex items-center gap-1 pl-2 pr-1 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-md border border-indigo-100 animate-in zoom-in-95 duration-200">
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter(t => t !== tag))}
            className="p-0.5 hover:bg-indigo-100 rounded text-indigo-400 hover:text-indigo-700 transition-colors"
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
        className="flex-1 min-w-[120px] text-sm outline-none bg-transparent placeholder:text-slate-400"
        placeholder={tags.length === 0 ? "Add tags (press Enter)..." : ""}
      />
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
  const [name, setName] = useState(model.name || "");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [tags, setTags] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [fetchingCats, setFetchingCats] = useState(true);

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
            setCategory(found.category || "general");
            if (found.tags) setTags(found.tags);
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

  const handlePublish = async () => {
    if (!name.trim() || !description.trim()) {
      setError("Name and description are required.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Please sign in to publish workflows");

      const api = getMarketplaceApi(() => token);

      const res = await api.publish({
        name,
        description,
        spec: model,
        category,
        tags,
        icon: undefined, // TODO: Add icon picker
        locked,
      });

      if (res.ok) {
        setSuccess(true);
        // Notify via desktopAPI if available
        try { (window as any).desktopAPI?.notify?.('Published!', `${name} is now live on the marketplace.`); } catch { }
        onSuccess();
        // Close after a brief delay to show success state
        setTimeout(() => onClose(), 1200);
      } else {
        setError(res.error || "Failed to publish");
      }
    } catch (e: any) {
      setError(e.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleUnpublish = async () => {
    if (!existingWorkflow) return;
    if (!confirm(`Are you sure you want to unpublish "${existingWorkflow.name}"? This will remove it from the marketplace.`)) return;

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
      <ModalShell title="Published!" onClose={onClose}>
        <div className="p-10 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-6 animate-in zoom-in duration-300">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">Successfully Published!</h3>
          <p className="text-sm text-slate-600 max-w-xs">
            Your workflow "{name}" is now live on the Stuard Marketplace and available for others to discover.
          </p>
        </div>
      </ModalShell>
    );
  }

  // Ownership checking loading state
  if (checkingOwnership) {
    return (
      <ModalShell title="Checking Status..." onClose={onClose}>
        <div className="h-[300px] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      </ModalShell>
    );
  }

  // If already published (and we own it), show the "Manage" screen
  if (existingWorkflow) {
    return (
      <ModalShell title="Manage Published Workflow" onClose={onClose}>
        <div className="p-6 space-y-6">
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-indigo-600 shadow-sm">
              <Globe className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-900 text-lg">{existingWorkflow.name}</h3>
              <p className="text-sm text-slate-500 mt-1 line-clamp-2">{existingWorkflow.description}</p>
              <div className="flex items-center gap-3 mt-3 text-xs text-slate-400 font-medium">
                <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-100">
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
              className="flex items-center justify-between p-4 rounded-xl border border-indigo-100 bg-indigo-50/50 hover:bg-indigo-50 hover:border-indigo-200 text-left group transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <ArrowUpCircle className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold text-indigo-900">Update Workflow</div>
                  <div className="text-xs text-indigo-700/70">Publish a new version with your current changes</div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-indigo-300 group-hover:text-indigo-500" />
            </button>

            <button
              onClick={handleUnpublish}
              disabled={unpublishLoading}
              className="flex items-center justify-between p-4 rounded-xl border border-slate-200 hover:border-rose-200 hover:bg-rose-50/30 text-left group transition-all disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center group-hover:bg-rose-100 group-hover:text-rose-500 transition-colors">
                  {unpublishLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                </div>
                <div>
                  <div className="font-semibold text-slate-900 group-hover:text-rose-700">Unpublish from Marketplace</div>
                  <div className="text-xs text-slate-500 group-hover:text-rose-600/70">Remove this workflow permanently from the store</div>
                </div>
              </div>
            </button>
          </div>
        </div>

        <div className="p-5 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-between gap-3">
          <button
            onClick={() => setExistingWorkflow(null)}
            className="text-xs text-slate-400 hover:text-slate-600 font-medium px-2"
          >
            Publish as new instead
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-white hover:shadow-sm font-medium transition-all"
          >
            Close
          </button>
        </div>
      </ModalShell>
    );
  }

  // STANDARD PUBLISH FORM (for new workflows or "Publish as new")
  return (
    <ModalShell title="Publish to Marketplace" onClose={onClose}>
      <div className="p-6 space-y-6">
        <div className="bg-indigo-50/50 rounded-xl p-4 border border-indigo-100/50">
          <h3 className="text-sm font-semibold text-indigo-900 mb-1">Share your workflow</h3>
          <p className="text-xs text-indigo-700/80 leading-relaxed">
            Publishing makes your workflow available to other users in the Stuard Marketplace.
            Make sure to remove any sensitive API keys or personal data before publishing.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-700 text-sm animate-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Workflow Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm transition-all"
            placeholder="e.g., Email Summarizer"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm min-h-[100px] resize-none transition-all"
            placeholder="Describe what your workflow does, how it works, and any requirements..."
          />
          <div className="flex justify-end">
            <span className="text-xs text-slate-400">{description.length} chars</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Category</label>
            <div className="relative">
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                disabled={fetchingCats}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm bg-white appearance-none pr-8 transition-all"
              >
                <option value="general">General</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <ChevronRight className="w-4 h-4 rotate-90" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Tags</label>
            <TagInput tags={tags} onChange={setTags} />
          </div>
        </div>

        {/* Lock workflow toggle */}
        <div className={`rounded-xl p-4 border transition-all ${locked ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50/50 border-slate-200'}`}>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setLocked(!locked)}
              className={`mt-0.5 w-10 h-6 rounded-full transition-all flex items-center px-1 ${locked ? 'bg-amber-500' : 'bg-slate-300'
                }`}
            >
              <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${locked ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {locked ? <Lock className="w-4 h-4 text-amber-600" /> : <Unlock className="w-4 h-4 text-slate-400" />}
                <span className={`text-sm font-semibold ${locked ? 'text-amber-900' : 'text-slate-700'}`}>
                  {locked ? 'Locked Workflow' : 'Open Workflow'}
                </span>
              </div>
              <p className={`text-xs mt-1 leading-relaxed ${locked ? 'text-amber-700/80' : 'text-slate-500'}`}>
                {locked
                  ? 'Users who download this workflow will not be able to view the code, use AI to modify it, or manually edit it. They can only run the workflow and wait for your updates.'
                  : 'Users can view, modify, and customize this workflow after downloading.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-white hover:shadow-sm font-medium transition-all"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700 font-medium flex items-center gap-2 disabled:opacity-50 transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
          Publish Workflow
        </button>
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
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [category, setCategory] = useState(workflow.category || "general");
  const [tags, setTags] = useState<string[]>(workflow.tags || []);
  const [changelog, setChangelog] = useState("");
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [versions, setVersions] = useState<MarketplaceVersion[]>([]);
  const [fetchingData, setFetchingData] = useState(true);

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

  const handleUpdate = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Please sign in to update workflows");

      const api = getMarketplaceApi(() => token);

      const res = await api.update(workflow.slug, {
        name: name !== workflow.name ? name : undefined,
        description: description !== workflow.description ? description : undefined,
        spec: newSpec,
        category: category !== workflow.category ? category : undefined,
        tags: JSON.stringify(tags) !== JSON.stringify(workflow.tags) ? tags : undefined,
        changelog: changelog.trim() || undefined,
      });

      if (res.ok) {
        setSuccess(true);
        try { (window as any).desktopAPI?.notify?.('Updated!', `${name} v${res.workflow?.version} is now live.`); } catch { }
        onSuccess();
        setTimeout(() => onClose(), 1200);
      } else {
        setError(res.error || "Failed to update");
      }
    } catch (e: any) {
      setError(e.message || "An error occurred");
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
          <h3 className="text-xl font-bold text-slate-900 mb-2">Successfully Updated!</h3>
          <p className="text-sm text-slate-600 max-w-xs">
            Your workflow "{name}" has been updated to a new version and is now live on the marketplace.
          </p>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Update Published Workflow" onClose={onClose}>
      <div className="p-6 space-y-6">
        <div className="bg-amber-50/50 rounded-xl p-4 border border-amber-100/50">
          <h3 className="text-sm font-semibold text-amber-900 mb-1 flex items-center gap-2">
            <ArrowUpCircle className="w-4 h-4" />
            Publishing an Update
          </h3>
          <p className="text-xs text-amber-700/80 leading-relaxed">
            This will create a new version of your workflow. Users who downloaded previous versions will be notified of the update.
            Current version: <span className="font-semibold">{workflow.version}</span>
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-700 text-sm animate-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Workflow Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm transition-all"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm min-h-[100px] resize-none transition-all"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700">What's New (Changelog)</label>
          <textarea
            value={changelog}
            onChange={e => setChangelog(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 text-sm min-h-[80px] resize-none transition-all bg-amber-50/30"
            placeholder="Describe what changed in this update..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Category</label>
            <div className="relative">
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                disabled={fetchingData}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm bg-white appearance-none pr-8 transition-all"
              >
                <option value="general">General</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <ChevronRight className="w-4 h-4 rotate-90" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Tags</label>
            <TagInput tags={tags} onChange={setTags} />
          </div>
        </div>

        {versions.length > 1 && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <History className="w-4 h-4 text-slate-400" />
              Version History
            </label>
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-3 max-h-32 overflow-y-auto">
              {versions.slice(0, 5).map((v, i) => (
                <div key={v.version + i} className={`flex items-center justify-between py-1.5 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono font-semibold ${v.current ? 'text-indigo-600' : 'text-slate-500'}`}>
                      v{v.version}
                    </span>
                    {v.current && (
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">Current</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400">
                    {new Date(v.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-5 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-white hover:shadow-sm font-medium transition-all"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-sm bg-amber-600 text-white hover:bg-amber-700 font-medium flex items-center gap-2 disabled:opacity-50 transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
          Publish Update
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
    if (!confirm(`Are you sure you want to unpublish "${name}"?\n\nThis will:\n• Remove it from the marketplace\n• Users who downloaded it will keep their copies\n• This action cannot be undone`)) {
      return;
    }

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
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <span className="text-sm">Loading your workflows...</span>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-rose-400" />
              </div>
              <div className="text-center">
                <p className="font-medium text-slate-900">Something went wrong</p>
                <p className="text-sm text-slate-500 mt-1">{error}</p>
                <button
                  onClick={loadWorkflows}
                  className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : workflows.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-50 flex items-center justify-center shadow-sm border border-indigo-100">
                <Package className="w-10 h-10 text-indigo-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">No published workflows yet</h3>
                <p className="text-sm text-slate-600 max-w-sm leading-relaxed">
                  Share your workflows with the community! Open a workflow and click "Publish to Marketplace" to get started.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Stats Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <div className="text-2xl font-bold text-slate-900">{workflows.length}</div>
                  <div className="text-xs text-slate-500 font-medium mt-1">Published</div>
                </div>
                <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                  <div className="text-2xl font-bold text-indigo-600">{totalStats.downloads}</div>
                  <div className="text-xs text-indigo-600/70 font-medium mt-1">Total Downloads</div>
                </div>
                <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                  <div className="text-2xl font-bold text-amber-600">{totalStats.ratings}</div>
                  <div className="text-xs text-amber-600/70 font-medium mt-1">Total Reviews</div>
                </div>
              </div>

              <div className="h-px bg-slate-100" />

              <div className="space-y-3">
                {workflows.map(w => {
                  const isExpanded = expandedId === w.id;
                  return (
                    <div
                      key={w.id}
                      className={`bg-white border rounded-xl transition-all overflow-hidden ${
                        w.status === 'published'
                          ? 'border-slate-200 hover:border-indigo-200 hover:shadow-md'
                          : 'border-slate-100 bg-slate-50 opacity-60'
                      }`}
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-4 flex-1 min-w-0">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                              {w.icon ? <span className="text-2xl">{w.icon}</span> : <Globe className="w-6 h-6" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold text-slate-900 truncate">{w.name}</h3>
                                <span className="text-xs font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                  v{w.version}
                                </span>
                                {w.locked && (
                                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                                    <Lock className="w-2.5 h-2.5" /> Locked
                                  </span>
                                )}
                                {w.status !== 'published' && (
                                  <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-medium uppercase">
                                    {w.status}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">{w.description}</p>
                              <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                                <div className="flex items-center gap-1">
                                  <Download className="w-3.5 h-3.5" />
                                  {w.download_count} downloads
                                </div>
                                {w.rating_avg > 0 && (
                                  <div className="flex items-center gap-1 text-amber-600">
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
                              className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
                              title={isExpanded ? "Hide details" : "Show details"}
                            >
                              <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                            {w.status === 'published' && onUpdateWorkflow && (
                              <button
                                onClick={() => onUpdateWorkflow(w)}
                                className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-colors"
                                title="Push an update"
                              >
                                <ArrowUpCircle className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(w.slug, w.name)}
                              disabled={deletingSlug === w.slug}
                              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition-colors disabled:opacity-50"
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
                        <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50/50 animate-in slide-in-from-top-2 duration-200">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Category</div>
                              <div className="text-sm text-slate-700 capitalize">{w.category || 'General'}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Slug</div>
                              <div className="text-xs font-mono text-slate-500 bg-white px-2 py-1 rounded border border-slate-200 truncate">{w.slug}</div>
                            </div>
                            {w.tags && w.tags.length > 0 && (
                              <div className="col-span-2">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Tags</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {w.tags.map(tag => (
                                    <span key={tag} className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="col-span-2">
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Description</div>
                              <p className="text-sm text-slate-600 leading-relaxed">{w.description}</p>
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
          <h3 className="text-xl font-bold text-slate-900 mb-2">Successfully Updated!</h3>
          <p className="text-sm text-slate-600 max-w-xs">
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
        <div className="bg-gradient-to-r from-indigo-50 to-violet-50 rounded-xl p-5 border border-indigo-100">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-white border border-indigo-200 flex items-center justify-center text-indigo-600 shadow-sm">
              <ArrowUpCircle className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-slate-900 text-lg">{update.name}</h3>
              <p className="text-sm text-slate-600 mt-1">
                A new version is available from the Marketplace
              </p>
              <div className="flex items-center gap-4 mt-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Current:</span>
                  <span className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                    v{update.currentVersion}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300" />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Latest:</span>
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
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
          </div>
        ) : (
          <>
            {changelog && (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  What's New
                </label>
                <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-4">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {changelog}
                  </p>
                </div>
              </div>
            )}

            {/* Version History */}
            {versions.length > 1 && (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <History className="w-4 h-4 text-slate-400" />
                  Version History
                </label>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3 max-h-40 overflow-y-auto">
                  {versions.slice(0, 6).map((v, i) => (
                    <div key={v.version + i} className={`flex items-center justify-between py-2 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${
                          v.current ? 'bg-emerald-100 text-emerald-700' :
                          v.version === update.currentVersion ? 'bg-slate-200 text-slate-600' : 'text-slate-500'
                        }`}>
                          v{v.version}
                        </span>
                        {v.current && (
                          <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">Latest</span>
                        )}
                        {v.version === update.currentVersion && (
                          <span className="text-[10px] bg-slate-300 text-slate-600 px-1.5 py-0.5 rounded font-medium">Your version</span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">
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
        <div className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <Info className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-500 leading-relaxed">
            Updating will replace your current workflow with the latest version from the Marketplace.
            Any local changes you've made may be overwritten.
          </p>
        </div>
      </div>

      <div className="p-5 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-white hover:shadow-sm font-medium transition-all"
        >
          Not Now
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={loading}
          className="px-5 py-2 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700 font-medium flex items-center gap-2 disabled:opacity-50 transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0"
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
  return (
    <button
      onClick={onClick}
      className="flex flex-col text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-100/50 transition-all group h-full relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="bg-indigo-50 text-indigo-600 rounded-lg p-1">
          <ChevronRight className="w-4 h-4" />
        </div>
      </div>

      <div className="flex items-start justify-between w-full mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm group-hover:scale-105 transition-transform duration-300">
            {workflow.icon ? <span className="text-2xl">{workflow.icon}</span> : <Globe className="w-6 h-6" />}
          </div>
          <div>
            <div className="font-semibold text-slate-900 line-clamp-1 group-hover:text-indigo-600 transition-colors">
              {workflow.name}
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
              <User className="w-3 h-3" />
              {workflow.publisher_name}
            </div>
          </div>
        </div>
      </div>

      <p className="text-sm text-slate-600 line-clamp-2 mb-4 flex-1 leading-relaxed">
        {workflow.description}
      </p>

      <div className="flex items-center justify-between w-full pt-3 border-t border-slate-50 mt-auto">
        <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
          {workflow.rating_avg > 0 && (
            <div className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
              <Star className="w-3 h-3 fill-current" />
              {Number(workflow.rating_avg).toFixed(1)}
            </div>
          )}
          <div className="flex items-center gap-1" title={`${workflow.download_count} downloads`}>
            <Download className="w-3.5 h-3.5" />
            {workflow.download_count}
          </div>
        </div>
        {workflow.category && (
          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full">
            {workflow.category}
          </div>
        )}
      </div>
    </button>
  );
}

function WorkflowDetail({
  workflow,
  onBack,
  onImport,
  onRate
}: {
  workflow: MarketplaceWorkflow;
  onBack: () => void;
  onImport: (w: MarketplaceWorkflow) => void;
  onRate: (rating: number, review?: string) => Promise<void>;
}) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [isRating, setIsRating] = useState(false);
  const [importing, setImporting] = useState(false);

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
    <div className="flex flex-col h-full bg-slate-50/30">
      <div className="p-6 border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
        <button
          onClick={onBack}
          className="text-xs font-medium text-slate-500 hover:text-slate-800 mb-6 flex items-center gap-1 transition-colors"
        >
          <ChevronRight className="w-3 h-3 rotate-180" />
          Back to browsing
        </button>

        <div className="flex items-start justify-between gap-6">
          <div className="flex gap-5">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0 shadow-sm">
              {workflow.icon ? <span className="text-4xl">{workflow.icon}</span> : <Globe className="w-10 h-10" />}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{workflow.name}</h2>
              <div className="flex items-center gap-5 mt-3 text-sm text-slate-600">
                <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-full text-xs font-medium">
                  <User className="w-3.5 h-3.5" />
                  {workflow.publisher_name}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Download className="w-3.5 h-3.5" />
                  {workflow.download_count} downloads
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                  <Calendar className="w-3.5 h-3.5" />
                  {new Date(workflow.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleImport}
            disabled={importing}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold shadow-lg shadow-indigo-200 flex items-center gap-2.5 transition-all active:scale-95 disabled:opacity-70 hover:-translate-y-0.5"
          >
            {importing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            Import Workflow
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
            <div className="w-1 h-4 bg-indigo-500 rounded-full" />
            About this workflow
          </h3>
          <p className="text-slate-600 leading-relaxed whitespace-pre-wrap text-sm">{workflow.description}</p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <div className="w-1 h-4 bg-emerald-500 rounded-full" />
              Tags & Category
            </h3>
            <div className="flex flex-wrap gap-2">
              {workflow.category && (
                <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200">
                  {workflow.category}
                </span>
              )}
              {workflow.tags?.map(tag => (
                <span key={tag} className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium border border-indigo-100 flex items-center gap-1.5">
                  <Hash className="w-3 h-3 opacity-50" />
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <div className="w-1 h-4 bg-amber-500 rounded-full" />
              Rate this workflow
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((r) => (
                  <button
                    key={r}
                    onMouseEnter={() => setHoverRating(r)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => handleRate(r)}
                    disabled={isRating}
                    className="p-1 focus:outline-none transition-transform hover:scale-110 active:scale-95"
                  >
                    <Star
                      className={`w-8 h-8 transition-colors ${(hoverRating || rating || Math.round(workflow.rating_avg)) >= r
                          ? "fill-amber-400 text-amber-400"
                          : "text-slate-200"
                        }`}
                    />
                  </button>
                ))}
              </div>
              <div className="text-sm font-medium text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg">
                {workflow.rating_count} ratings
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketplaceBrowser({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (spec: any) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<MarketplaceWorkflow[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [selectedWorkflow, setSelectedWorkflow] = useState<MarketplaceWorkflow | null>(null);
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial data
  useEffect(() => {
    loadCategories();
    loadFeatured();
  }, []);

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
        // Notify
        try { (window as any).desktopAPI?.notify?.('Imported!', `${w.name} has been added to your workflows.`); } catch { }
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

  return (
    <>
      <ModalShell title="Workflow Marketplace" onClose={onClose} maxWidth="max-w-5xl">
        {selectedWorkflow ? (
          <WorkflowDetail
            workflow={selectedWorkflow}
            onBack={() => setSelectedWorkflow(null)}
            onImport={handleImportWorkflow}
            onRate={handleRateWorkflow}
          />
        ) : (
          <div className="flex flex-col h-[70vh]">
            {/* Search Header */}
            <div className="p-5 border-b border-slate-200 bg-white space-y-4 shrink-0">
              <div className="flex gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm shadow-sm transition-all"
                    placeholder="Search for workflows..."
                  />
                </div>
                <div className="relative">
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-sm bg-white shadow-sm min-w-[150px] appearance-none pr-8 cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <option value="all">All Categories</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <ChevronRight className="w-4 h-4 rotate-90" />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                <button
                  onClick={() => { setCategory('all'); setSearch(''); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-all ${category === 'all' && !search ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200 hover:text-indigo-600'}`}
                >
                  All
                </button>
                {categories.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-all ${category === c.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-200 hover:text-indigo-600'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Results Grid */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  <span className="text-sm">{initialLoad ? 'Loading marketplace...' : 'Searching...'}</span>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-rose-400" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-slate-900">Something went wrong</p>
                    <p className="text-sm text-slate-500 mt-1 max-w-xs">{error}</p>
                    <button
                      onClick={loadFeatured}
                      className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              ) : workflows.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  {workflows.map(w => (
                    <WorkflowCard
                      key={w.id}
                      workflow={w}
                      onClick={() => setSelectedWorkflow(w)}
                    />
                  ))}
                </div>
              ) : search.trim() || category !== 'all' ? (
                // Search with no results
                <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                    <Search className="w-8 h-8 text-slate-300" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-slate-900">No workflows found</p>
                    <p className="text-sm mt-1">Try different search terms or browse all categories</p>
                    <button
                      onClick={() => { setSearch(''); setCategory('all'); }}
                      className="mt-4 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-white hover:shadow-sm transition-all"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              ) : (
                // Empty marketplace - encourage publishing
                <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-8">
                  <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-50 flex items-center justify-center shadow-sm border border-indigo-100">
                    <Rocket className="w-12 h-12 text-indigo-500" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">The marketplace is waiting for you!</h3>
                    <p className="text-sm text-slate-600 max-w-md leading-relaxed">
                      Be the first to share your workflows with the community.
                      Create powerful automations and help others save time.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={onClose}
                      className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2"
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