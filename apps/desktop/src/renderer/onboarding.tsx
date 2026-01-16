import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import OnboardingFlow from "./components/onboarding/OnboardingFlow";
import { usePreferences } from "./hooks/usePreferences";

function OnboardingApp() {
  const { onboardingComplete, setTourComplete } = usePreferences();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        try { (window as any).desktopAPI.closeOnboarding(); } catch {}
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (onboardingComplete) {
      try { (window as any).desktopAPI.closeOnboarding(); } catch {}
    }
  }, [onboardingComplete]);

  const handleComplete = () => {
    // When the modal wizard finishes, mark onboarding as done
    // but reset tourComplete so the in-overlay spotlight tour runs.
    try {
      setTourComplete(false);
    } catch {}
    try { (window as any).desktopAPI.closeOnboarding(); } catch {}
  };

  return (
    <OnboardingFlow onComplete={handleComplete} modalOnly={true} />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OnboardingApp />
  </React.StrictMode>
);
