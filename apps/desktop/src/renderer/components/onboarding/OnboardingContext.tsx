import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export type OnboardingPhase = 
  | 'welcome'           // Initial welcome + sign in
  | 'persona'           // AI tone/persona selection
  | 'shortcut'          // Keyboard shortcut tutorial
  | 'explore'           // Free exploration with contextual hints
  | 'workflows'         // Workflow builder tutorial
  | 'dashboard'         // Dashboard walkthrough
  | 'complete';         // All done

export type FeatureArea = 
  | 'overlay' 
  | 'chat' 
  | 'workflows' 
  | 'dashboard' 
  | 'planner' 
  | 'memories' 
  | 'automations' 
  | 'settings';

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  targetSelector?: string;
  area: FeatureArea;
  action?: 'click' | 'type' | 'hover' | 'observe';
  actionLabel?: string;
  dismissOnAction?: boolean;
  showOnce?: boolean;
}

export interface UserProgress {
  completedSteps: string[];
  dismissedTips: string[];
  lastActiveArea?: FeatureArea;
  visitCount: Record<FeatureArea, number>;
  firstVisit: Record<FeatureArea, boolean>;
}

interface OnboardingContextValue {
  // State
  isActive: boolean;
  currentPhase: OnboardingPhase;
  currentStep: OnboardingStep | null;
  progress: UserProgress;
  showTooltips: boolean;
  
  // Actions
  startOnboarding: () => void;
  completePhase: (phase: OnboardingPhase) => void;
  nextPhase: () => void;
  skipOnboarding: () => void;
  resetOnboarding: () => void;
  
  // Step management
  showStep: (step: OnboardingStep) => void;
  completeStep: (stepId: string) => void;
  dismissStep: () => void;
  
  // Feature area tracking
  enterArea: (area: FeatureArea) => void;
  leaveArea: (area: FeatureArea) => void;
  
  // Tooltip control
  setShowTooltips: (show: boolean) => void;
  toggleTooltips: () => void;
  
  // Checks
  hasCompletedStep: (stepId: string) => boolean;
  hasDismissedTip: (tipId: string) => boolean;
  isFirstVisit: (area: FeatureArea) => boolean;
}

// =============================================================================
// DEFAULT STEPS BY AREA
// =============================================================================

export const DEFAULT_STEPS: Record<FeatureArea, OnboardingStep[]> = {
  overlay: [
    {
      id: 'overlay_mentions',
      title: 'Add Context',
      description: 'Type @ to mention files, folders, or previous conversations for context.',
      targetSelector: '[data-onboarding="input-area"]',
      area: 'overlay',
      action: 'type',
      actionLabel: 'Try typing @',
      showOnce: true,
    },
    {
      id: 'overlay_attach',
      title: 'Attach Files',
      description: 'Click the + button to attach files, images, or screenshots.',
      targetSelector: '[data-onboarding="attach-btn"]',
      area: 'overlay',
      action: 'click',
      actionLabel: 'Click to attach',
      showOnce: true,
    },
    {
      id: 'overlay_voice',
      title: 'Voice Input',
      description: 'Press the microphone to speak. Say "Send Stuard" when done.',
      targetSelector: '[data-onboarding="mic-btn"]',
      area: 'overlay',
      action: 'click',
      actionLabel: 'Try voice',
      showOnce: true,
    },
    {
      id: 'overlay_expand',
      title: 'Expand for More',
      description: 'Click to expand the overlay for more space and features.',
      targetSelector: '[data-onboarding="expand-btn"]',
      area: 'overlay',
      action: 'click',
      actionLabel: 'Expand',
      showOnce: true,
    },
  ],
  chat: [
    {
      id: 'chat_send',
      title: 'Send Messages',
      description: 'Press Enter to send. Use Shift+Enter for a new line.',
      targetSelector: '[data-onboarding="chat-input"]',
      area: 'chat',
      action: 'type',
      showOnce: true,
    },
    {
      id: 'chat_tools',
      title: 'Tool Results',
      description: 'Stuard can use tools. Watch for cards showing results.',
      targetSelector: '[data-onboarding="tool-result"]',
      area: 'chat',
      action: 'observe',
      showOnce: true,
    },
  ],
  workflows: [
    {
      id: 'workflows_canvas',
      title: 'Visual Builder',
      description: 'Drag and drop nodes to build automations. Connect them with wires.',
      targetSelector: '[data-onboarding="workflow-canvas"]',
      area: 'workflows',
      action: 'observe',
      showOnce: true,
    },
    {
      id: 'workflows_palette',
      title: 'Node Palette',
      description: 'Browse categories or search for nodes to add to your workflow.',
      targetSelector: '[data-onboarding="node-palette"]',
      area: 'workflows',
      action: 'click',
      actionLabel: 'Browse nodes',
      showOnce: true,
    },
    {
      id: 'workflows_ai_assist',
      title: 'AI Assistant',
      description: 'Ask the AI to help build or modify your workflow.',
      targetSelector: '[data-onboarding="ai-assist-btn"]',
      area: 'workflows',
      action: 'click',
      actionLabel: 'Try AI assist',
      showOnce: true,
    },
    {
      id: 'workflows_run',
      title: 'Test & Run',
      description: 'Test your workflow step by step or run it fully.',
      targetSelector: '[data-onboarding="run-btn"]',
      area: 'workflows',
      action: 'click',
      actionLabel: 'Run workflow',
      showOnce: true,
    },
  ],
  dashboard: [
    {
      id: 'dashboard_nav',
      title: 'Navigation',
      description: 'Switch between Overview, History, Planner, and more.',
      targetSelector: '[data-onboarding="sidebar-nav"]',
      area: 'dashboard',
      action: 'click',
      actionLabel: 'Explore tabs',
      showOnce: true,
    },
    {
      id: 'dashboard_overview',
      title: 'Your Overview',
      description: 'See your recent activity, tasks, and quick actions.',
      targetSelector: '[data-onboarding="overview-panel"]',
      area: 'dashboard',
      action: 'observe',
      showOnce: true,
    },
  ],
  planner: [
    {
      id: 'planner_calendar',
      title: 'Unified Planner',
      description: 'View calendar events and tasks together. Drag to reschedule.',
      targetSelector: '[data-onboarding="planner-calendar"]',
      area: 'planner',
      action: 'observe',
      showOnce: true,
    },
    {
      id: 'planner_add',
      title: 'Add Events',
      description: 'Click any time slot to add a new event or task.',
      targetSelector: '[data-onboarding="planner-add-btn"]',
      area: 'planner',
      action: 'click',
      actionLabel: 'Add event',
      showOnce: true,
    },
  ],
  memories: [
    {
      id: 'memories_pinboard',
      title: 'Knowledge Pinboard',
      description: 'Visual map of your saved memories and connections.',
      targetSelector: '[data-onboarding="pinboard-view"]',
      area: 'memories',
      action: 'observe',
      showOnce: true,
    },
    {
      id: 'memories_profile',
      title: 'Your Profile',
      description: 'Store personal info Stuard should remember about you.',
      targetSelector: '[data-onboarding="profile-tab"]',
      area: 'memories',
      action: 'click',
      actionLabel: 'View profile',
      showOnce: true,
    },
  ],
  automations: [
    {
      id: 'automations_list',
      title: 'Your Automations',
      description: 'Manage deployed workflows that run automatically.',
      targetSelector: '[data-onboarding="automations-list"]',
      area: 'automations',
      action: 'observe',
      showOnce: true,
    },
    {
      id: 'automations_deploy',
      title: 'Deploy Workflows',
      description: 'Turn any workflow into a running automation.',
      targetSelector: '[data-onboarding="deploy-btn"]',
      area: 'automations',
      action: 'click',
      actionLabel: 'Deploy',
      showOnce: true,
    },
  ],
  settings: [
    {
      id: 'settings_models',
      title: 'AI Models',
      description: 'Choose which AI models Stuard uses for different tasks.',
      targetSelector: '[data-onboarding="models-section"]',
      area: 'settings',
      action: 'observe',
      showOnce: true,
    },
    {
      id: 'settings_integrations',
      title: 'Integrations',
      description: 'Connect Google, Outlook, GitHub, and more.',
      targetSelector: '[data-onboarding="integrations-section"]',
      area: 'settings',
      action: 'click',
      actionLabel: 'Connect',
      showOnce: true,
    },
  ],
};

// =============================================================================
// STORAGE HELPERS
// =============================================================================

const STORAGE_KEY = 'stuard_onboarding_v2';

function loadProgress(): UserProgress {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {}
  
  return {
    completedSteps: [],
    dismissedTips: [],
    visitCount: {
      overlay: 0, chat: 0, workflows: 0, dashboard: 0,
      planner: 0, memories: 0, automations: 0, settings: 0,
    },
    firstVisit: {
      overlay: true, chat: true, workflows: true, dashboard: true,
      planner: true, memories: true, automations: true, settings: true,
    },
  };
}

function saveProgress(progress: UserProgress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {}
}

// =============================================================================
// CONTEXT PROVIDER
// =============================================================================

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<OnboardingPhase>('welcome');
  const [currentStep, setCurrentStep] = useState<OnboardingStep | null>(null);
  const [progress, setProgress] = useState<UserProgress>(loadProgress);
  const [showTooltips, setShowTooltips] = useState(true);
  const currentAreaRef = useRef<FeatureArea | null>(null);

  // Persist progress changes
  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  const startOnboarding = useCallback(() => {
    setIsActive(true);
    setCurrentPhase('welcome');
    setCurrentStep(null);
  }, []);

  const completePhase = useCallback((phase: OnboardingPhase) => {
    const phaseOrder: OnboardingPhase[] = ['welcome', 'persona', 'shortcut', 'explore', 'workflows', 'dashboard', 'complete'];
    const currentIndex = phaseOrder.indexOf(phase);
    const nextPhase = phaseOrder[currentIndex + 1];
    
    if (nextPhase) {
      setCurrentPhase(nextPhase);
      if (nextPhase === 'complete') {
        setIsActive(false);
      }
    }
  }, []);

  const nextPhase = useCallback(() => {
    completePhase(currentPhase);
  }, [currentPhase, completePhase]);

  const skipOnboarding = useCallback(() => {
    setIsActive(false);
    setCurrentPhase('complete');
    setProgress(prev => ({
      ...prev,
      completedSteps: Object.values(DEFAULT_STEPS).flat().map(s => s.id),
    }));
  }, []);

  const resetOnboarding = useCallback(() => {
    setProgress({
      completedSteps: [],
      dismissedTips: [],
      visitCount: {
        overlay: 0, chat: 0, workflows: 0, dashboard: 0,
        planner: 0, memories: 0, automations: 0, settings: 0,
      },
      firstVisit: {
        overlay: true, chat: true, workflows: true, dashboard: true,
        planner: true, memories: true, automations: true, settings: true,
      },
    });
    setCurrentPhase('welcome');
    setIsActive(true);
  }, []);

  const showStep = useCallback((step: OnboardingStep) => {
    if (!showTooltips) return;
    if (step.showOnce && progress.completedSteps.includes(step.id)) return;
    if (progress.dismissedTips.includes(step.id)) return;
    
    setCurrentStep(step);
  }, [showTooltips, progress]);

  const completeStep = useCallback((stepId: string) => {
    setProgress(prev => ({
      ...prev,
      completedSteps: [...new Set([...prev.completedSteps, stepId])],
    }));
    setCurrentStep(null);
  }, []);

  const dismissStep = useCallback(() => {
    if (currentStep) {
      setProgress(prev => ({
        ...prev,
        dismissedTips: [...new Set([...prev.dismissedTips, currentStep.id])],
      }));
    }
    setCurrentStep(null);
  }, [currentStep]);

  const enterArea = useCallback((area: FeatureArea) => {
    currentAreaRef.current = area;
    
    setProgress(prev => {
      const isFirst = prev.firstVisit[area];
      return {
        ...prev,
        lastActiveArea: area,
        visitCount: {
          ...prev.visitCount,
          [area]: prev.visitCount[area] + 1,
        },
        firstVisit: {
          ...prev.firstVisit,
          [area]: false,
        },
      };
    });

    // Auto-show first step in area if applicable
    const areaSteps = DEFAULT_STEPS[area];
    const firstUncompleted = areaSteps?.find(s => 
      !progress.completedSteps.includes(s.id) && 
      !progress.dismissedTips.includes(s.id)
    );
    
    if (firstUncompleted && isActive && currentPhase === 'explore') {
      // Small delay to let the UI settle
      setTimeout(() => showStep(firstUncompleted), 500);
    }
  }, [progress, isActive, currentPhase, showStep]);

  const leaveArea = useCallback((area: FeatureArea) => {
    if (currentAreaRef.current === area) {
      currentAreaRef.current = null;
    }
    // Don't immediately dismiss - let user see the tip
  }, []);

  const toggleTooltips = useCallback(() => {
    setShowTooltips(prev => !prev);
  }, []);

  const hasCompletedStep = useCallback((stepId: string) => {
    return progress.completedSteps.includes(stepId);
  }, [progress]);

  const hasDismissedTip = useCallback((tipId: string) => {
    return progress.dismissedTips.includes(tipId);
  }, [progress]);

  const isFirstVisit = useCallback((area: FeatureArea) => {
    return progress.firstVisit[area];
  }, [progress]);

  const value: OnboardingContextValue = {
    isActive,
    currentPhase,
    currentStep,
    progress,
    showTooltips,
    startOnboarding,
    completePhase,
    nextPhase,
    skipOnboarding,
    resetOnboarding,
    showStep,
    completeStep,
    dismissStep,
    enterArea,
    leaveArea,
    setShowTooltips,
    toggleTooltips,
    hasCompletedStep,
    hasDismissedTip,
    isFirstVisit,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
}

export function useOnboardingArea(area: FeatureArea) {
  const onboarding = useOnboarding();
  
  useEffect(() => {
    onboarding.enterArea(area);
    return () => onboarding.leaveArea(area);
  }, [area, onboarding]);
  
  return onboarding;
}
