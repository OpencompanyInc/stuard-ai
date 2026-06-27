import React, { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";

interface ReasoningBlockProps {
    text: string;
    isOpen: boolean;
    onToggle: () => void;
    isComplete?: boolean;
    startTime?: number; // timestamp when thinking started
}

// Format seconds to human readable
function formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
}

export const ReasoningBlock = ({ text, isOpen, onToggle, isComplete, startTime }: ReasoningBlockProps) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const [elapsed, setElapsed] = useState(0);
    const internalStartRef = useRef<number | null>(null);

    // Track elapsed time
    useEffect(() => {
        if (isComplete) return;
        
        // Use provided startTime or create our own
        if (!internalStartRef.current) {
            internalStartRef.current = startTime || Date.now();
        }
        
        const interval = setInterval(() => {
            const start = internalStartRef.current || Date.now();
            setElapsed((Date.now() - start) / 1000);
        }, 100);
        
        return () => clearInterval(interval);
    }, [isComplete, startTime]);

    // Reset timer when complete
    useEffect(() => {
        if (isComplete && internalStartRef.current) {
            const start = internalStartRef.current;
            setElapsed((Date.now() - start) / 1000);
        }
    }, [isComplete]);

    // Auto-scroll when streaming
    useEffect(() => {
        if (isOpen && contentRef.current && !isComplete) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }, [text, isOpen, isComplete]);

    if (!text) return null;

    return (
        <div className="mb-2">
            {/* Collapsed: Minimal "Thinking for Xs" chip */}
            <button
                onClick={onToggle}
                className="group flex items-center gap-1.5 text-[11px] text-neutral-400 hover:text-neutral-500 transition-colors select-none"
            >
                <ChevronRight 
                    className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} 
                />
                <span className="italic">
                    {isComplete 
                        ? `Thought for ${formatDuration(elapsed)}`
                        : `Thinking for ${formatDuration(elapsed)}`
                    }
                </span>
                {!isComplete && (
                    <span className="w-1 h-1 rounded-full bg-neutral-400 animate-pulse" />
                )}
            </button>

            {/* Expanded: Greyed-out streaming text */}
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="overflow-hidden"
                    >
                        <div
                            ref={contentRef}
                            className="mt-2 pl-4 border-l-2 border-neutral-200 max-h-40 overflow-y-auto custom-scrollbar"
                        >
                            <div className="text-[12px] text-neutral-400 leading-relaxed whitespace-pre-wrap font-light">
                                {text}
                                {/* Blinking cursor while streaming */}
                                {!isComplete && (
                                    <span className="inline-block w-[2px] h-3 bg-neutral-300 ml-0.5 animate-[blink_1s_step-end_infinite] align-middle" />
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
