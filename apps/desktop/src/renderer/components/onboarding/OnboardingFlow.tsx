import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePreferences, TonePreset } from "../../hooks/usePreferences";
import { supabase } from "../../lib/supabaseClient";
import { startBrowserSignIn } from "../../auth/browserSignIn";
import { MockOverlay } from "./MockOverlay";
import {
  ArrowRight,
  Check,
  Keyboard,
  Mic,
  Settings,
  Sparkles,
  X,
  AtSign,
  Home,
  PanelRight,
  AppWindow,
  Plus,
  Video,
  MessageSquare,
  Zap,
  ExternalLink,
  Play,
  Calendar,
  Mail,
  FileText,
  Globe,
} from "lucide-react";

type Phase = "modal" | "tour";
type ModalStep = "welcome" | "tone" | "shortcut";
type TourStep = "try-input" | "try-attach" | "try-mention" | "layouts" | "shortcuts" | "marketplace" | "done";

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
  const [tourStep, setTourStep] = useState<TourStep>("try-input");
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
      // Move to tour phase
      setPhase("tour");
      setTourStep("try-input");
      // Close the modal window and go to overlay tour
      try { (window as any).desktopAPI?.closeOnboarding?.(); } catch {}
    }
  };

  const nextTourStep = () => {
    if (tourStep === "try-input") setTourStep("try-attach");
    else if (tourStep === "try-attach") setTourStep("try-mention");
    else if (tourStep === "try-mention") setTourStep("layouts");
    else if (tourStep === "layouts") setTourStep("shortcuts");
    else if (tourStep === "shortcuts") setTourStep("marketplace");
    else if (tourStep === "marketplace") setTourStep("done");
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
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[#09090b] backdrop-blur-xl">
        {/* Ambient glow effects - Minimal */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none bg-black/20" />

        {/* Skip button */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all"
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
                  ? 'w-8 h-2 bg-white' 
                  : i < currentModalIndex 
                    ? 'w-2 h-2 bg-white/40' 
                    : 'w-2 h-2 bg-white/10'
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
              {/* Logo/Icon - Minimal */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 15 }}
                className="mx-auto mb-8 w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-lg"
              >
                <Sparkles className="text-white/90" size={36} />
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
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white shrink-0">
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
                    className="w-full py-3.5 rounded-xl bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-2"
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
                <div className="mx-auto mb-4 w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                  <Settings className="text-white/90" size={28} />
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
                        ? 'border-white bg-white text-black'
                        : 'border-white/10 hover:border-white/20 hover:bg-white/5'
                    } ${t === 'custom' ? 'col-span-2' : ''}`}
                  >
                    <div className="text-sm font-medium capitalize flex items-center justify-between">
                      {t}
                      {tone === t && <Check size={14} className="text-black" />}
                    </div>
                    <div className={`text-[11px] mt-0.5 ${tone === t ? 'text-black/60' : 'text-white/50'}`}>
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
                    className="w-full bg-white/5 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-white/30 border border-white/10 focus:border-white/30 transition-all text-white"
                  />
                </motion.div>
              )}

              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                onClick={nextModalStep}
                className="w-full py-3.5 rounded-xl bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
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
                <div className="mx-auto mb-4 w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                  <Keyboard className="text-white/90" size={28} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Remember This Shortcut</h2>
                <p className="text-white/50 text-sm">Summon Stuard from anywhere</p>
              </motion.div>

              {/* Big keyboard shortcut display */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 20 }}
                className="bg-white/5 border border-white/10 rounded-2xl p-8 mb-6 shadow-xl"
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
                className="w-full py-4 rounded-xl bg-white text-black font-bold text-sm hover:bg-white/90 transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
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

  // ============ PHASE 2: INTERACTIVE TOUR ============
  // Marketplace workflows
  const starterWorkflows = [
    { id: 'daily-briefing', name: 'Daily Briefing', desc: 'Morning summary of calendar & tasks', icon: <Calendar className="w-5 h-5" /> },
    { id: 'email-summarizer', name: 'Email Summarizer', desc: 'AI summaries of long emails', icon: <Mail className="w-5 h-5" /> },
    { id: 'meeting-notes', name: 'Meeting Notes', desc: 'Auto-transcribe & summarize meetings', icon: <FileText className="w-5 h-5" /> },
    { id: 'web-research', name: 'Web Research', desc: 'Deep research on any topic', icon: <Globe className="w-5 h-5" /> },
  ];

  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>([]);

  const toggleWorkflow = (id: string) => {
    setSelectedWorkflows(prev => 
      prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id]
    );
  };

  // Tour step configurations
  const tourStepConfig: Record<TourStep, {
    highlight?: string;
    showAttachMenu?: boolean;
    showMentionMenu?: boolean;
    interactive?: boolean;
  }> = {
    'try-input': { highlight: 'input', interactive: true },
    'try-attach': { highlight: 'attach', showAttachMenu: true, interactive: true },
    'try-mention': { highlight: 'input', showMentionMenu: true, interactive: true },
    'layouts': { highlight: 'layouts', interactive: false },
    'shortcuts': { interactive: false },
    'marketplace': { interactive: false },
    'done': { interactive: false },
  };

  const currentConfig = tourStepConfig[tourStep];
  const tourStepsList: TourStep[] = ['try-input', 'try-attach', 'try-mention', 'layouts', 'shortcuts', 'marketplace', 'done'];
  const currentTourIndex = tourStepsList.indexOf(tourStep);

  // Tour content renderer
  const renderTourContent = () => {
    switch (tourStep) {
      case 'try-input':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <MessageSquare size={20} />
              </div>
              <div>
                <h3 className="text-white font-semibold text-base">Try typing something!</h3>
                <p className="text-white/50 text-sm">Click on the input above and type a message</p>
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.08]">
              <p className="text-white/40 text-xs">💡 Try: "What can you help me with?"</p>
            </div>
          </div>
        );

      case 'try-attach':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <Plus size={20} />
              </div>
              <div>
                <h3 className="text-white font-semibold text-base">Attach Files</h3>
                <p className="text-white/50 text-sm">Click the + button to see attachment options</p>
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.08] space-y-1">
              <p className="text-white/40 text-xs">📎 Attach images, documents, or folders</p>
              <p className="text-white/40 text-xs">📋 You can also paste images directly</p>
            </div>
          </div>
        );

      case 'try-mention':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <AtSign size={20} />
              </div>
              <div>
                <h3 className="text-white font-semibold text-base">@ Mentions for Context</h3>
                <p className="text-white/50 text-sm">Type @ to add files or browser tabs as context</p>
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.08]">
              <p className="text-white/40 text-xs">💡 Try typing @ in the input to see the menu</p>
            </div>
          </div>
        );

      case 'layouts':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <PanelRight size={20} />
              </div>
              <div>
                <h3 className="text-white font-semibold text-base">Layout Modes</h3>
                <p className="text-white/50 text-sm">Switch views to fit your workflow</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white/[0.05] rounded-xl p-3 border border-sky-500/30 text-center">
                <PanelRight className="w-6 h-6 mx-auto mb-2 text-sky-400" />
                <p className="text-white text-xs font-medium">Sidebar</p>
                <p className="text-white/40 text-[10px]">Docks to side</p>
              </div>
              <div className="bg-white/[0.05] rounded-xl p-3 border border-white/[0.1] text-center">
                <AppWindow className="w-6 h-6 mx-auto mb-2 text-white/60" />
                <p className="text-white text-xs font-medium">Window</p>
                <p className="text-white/40 text-[10px]">Floating chat</p>
              </div>
              <div className="bg-white/[0.05] rounded-xl p-3 border border-white/[0.1] text-center">
                <Home className="w-6 h-6 mx-auto mb-2 text-white/60" />
                <p className="text-white text-xs font-medium">Dashboard</p>
                <p className="text-white/40 text-[10px]">Full app</p>
              </div>
            </div>
          </div>
        );

      case 'shortcuts':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <Keyboard size={20} />
              </div>
              <div>
                <h3 className="text-white font-semibold text-base">Keyboard Shortcuts</h3>
                <p className="text-white/50 text-sm">Master these for faster access</p>
              </div>
            </div>
            <div className="space-y-2">
              {[
                { keys: ['Ctrl', 'Shift', 'Space'], desc: 'Summon Stuard' },
                { keys: ['Esc'], desc: 'Hide overlay' },
                { keys: ['Ctrl', '/'], desc: 'Command palette' },
                { keys: ['Ctrl', '↑↓←→'], desc: 'Move overlay' },
              ].map((shortcut, i) => (
                <div key={i} className="flex items-center justify-between bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.08]">
                  <span className="text-white/60 text-xs">{shortcut.desc}</span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key, j) => (
                      <React.Fragment key={j}>
                        <kbd className="px-2 py-1 text-[10px] font-medium bg-white/10 border border-white/20 rounded text-white/80">
                          {key}
                        </kbd>
                        {j < shortcut.keys.length - 1 && <span className="text-white/30 text-xs">+</span>}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <a 
              href="#" 
              onClick={(e) => { e.preventDefault(); /* Open settings */ }}
              className="flex items-center gap-1.5 text-sky-400 text-xs hover:text-sky-300 transition-colors"
            >
              Customize shortcuts in Settings <ExternalLink size={12} />
            </a>
          </div>
        );

      case 'marketplace':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <Zap size={20} />
              </div>
              <div>
                <h3 className="text-white font-semibold text-base">Get Started with Workflows</h3>
                <p className="text-white/50 text-sm">Select automations to deploy instantly</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {starterWorkflows.map((wf) => (
                <button
                  key={wf.id}
                  onClick={() => toggleWorkflow(wf.id)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    selectedWorkflows.includes(wf.id)
                      ? 'bg-sky-500/20 border-sky-500/50'
                      : 'bg-white/[0.03] border-white/[0.08] hover:border-white/20'
                  }`}
                >
                  <div className={`mb-2 ${selectedWorkflows.includes(wf.id) ? 'text-sky-400' : 'text-white/50'}`}>
                    {wf.icon}
                  </div>
                  <p className="text-white text-xs font-medium">{wf.name}</p>
                  <p className="text-white/40 text-[10px] leading-tight mt-0.5">{wf.desc}</p>
                  {selectedWorkflows.includes(wf.id) && (
                    <div className="mt-2 flex items-center gap-1 text-sky-400">
                      <Check size={12} />
                      <span className="text-[10px]">Selected</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
            <a 
              href="https://studio.stuard.ai/marketplace" 
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 text-sky-400 text-xs hover:text-sky-300 transition-colors py-2"
            >
              Browse more in Stuard Studio <ExternalLink size={12} />
            </a>
          </div>
        );

      case 'done':
        return (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500/30 to-blue-600/30 border border-sky-500/30 flex items-center justify-center mx-auto">
              <Sparkles className="w-8 h-8 text-sky-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-xl mb-2">You're all set!</h3>
              <p className="text-white/50 text-sm">
                Stuard is ready to help. Press <kbd className="px-1.5 py-0.5 text-[10px] bg-white/10 border border-white/20 rounded">Ctrl+Shift+Space</kbd> anytime to summon.
              </p>
            </div>
            {selectedWorkflows.length > 0 && (
              <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-3">
                <p className="text-sky-400 text-xs">
                  <Check size={12} className="inline mr-1" />
                  {selectedWorkflows.length} workflow{selectedWorkflows.length > 1 ? 's' : ''} will be deployed
                </p>
              </div>
            )}
          </div>
        );
    }
  };

  // Tour UI
  return (
    <div className="fixed inset-0 z-[10000] flex flex-col bg-[#0a0a0f]">
      {/* Skip button */}
      <button
        onClick={handleSkip}
        className="absolute top-4 right-4 p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all z-20"
      >
        <X size={18} />
      </button>

      {/* Main content area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        {/* MockOverlay - only show for relevant steps */}
        {['try-input', 'try-attach', 'try-mention', 'layouts'].includes(tourStep) && (
          <div className="w-full max-w-[560px] mb-8">
            <MockOverlay 
              highlightElement={currentConfig?.highlight}
              interactive={currentConfig?.interactive}
              showAttachMenu={currentConfig?.showAttachMenu}
              showMentionMenu={currentConfig?.showMentionMenu}
              onAction={(action) => {
                // Auto-advance on certain actions
                if (tourStep === 'try-input' && action === 'send') nextTourStep();
                if (tourStep === 'try-attach' && action.startsWith('attach-')) nextTourStep();
                if (tourStep === 'try-mention' && action.startsWith('mention-')) nextTourStep();
              }}
            />
          </div>
        )}

        {/* Tour Card - Fixed position below overlay */}
        <motion.div
          key={tourStep}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25 }}
          className="w-full max-w-[480px]"
        >
          <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl p-5 shadow-2xl backdrop-blur-xl">
            {renderTourContent()}

            {/* Progress & Actions */}
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/[0.08]">
              <div className="flex gap-1.5">
                {tourStepsList.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === currentTourIndex 
                        ? 'w-6 bg-sky-500' 
                        : i < currentTourIndex 
                          ? 'w-1.5 bg-sky-500/50' 
                          : 'w-1.5 bg-white/10'
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSkip}
                  className="text-xs text-white/40 hover:text-white/70 transition-colors px-3 py-1.5"
                >
                  Skip
                </button>
                <button
                  onClick={tourStep === "done" ? handleComplete : nextTourStep}
                  className="px-4 py-2 rounded-xl bg-sky-500 text-white text-xs font-semibold hover:bg-sky-400 transition-all active:scale-[0.98] flex items-center gap-1.5"
                >
                  {tourStep === "done" ? (
                    <>
                      <Play size={14} />
                      Get Started
                    </>
                  ) : (
                    <>
                      Next
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Step indicator */}
      <div className="pb-6 text-center text-white/30 text-xs">
        Step {currentTourIndex + 1} of {tourStepsList.length}
      </div>
    </div>
  );
}
