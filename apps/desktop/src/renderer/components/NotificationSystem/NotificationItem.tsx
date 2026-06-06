import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { NotificationState, NotificationAction } from './types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { GenUIContainer, GenUIErrorBoundary } from '../genui';
import {
    X,
    CheckCircle,
    AlertTriangle,
    AlertOctagon,
    Bell,
    Send,
} from 'lucide-react';
import clsx from 'clsx';
import 'katex/dist/katex.min.css';

interface NotificationItemProps {
    notification: NotificationState;
    onDismiss: () => void;
}

function resolveNotificationImageSrc(image?: string): string | undefined {
    const raw = String(image || '').trim();
    if (!raw) return undefined;
    // Web URLs and data URIs pass through
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    // Already using local-file protocol
    if (/^local-file:/i.test(raw)) return raw;
    // Convert file:// to local-file:// (bypassCSP custom protocol)
    if (/^file:/i.test(raw)) return raw.replace(/^file:/i, 'local-file:');

    const encodePath = (inputPath: string, preserveDrive: boolean) => {
        const parts = inputPath.split('/');
        return parts
            .map((part, idx) => {
                if (preserveDrive && idx === 0 && /^[a-zA-Z]:$/.test(part)) return part;
                return encodeURIComponent(part);
            })
            .join('/');
    };

    // Windows paths (C:\... or C:/...)
    const normalized = raw.replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(normalized)) {
        return `local-file:///${encodePath(normalized, true)}`;
    }
    // Unix absolute paths
    if (normalized.startsWith('/')) {
        return `local-file://${encodePath(normalized, false)}`;
    }
    return raw;
}

export const NotificationItem: React.FC<NotificationItemProps> = ({
    notification,
    onDismiss,
}) => {
    const [isExiting, setIsExiting] = useState(false);
    const [inputValue, setInputValue] = useState(notification.input?.defaultValue || '');
    const [isHovered, setIsHovered] = useState(false);
    const [expandedMessage, setExpandedMessage] = useState(false);
    const [imageFailed, setImageFailed] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const messageText = notification.message || '';
    const messageLineCount = useMemo(() => messageText.split('\n').length, [messageText]);
    const imageSrc = useMemo(() => resolveNotificationImageSrc(notification.image), [notification.image]);
    const submitText = useMemo(() => String(notification.input?.submitText || '').trim(), [notification.input?.submitText]);
    const shouldShowExpand = useMemo(
        () => messageText.length > 220 || messageLineCount > 4,
        [messageText, messageLineCount]
    );

    // Handle dismiss with exit animation
    const handleDismiss = useCallback(() => {
        setIsExiting(true);
        setTimeout(onDismiss, 250);
    }, [onDismiss]);

    // Handle input submit
    const handleInputSubmit = useCallback(() => {
        if (notification.input?.onSubmit) {
            notification.input.onSubmit(inputValue);
        }
        if (notification.input?.keepAfterSubmit) {
            setInputValue('');
        } else {
            handleDismiss();
        }
    }, [inputValue, notification.input, handleDismiss]);

    // Handle input cancel
    const handleInputCancel = useCallback(() => {
        if (notification.input?.onCancel) {
            notification.input.onCancel();
        }
        handleDismiss();
    }, [notification.input, handleDismiss]);

    // Handle key press in input
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                handleInputSubmit();
            } else if (e.key === 'Escape') {
                handleInputCancel();
            }
        },
        [handleInputSubmit, handleInputCancel]
    );

    // Auto-focus input when present
    useEffect(() => {
        if (notification.input && inputRef.current) {
            inputRef.current.focus();
        }
    }, [notification.input]);

    useEffect(() => {
        setImageFailed(false);
    }, [imageSrc]);

    // Progress animation for auto-dismiss
    useEffect(() => {
        if (notification.duration > 0 && progressRef.current && !isHovered) {
            progressRef.current.style.transition = `width ${notification.duration}ms linear`;
            progressRef.current.style.width = '0%';
        }
    }, [notification.duration, isHovered]);

    // Pause progress on hover
    useEffect(() => {
        if (progressRef.current) {
            if (isHovered) {
                const computed = window.getComputedStyle(progressRef.current);
                progressRef.current.style.transition = 'none';
                progressRef.current.style.width = computed.width;
            } else if (notification.duration > 0) {
                const currentWidth = parseFloat(progressRef.current.style.width) || 100;
                const remainingTime = (currentWidth / 100) * notification.duration;
                progressRef.current.style.transition = `width ${remainingTime}ms linear`;
                progressRef.current.style.width = '0%';
            }
        }
    }, [isHovered, notification.duration]);

    const isStuardNotification = notification.className?.includes('stuard-notification');

    const variantConfig = {
        info: {
            icon: Bell,
            accentColor: 'var(--border)',
            iconBg: 'bg-theme-hover',
            iconText: 'text-theme-muted',
            progressBg: 'bg-theme-muted/40',
            label: 'Information',
        },
        success: {
            icon: CheckCircle,
            accentColor: '#10b981',
            iconBg: 'bg-emerald-500/10',
            iconText: 'text-emerald-600 dark:text-emerald-400',
            progressBg: 'bg-emerald-500/50',
            label: 'Success',
        },
        warning: {
            icon: AlertTriangle,
            accentColor: '#f59e0b',
            iconBg: 'bg-amber-500/10',
            iconText: 'text-amber-600 dark:text-amber-400',
            progressBg: 'bg-amber-500/50',
            label: 'Warning',
        },
        error: {
            icon: AlertOctagon,
            accentColor: '#ef4444',
            iconBg: 'bg-red-500/10',
            iconText: 'text-red-600 dark:text-red-400',
            progressBg: 'bg-red-500/50',
            label: 'Error',
        },
        neutral: {
            icon: Bell,
            accentColor: 'var(--border)',
            iconBg: 'bg-theme-hover',
            iconText: 'text-theme-muted',
            progressBg: 'bg-theme-muted/40',
            label: 'Notification',
        },
    };

    const stuardIconClass = notification.orchestratorDone || notification.variant === 'success'
        ? 'stuard-notification-icon stuard-notification-icon--success'
        : notification.variant === 'warning'
            ? 'stuard-notification-icon stuard-notification-icon--warning'
            : notification.variant === 'error'
                ? 'stuard-notification-icon stuard-notification-icon--error'
                : 'stuard-notification-icon';

    const config = variantConfig[notification.variant];
    const Icon = (isStuardNotification && (notification.orchestratorDone || notification.variant === 'success'))
        ? CheckCircle
        : config.icon;

    const getButtonStyles = (variant: NotificationAction['variant'] = 'secondary') => {
        if (isStuardNotification) {
            return {
                className: clsx(
                    'stuard-notification-btn',
                    variant === 'primary'
                        ? 'stuard-notification-btn-primary'
                        : variant === 'danger'
                            ? 'bg-red-500 text-white hover:bg-red-600'
                            : 'stuard-notification-btn-secondary',
                ),
                style: undefined,
            };
        }

        const base = 'px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 active:scale-[0.97]';
        switch (variant) {
            case 'primary':
                return { className: clsx(base, 'text-white shadow-sm hover:opacity-90'), style: { backgroundColor: config.accentColor } };
            case 'danger':
                return { className: clsx(base, 'bg-red-500 text-white hover:bg-red-600 shadow-sm'), style: undefined };
            default:
                return { className: clsx(base, 'bg-theme-hover text-theme-fg hover:bg-theme-active'), style: undefined };
        }
    };

    return (
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
                ...(isStuardNotification ? {} : { borderLeftColor: config.accentColor }),
                transform: isExiting ? 'translateX(110%)' : 'translateX(0)',
                opacity: isExiting ? 0 : 1,
                transition: 'transform 250ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease',
            }}
            className={clsx(
                'relative w-full min-w-[340px] max-w-[400px] pointer-events-auto overflow-hidden',
                isStuardNotification
                    ? 'stuard-notification-card'
                    : 'bg-theme-card rounded-lg border border-theme border-l-[4px] shadow-[0_4px_24px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.08)]',
                notification.className
            )}
        >
            {/* Auto-dismiss progress bar */}
            {notification.duration > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-theme-hover">
                    <div
                        ref={progressRef}
                        className={clsx(
                            'h-full w-full rounded-full',
                            isStuardNotification ? 'stuard-notification-progress' : config.progressBg,
                        )}
                        style={{ opacity: isStuardNotification ? 1 : 0.7 }}
                    />
                </div>
            )}

            {/* Main content */}
            <div className="px-4 py-3">
                <div className="flex items-start gap-3">
                    {/* Icon or Image */}
                    {imageSrc && !imageFailed ? (
                        <div className="shrink-0 w-10 h-10 rounded-lg overflow-hidden ring-1 ring-theme/30">
                            <img
                                src={imageSrc}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    setImageFailed(true);
                                }}
                            />
                        </div>
                    ) : (
                        <div
                            className={clsx(
                                'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
                                isStuardNotification ? stuardIconClass : clsx(config.iconBg, config.iconText),
                            )}
                        >
                            {notification.icon || <Icon className="w-4 h-4" strokeWidth={2} />}
                        </div>
                    )}

                    {/* Text content */}
                    <div className="flex-1 min-w-0 max-h-[68vh] overflow-y-auto custom-scrollbar pr-1">
                        <h4 className={clsx(
                            'font-medium text-[13px] text-theme-fg leading-tight truncate',
                            isStuardNotification && 'font-stuard tracking-tight'
                        )}>
                            {notification.title}
                        </h4>
                        {notification.message && (
                            <div className="mt-0.5">
                                <div
                                    className={clsx(
                                        'text-[12.5px] text-theme-muted leading-snug transition-[max-height] duration-200',
                                        !expandedMessage && shouldShowExpand && 'max-h-[92px] overflow-hidden'
                                    )}
                                >
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                                        components={{
                                            p: ({ node, ...props }) => <p {...props} className="m-0 mb-1.5 last:mb-0" />,
                                            strong: ({ node, ...props }) => <strong {...props} className="font-bold text-theme-fg" />,
                                            em: ({ node, ...props }) => <em {...props} className="italic" />,
                                            h1: ({ node, ...props }) => <h1 {...props} className="text-[14px] font-bold text-theme-fg mt-2 mb-1" />,
                                            h2: ({ node, ...props }) => <h2 {...props} className="text-[13px] font-bold text-theme-fg mt-2 mb-1" />,
                                            h3: ({ node, ...props }) => <h3 {...props} className="text-[12.5px] font-semibold text-theme-fg mt-1.5 mb-0.5" />,
                                            blockquote: ({ node, ...props }) => (
                                                <blockquote {...props} className="border-l-2 border-theme/30 pl-2.5 my-1.5 text-theme-muted italic" />
                                            ),
                                            hr: ({ node, ...props }) => <hr {...props} className="border-theme/30 my-2" />,
                                            ul: ({ node, ...props }) => <ul {...props} className="m-0 ml-4 list-disc" />,
                                            ol: ({ node, ...props }) => <ol {...props} className="m-0 ml-4 list-decimal" />,
                                            li: ({ node, ...props }) => <li {...props} className="mb-0.5" />,
                                            pre: ({ node, children, ...props }) => (
                                                <pre {...props} className="my-1.5 p-2.5 rounded-lg bg-theme-hover border border-theme/20 overflow-x-auto text-[11px] leading-relaxed">
                                                    {children}
                                                </pre>
                                            ),
                                            code: ({ node, inline, className, children, ...props }: any) => {
                                                return inline ? (
                                                    <code className="bg-theme-hover text-theme-fg px-[5px] py-[1px] rounded text-[85%] font-mono font-medium border border-theme/20" {...props}>
                                                        {children}
                                                    </code>
                                                ) : (
                                                    <code className={clsx(
                                                        'block text-[11px] text-theme-fg font-mono whitespace-pre leading-[1.6]',
                                                        className
                                                    )} {...props}>
                                                        {children}
                                                    </code>
                                                )
                                            },
                                            a: ({ node, ...props }) => (
                                                <a
                                                    {...props}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className={isStuardNotification ? 'stuard-notification-link' : 'text-blue-600 hover:underline underline-offset-2'}
                                                />
                                            ),
                                            img: ({ node, src, ...props }) => (
                                                <img
                                                    {...props}
                                                    src={resolveNotificationImageSrc(src) || src}
                                                    className="max-w-full h-auto rounded-md my-1.5 border border-theme/20"
                                                    loading="lazy"
                                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                />
                                            ),
                                            table: ({ node, ...props }) => (
                                                <div className="overflow-x-auto my-1.5">
                                                    <table {...props} className="w-full text-[11px] border-collapse" />
                                                </div>
                                            ),
                                            th: ({ node, ...props }) => (
                                                <th {...props} className="text-left font-semibold text-theme-fg px-2 py-1 border-b border-theme/30 bg-theme-hover/50" />
                                            ),
                                            td: ({ node, ...props }) => (
                                                <td {...props} className="px-2 py-1 border-b border-theme/10 text-theme-muted" />
                                            ),
                                        }}
                                    >
                                        {notification.message}
                                    </ReactMarkdown>
                                </div>
                                {shouldShowExpand && (
                                    <button
                                        onClick={() => setExpandedMessage(v => !v)}
                                        className="mt-1 text-[11px] font-medium text-theme-muted hover:text-theme-fg transition-colors"
                                    >
                                        {expandedMessage ? 'Show less' : 'Show more'}
                                    </button>
                                )}
                            </div>
                        )}

                        {notification.structuredContent && (
                            <div className="mt-2.5 max-h-[320px] overflow-y-auto custom-scrollbar rounded-lg border border-theme/20 bg-theme-hover/50 p-2">
                                <GenUIErrorBoundary componentName={notification.structuredContent.toolName}>
                                    <GenUIContainer
                                        toolName={notification.structuredContent.toolName}
                                        args={notification.structuredContent.args}
                                        isCompleted={true}
                                        result={{ displayed: true }}
                                        onResult={() => { }}
                                    />
                                </GenUIErrorBoundary>
                            </div>
                        )}

                        {/* Custom progress bar (for progress notifications) */}
                        {typeof notification.progress === 'number' && (
                            <div className="mt-2.5 h-1.5 bg-theme-hover rounded-full overflow-hidden">
                                <div
                                    className={clsx('h-full rounded-full transition-all duration-300', config.progressBg)}
                                    style={{ width: `${Math.min(100, Math.max(0, notification.progress))}%` }}
                                />
                            </div>
                        )}

                        {/* Input field */}
                        {notification.input && (
                            <div className="mt-2.5">
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={inputRef}
                                        type={notification.input.type || 'text'}
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder={notification.input.placeholder || 'Type here...'}
                                        className={clsx(
                                            'flex-1 px-2.5 py-1.5 text-xs rounded-md transition-all',
                                            isStuardNotification
                                                ? 'stuard-notification-input'
                                                : 'bg-theme-input border border-theme/30 text-theme-fg placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-offset-0',
                                        )}
                                        style={isStuardNotification ? undefined : ({ '--tw-ring-color': config.accentColor + '40' } as React.CSSProperties)}
                                    />
                                    <button
                                        onClick={handleInputSubmit}
                                        className={clsx(
                                            isStuardNotification
                                                ? 'stuard-notification-btn stuard-notification-btn-primary'
                                                : 'rounded-md text-white hover:opacity-90 active:scale-95 transition-all',
                                            !isStuardNotification && (submitText ? 'px-2.5 py-1.5 text-[11px] font-semibold leading-none min-w-[52px]' : 'p-1.5'),
                                            isStuardNotification && (submitText ? 'min-w-[52px]' : 'p-1.5'),
                                        )}
                                        style={isStuardNotification ? undefined : { backgroundColor: config.accentColor }}
                                    >
                                        {submitText ? submitText : <Send className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                                {(notification.input.cancelText) && (
                                    <button
                                        onClick={handleInputCancel}
                                        className="mt-1.5 text-[11px] text-theme-muted hover:text-theme-fg transition-colors"
                                    >
                                        {notification.input.cancelText || 'Cancel'}
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Action buttons */}
                        {notification.actions && notification.actions.length > 0 && (
                            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                                {notification.actions.map((action, index) => {
                                    const btnStyles = getButtonStyles(action.variant);
                                    return (
                                        <button
                                            key={index}
                                            onClick={() => {
                                                action.onClick();
                                                if (!action.keepNotification) {
                                                    handleDismiss();
                                                }
                                            }}
                                            className={btnStyles.className}
                                            style={btnStyles.style}
                                        >
                                            {action.label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Dismiss button */}
                    {notification.dismissible && (
                        <button
                            onClick={handleDismiss}
                            className={clsx(
                                'shrink-0 p-1 rounded-md',
                                'text-theme-muted hover:text-theme-fg',
                                'hover:bg-theme-hover active:bg-theme-active',
                                'transition-all duration-150'
                            )}
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
