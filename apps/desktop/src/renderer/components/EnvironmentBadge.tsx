import React, { useEffect, useState } from "react";
import { Beaker, Sparkles, FlaskConical } from "lucide-react";

type UpdateChannel = "stable" | "beta" | "staging";

interface UpdateState {
  channel: UpdateChannel;
  currentVersion: string;
}

interface EnvironmentBadgeProps {
  variant?: "overlay" | "dashboard" | "minimal";
  className?: string;
}

const channelConfig = {
  stable: {
    label: "Stable",
    color: "bg-green-500/20 text-green-400 border-green-500/30",
    dashColor: "bg-green-50 text-green-700 border-green-200",
    icon: Sparkles,
    show: false, // Don't show badge for stable (production)
  },
  beta: {
    label: "Beta",
    color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    dashColor: "bg-amber-50 text-amber-700 border-amber-200",
    icon: Beaker,
    show: true,
  },
  staging: {
    label: "Staging",
    color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    dashColor: "bg-purple-50 text-purple-700 border-purple-200",
    icon: FlaskConical,
    show: true,
  },
};

export const EnvironmentBadge: React.FC<EnvironmentBadgeProps> = ({
  variant = "overlay",
  className = "",
}) => {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    // Get initial state
    (window as any).desktopAPI?.updatesGetState?.().then((s: UpdateState) => {
      if (s) setState(s);
    });

    // Listen for state changes
    const unsub = (window as any).desktopAPI?.onUpdatesState?.((s: UpdateState) => {
      if (s) setState(s);
    });

    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  if (!state) return null;

  const channel = state.channel || "stable";
  const config = channelConfig[channel];

  // For stable/production: just show version, no badge
  if (!config.show) {
    if (variant === "minimal") {
      return (
        <span className={`text-[10px] text-neutral-400 ${className}`}>
          v{state.currentVersion}
        </span>
      );
    }
    if (variant === "dashboard") {
      return (
        <span className={`text-[11px] text-neutral-500 ${className}`}>
          v{state.currentVersion}
        </span>
      );
    }
    // overlay: no version shown for stable
    return null;
  }

  const Icon = config.icon;

  if (variant === "minimal") {
    return (
      <div
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${config.color} ${className}`}
        title={`${config.label} v${state.currentVersion}`}
      >
        <Icon className="w-3 h-3" />
        {config.label}
      </div>
    );
  }

  if (variant === "dashboard") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide border ${config.dashColor} ${className}`}
        title={`Running ${config.label} version ${state.currentVersion}`}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{config.label}</span>
        <span className="opacity-60 font-normal">v{state.currentVersion}</span>
      </div>
    );
  }

  // overlay variant
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border backdrop-blur-sm ${config.color} ${className}`}
      title={`${config.label} v${state.currentVersion}`}
    >
      <Icon className="w-3 h-3" />
      <span>{config.label}</span>
    </div>
  );
};

export default EnvironmentBadge;
