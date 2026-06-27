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
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    if (/^local-file:/i.test(raw)) return raw;
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

    const normalized = raw.replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(normalized)) {
        return `local-file:///${encodePath(normalized, true)}`;
    }
    if (normalized.startsWith('/')) {
        return `local-file://${encodePath(normalized, false)}`;
    }
    return raw;
}

const stuardMarkdownComponents = {
    p: ({ node, ...props }: any) => <p {...props} className="m-0 mb-1.5 last:mb-0" />,
    strong: ({ node, ...props }: any) => <strong {...props} />,
    em: ({ node, ...props }: any) => <em {...props} className="italic" />,
    h1: ({ node, ...props }: any) => <h1 {...props} className="text-[13px] font-semibold mt-2 mb-1" />,
    h2: ({ node, ...props }: any) => <h2 {...props} className="text-[12px] font-semibold mt-2 mb-1" />,
    h3: ({ node, ...props }: any) => <h3 {...props} className="text-[12px] font-medium mt-1.5 mb-0.5" />,
    blockquote: ({ node, ...props }: any) => (
        <blockquote {...props} className="border-l-2 border-[rgb(var(--compact-pill-fg)/0.15)] pl-2.5 my-1.5 italic opacity-80" />
    ),
    hr: ({ node, ...props }: any) => <hr {...props} className="border-[rgb(var(--compact-pill-fg)/0.1)] my-2" />,
    ul: ({ node, ...props }: any) => <ul {...props} className="m-0 ml-4 list-disc" />,
    ol: ({ node, ...props }: any) => <ol {...props} className="m-0 ml-4 list-decimal" />,
    li: ({ node, ...props }: any) => <li {...props} className="mb-0.5" />,
    pre: ({ node, children, ...props }: any) => <pre {...props}>{children}</pre>,
    code: ({ node, inline, className, children, ...props }: any) => {
        return inline ? (
            <code {...props}>{children}</code>
        ) : (
            <code className={clsx('block font-mono whitespace-pre', className)} {...props}>
                {children}
            </code>
        );
    },
    a: ({ node, ...props }: any) => <a {...props} target="_blank" rel="noopener noreferrer" className="stuard-notification-link" />,
    img: ({ node, src, ...props }: any) => (
        <img
            {...props}
            src={resolveNotificationImageSrc(src) || src}
            className="max-w-full h-auto rounded-[12px] my-1.5"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
    ),
    table: ({ node, ...props }: any) => (
        <div className="overflow-x-auto my-1.5">
            <table {...props} className="w-full text-[11px] border-collapse" />
        </div>
    ),
    th: ({ node, ...props }: any) => (
        <th {...props} className="text-left font-semibold px-2 py-1 border-b border-[rgb(var(--compact-pill-fg)/0.1)]" />
    ),
    td: ({ node, ...props }: any) => (
        <td {...props} className="px-2 py-1 border-b border-[rgb(var(--compact-pill-fg)/0.06)]" />
    ),
};

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

    const handleDismiss = useCallback(() => {
        setIsExiting(true);
        setTimeout(onDismiss, 220);
    }, [onDismiss]);

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

    const handleInputCancel = useCallback(() => {
        if (notification.input?.onCancel) {
            notification.input.onCancel();
        }
        handleDismiss();
    }, [notification.input, handleDismiss]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') handleInputSubmit();
            else if (e.key === 'Escape') handleInputCancel();
        },
        [handleInputSubmit, handleInputCancel]
    );

    useEffect(() => {
        if (notification.input && inputRef.current) {
            inputRef.current.focus();
        }
    }, [notification.input]);

    useEffect(() => {
        setImageFailed(false);
    }, [imageSrc]);

    useEffect(() => {
        if (notification.duration > 0 && progressRef.current && !isHovered) {
            progressRef.current.style.transition = `width ${notification.duration}ms linear`;
            progressRef.current.style.width = '0%';
        }
    }, [notification.duration, isHovered]);

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
        info: { icon: Bell, accentColor: 'var(--border)', iconBg: 'bg-theme-hover', iconText: 'text-theme-muted', progressBg: 'bg-theme-muted/40' },
        success: { icon: CheckCircle, accentColor: '#10b981', iconBg: 'bg-emerald-500/10', iconText: 'text-emerald-600 dark:text-emerald-400', progressBg: 'bg-emerald-500/50' },
        warning: { icon: AlertTriangle, accentColor: '#f59e0b', iconBg: 'bg-amber-500/10', iconText: 'text-amber-600 dark:text-amber-400', progressBg: 'bg-amber-500/50' },
        error: { icon: AlertOctagon, accentColor: '#ef4444', iconBg: 'bg-red-500/10', iconText: 'text-red-600 dark:text-red-400', progressBg: 'bg-red-500/50' },
        neutral: { icon: Bell, accentColor: 'var(--border)', iconBg: 'bg-theme-hover', iconText: 'text-theme-muted', progressBg: 'bg-theme-muted/40' },
    };

    const config = variantConfig[notification.variant];
    const Icon = config.icon;

    const getButtonStyles = (variant: NotificationAction['variant'] = 'secondary') => {
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

    const stuardBtnClass = (variant: NotificationAction['variant'] = 'secondary') => clsx(
        'stuard-notification-btn',
        variant === 'primary'
            ? 'stuard-notification-btn-primary'
            : variant === 'danger'
                ? 'stuard-notification-btn-primary !bg-[#ef4444] !text-white'
                : 'stuard-notification-btn-secondary',
    );

    const exitStyle: React.CSSProperties = {
        transform: isExiting ? 'translateY(-8px) scale(0.98)' : 'translateY(0) scale(1)',
        opacity: isExiting ? 0 : 1,
        transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
    };

    const messageBlock = messageText ? (
        <div className={isStuardNotification ? 'stuard-notification-body' : 'mt-1 text-[12.5px] text-theme-muted leading-snug'}>
            <div className={clsx(!expandedMessage && shouldShowExpand && 'max-h-[88px] overflow-hidden')}>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
                    components={isStuardNotification ? stuardMarkdownComponents : undefined}
                >
                    {notification.message}
                </ReactMarkdown>
            </div>
            {shouldShowExpand && (
                <button
                    type="button"
                    onClick={() => setExpandedMessage(v => !v)}
                    className={isStuardNotification ? 'stuard-notification-expand' : 'mt-1 text-[11px] font-medium text-theme-muted hover:text-theme-fg transition-colors'}
                >
                    {expandedMessage ? 'Show less' : 'Show more'}
                </button>
            )}
        </div>
    ) : null;

    if (isStuardNotification) {
        return (
            <div
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={exitStyle}
                className={clsx(
                    'stuard-notification-card relative w-full min-w-[300px] max-w-[372px] pointer-events-auto',
                    notification.duration > 0 && 'stuard-notification-has-progress',
                    notification.className,
                )}
            >
                {notification.duration > 0 && (
                    <div className="stuard-notification-progress-track">
                        <div ref={progressRef} className="stuard-notification-progress w-full" />
                    </div>
                )}

                <div className="stuard-notification-inner">
                    <div className="stuard-notification-header">
                        <h4 className="stuard-notification-title">{notification.title}</h4>
                        {notification.dismissible && (
                            <button type="button" onClick={handleDismiss} className="stuard-notification-dismiss" aria-label="Dismiss">
                                <X className="w-3.5 h-3.5" strokeWidth={2} />
                            </button>
                        )}
                    </div>

                    {imageSrc && !imageFailed && (
                        <div className="mt-2.5 rounded-[14px] overflow-hidden">
                            <img
                                src={imageSrc}
                                alt=""
                                className="w-full max-h-[140px] object-cover"
                                onError={() => setImageFailed(true)}
                            />
                        </div>
                    )}

                    {messageBlock}

                    {notification.structuredContent && (
                        <div className="stuard-notification-embed custom-scrollbar">
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

                    {typeof notification.progress === 'number' && (
                        <div className="mt-3 h-1 rounded-full bg-[rgb(var(--compact-pill-fg)/0.08)] overflow-hidden">
                            <div
                                className="h-full rounded-full bg-[rgb(var(--compact-pill-fg)/0.28)] transition-all duration-300"
                                style={{ width: `${Math.min(100, Math.max(0, notification.progress))}%` }}
                            />
                        </div>
                    )}

                    {notification.input && (
                        <div className="stuard-notification-input-row">
                            <input
                                ref={inputRef}
                                type={notification.input.type || 'text'}
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={notification.input.placeholder || 'Type here...'}
                                className="stuard-notification-input"
                            />
                            <button
                                type="button"
                                onClick={handleInputSubmit}
                                className={clsx('stuard-notification-btn stuard-notification-btn-primary stuard-notification-input-submit')}
                            >
                                {submitText || <Send className="w-3.5 h-3.5" />}
                            </button>
                        </div>
                    )}

                    {notification.actions && notification.actions.length > 0 && (
                        <div className="stuard-notification-actions">
                            {notification.actions.map((action, index) => (
                                <button
                                    key={index}
                                    type="button"
                                    onClick={() => {
                                        action.onClick();
                                        if (!action.keepNotification) handleDismiss();
                                    }}
                                    className={stuardBtnClass(action.variant)}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Legacy / non-Stuard notification styling
    return (
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{ ...exitStyle, borderLeftColor: config.accentColor }}
            className={clsx(
                'relative w-full min-w-[340px] max-w-[400px] pointer-events-auto overflow-hidden',
                'bg-theme-card rounded-lg border border-theme border-l-[4px]',
                'shadow-[0_4px_24px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.08)]',
                notification.className,
            )}
        >
            {notification.duration > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-theme-hover">
                    <div ref={progressRef} className={clsx('h-full w-full rounded-full', config.progressBg)} style={{ opacity: 0.7 }} />
                </div>
            )}

            <div className="px-4 py-3">
                <div className="flex items-start gap-3">
                    {imageSrc && !imageFailed ? (
                        <div className="shrink-0 w-10 h-10 rounded-lg overflow-hidden ring-1 ring-theme/30">
                            <img src={imageSrc} alt="" className="w-full h-full object-cover" onError={() => setImageFailed(true)} />
                        </div>
                    ) : (
                        <div className={clsx('shrink-0 w-8 h-8 rounded-lg flex items-center justify-center', config.iconBg, config.iconText)}>
                            {notification.icon || <Icon className="w-4 h-4" strokeWidth={2} />}
                        </div>
                    )}

                    <div className="flex-1 min-w-0 max-h-[68vh] overflow-y-auto custom-scrollbar pr-1">
                        <h4 className="font-medium text-[13px] text-theme-fg leading-tight truncate font-stuard tracking-tight">
                            {notification.title}
                        </h4>
                        {messageBlock}

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

                        {typeof notification.progress === 'number' && (
                            <div className="mt-2.5 h-1.5 bg-theme-hover rounded-full overflow-hidden">
                                <div className={clsx('h-full rounded-full transition-all duration-300', config.progressBg)} style={{ width: `${Math.min(100, Math.max(0, notification.progress))}%` }} />
                            </div>
                        )}

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
                                        className="flex-1 px-2.5 py-1.5 text-xs rounded-md bg-theme-input border border-theme/30 text-theme-fg placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-offset-0"
                                        style={{ '--tw-ring-color': config.accentColor + '40' } as React.CSSProperties}
                                    />
                                    <button
                                        onClick={handleInputSubmit}
                                        className={clsx('rounded-md text-white hover:opacity-90 active:scale-95 transition-all', submitText ? 'px-2.5 py-1.5 text-[11px] font-semibold min-w-[52px]' : 'p-1.5')}
                                        style={{ backgroundColor: config.accentColor }}
                                    >
                                        {submitText || <Send className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                            </div>
                        )}

                        {notification.actions && notification.actions.length > 0 && (
                            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                                {notification.actions.map((action, index) => {
                                    const btnStyles = getButtonStyles(action.variant);
                                    return (
                                        <button
                                            key={index}
                                            onClick={() => {
                                                action.onClick();
                                                if (!action.keepNotification) handleDismiss();
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

                    {notification.dismissible && (
                        <button
                            onClick={handleDismiss}
                            className="shrink-0 p-1 rounded-md text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all duration-150"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
