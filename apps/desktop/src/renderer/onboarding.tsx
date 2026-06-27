import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { motion } from "framer-motion";
import "./styles.css";
import { OnboardingProvider } from "./components/onboarding";
import { ConversationalOnboarding } from "./components/onboarding/ConversationalOnboarding";
import { CoachingTour } from "./components/onboarding/CoachingTour";
import { FeaturedWorkflows } from "./components/onboarding/FeaturedWorkflows";
import { StudioIntro } from "./components/onboarding/StudioIntro";
import { usePreferences } from "./hooks/usePreferences";

// Toggle the Electron click-through state based on whether the cursor is over
// an element we want to be interactive. Elements opt in by carrying
// `data-interactive="true"`. Everything else lets mouse events pass to the OS.
function useClickThroughTracker() {
  const ignoringRef = useRef<boolean | null>(null);

  useEffect(() => {
    const api = (window as any).desktopAPI;
    if (!api?.setIgnoreMouseEvents) return;

    const setIgnore = (ignore: boolean) => {
      if (ignoringRef.current === ignore) return;
      ignoringRef.current = ignore;
      if (ignore) api.setIgnoreMouseEvents(true, { forward: true });
      else api.setIgnoreMouseEvents(false);
    };

    const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'A', 'SELECT', 'LABEL']);
    const isInteractive = (el: Element | null): boolean => {
      let cur: Element | null = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        if (INTERACTIVE_TAGS.has(cur.tagName)) return true;
        if ((cur as HTMLElement).dataset?.interactive === 'true') return true;
        cur = cur.parentElement;
      }
      return false;
    };

    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      setIgnore(!isInteractive(el));
    };

    window.addEventListener('mousemove', onMove);
    setIgnore(true);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
}

function OnboardingApp() {
  const { setOnboardingComplete, setTourComplete } = usePreferences();
  useClickThroughTracker();

  // Phases inside this overlay: the welcome scenes, the coaching demo (which
  // replaces the old in-app InteractiveTour), a featured-workflows gallery to
  // get a running start, then a Studio hand-off.
  const [phase, setPhase] = useState<'welcome' | 'coaching' | 'gallery' | 'studio'>('welcome');

  // Welcome "Open Stuard" hands off into the coaching demo — don't close yet.
  const handleWelcomeDone = () => setPhase('coaching');

  // The coaching tour's last step leads into the featured-workflows gallery.
  const handleCoachingDone = () => setPhase('gallery');

  // The gallery (install ready-made workflows) hands off to the Studio intro.
  const handleGalleryDone = () => setPhase('studio');

  // Finish everything → mark complete, reveal + focus the real pill. Coaching IS
  // the tour, so mark tourComplete too and the legacy InteractiveTour won't run.
  const finish = () => {
    setOnboardingComplete(true);
    setTourComplete(true);
    try { (window as any).desktopAPI.show(); } catch {}
    try { (window as any).desktopAPI.closeOnboarding(); } catch {}
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.4, ease: 'easeOut' }}
      className="onboarding-overlay fixed inset-0 z-[10000] overflow-hidden bg-transparent text-white font-stuard pointer-events-none"
    >
      <style>{`
        .onboarding-overlay button,
        .onboarding-overlay input,
        .onboarding-overlay textarea,
        .onboarding-overlay select,
        .onboarding-overlay a,
        .onboarding-overlay label,
        .onboarding-overlay [data-interactive="true"] {
          pointer-events: auto;
        }
      `}</style>
      <div className="h-full w-full">
        {phase === 'welcome' ? (
          <ConversationalOnboarding
            onComplete={handleWelcomeDone}
            onSkip={finish}
          />
        ) : phase === 'coaching' ? (
          <CoachingTour onComplete={handleCoachingDone} onSkip={finish} lastLabel="Next" />
        ) : phase === 'gallery' ? (
          <FeaturedWorkflows onComplete={handleGalleryDone} onSkip={finish} />
        ) : (
          <StudioIntro onComplete={finish} onSkip={finish} />
        )}
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
