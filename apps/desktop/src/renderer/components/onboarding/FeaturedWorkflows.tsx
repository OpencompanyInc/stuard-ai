import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { clsx } from 'clsx';
import { ArrowRight, Check, Download, Layers, Loader2, X } from 'lucide-react';
import { getMarketplaceApi, type MarketplaceWorkflow } from '../../utils/cloud';
import { getValidAccessToken } from '../../auth/authManager';
import { specToDesignerModel } from '../../workflows/utils/conversions';
import { stripWorkspaceBundle, unpackWorkspaceBundle } from '../../workflows/utils/workspaceBundle';

// Onboarding beat — after the compact-pill coaching tour and before the Studio
// hand-off, give the user a running start by letting them install a couple of
// ready-made workflows from the marketplace in one click. This is "use what's
// already there"; StudioIntro that follows is "and you can build your own".

// Keep the list short and digestible — onboarding isn't the full marketplace.
const MAX_SHOWN = 6;

interface Props {
  onComplete: () => void;
  onSkip?: () => void;
}

function readFirstName(): string {
  try {
    const raw = (localStorage.getItem('stuard_user_name') || '').trim();
    return raw ? raw.split(/\s+/)[0] : '';
  } catch {
    return '';
  }
}

// Install a marketplace workflow into the local workflows store. Mirrors the
// MarketplaceModal import path: strip the bundle out of the saved main model,
// then unpack the bundled workspace deps so it runs without manual wiring.
async function installWorkflow(w: MarketplaceWorkflow): Promise<void> {
  const spec = w.spec;
  if (!spec) throw new Error('Workflow has no spec');

  const newId = `flow_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  // Tag with the marketplace slug/version so Studio can later offer updates.
  const tagged = {
    ...spec,
    id: newId,
    locked: w.locked || false,
    marketplaceSlug: w.slug,
    marketplaceVersion: w.version,
  };
  const model = specToDesignerModel(stripWorkspaceBundle(tagged));
  await (window as any).desktopAPI?.workflowsSave?.(newId, JSON.stringify(model, null, 2));
  await unpackWorkspaceBundle(newId, spec);
}

export function FeaturedWorkflows({ onComplete, onSkip }: Props) {
  const firstName = useMemo(readFirstName, []);
  const [workflows, setWorkflows] = useState<MarketplaceWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const completedRef = useRef(false);

  // Advance exactly once — used both by the buttons and by the auto-skip when
  // there's nothing worth showing.
  const finishOnce = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  // Fetch featured (falls back to popular server-side). If it fails or comes
  // back empty, quietly skip this beat instead of stranding the user on an
  // empty screen. A timeout guards against a hung network call so onboarding
  // never gets stuck spinning.
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => { if (!cancelled) finishOnce(); }, 7000);
    (async () => {
      try {
        const token = await getValidAccessToken().catch(() => null);
        const api = getMarketplaceApi(() => token || null);
        const res = await api.getFeatured();
        if (cancelled) return;
        const list = (res?.ok && Array.isArray(res.workflows) ? res.workflows : [])
          .filter((w) => w && w.spec)
          .slice(0, MAX_SHOWN);
        if (list.length === 0) {
          finishOnce();
          return;
        }
        setWorkflows(list);
        setLoading(false);
      } catch {
        if (!cancelled) finishOnce();
      }
    })();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [finishOnce]);

  const handleInstall = useCallback(async (w: MarketplaceWorkflow) => {
    if (installing.has(w.id) || installed.has(w.id)) return;
    setInstalling((prev) => new Set(prev).add(w.id));
    try {
      await installWorkflow(w);
      setInstalled((prev) => new Set(prev).add(w.id));
      // Best-effort: bump the marketplace download counter + confirm.
      try {
        const token = await getValidAccessToken().catch(() => null);
        void getMarketplaceApi(() => token || null).download(w.slug);
      } catch { /* non-blocking */ }
      try { (window as any).desktopAPI?.notify?.('Installed', `${w.name} is ready in your workflows.`); } catch {}
    } catch {
      // Surface failure by clearing the spinner; the row stays installable.
    } finally {
      setInstalling((prev) => { const next = new Set(prev); next.delete(w.id); return next; });
    }
  }, [installing, installed]);

  const installedCount = installed.size;

  const container: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.12 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center px-6 font-stuard text-white">
      <div className="pointer-events-none absolute inset-0 bg-stone-950/70 backdrop-blur-md" aria-hidden />

      {/* skip whole onboarding */}
      {onSkip && (
        <button
          onClick={onSkip}
          className="pointer-events-auto absolute top-7 right-8 inline-flex items-center gap-1.5 rounded-md border border-white/[0.10] bg-stone-950/55 px-3 py-1.5 text-[11px] tracking-[0.08em] uppercase font-medium text-white/55 backdrop-blur-md transition-colors hover:bg-stone-900/65 hover:border-white/[0.20] hover:text-white/80"
        >
          <X size={11} strokeWidth={2} />
          Skip
        </button>
      )}

      {/* The whole card opts into mouse capture so the list scrolls and the
          install buttons stay clickable through the click-through overlay. */}
      <motion.div
        data-interactive="true"
        variants={container}
        initial="hidden"
        animate="show"
        className="pointer-events-auto relative flex max-h-[86vh] w-full max-w-[600px] flex-col rounded-[28px] border border-rose-200/15 bg-stone-950/85 px-8 pt-8 pb-7 shadow-[0_24px_80px_rgba(20,8,12,0.7)] backdrop-blur-xl"
      >
        <motion.p variants={item} className="text-[10px] tracking-[0.18em] uppercase font-semibold text-rose-200/70">
          Get started
        </motion.p>
        <motion.h2 variants={item} className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.01em] text-white">
          {firstName ? `Start with a ready-made workflow, ${firstName}.` : 'Start with a ready-made workflow.'}
        </motion.h2>
        <motion.p variants={item} className="mt-2 max-w-[48ch] text-[14px] font-light leading-relaxed text-white/75">
          Install any of these in one click — they show up in your workflows, ready to run. You can tweak
          them later, or build your own from scratch.
        </motion.p>

        {loading ? (
          <div className="flex h-[280px] flex-col items-center justify-center gap-3 text-white/55">
            <Loader2 className="h-6 w-6 animate-spin text-rose-200/70" />
            <span className="text-[12.5px] font-light">Finding workflows for you…</span>
          </div>
        ) : (
          <div
            className="mt-6 -mr-2 flex-1 space-y-2.5 overflow-y-auto pr-2 onboarding-wf-scroll"
          >
            <AnimatePresence initial={false}>
              {workflows.map((w) => {
                const isInstalling = installing.has(w.id);
                const isInstalled = installed.has(w.id);
                return (
                  <WorkflowRow
                    key={w.id}
                    workflow={w}
                    installing={isInstalling}
                    installed={isInstalled}
                    onInstall={() => void handleInstall(w)}
                  />
                );
              })}
            </AnimatePresence>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3 pt-1">
          <span className="text-[12px] font-light text-white/45">
            {installedCount > 0
              ? `${installedCount} added to your workflows`
              : 'No pressure — you can browse the full marketplace anytime.'}
          </span>
          <button
            onClick={finishOnce}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-rose-300/35 bg-rose-500/15 px-6 py-2.5 text-[13px] font-medium text-rose-50 transition-colors hover:border-rose-300/55 hover:bg-rose-500/25"
          >
            {installedCount > 0 ? 'Continue' : 'Skip for now'}
            <ArrowRight size={14} className="text-rose-100/80" />
          </button>
        </div>
      </motion.div>

      <style>{`
        .onboarding-wf-scroll::-webkit-scrollbar { width: 8px; }
        .onboarding-wf-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.12); border-radius: 8px;
        }
        .onboarding-wf-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}

// Calm neutral list row (per the item-heavy-list convention): the only red on
// the row is the Install action; everything else stays neutral.
function WorkflowRow({
  workflow,
  installing,
  installed,
  onInstall,
}: {
  workflow: MarketplaceWorkflow;
  installing: boolean;
  installed: boolean;
  onInstall: () => void;
}) {
  const blurb = workflow.short_description || workflow.description || '';
  const downloads = workflow.download_count || 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="flex items-center gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5 transition-colors hover:border-white/[0.14] hover:bg-white/[0.035]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-white/[0.08] bg-white/[0.03] text-white/85">
        {workflow.icon ? (
          <span className="text-[20px] leading-none">{workflow.icon}</span>
        ) : (
          <Layers className="h-[18px] w-[18px]" strokeWidth={1.75} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[14px] font-semibold leading-none text-white">{workflow.name}</h3>
        {blurb && (
          <p className="mt-1.5 line-clamp-1 text-[12.5px] font-light leading-snug text-white/60">{blurb}</p>
        )}
        {downloads > 0 && (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] font-light text-white/40">
            <Download className="h-3 w-3" strokeWidth={1.75} />
            {downloads.toLocaleString()} installs
          </p>
        )}
      </div>

      <button
        onClick={onInstall}
        disabled={installing || installed}
        className={clsx(
          'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12.5px] font-medium transition-colors min-w-[92px]',
          installed
            ? 'border-emerald-300/35 bg-emerald-500/10 text-emerald-200 cursor-default'
            : 'border-rose-300/35 bg-rose-500/15 text-rose-50 hover:border-rose-300/55 hover:bg-rose-500/25 disabled:opacity-60',
        )}
      >
        {installed ? (
          <>
            <Check size={13} strokeWidth={2.2} />
            Added
          </>
        ) : installing ? (
          <>
            <Loader2 size={13} className="animate-spin" />
            Adding…
          </>
        ) : (
          <>
            <Download size={13} strokeWidth={1.9} />
            Install
          </>
        )}
      </button>
    </motion.div>
  );
}

export default FeaturedWorkflows;
