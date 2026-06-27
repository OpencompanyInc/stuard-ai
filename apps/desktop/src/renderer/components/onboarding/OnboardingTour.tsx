import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePreferences } from "../../hooks/usePreferences";
import {
    MessageSquare,
    MousePointer2,
    X
} from "lucide-react";

interface TourStep {
    id: string;
    type: 'modal' | 'overlay';
    targetId?: string;
    title?: string;
    content?: React.ReactNode;
    placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
    requireAuth?: boolean;
}

export default function OnboardingTour({ onComplete }: { onComplete: () => void }) {
    const { setOnboardingComplete } = usePreferences();
    const [stepIndex, setStepIndex] = useState(0);
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

    const next = () => {
        if (stepIndex < steps.length - 1) {
            setStepIndex(s => s + 1);
        } else {
            onComplete();
        }
    };

    const back = () => {
        if (stepIndex > 0) {
            setStepIndex(s => s - 1);
        }
    };

    const skip = () => {
        onComplete();
    };

    const steps: TourStep[] = [
        {
            id: "shortcuts",
            type: "overlay",
            targetId: "stuard-input-area",
            placement: "top",
            title: "Power User Tips",
            content: (
                <div className="space-y-4">
                    <div className="space-y-3">
                        <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-white/5 border border-white/10 shrink-0">
                                <MousePointer2 size={16} className="text-white/90" />
                            </div>
                            <div>
                                <div className="text-white font-medium text-sm">Move Window</div>
                                <div className="text-white/50 text-xs mt-1">Hold <span className="text-white/80">Ctrl</span> + <span className="text-white/80">Arrow Keys</span> to move Stuard around.</div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-white/5 border border-white/10 shrink-0">
                                <MessageSquare size={16} className="text-white/90" />
                            </div>
                            <div>
                                <div className="text-white font-medium text-sm">Mentions</div>
                                <div className="text-white/50 text-xs mt-1">Type <span className="text-white/80">@</span> to mention files, folders, or context.</div>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={next}
                        className="w-full py-2 rounded-lg bg-white text-black text-sm font-bold hover:bg-white/90 transition-all"
                    >
                        Next
                    </button>
                </div>
            )
        },
        {
            id: "first-message",
            type: "overlay",
            targetId: "stuard-input-area",
            placement: "top",
            title: "Let's Start!",
            content: (
                <div className="space-y-4">
                    <p className="text-sm text-white/80">
                        Try saying "Hello" or ask a question to get started.
                    </p>
                    <button
                        onClick={() => {
                            onComplete();
                        }}
                        className="w-full py-2 rounded-lg bg-white text-black text-sm font-bold hover:bg-white/90 transition-all"
                    >
                        Start Chatting
                    </button>
                </div>
            )
        }
    ];

    const currentStep = steps[stepIndex];

    // Update target rect for overlay steps
    useEffect(() => {
        const targetId = currentStep.targetId;
        const type = currentStep.type;

        if (type === 'overlay' && targetId) {
            const updateRect = () => {
                const el = document.getElementById(targetId);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    // Only update if changed significantly to avoid loops
                    setTargetRect(prev => {
                        if (!prev) return rect;
                        if (Math.abs(prev.x - rect.x) < 1 &&
                            Math.abs(prev.y - rect.y) < 1 &&
                            Math.abs(prev.width - rect.width) < 1 &&
                            Math.abs(prev.height - rect.height) < 1) {
                            return prev;
                        }
                        return rect;
                    });
                }
            };
            updateRect();
            window.addEventListener('resize', updateRect);
            const interval = setInterval(updateRect, 500);
            return () => {
                window.removeEventListener('resize', updateRect);
                clearInterval(interval);
            };
        } else {
            setTargetRect(null);
        }
    }, [currentStep.targetId, currentStep.type]);

    // Render Modal Step
    const renderModal = () => (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="w-full max-w-[500px] bg-[#0A0A0A] rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col"
            >
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <h2 className="text-lg font-bold text-white">{currentStep.title}</h2>
                    <button onClick={skip} className="text-white/40 hover:text-white transition-colors"><X size={18} /></button>
                </div>
                <div className="p-6">
                    {currentStep.content}
                </div>
                <div className="px-6 py-4 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
                    <div className="flex gap-1">
                        {steps.map((_, i) => (
                            <div key={i} className={`h-1 rounded-full transition-all ${i === stepIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/10'}`} />
                        ))}
                    </div>
                    <div className="flex gap-2">
                        {stepIndex > 0 && <button onClick={back} className="px-3 py-1.5 rounded-lg text-white/60 hover:bg-white/5">Back</button>}
                        <button
                            onClick={next}
                            className="px-4 py-1.5 rounded-lg bg-white text-black font-medium hover:bg-white/90 disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );

    const renderOverlay = () => {
        if (!targetRect) return null;

        const placement = currentStep.placement || "top";
        const padding = 12;

        const highlightTop = targetRect.top - padding;
        const highlightLeft = targetRect.left - padding;
        const highlightWidth = targetRect.width + padding * 2;
        const highlightHeight = targetRect.height + padding * 2;

        const highlight: React.CSSProperties = {
            position: "fixed",
            top: highlightTop,
            left: highlightLeft,
            width: highlightWidth,
            height: highlightHeight,
        };

        const cardWidth = 320;
        const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
        const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 720;

        let cardTop = placement === "top"
            ? highlightTop - 16 - 160
            : highlightTop + highlightHeight + 16;

        cardTop = Math.max(16, Math.min(cardTop, viewportHeight - 16 - 160));

        let cardLeft = highlightLeft;
        cardLeft = Math.max(16, Math.min(cardLeft, viewportWidth - cardWidth - 16));

        return (
            <div className="fixed inset-0 z-[10000] pointer-events-none">
                <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

                <div
                    className="absolute rounded-xl border border-white/60 bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.1)]"
                    style={highlight}
                />

                <motion.div
                    initial={{ opacity: 0, scale: 0.98, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, y: 8 }}
                    transition={{ duration: 0.2 }}
                    style={{ top: cardTop, left: cardLeft, width: cardWidth }}
                    className="absolute pointer-events-auto bg-[#0A0A0A] border border-white/10 rounded-xl shadow-2xl p-4"
                >
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="text-[11px] font-medium text-white/60 uppercase tracking-wide">Tip</div>
                            {currentStep.title && (
                                <h2 className="text-sm font-semibold text-white mt-1">
                                    {currentStep.title}
                                </h2>
                            )}
                        </div>
                        <button
                            onClick={skip}
                            className="text-white/40 hover:text-white transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <div className="mt-3 text-sm text-white/80">
                        {currentStep.content}
                    </div>
                </motion.div>
            </div>
        );
    };

    return (
        <AnimatePresence mode="wait">
            {currentStep.type === 'modal' ? renderModal() : renderOverlay()}
        </AnimatePresence>
    );
}
