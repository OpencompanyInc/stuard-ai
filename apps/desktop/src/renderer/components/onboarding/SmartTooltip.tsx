import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboarding, type OnboardingStep } from './OnboardingContext';
import { 
  X, 
  ChevronRight, 
  Check, 
  MousePointer, 
  Keyboard, 
  Eye,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { clsx } from 'clsx';

interface SmartTooltipProps {
  step: OnboardingStep;
  onComplete: () => void;
  onDismiss: () => void;
}

export function SmartTooltip({ step, onComplete, onDismiss }: SmartTooltipProps) {
  const [position, setPosition] = useState<{ top: number; left: number; placement: 'top' | 'bottom' | 'left' | 'right' }>({ 
    top: 0, 
    left: 0, 
    placement: 'bottom' 
  });
  const [isVisible, setIsVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Find target element and position tooltip
  useEffect(() => {
    if (!step.targetSelector) {
      setIsVisible(true);
      return;
    }

    const updatePosition = () => {
      const target = document.querySelector(step.targetSelector!);
      if (!target) {
        // Target not found, try again shortly
        setTimeout(updatePosition, 100);
        return;
      }

      const targetRect = target.getBoundingClientRect();
      const tooltipRect = tooltipRef.current?.getBoundingClientRect();
      const tooltipWidth = tooltipRect?.width || 320;
      const tooltipHeight = tooltipRect?.height || 150;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 16;

      // Determine best placement
      let placement: 'top' | 'bottom' | 'left' | 'right' = 'bottom';
      let top = targetRect.bottom + 12;
      let left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;

      // Check if there's room below
      if (top + tooltipHeight > viewportHeight - padding) {
        placement = 'top';
        top = targetRect.top - tooltipHeight - 12;
      }

      // Check horizontal bounds
      if (left < padding) {
        left = padding;
      } else if (left + tooltipWidth > viewportWidth - padding) {
        left = viewportWidth - tooltipWidth - padding;
      }

      // If still off-screen vertically, center it
      if (top < padding) {
        placement = 'bottom';
        top = targetRect.bottom + 12;
      }

      setPosition({ top, left, placement });
      setIsVisible(true);

      // Add highlight to target
      target.setAttribute('data-onboarding-highlight', 'true');
    };

    // Delay to allow UI to settle
    const timer = setTimeout(updatePosition, 300);
    
    const handleResize = () => {
      updatePosition();
    };

    window.addEventListener('resize', handleResize);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      // Remove highlight
      const target = document.querySelector(step.targetSelector!);
      target?.removeAttribute('data-onboarding-highlight');
    };
  }, [step.targetSelector]);

  const getActionIcon = () => {
    switch (step.action) {
      case 'click': return <MousePointer size={14} />;
      case 'type': return <Keyboard size={14} />;
      case 'hover': return <MousePointer size={14} />;
      case 'observe': return <Eye size={14} />;
      default: return <Sparkles size={14} />;
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Backdrop for non-target areas */}
          {step.targetSelector && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9998] pointer-events-none"
              style={{ background: 'rgba(0,0,0,0.3)' }}
            />
          )}

          {/* Tooltip */}
          <motion.div
            ref={tooltipRef}
            initial={{ opacity: 0, y: position.placement === 'top' ? 10 : -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: position.placement === 'top' ? 10 : -10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={clsx(
              "fixed z-[9999] w-[340px] pointer-events-auto",
              "rounded-[28px] border border-white/20",
              "bg-white/10 backdrop-blur-2xl",
              "shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden"
            )}
            style={{ top: position.top, left: position.left }} >
            {/* Gradient header line */}
            <div className="relative h-[2px] bg-gradient-to-r from-transparent via-white/40 to-transparent" />

            <div className="p-5">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white/90" />
                  </div>
                  <h3 className="font-medium text-white text-sm">{step.title}</h3>
                </div>
                <button
                  onClick={onDismiss}
                  className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg 
                           hover:bg-theme-hover transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Description */}
              <p className="text-theme-muted text-[13px] leading-relaxed mb-4">
                {step.description}
              </p>

              {/* Action area */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-theme-muted text-xs">
                  {getActionIcon()}
                  <span className="capitalize">{step.action}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={onDismiss}
                    className="px-3 py-1.5 rounded-lg text-theme-muted text-xs 
                             hover:text-theme-fg hover:bg-theme-hover transition-colors"
                  >
                    Skip
                  </button>
                  {step.action !== 'observe' && step.actionLabel && (
                    <button
                      onClick={onComplete}
                      className="px-3 py-1.5 rounded-lg bg-white/10 text-white 
                               text-xs font-medium hover:bg-white/20 
                               transition-colors flex items-center gap-1.5"
                    >
                      {step.actionLabel}
                      <ArrowRight size={12} />
                    </button>
                  )}
                  {step.action === 'observe' && (
                    <button
                      onClick={onComplete}
                      className="px-3 py-1.5 rounded-lg bg-theme-hover text-theme-fg 
                               text-xs font-medium hover:bg-theme-active 
                               transition-colors flex items-center gap-1.5"
                    >
                      <Check size={12} />
                      Got it
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Arrow pointer */}
            {step.targetSelector && (
              <div
                className={clsx(
                  "absolute w-3 h-3 bg-white/10 border-l border-t border-white/20 rotate-45 backdrop-blur-sm",
                  position.placement === 'bottom' && "-top-1.5 left-1/2 -translate-x-1/2",
                  position.placement === 'top' && "-bottom-1.5 left-1/2 -translate-x-1/2 rotate-[225deg]",
                  position.placement === 'left' && "-right-1.5 top-1/2 -translate-y-1/2 rotate-[135deg]",
                  position.placement === 'right' && "-left-1.5 top-1/2 -translate-y-1/2 -rotate-45"
                )}
              />
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Global tooltip container that renders the current step
export function OnboardingTooltipContainer() {
  const { currentStep, completeStep, dismissStep } = useOnboarding();

  if (!currentStep) return null;

  return (
    <SmartTooltip
      step={currentStep}
      onComplete={() => completeStep(currentStep.id)}
      onDismiss={dismissStep}
    />
  );
}
