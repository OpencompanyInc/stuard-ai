import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { motion, AnimatePresence } from "framer-motion";
import "./styles.css";
import { WelcomeFlow, OnboardingComplete, OnboardingProvider } from "./components/onboarding";
import { usePreferences } from "./hooks/usePreferences";
import { X, Minus, Sparkles } from "lucide-react";

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
    <div className="fixed inset-0 z-[10000] flex flex-col overflow-hidden rounded-2xl bg-[#09090b] border border-white/10 text-white font-stuard shadow-2xl">
      {/* Draggable Title Bar */}
      <div 
        className="flex items-center justify-between px-4 py-3 shrink-0 bg-white/5 border-b border-white/5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 select-none">
          <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-white/70" />
          </div>
          <span className="text-sm font-medium text-white/80">Stuard Setup</span>
        </div>
        
        <div 
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={handleMinimize}
            className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleSkip}
            className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 relative z-10 overflow-y-auto custom-scrollbar">
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
