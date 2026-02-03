import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboarding, type FeatureArea } from './OnboardingContext';
import { 
  Sparkles, 
  X, 
  ChevronRight, 
  ChevronLeft,
  Check,
  Lightbulb,
  BookOpen
} from 'lucide-react';
import { clsx } from 'clsx';
import { AnimatedBackground } from './AnimatedBackground';

// =============================================================================
// FEATURE HIGHLIGHT OVERLAY
// =============================================================================

interface HighlightOverlayProps {
  targetSelector: string;
  children: React.ReactNode;
  onDismiss: () => void;
}

export function FeatureHighlight({ targetSelector, children, onDismiss }: HighlightOverlayProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const updateRect = () => {
      const el = document.querySelector(targetSelector);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setRect(r);
        }
      }
    };

    updateRect();
    const interval = setInterval(updateRect, 200);
    window.addEventListener('resize', updateRect);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', updateRect);
    };
  }, [targetSelector]);

  if (!rect) return null;

  const padding = 8;

  return (
    <div className="fixed inset-0 z-[9998] pointer-events-none">
      {/* Dark overlay with cutout */}
      <svg className="absolute inset-0 w-full h-full">
        <defs>
          <mask id="highlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={rect.left - padding}
              y={rect.top - padding}
              width={rect.width + padding * 2}
              height={rect.height + padding * 2}
              rx="12"
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#highlight-mask)"
          className="pointer-events-auto"
          onClick={onDismiss}
        />
      </svg>

      {/* Highlight ring */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="absolute pointer-events-none"
        style={{
          top: rect.top - padding,
          left: rect.left - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        }}
      >
        <div className="absolute inset-0 rounded-xl border-2 border-white/50 
                      shadow-[0_0_30px_rgba(255,255,255,0.1)] animate-pulse" />
        <div className="absolute inset-0 rounded-xl bg-white/5" />
      </motion.div>

      {/* Content positioned near highlight */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute pointer-events-auto"
        style={{
          top: Math.min(rect.bottom + 20, window.innerHeight - 200),
          left: Math.max(20, Math.min(rect.left, window.innerWidth - 340)),
          width: 320,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}

// =============================================================================
// PROGRESSIVE DISCOVERY CARD
// =============================================================================

interface DiscoveryCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onExplore: () => void;
  onDismiss: () => void;
  area: FeatureArea;
}

export function DiscoveryCard({ 
  title, 
  description, 
  icon, 
  onExplore, 
  onDismiss,
  area 
}: DiscoveryCardProps) {
  // Uniform styling for consistency
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-[#09090b] rounded-xl border border-white/10 p-4 shadow-xl text-white"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center shrink-0 text-white">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-3 h-3 text-white/70" />
            <span className="text-[10px] uppercase tracking-wider text-white/50 font-medium">
              New Feature
            </span>
          </div>
          <h4 className="font-medium text-white text-sm mb-1">{title}</h4>
          <p className="text-white/50 text-xs leading-relaxed">{description}</p>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={onDismiss}
          className="flex-1 py-2 rounded-lg bg-white/5 text-white/60 text-xs 
                   hover:bg-white/10 hover:text-white transition-colors border border-white/5"
        >
          Maybe later
        </button>
        <button
          onClick={onExplore}
          className="flex-1 py-2 rounded-lg bg-white text-black text-xs font-medium
                   hover:bg-white/90 transition-colors flex items-center justify-center gap-1"
        >
          Explore
          <ChevronRight size={12} />
        </button>
      </div>
    </motion.div>
  );
}

// =============================================================================
// ONBOARDING COMPLETION CELEBRATION
// =============================================================================

export function OnboardingComplete({ onClose }: { onClose: () => void }) {
  const [showConfetti, setShowConfetti] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center px-6">
      {/* Subtle confetti effect */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(20)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ 
                y: -20, 
                x: Math.random() * 500,
                scale: 0,
                rotate: 0 
              }}
              animate={{ 
                y: 700,
                scale: [0, 1, 1, 0.5],
                rotate: 360 + Math.random() * 360
              }}
              transition={{ 
                duration: 2.5 + Math.random() * 2,
                delay: Math.random() * 0.5,
                ease: "easeOut",
                repeat: Infinity,
                repeatDelay: Math.random() * 2
              }}
              className={clsx(
                "absolute w-1.5 h-1.5 rounded-full",
                i % 2 === 0 ? "bg-white" : "bg-white/50",
                "opacity-40"
              )}
            />
          ))}
        </div>
      )}

      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 20 }}
        className="text-center max-w-sm mx-auto relative"
      >
        <motion.div
          initial={{ scale: 0, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, delay: 0.3 }}
          className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-white/5 border border-white/10
                   flex items-center justify-center shadow-lg"
        >
          <Check className="w-8 h-8 text-white/90" strokeWidth={3} />
        </motion.div>

        <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">
          You're All Set!
        </h2>
        <p className="text-white/60 text-sm mb-8 leading-relaxed">
          Stuard is active and running locally.
          <br />
          <span className="opacity-80 mt-2 block">
            Summon with <span className="text-white bg-white/10 px-1.5 py-0.5 rounded border border-white/10 font-mono text-xs">Ctrl + Shift + Space</span>
          </span>
        </p>

        <div className="space-y-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-white text-black font-medium text-sm
                     hover:bg-white/90 transition-all shadow-lg flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Start Working Smarter
          </motion.button>
          
          <p className="text-white/40 text-xs">
            Tip: Type <span className="font-mono text-white/60">/</span> to open commands
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// =============================================================================
// CONTEXTUAL TIP BANNER
// =============================================================================

interface TipBannerProps {
  message: string;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}

export function TipBanner({ message, action, onDismiss }: TipBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] max-w-lg w-[90vw]"
    >
      <div className="bg-[#09090b] border border-white/10 rounded-xl p-3 
                    shadow-2xl flex items-center gap-3 text-white">
        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
          <Lightbulb className="w-4 h-4 text-white/90" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs">{message}</p>
        </div>
        {action && (
          <button
            onClick={action.onClick}
            className="px-3 py-1.5 rounded-lg bg-white/10 text-white 
                     text-xs font-medium hover:bg-white/20 transition-colors shrink-0"
          >
            {action.label}
          </button>
        )}
        <button
          onClick={onDismiss}
          className="p-1.5 rounded-md text-white/40 hover:text-white 
                   hover:bg-white/10 transition-colors shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </motion.div>
  );
}

// =============================================================================
// ONBOARDING SETTINGS PANEL
// =============================================================================

export function OnboardingSettings() {
  const { 
    progress, 
    showTooltips, 
    toggleTooltips, 
    resetOnboarding,
    isActive 
  } = useOnboarding();

  const completedCount = progress.completedSteps.length;
  const totalSteps = 20; // Approximate total

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5">
        <h3 className="font-medium text-white mb-4 flex items-center gap-2 text-sm">
          <BookOpen className="w-4 h-4" />
          Onboarding Progress
        </h3>
        
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-white/50">Tips discovered</span>
            <span className="text-white font-medium">{completedCount} / {totalSteps}</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div 
              className="h-full bg-white transition-all duration-500"
              style={{ width: `${(completedCount / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between py-3 border-t border-white/10">
          <span className="text-white/50 text-xs">Show contextual tips</span>
          <button
            onClick={toggleTooltips}
            className={clsx(
              "w-10 h-5 rounded-full transition-colors relative",
              showTooltips ? "bg-white" : "bg-white/20"
            )}
          >
            <div className={clsx(
              "absolute top-1 w-3 h-3 rounded-full transition-all",
              showTooltips ? "left-6 bg-black" : "left-1 bg-white"
            )} />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <button
          onClick={resetOnboarding}
          disabled={isActive}
          className="w-full py-2.5 rounded-lg border border-white/10 bg-white/5
                   text-white text-xs font-medium hover:bg-white/10 
                   disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                   flex items-center justify-center gap-2"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Restart Onboarding
        </button>

        {isActive && (
          <p className="text-white/40 text-[10px] text-center">
            Onboarding is currently active
          </p>
        )}
      </div>
    </div>
  );
}
