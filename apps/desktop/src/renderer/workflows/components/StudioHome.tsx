/**
 * StudioHome — the Stuard Studio landing hub.
 *
 * Mirrors the compact / launcher / window overlay language: a quiet greeting
 * hero, neutral frosted feature tiles where the brand red only shows on the
 * icon chip + on hover, and a "continue building" recents row. This is the
 * default view when Studio opens (see WorkflowLauncherV2).
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  Layers,
  Plug,
  Plus,
  Store,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useWorkflowTheme } from "../WorkflowThemeContext";
import type { WorkflowItem } from "../types";
import { formatRelativeTime } from "./Skills";
import { fetchInstalledIntegrations } from "../../utils/installedIntegrations";

type StudioView = "workflows" | "agents" | "skills" | "tools" | "marketplace";

interface StudioHomeProps {
  items: WorkflowItem[];
  skillsCount: number;
  greetingName?: string | null;
  onOpenView: (view: StudioView) => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onMarketplace: () => void;
}

interface FeatureTile {
  view: StudioView;
  icon: LucideIcon;
  title: string;
  description: string;
  count?: number;
  cta: string;
}

function greetingFor(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function StudioHome({
  items,
  skillsCount,
  greetingName,
  onOpenView,
  onCreate,
  onSelect,
  onMarketplace,
}: StudioHomeProps) {
  const { isDark } = useWorkflowTheme();
  const [toolsCount, setToolsCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchInstalledIntegrations()
      .then((list) => {
        if (!cancelled) setToolsCount(list.length);
      })
      .catch(() => {
        if (!cancelled) setToolsCount(0);
      });
    const onChanged = () => {
      fetchInstalledIntegrations()
        .then((list) => setToolsCount(list.length))
        .catch(() => {});
    };
    window.addEventListener("stuard:integrations-changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("stuard:integrations-changed", onChanged);
    };
  }, []);

  const recents = useMemo(() => {
    return [...items]
      .filter((it) => it.updatedAt)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, 4);
  }, [items]);

  const headline = greetingName ? `${greetingFor()}, ${greetingName}` : greetingFor();

  const tiles: FeatureTile[] = [
    {
      view: "workflows",
      icon: Layers,
      title: "Workflows",
      description: "Visual, multi-step automations that connect your apps and run on a trigger.",
      count: items.length,
      cta: "Open workflows",
    },
    {
      view: "agents",
      icon: Bot,
      title: "Agents",
      description: "Autonomous bots that handle tasks for you, locally or in the cloud.",
      cta: "Build an agent",
    },
    {
      view: "skills",
      icon: Wand2,
      title: "Skills",
      description: "Reusable behaviors that teach Stuard how to handle a kind of request.",
      count: skillsCount,
      cta: "Open skills",
    },
    {
      view: "tools",
      icon: Plug,
      title: "Custom Tools",
      description: "Connect any HTTP API and surface it to your agents, workflows, and chat.",
      count: toolsCount ?? undefined,
      cta: "Build a tool",
    },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scrollbar-minimal">
      <div className="mx-auto w-full max-w-5xl px-10 pt-14 pb-16">
        {/* Hero */}
        <div className="flex flex-col">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] wf-fg-faint">
            Stuard Studio
          </p>
          <h1 className="mt-3 text-[30px] font-semibold tracking-tight wf-fg leading-tight">
            {headline}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed wf-fg-muted max-w-xl">
            What do you want to build? Design workflows, agents, skills and custom tools — then ship
            them to chat, the cloud, or the community.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onCreate}
              className="wf-primary-btn inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold transition-transform active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              New workflow
            </button>
            <button
              type="button"
              onClick={onMarketplace}
              className="wf-card wf-card-interactive inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium wf-fg"
            >
              <Store className="w-4 h-4 wf-fg-muted" />
              Browse marketplace
            </button>
          </div>
        </div>

        {/* Feature tiles */}
        <div className="mt-9 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.view}
                type="button"
                onClick={() => onOpenView(tile.view)}
                className="wf-feature-tile group relative flex flex-col items-start rounded-[22px] p-6 text-left"
              >
                <div className="relative z-10 flex w-full items-start gap-4">
                  <span className="wf-feature-tile__icon flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px]">
                    <Icon className="w-[22px] h-[22px]" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[16px] font-semibold wf-fg leading-none">{tile.title}</h3>
                      {typeof tile.count === "number" && (
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold wf-fg-muted wf-icon-chip">
                          {tile.count}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-[13px] leading-relaxed wf-fg-muted">{tile.description}</p>
                  </div>
                </div>
                <div className="relative z-10 mt-4 flex items-center gap-1.5 text-[12.5px] font-semibold wf-fg-muted">
                  <span className="transition-colors group-hover:text-[color:var(--wf-accent)]">{tile.cta}</span>
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:text-[color:var(--wf-accent)]" />
                </div>
              </button>
            );
          })}
        </div>

        {/* Marketplace strip */}
        <button
          type="button"
          onClick={onMarketplace}
          className="wf-card wf-card-interactive group mt-4 flex w-full items-center gap-4 rounded-[22px] p-6 text-left"
        >
          <span className="wf-feature-tile__icon flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px]">
            <Store className="w-[22px] h-[22px]" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-semibold wf-fg leading-none">Marketplace</h3>
            <p className="mt-2 text-[13px] leading-relaxed wf-fg-muted">
              Discover and install community-built workflows, skills, and functions.
            </p>
          </div>
          <ArrowRight className="w-4 h-4 shrink-0 wf-fg-faint transition-all group-hover:translate-x-0.5 group-hover:text-[color:var(--wf-accent)]" />
        </button>

        {/* Recents */}
        {recents.length > 0 && (
          <div className="mt-10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold wf-fg">Continue building</h2>
              <button
                type="button"
                onClick={() => onOpenView("workflows")}
                className="inline-flex items-center gap-1 text-[12.5px] font-medium wf-fg-muted transition-colors hover:text-[color:var(--wf-accent)]"
              >
                All workflows
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {recents.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="wf-card wf-card-interactive group flex items-center gap-3.5 rounded-[16px] p-4 text-left"
                >
                  <span className="wf-icon-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] transition-colors group-hover:text-[color:var(--wf-accent)]">
                    <Layers className="w-[18px] h-[18px]" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold wf-fg">
                      {item.name || item.id}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] wf-fg-faint">
                      {item.updatedAt ? `Edited ${formatRelativeTime(item.updatedAt)}` : "Ready"}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 shrink-0 opacity-0 wf-fg-faint transition-all group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:text-[color:var(--wf-accent)]" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
