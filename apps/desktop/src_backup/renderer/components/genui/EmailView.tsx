
import React, { useState } from 'react';
import { Mail, Send, X, Paperclip, Minimize2, Maximize2, MoreHorizontal, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

interface EmailViewProps {
    to?: string;
    from?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
    attachments?: string[];
    isDraft?: boolean;
    onSend?: (data: any) => void;
    onCancel?: () => void;
    readOnly?: boolean;
}

export const EmailView: React.FC<EmailViewProps> = ({
    to: initialTo = '',
    from = 'me@example.com',
    cc: initialCc = '',
    bcc: initialBcc = '',
    subject: initialSubject = '',
    body: initialBody = '',
    attachments: initialAttachments = [],
    isDraft = false,
    onSend,
    onCancel,
    readOnly = false
}) => {
    const [to, setTo] = useState(initialTo);
    const [cc, setCc] = useState(initialCc);
    const [bcc, setBcc] = useState(initialBcc);
    const [subject, setSubject] = useState(initialSubject);
    const [body, setBody] = useState(initialBody);
    const [isSending, setIsSending] = useState(false);
    const [isSent, setIsSent] = useState(false);
    const [isExpanded, setIsExpanded] = useState(true);
    const [showCc, setShowCc] = useState(!!initialCc || !!initialBcc);
    const [attachments] = useState(initialAttachments);

    const handleSend = async () => {
        if (readOnly) return;
        setIsSending(true);
        // Simulate network delay for effect
        await new Promise(resolve => setTimeout(resolve, 1200));
        onSend?.({ to, cc, bcc, subject, body });
        setIsSending(false);
        setIsSent(true);
        setTimeout(() => setIsExpanded(false), 500);
    };

    return (
        <div className="w-full max-w-2xl my-6 font-sans text-sm rounded-2xl overflow-hidden border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl ring-1 ring-white/5 flex flex-col transition-all duration-300 group">
            {/* Premium Header */}
            <div
                className={clsx(
                    "relative px-5 py-3 flex items-center justify-between cursor-pointer select-none transition-colors duration-300",
                    isExpanded ? "bg-white/5 border-b border-white/5" : "bg-transparent hover:bg-white/5"
                )}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className={clsx(
                        "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500",
                        isSent ? "bg-green-500 text-white shadow-[0_0_15px_rgba(34,197,94,0.4)]" : "bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                    )}>
                        {isSent ? <Check className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                    </div>
                    <div className="flex flex-col">
                        <span className="font-semibold text-white/90 tracking-wide text-sm">
                            {isDraft ? 'New Message' : (subject || '(No Subject)')}
                        </span>
                        {!isExpanded && (
                            <span className="text-xs text-white/50 truncate max-w-[200px]">
                                {to ? `To: ${to}` : 'Draft'}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        className="p-1.5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition-colors"
                        onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                    >
                        <ChevronDown className={clsx("w-4 h-4 transition-transform duration-300", isExpanded ? "rotate-180" : "")} />
                    </button>

                    {isDraft && onCancel && (
                        <button
                            className="p-1.5 hover:bg-red-500/20 rounded-lg text-white/60 hover:text-red-400 transition-colors"
                            onClick={(e) => { e.stopPropagation(); onCancel(); }}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="flex flex-col flex-1"
                    >
                        {/* Fields Area */}
                        <div className="px-6 pt-4 pb-2 space-y-4 bg-transparent">
                            {/* To Field */}
                            <div className="group/field relative">
                                <div className="flex items-baseline gap-4">
                                    <label className="w-12 text-xs font-medium text-white/40 group-focus-within/field:text-blue-400 transition-colors">To</label>
                                    <div className="flex-1 relative">
                                        <input
                                            type="text"
                                            value={to}
                                            onChange={(e) => setTo(e.target.value)}
                                            disabled={readOnly || !isDraft}
                                            className="w-full bg-transparent border-none p-0 text-white/90 focus:ring-0 placeholder:text-white/20 font-light text-[15px] outline-none"
                                            placeholder="Recipient"
                                        />
                                        <div className="absolute bottom-0 left-0 w-full h-[1px] bg-white/10 group-focus-within/field:bg-blue-500/50 transition-colors" />

                                        {!readOnly && isDraft && !showCc && (
                                            <button
                                                className="absolute right-0 top-0 text-xs font-medium text-white/30 hover:text-blue-400 transition-colors"
                                                onClick={() => setShowCc(true)}
                                            >
                                                Cc/Bcc
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* CC/BCC Fields (Conditional) */}
                            <AnimatePresence>
                                {showCc && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="space-y-4 overflow-hidden"
                                    >
                                        <div className="group/field flex items-baseline gap-4">
                                            <label className="w-12 text-xs font-medium text-white/40 group-focus-within/field:text-blue-400 transition-colors">Cc</label>
                                            <div className="flex-1 relative">
                                                <input
                                                    value={cc}
                                                    onChange={(e) => setCc(e.target.value)}
                                                    disabled={readOnly || !isDraft}
                                                    className="w-full bg-transparent border-none p-0 text-white/90 focus:ring-0 placeholder:text-white/20 font-light text-[15px] outline-none"
                                                />
                                                <div className="absolute bottom-0 left-0 w-full h-[1px] bg-white/10 group-focus-within/field:bg-blue-500/50 transition-colors" />
                                            </div>
                                        </div>
                                        <div className="group/field flex items-baseline gap-4">
                                            <label className="w-12 text-xs font-medium text-white/40 group-focus-within/field:text-blue-400 transition-colors">Bcc</label>
                                            <div className="flex-1 relative">
                                                <input
                                                    value={bcc}
                                                    onChange={(e) => setBcc(e.target.value)}
                                                    disabled={readOnly || !isDraft}
                                                    className="w-full bg-transparent border-none p-0 text-white/90 focus:ring-0 placeholder:text-white/20 font-light text-[15px] outline-none"
                                                />
                                                <div className="absolute bottom-0 left-0 w-full h-[1px] bg-white/10 group-focus-within/field:bg-blue-500/50 transition-colors" />
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Subject Field */}
                            <div className="group/field flex items-baseline gap-4 pb-2">
                                <label className="w-12 text-xs font-medium text-white/40 group-focus-within/field:text-blue-400 transition-colors">Subject</label>
                                <div className="flex-1 relative">
                                    <input
                                        type="text"
                                        value={subject}
                                        onChange={(e) => setSubject(e.target.value)}
                                        disabled={readOnly || !isDraft}
                                        className="w-full bg-transparent border-none p-0 text-white placeholder:text-white/20 font-medium text-[15px] outline-none"
                                        placeholder="Subject"
                                    />
                                    <div className="absolute bottom-0 left-0 w-full h-[1px] bg-white/10 group-focus-within/field:bg-blue-500/50 transition-colors" />
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="relative flex-1 min-h-[250px] bg-white/[0.02]">
                            <textarea
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                disabled={readOnly || !isDraft}
                                className="w-full h-full p-6 bg-transparent border-none outline-none resize-none text-white/90 font-light leading-relaxed placeholder:text-white/10 text-[15px]"
                                placeholder="Write your message here..."
                            />

                            {/* Attachments Area */}
                            {attachments.length > 0 && (
                                <div className="absolute bottom-4 left-6 flex gap-2">
                                    {attachments.map((att, i) => (
                                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70">
                                            <Paperclip className="w-3 h-3" />
                                            <span>{att}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer / Actions */}
                        <div className="px-5 py-4 flex items-center justify-between border-t border-white/5 bg-white/[0.01]">
                            <div className="flex items-center gap-2">
                                <button
                                    className="p-2.5 text-white/40 hover:bg-white/10 hover:text-white/80 rounded-full transition-all active:scale-95"
                                    disabled={readOnly}
                                >
                                    <Paperclip className="w-4 h-4" />
                                </button>
                                <button
                                    className="p-2.5 text-white/40 hover:bg-white/10 hover:text-white/80 rounded-full transition-all active:scale-95"
                                    disabled={readOnly}
                                >
                                    <MoreHorizontal className="w-4 h-4" />
                                </button>
                            </div>

                            {isDraft && !readOnly ? (
                                <button
                                    onClick={handleSend}
                                    disabled={isSending || !to || isSent}
                                    className={clsx(
                                        "flex items-center gap-2 px-6 py-2 rounded-full font-medium text-sm transition-all shadow-lg active:scale-95",
                                        isSent
                                            ? "bg-green-500 text-white cursor-default shadow-green-500/20"
                                            : (isSending || !to)
                                                ? "bg-white/10 text-white/30 cursor-not-allowed"
                                                : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/25 hover:shadow-blue-500/40"
                                    )}
                                >
                                    {isSending ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : isSent ? (
                                        <>
                                            <span>Sent</span>
                                            <Check className="w-4 h-4" />
                                        </>
                                    ) : (
                                        <>
                                            <span>Send</span>
                                            <Send className="w-3.5 h-3.5" />
                                        </>
                                    )}
                                </button>
                            ) : (
                                <div className="px-4 py-1.5 rounded-full bg-white/5 border border-white/5 text-xs font-medium text-white/40 uppercase tracking-widest">
                                    {readOnly ? 'View Only' : 'Sent'}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
