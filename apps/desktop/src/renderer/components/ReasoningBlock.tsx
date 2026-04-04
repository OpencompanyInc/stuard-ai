import React, { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { convertLatexDelims, escapeCurrencyDollars } from "../utils/text";

function normalizeMarkdownSpacing(input: string): string {
    const raw = String(input || '').replace(/\r\n/g, '\n');
    const parts = raw.split('```');
    const normalized = parts.map((part, idx) => {
        if (idx % 2 === 1) return part;
        return part
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n');
    });
    return normalized.join('```');
}

interface ReasoningBlockProps {
    text: string;
    isOpen: boolean;
    onToggle: () => void;
    isComplete?: boolean;
    startTime?: number;
    duration?: number;
}

function formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
}

export const ReasoningBlock = ({ text, isOpen, onToggle, isComplete, startTime, duration }: ReasoningBlockProps) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const [elapsed, setElapsed] = useState(duration ?? 0);
    const internalStartRef = useRef<number | null>(null);
    const autoCollapseRef = useRef<NodeJS.Timeout | null>(null);
    const [autoCollapsed, setAutoCollapsed] = useState(false);

    const hasPredefinedDuration = duration !== undefined && duration > 0;

    useEffect(() => {
        if (isComplete || hasPredefinedDuration) return;
        
        if (!internalStartRef.current) {
            internalStartRef.current = startTime || Date.now();
        }
        
        const interval = setInterval(() => {
            const start = internalStartRef.current || Date.now();
            setElapsed((Date.now() - start) / 1000);
        }, 100);
        
        return () => clearInterval(interval);
    }, [isComplete, startTime, hasPredefinedDuration]);

    useEffect(() => {
        if (isComplete && internalStartRef.current && !hasPredefinedDuration) {
            const start = internalStartRef.current;
            setElapsed((Date.now() - start) / 1000);
        }
    }, [isComplete, hasPredefinedDuration]);

    useEffect(() => {
        if (isOpen && !isComplete && !autoCollapsed && text.length > 30) {
            autoCollapseRef.current = setTimeout(() => {
                onToggle();
                setAutoCollapsed(true);
            }, 4000);
        }
        return () => { if (autoCollapseRef.current) clearTimeout(autoCollapseRef.current); };
    }, [isOpen, isComplete, autoCollapsed, text, onToggle]);

    useEffect(() => {
        if (isOpen && contentRef.current && !isComplete) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }, [text, isOpen, isComplete]);

    if (!text) return null;

    const handleToggle = () => {
        if (autoCollapseRef.current) {
            clearTimeout(autoCollapseRef.current);
            autoCollapseRef.current = null;
        }
        onToggle();
    };

    const headerLabel = isComplete
        ? `Thought for ${formatDuration(elapsed)}`
        : `Thinking ${formatDuration(elapsed)}`;

    return (
        <div className="mb-2">
            <button
                onClick={handleToggle}
                className="group flex items-center gap-1.5 py-1 text-[12px] transition-colors select-none"
                style={{ color: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 80%, transparent)' }}
            >
                <ChevronRight
                    className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                    style={{ color: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 50%, transparent)' }}
                />
                <span>{headerLabel}</span>
                {!isComplete && (
                    <span
                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 60%, transparent)' }}
                    />
                )}
            </button>

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
                            className="mt-1 pl-4 max-h-36 overflow-y-auto scrollbar-none"
                            style={{ borderLeft: '1px solid color-mix(in srgb, var(--foreground-muted, #a6a6a6) 18%, transparent)' }}
                        >
                            <div
                                className="text-[12px] leading-relaxed font-light prose prose-sm max-w-none prose-p:my-1 prose-headings:font-semibold prose-headings:text-xs prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[10px] prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:p-2 prose-pre:rounded-md prose-pre:text-[10px]"
                                style={{ color: 'color-mix(in srgb, var(--foreground, #fff) 55%, transparent)' }}
                            >
                                <ReactMarkdown
                                    remarkPlugins={[remarkMath, remarkGfm]}
                                    rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                                >
                                    {normalizeMarkdownSpacing(convertLatexDelims(escapeCurrencyDollars(text)))}
                                </ReactMarkdown>
                                {!isComplete && (
                                    <span
                                        className="inline-block w-[2px] h-3 ml-0.5 animate-[blink_1s_step-end_infinite] align-middle rounded-full"
                                        style={{ backgroundColor: 'color-mix(in srgb, var(--foreground-muted, #a6a6a6) 40%, transparent)' }}
                                    />
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
