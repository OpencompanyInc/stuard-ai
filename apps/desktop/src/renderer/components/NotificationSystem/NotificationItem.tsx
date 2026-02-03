import React, { useState, useCallback, useRef, useEffect } from 'react';
import { NotificationState, NotificationAction } from './types';
import {
    X,
    Info,
    CheckCircle,
    AlertTriangle,
    AlertOctagon,
    Bell,
    Send,
} from 'lucide-react';
import clsx from 'clsx';

interface NotificationItemProps {
    notification: NotificationState;
    onDismiss: () => void;
}

export const NotificationItem: React.FC<NotificationItemProps> = ({
    notification,
    onDismiss,
}) => {
    const [isExiting, setIsExiting] = useState(false);
    const [inputValue, setInputValue] = useState(notification.input?.defaultValue || '');
    const [isHovered, setIsHovered] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);

    // Handle dismiss with exit animation
    const handleDismiss = useCallback(() => {
        setIsExiting(true);
        setTimeout(onDismiss, 200);
    }, [onDismiss]);

    // Handle input submit
    const handleInputSubmit = useCallback(() => {
        if (notification.input?.onSubmit) {
            notification.input.onSubmit(inputValue);
        }
        handleDismiss();
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
                // Calculate remaining time based on current progress
                const currentWidth = parseFloat(progressRef.current.style.width) || 100;
                const remainingTime = (currentWidth / 100) * notification.duration;
                progressRef.current.style.transition = `width ${remainingTime}ms linear`;
                progressRef.current.style.width = '0%';
            }
        }
    }, [isHovered, notification.duration]);

    // Variant styles
    const variantConfig = {
        info: {
            icon: Info,
            bgClass: 'bg-blue-500/10',
            borderClass: 'border-blue-500/30',
            iconClass: 'text-blue-500',
            progressClass: 'bg-blue-500',
        },
        success: {
            icon: CheckCircle,
            bgClass: 'bg-emerald-500/10',
            borderClass: 'border-emerald-500/30',
            iconClass: 'text-emerald-500',
            progressClass: 'bg-emerald-500',
        },
        warning: {
            icon: AlertTriangle,
            bgClass: 'bg-amber-500/10',
            borderClass: 'border-amber-500/30',
            iconClass: 'text-amber-500',
            progressClass: 'bg-amber-500',
        },
        error: {
            icon: AlertOctagon,
            bgClass: 'bg-red-500/10',
            borderClass: 'border-red-500/30',
            iconClass: 'text-red-500',
            progressClass: 'bg-red-500',
        },
        neutral: {
            icon: Bell,
            bgClass: 'bg-theme-card',
            borderClass: 'border-theme',
            iconClass: 'text-theme-muted',
            progressClass: 'bg-theme-muted',
        },
    };

    const config = variantConfig[notification.variant];
    const Icon = config.icon;

    // Button variant styles
    const getButtonStyles = (variant: NotificationAction['variant'] = 'secondary') => {
        const base = 'px-3 py-1.5 text-xs font-medium rounded-lg transition-all active:scale-95';
        switch (variant) {
            case 'primary':
                return clsx(base, 'bg-primary text-primary-fg hover:opacity-90');
            case 'danger':
                return clsx(base, 'bg-red-500 text-white hover:bg-red-600');
            default:
                return clsx(base, 'bg-theme-hover text-theme-fg hover:bg-theme-active');
        }
    };

    return (
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={clsx(
                // Base styles - Stuard overlay theme matching
                'relative w-full min-w-[320px] max-w-[400px]',
                'rounded-xl border backdrop-blur-xl',
                'shadow-lg shadow-black/20',
                'pointer-events-auto',
                'transition-all duration-200',
                // Animation
                isExiting
                    ? 'animate-out fade-out-0 slide-out-to-left-5'
                    : 'animate-in fade-in-0 slide-in-from-left-5',
                // Variant styles
                config.bgClass,
                config.borderClass,
                notification.className
            )}

        >
            {/* Progress bar for auto-dismiss */}
            {notification.duration > 0 && (
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl overflow-hidden">
                    <div
                        ref={progressRef}
                        className={clsx('h-full w-full', config.progressClass)}
                        style={{ opacity: 0.6 }}
                    />
                </div>
            )}

            {/* Main content */}
            <div className="p-4">
                <div className="flex items-start gap-3">
                    {/* Icon or Image */}
                    {notification.image ? (
                        <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-theme/10">
                            <img
                                src={notification.image}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                        </div>
                    ) : (
                        <div
                            className={clsx(
                                'shrink-0 p-2 rounded-lg',
                                'bg-theme-card border border-theme/10',
                                config.iconClass
                            )}
                        >
                            {notification.icon || <Icon className="w-5 h-5" />}
                        </div>
                    )}

                    {/* Text content */}
                    <div className="flex-1 min-w-0 pt-0.5">
                        <h4 className="font-semibold text-sm text-theme-fg leading-tight">
                            {notification.title}
                        </h4>
                        {notification.message && (
                            <p className="mt-1 text-sm text-theme-muted leading-relaxed">
                                {notification.message}
                            </p>
                        )}

                        {/* Custom progress bar (for progress notifications) */}
                        {typeof notification.progress === 'number' && (
                            <div className="mt-3 h-1.5 bg-theme-hover rounded-full overflow-hidden">
                                <div
                                    className={clsx('h-full transition-all duration-300', config.progressClass)}
                                    style={{ width: `${Math.min(100, Math.max(0, notification.progress))}%` }}
                                />
                            </div>
                        )}

                        {/* Input field */}
                        {notification.input && (
                            <div className="mt-3">
                                <div className="flex items-center gap-2">
                                    <input
                                        ref={inputRef}
                                        type={notification.input.type || 'text'}
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder={notification.input.placeholder || 'Type here...'}
                                        className={clsx(
                                            'flex-1 px-3 py-2 text-sm rounded-lg',
                                            'bg-theme-input border border-theme',
                                            'text-theme-fg placeholder:text-theme-muted',
                                            'focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20',
                                            'transition-all'
                                        )}
                                    />
                                    <button
                                        onClick={handleInputSubmit}
                                        className={clsx(
                                            'p-2 rounded-lg bg-primary text-primary-fg',
                                            'hover:opacity-90 active:scale-95 transition-all'
                                        )}
                                    >
                                        <Send className="w-4 h-4" />
                                    </button>
                                </div>
                                {(notification.input.cancelText) && (
                                    <button
                                        onClick={handleInputCancel}
                                        className="mt-2 text-xs text-theme-muted hover:text-theme-fg transition-colors"
                                    >
                                        {notification.input.cancelText || 'Cancel'}
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Action buttons */}
                        {notification.actions && notification.actions.length > 0 && (
                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                                {notification.actions.map((action, index) => (
                                    <button
                                        key={index}
                                        onClick={() => {
                                            action.onClick();
                                            handleDismiss();
                                        }}
                                        className={getButtonStyles(action.variant)}
                                    >
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Dismiss button */}
                    {notification.dismissible && (
                        <button
                            onClick={handleDismiss}
                            className={clsx(
                                'shrink-0 p-1.5 rounded-lg',
                                'text-theme-muted hover:text-theme-fg',
                                'hover:bg-theme-hover active:bg-theme-active',
                                'transition-all'
                            )}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
