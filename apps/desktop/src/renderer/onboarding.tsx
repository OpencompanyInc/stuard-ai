import React from "react";
import ReactDOM from "react-dom/client";
import { motion } from "framer-motion";
import "./styles.css";
import { OnboardingProvider } from "./components/onboarding";
import { InteractiveWelcome } from "./components/onboarding/InteractiveWelcome";
import { usePreferences } from "./hooks/usePreferences";

function OnboardingApp() {
  const { setOnboardingComplete, setTourComplete } = usePreferences();

  const handleComplete = () => {
    setOnboardingComplete(true);
    setTourComplete(true);
    try { (window as any).desktopAPI.closeOnboarding(); } catch {}
  };

  const handleSkip = () => {
    setOnboardingComplete(true);
    try { (window as any).desktopAPI.closeOnboarding(); } catch {}
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.4, ease: 'easeOut' }}
      className="fixed inset-0 z-[10000] overflow-hidden bg-transparent text-white font-stuard"
    >
      <div className="h-full w-full">
        <InteractiveWelcome
          onComplete={handleComplete}
          onSkip={handleSkip}
        />
      </div>
    </motion.div>
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
