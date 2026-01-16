import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePreferences, TonePreset } from "../../hooks/usePreferences";
import { supabase } from "../../lib/supabaseClient";
import { startBrowserSignIn } from "../../auth/browserSignIn";
import {
  ArrowRight,
  Check,
  Keyboard,
  Mic,
  Paperclip,
  Settings,
  Sparkles,
  X,
  AtSign,
  History,
  LayoutGrid,
  Minimize2,
} from "lucide-react";

type Phase = "modal" | "tour";
type ModalStep = "welcome" | "tone" | "shortcut";
type TourStep = "mentions" | "attachments" | "voice" | "history" | "dashboard" | "collapse" | "done";

interface OnboardingFlowProps {
  onComplete: () => void;
  expanded?: boolean;
  onExpand?: () => void;
  modalOnly?: boolean; // If true, complete after modal phase (for separate window)
  startAtTour?: boolean; // If true, skip modal and start directly at tour phase
}

export default function OnboardingFlow({ onComplete, expanded, onExpand, modalOnly, startAtTour }: OnboardingFlowProps) {
  const { setOnboardingComplete, tone, setTone, customTone, setCustomTone } = usePreferences();
  const [phase, setPhase] = useState<Phase>(startAtTour ? "tour" : "modal");
  const [modalStep, setModalStep] = useState<ModalStep>("welcome");
  const [tourStep, setTourStep] = useState<TourStep>("mentions");
  const [signedIn, setSignedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // Check auth state
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSignedIn(!!data?.session);
      setUserEmail(data?.session?.user?.email ?? null);
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      setUserEmail(session?.user?.email ?? null);
      setSigningIn(false);
    });
    return () => { try { subscription.unsubscribe(); } catch { } };
  }, []);

  // Auto-expand overlay when starting at tour
  useEffect(() => {
    if (startAtTour && !expanded) {
      onExpand?.();
      setTimeout(() => {
        try { (window as any).desktopAPI?.resize?.(520, 230); } catch {}
      }, 100);
    }
  }, [startAtTour, expanded, onExpand]);

  const handleSignIn = async () => {
    setSigningIn(true);
    const res = await startBrowserSignIn();
    if (!res.ok) setSigningIn(false);
  };

  const handleComplete = () => {
    setOnboardingComplete(true);
    onComplete();
  };

  const handleSkip = () => {
    handleComplete();
  };

  const nextModalStep = () => {
    if (modalStep === "welcome") setModalStep("tone");
    else if (modalStep === "tone") setModalStep("shortcut");
    else {
      // Modal complete
      if (modalOnly) {
        // For separate window: just complete, don't go to tour
        handleComplete();
        return;
      }
      // Move to tour phase - auto-expand and go directly to tour
      setPhase("tour");
      setTourStep("mentions"); // Skip "expand" step, start at mentions
      onExpand?.(); // Expand the overlay
      // Resize to compact expanded size for the tour
      setTimeout(() => {
        try { (window as any).desktopAPI?.resize?.(520, 270); } catch {}
      }, 100);
    }
  };

  const nextTourStep = () => {
    if (tourStep === "mentions") setTourStep("attachments");
    else if (tourStep === "attachments") setTourStep("voice");
    else if (tourStep === "voice") setTourStep("history");
    else if (tourStep === "history") setTourStep("dashboard");
    else if (tourStep === "dashboard") setTourStep("collapse");
    else if (tourStep === "collapse") setTourStep("done");
    else handleComplete();
  };

  // Keyboard shortcut display
  const ShortcutKey = ({ children }: { children: React.ReactNode }) => (
    <kbd className="inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1.5 text-sm font-medium bg-white/10 border border-white/20 rounded-lg text-white/90 shadow-sm">
      {children}
    </kbd>
  );

  const modalSteps: ModalStep[] = ["welcome", "tone", "shortcut"];
  const currentModalIndex = modalSteps.indexOf(modalStep);

  // ============ PHASE 1: MODAL ============
  if (phase === "modal") {
    return (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-gradient-to-b from-black/90 via-black/95 to-black/90 backdrop-blur-xl">
        {/* Ambient glow effects - BLUE theme */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/15 rounded-full blur-[120px]" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-500/10 rounded-full blur-[100px]" />
        </div>

        {/* Skip button */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 p-2 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-all"
        >
          <X size={18} />
        </button>

        {/* Progress dots */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
          {modalSteps.map((_, i) => (
            <div
              key={i}
              className={`transition-all duration-300 rounded-full ${
                i === currentModalIndex 
                  ? 'w-8 h-2 bg-blue-500' 
                  : i < currentModalIndex 
                    ? 'w-2 h-2 bg-blue-500/50' 
                    : 'w-2 h-2 bg-white/20'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Modal Step: Welcome & Sign-in */}
          {modalStep === "welcome" && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 w-full max-w-md px-6 text-center"
            >
              {/* Logo/Icon - BLUE */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 15 }}
                className="mx-auto mb-8 w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-600/10 border border-blue-500/30 flex items-center justify-center shadow-[0_0_40px_rgba(59,130,246,0.2)]"
              >
                <Sparkles className="text-blue-400" size={36} />
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-3xl font-bold text-white mb-3"
              >
                Welcome to Stuard
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-white/60 text-base leading-relaxed mb-8"
              >
                Your intelligent system-native assistant. Always ready to help you think, create, and automate.
              </motion.p>

              {/* Auth section */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="space-y-4"
              >
                {signedIn ? (
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                      <Check size={20} />
                    </div>
                    <div className="text-left flex-1 min-w-0">
                      <div className="text-white font-medium text-sm">Signed In</div>
                      <div className="text-white/50 text-xs truncate">{userEmail}</div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleSignIn}
                    disabled={signingIn}
                    className="w-full py-3.5 rounded-xl bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all shadow-lg shadow-white/10 active:scale-[0.98] disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-2"
                  >
                    {signingIn ? (
                      <>
                        <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      "Sign in to sync your data"
                    )}
                  </button>
                )}

                <button
                  onClick={nextModalStep}
                  className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-white font-medium text-sm hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                >
                  {signedIn ? "Continue" : "Continue without signing in"}
                  <ArrowRight size={16} />
                </button>
              </motion.div>
            </motion.div>
          )}

          {/* Modal Step: AI Tone */}
          {modalStep === "tone" && (
            <motion.div
              key="tone"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 w-full max-w-md px-6"
            >
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center mb-6"
              >
                <div className="mx-auto mb-4 w-14 h-14 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Settings className="text-indigo-400" size={28} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">How should I speak?</h2>
                <p className="text-white/50 text-sm">Choose a communication style</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="grid grid-cols-2 gap-2 mb-4"
              >
                {(["concise", "friendly", "formal", "technical", "custom"] as TonePreset[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTone(t)}
                    className={`text-left px-4 py-3 rounded-xl border transition-all duration-200 ${
                      tone === t
                        ? 'border-blue-500/50 bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.15)]'
                        : 'border-white/10 hover:border-white/20 hover:bg-white/5'
                    } ${t === 'custom' ? 'col-span-2' : ''}`}
                  >
                    <div className="text-sm font-medium capitalize text-white flex items-center justify-between">
                      {t}
                      {tone === t && <Check size={14} className="text-blue-400" />}
                    </div>
                    <div className="text-[11px] text-white/50 mt-0.5">
                      {t === 'concise' ? 'Short, direct answers' :
                        t === 'friendly' ? 'Warm, helpful vibe' :
                          t === 'formal' ? 'Professional tone' :
                            t === 'technical' ? 'Detailed & precise' : 'Define your own style'}
                    </div>
                  </button>
                ))}
              </motion.div>

              {tone === 'custom' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mb-4"
                >
                  <input
                    value={customTone}
                    onChange={(e) => setCustomTone(e.target.value)}
                    autoFocus
                    placeholder="e.g. Talk like a pirate, or explain like I'm 5..."
                    className="w-full bg-black/30 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-white/30 border border-white/10 focus:border-blue-500/50 transition-all text-white"
                  />
                </motion.div>
              )}

              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                onClick={nextModalStep}
                className="w-full py-3.5 rounded-xl bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all shadow-lg shadow-white/10 active:scale-[0.98] flex items-center justify-center gap-2"
              >
                Continue
                <ArrowRight size={16} />
              </motion.button>
            </motion.div>
          )}

          {/* Modal Step: Keyboard Shortcut */}
          {modalStep === "shortcut" && (
            <motion.div
              key="shortcut"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 w-full max-w-md px-6 text-center"
            >
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8"
              >
                <div className="mx-auto mb-4 w-14 h-14 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <Keyboard className="text-blue-400" size={28} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Remember This Shortcut</h2>
                <p className="text-white/50 text-sm">Summon Stuard from anywhere</p>
              </motion.div>

              {/* Big keyboard shortcut display */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 20 }}
                className="bg-gradient-to-b from-white/10 to-white/5 border border-white/20 rounded-2xl p-8 mb-6 shadow-2xl"
              >
                <div className="flex items-center justify-center gap-3">
                  <ShortcutKey>Ctrl</ShortcutKey>
                  <span className="text-white/40 text-xl">+</span>
                  <ShortcutKey>Shift</ShortcutKey>
                  <span className="text-white/40 text-xl">+</span>
                  <ShortcutKey>Space</ShortcutKey>
                </div>
                <p className="text-white/40 text-xs mt-4">
                  Works anywhere on your desktop
                </p>
              </motion.div>

              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                onClick={nextModalStep}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold text-sm hover:from-blue-400 hover:to-indigo-500 transition-all shadow-lg shadow-blue-500/30 active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Sparkles size={18} />
                Let's Take a Quick Tour
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ============ PHASE 2: INTERACTIVE TOUR (in-overlay) ============
  const tourSteps: { id: TourStep; targetId?: string; title: string; description: string; icon: React.ReactNode }[] = [
    {
      id: "mentions",
      targetId: "stuard-input-area",
      title: "@ Mentions",
      description: "Type @ to add files or folders as context",
      icon: <AtSign size={20} />,
    },
    {
      id: "attachments",
      targetId: "stuard-attach-btn",
      title: "Attachments",
      description: "Use the + button to attach files or images",
      icon: <Paperclip size={20} />,
    },
    {
      id: "voice",
      targetId: "stuard-mic-btn",
      title: "Voice Mode",
      description: "Press to speak, then click again when you're done — or just say \"Send Stuard\" to send.",
      icon: <Mic size={20} />,
    },
    {
      id: "history",
      targetId: "stuard-history-btn",
      title: "Chat History",
      description: "Access your past conversations here",
      icon: <History size={20} />,
    },
    {
      id: "dashboard",
      targetId: "stuard-dashboard-btn",
      title: "Dashboard",
      description: "Open the full dashboard for settings and workflows",
      icon: <LayoutGrid size={20} />,
    },
    {
      id: "collapse",
      targetId: "stuard-collapse-btn",
      title: "Layout Options",
      description: "Switch between compact bar, tall sidebar, standard, and wide views",
      icon: <Minimize2 size={20} />,
    },
    {
      id: "done",
      title: "All Set!",
      description: "Esc to hide, Ctrl+Shift+Space to summon",
      icon: <Sparkles size={20} />,
    },
  ];

  const currentTourStep = tourSteps.find(s => s.id === tourStep);
  const currentTourIndex = tourSteps.findIndex(s => s.id === tourStep);

  // Tour is in expanded overlay
  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      {/* Spotlight Effect */}
      {currentTourStep?.targetId ? (
        <SpotlightOverlay targetId={currentTourStep.targetId} />
      ) : (
        <div className="absolute inset-0 bg-black/60 pointer-events-none" />
      )}

      {/* Tour Card - Positioned at top with safe margins */}
      <motion.div
        key={tourStep}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="absolute top-4 left-4 right-4 mx-auto pointer-events-auto max-w-[380px] z-20"
      >
        <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-3 shadow-2xl relative overflow-hidden">
          {/* Blue accent line */}
          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
          
          <div className="flex items-start gap-3 pl-2">
            <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
              {currentTourStep?.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-semibold text-sm mb-0.5">{currentTourStep?.title}</h3>
              <p className="text-white/70 text-xs leading-snug">{currentTourStep?.description}</p>
            </div>
          </div>

          {/* Actions Row */}
          <div className="flex items-center justify-between mt-3 pl-2 pt-2 border-t border-white/5">
            <div className="flex gap-1">
              {tourSteps.map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === currentTourIndex ? 'bg-blue-500' : 'bg-white/10'
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSkip}
                className="text-[11px] text-white/40 hover:text-white/70 transition-colors px-2 py-1"
              >
                Skip
              </button>
              <button
                onClick={tourStep === "done" ? handleComplete : nextTourStep}
                className="px-3 py-1 rounded-md bg-blue-600 text-white text-[11px] font-semibold hover:bg-blue-500 transition-colors"
              >
                {tourStep === "done" ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// Component to create a spotlight effect around a target element
function SpotlightOverlay({ targetId }: { targetId: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const updateRect = () => {
      const el = document.getElementById(targetId);
      if (el) {
        const r = el.getBoundingClientRect();
        // Ensure we have valid dimensions
        if (r.width > 0 && r.height > 0) {
          setRect(r);
        }
      }
    };

    // Initial update
    // Small delay to allow layout to settle if coming from resize
    setTimeout(updateRect, 50);
    setTimeout(updateRect, 200);
    
    const interval = setInterval(updateRect, 200);
    window.addEventListener('resize', updateRect);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', updateRect);
    };
  }, [targetId]);

  if (!rect) return <div className="absolute inset-0 bg-black/60 pointer-events-none" />;

  const padding = 4; // Padding around the highlight
  
  // Calculate the 4 rectangles around the target to create the "hole"
  // Top rect
  const topStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: Math.max(0, rect.top - padding),
    background: 'rgba(0,0,0,0.7)',
    pointerEvents: 'none',
  };
  
  // Bottom rect
  const bottomStyle: React.CSSProperties = {
    position: 'absolute',
    top: rect.bottom + padding,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.7)',
    pointerEvents: 'none',
  };
  
  // Left rect
  const leftStyle: React.CSSProperties = {
    position: 'absolute',
    top: Math.max(0, rect.top - padding),
    height: rect.height + padding * 2,
    left: 0,
    width: Math.max(0, rect.left - padding),
    background: 'rgba(0,0,0,0.7)',
    pointerEvents: 'none',
  };
  
  // Right rect
  const rightStyle: React.CSSProperties = {
    position: 'absolute',
    top: Math.max(0, rect.top - padding),
    height: rect.height + padding * 2,
    left: rect.right + padding,
    right: 0,
    background: 'rgba(0,0,0,0.7)',
    pointerEvents: 'none',
  };

  return (
    <>
      <div style={topStyle} />
      <div style={bottomStyle} />
      <div style={leftStyle} />
      <div style={rightStyle} />
      
      {/* Highlight Ring */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="absolute pointer-events-none z-10"
        style={{
          top: rect.top - padding,
          left: rect.left - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        }}
      >
        <div className="absolute inset-0 rounded-lg border-2 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]" />
        <div className="absolute inset-0 rounded-lg bg-blue-500/10 animate-pulse" />
      </motion.div>
    </>
  );
}

