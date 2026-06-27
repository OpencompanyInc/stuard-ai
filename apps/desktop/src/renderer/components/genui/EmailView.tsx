
import React, { useState } from 'react';
import { Mail, Send, X, Paperclip, MoreHorizontal, ChevronDown, Check } from 'lucide-react';
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

const fieldLabelClass =
    'w-12 text-xs font-medium text-theme-muted group-focus-within/field:text-primary transition-colors shrink-0';
const fieldInputClass =
    'w-full bg-transparent border-none p-0 text-theme-fg focus:ring-0 placeholder:text-theme-muted/50 font-light text-[15px] outline-none';
const fieldUnderlineClass =
    'absolute bottom-0 left-0 w-full h-px bg-theme/15 group-focus-within/field:bg-primary/50 transition-colors';

export const EmailView: React.FC<EmailViewProps> = ({
    to: initialTo = '',
    from = '',
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
        await new Promise(resolve => setTimeout(resolve, 1200));
        onSend?.({ to, cc, bcc, subject, body });
        setIsSending(false);
        setIsSent(true);
        setTimeout(() => setIsExpanded(false), 500);
    };

    const collapsedSubtitle = from
        ? `From: ${from}`
        : to
            ? `To: ${to}`
            : 'Draft';

    return (
        <div className="w-full max-w-2xl my-3 font-sans text-sm rounded-2xl overflow-hidden border border-theme/20 bg-theme-card shadow-lg flex flex-col transition-all duration-300 group">
            <div
                className={clsx(
                    'relative px-5 py-3 flex items-center justify-between cursor-pointer select-none transition-colors duration-300',
                    isExpanded ? 'bg-theme-hover/40 border-b border-theme/15' : 'bg-transparent hover:bg-theme-hover/30',
                )}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <div
                        className={clsx(
                            'w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-500',
                            isSent
                                ? 'bg-green-500 text-white shadow-[0_0_12px_rgba(34,197,94,0.35)]'
                                : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-[0_0_12px_rgba(59,130,246,0.25)]',
                        )}
                    >
                        {isSent ? <Check className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-theme-fg tracking-wide text-sm truncate">
                            {isDraft ? 'New Message' : (subject || '(No Subject)')}
                        </span>
                        {!isExpanded && (
                            <span className="text-xs text-theme-muted truncate max-w-[240px]">
                                {collapsedSubtitle}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <button
                        type="button"
                        className="p-1.5 hover:bg-theme-hover rounded-lg text-theme-muted hover:text-theme-fg transition-colors"
                        onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                    >
                        <ChevronDown className={clsx('w-4 h-4 transition-transform duration-300', isExpanded ? 'rotate-180' : '')} />
                    </button>

                    {isDraft && onCancel && (
                        <button
                            type="button"
                            className="p-1.5 hover:bg-red-500/15 rounded-lg text-theme-muted hover:text-red-500 transition-colors"
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
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        className="flex flex-col flex-1"
                    >
                        <div className="px-6 pt-4 pb-2 space-y-4">
                            {from ? (
                                <div className="group/field flex items-baseline gap-4">
                                    <label className={fieldLabelClass}>From</label>
                                    <div className="flex-1 relative min-w-0">
                                        <div className="text-[15px] text-theme-fg font-light truncate">{from}</div>
                                        <div className={fieldUnderlineClass} />
                                    </div>
                                </div>
                            ) : null}

                            <div className="group/field relative">
                                <div className="flex items-baseline gap-4">
                                    <label className={fieldLabelClass}>To</label>
                                    <div className="flex-1 relative min-w-0">
                                        <input
                                            type="text"
                                            value={to}
                                            onChange={(e) => setTo(e.target.value)}
                                            disabled={readOnly || !isDraft}
                                            className={fieldInputClass}
                                            placeholder="Recipient"
                                        />
                                        <div className={fieldUnderlineClass} />

                                        {!readOnly && isDraft && !showCc && (
                                            <button
                                                type="button"
                                                className="absolute right-0 top-0 text-xs font-medium text-theme-muted hover:text-primary transition-colors"
                                                onClick={() => setShowCc(true)}
                                            >
                                                Cc/Bcc
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <AnimatePresence>
                                {showCc && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="space-y-4 overflow-hidden"
                                    >
                                        <div className="group/field flex items-baseline gap-4">
                                            <label className={fieldLabelClass}>Cc</label>
                                            <div className="flex-1 relative min-w-0">
                                                <input
                                                    value={cc}
                                                    onChange={(e) => setCc(e.target.value)}
                                                    disabled={readOnly || !isDraft}
                                                    className={fieldInputClass}
                                                />
                                                <div className={fieldUnderlineClass} />
                                            </div>
                                        </div>
                                        <div className="group/field flex items-baseline gap-4">
                                            <label className={fieldLabelClass}>Bcc</label>
                                            <div className="flex-1 relative min-w-0">
                                                <input
                                                    value={bcc}
                                                    onChange={(e) => setBcc(e.target.value)}
                                                    disabled={readOnly || !isDraft}
                                                    className={fieldInputClass}
                                                />
                                                <div className={fieldUnderlineClass} />
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <div className="group/field flex items-baseline gap-4 pb-2">
                                <label className={fieldLabelClass}>Subject</label>
                                <div className="flex-1 relative min-w-0">
                                    <input
                                        type="text"
                                        value={subject}
                                        onChange={(e) => setSubject(e.target.value)}
                                        disabled={readOnly || !isDraft}
                                        className={clsx(fieldInputClass, 'font-medium')}
                                        placeholder="Subject"
                                    />
                                    <div className={fieldUnderlineClass} />
                                </div>
                            </div>
                        </div>

                        <div className="relative flex-1 min-h-[250px] bg-theme-hover/25 border-y border-theme/10">
                            <textarea
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                disabled={readOnly || !isDraft}
                                className="w-full h-full min-h-[250px] p-6 bg-transparent border-none outline-none resize-none text-theme-fg font-light leading-relaxed placeholder:text-theme-muted/40 text-[15px]"
                                placeholder="Write your message here..."
                            />

                            {attachments.length > 0 && (
                                <div className="absolute bottom-4 left-6 flex flex-wrap gap-2">
                                    {attachments.map((att, i) => (
                                        <div
                                            key={i}
                                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-theme-card border border-theme/20 text-xs text-theme-fg shadow-sm"
                                        >
                                            <Paperclip className="w-3 h-3 text-theme-muted" />
                                            <span>{att}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="px-5 py-4 flex items-center justify-between border-t border-theme/15 bg-theme-hover/20">
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="p-2.5 text-theme-muted hover:bg-theme-hover hover:text-theme-fg rounded-full transition-all active:scale-95"
                                    disabled={readOnly}
                                >
                                    <Paperclip className="w-4 h-4" />
                                </button>
                                <button
                                    type="button"
                                    className="p-2.5 text-theme-muted hover:bg-theme-hover hover:text-theme-fg rounded-full transition-all active:scale-95"
                                    disabled={readOnly}
                                >
                                    <MoreHorizontal className="w-4 h-4" />
                                </button>
                            </div>

                            {isDraft && !readOnly ? (
                                <button
                                    type="button"
                                    onClick={handleSend}
                                    disabled={isSending || !to || isSent}
                                    className={clsx(
                                        'flex items-center gap-2 px-6 py-2 rounded-full font-medium text-sm transition-all shadow-lg active:scale-95',
                                        isSent
                                            ? 'bg-green-500 text-white cursor-default shadow-green-500/20'
                                            : (isSending || !to)
                                                ? 'bg-theme-hover text-theme-muted cursor-not-allowed'
                                                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/25 hover:shadow-blue-500/40',
                                    )}
                                >
                                    {isSending ? (
                                        <div className="w-5 h-5 border-2 border-theme-muted/40 border-t-theme-fg rounded-full animate-spin" />
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
                                <div className="px-4 py-1.5 rounded-full bg-theme-hover border border-theme/15 text-xs font-medium text-theme-muted uppercase tracking-widest">
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
