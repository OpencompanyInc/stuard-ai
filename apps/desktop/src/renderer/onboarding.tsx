import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { motion, AnimatePresence } from "framer-motion";
import "./styles.css";
import { WelcomeFlow, OnboardingComplete, OnboardingProvider } from "./components/onboarding";
import { usePreferences } from "./hooks/usePreferences";
import { Minus, Sparkles } from "lucide-react";

function OnboardingApp() {
  const { setOnboardingComplete, setTourComplete } = usePreferences();
  const [showComplete, setShowComplete] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        try { (window as any).desktopAPI.closeOnboarding(); } catch {}
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleComplete = () => {
    setShowComplete(true);
  };

  const handleFinish = () => {
    setOnboardingComplete(true);
    setTourComplete(true);
    try { (window as any).desktopAPI.closeOnboarding(); } catch {}
  };

  const handleSkip = () => {
    setOnboardingComplete(true);
    try { (window as any).desktopAPI.closeOnboarding(); } catch {}
  };

  const handleMinimize = () => {
    try { (window as any).desktopAPI.invoke?.('window:minimize'); } catch {}
  };

  return (
    <div className="fixed inset-0 z-[10000] flex flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#09090b] text-white font-stuard shadow-[0_40px_140px_rgba(0,0,0,0.55)]">
      {/* Draggable Title Bar */}
      <div 
        className="flex items-center justify-between border-b border-white/8 bg-white/[0.04] px-5 py-3.5 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-3 select-none">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10">
            <Sparkles className="w-4 h-4 text-white/80" />
          </div>
          <div>
            <div className="text-sm font-medium text-white/85">Stuard Setup</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">Guided first-run</div>
          </div>
        </div>
        
        <div 
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={handleSkip}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            Skip setup
          </button>
          <button
            onClick={handleMinimize}
            className="rounded-xl p-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Minus size={14} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative z-10 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {showComplete ? (
            <motion.div 
              key="complete"
              className="h-full"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <OnboardingComplete onClose={handleFinish} />
            </motion.div>
          ) : (
            <motion.div 
              key="flow"
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <WelcomeFlow 
                onComplete={handleComplete} 
                onSkip={handleSkip}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function OnboardingRoot() {
  return (
    <OnboardingProvider>
      <OnboardingApp />
    </OnboardingProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OnboardingRoot />
  </React.StrictMode>
);
