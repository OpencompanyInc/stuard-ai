import React, { createContext, useContext, useCallback, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    NotificationConfig,
    NotificationState,
    NotificationContextValue,
    NotificationPosition,
} from './types';
import { NotificationItem } from './NotificationItem';
import { getNotificationSound, NOTIFICATION_CHIME } from './sounds';

const NotificationContext = createContext<NotificationContextValue | null>(null);

export const useNotification = (): NotificationContextValue => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotification must be used within a NotificationProvider');
    }
    return context;
};

interface NotificationProviderProps {
    children: React.ReactNode;
    defaultDuration?: number;
    defaultPosition?: NotificationPosition;
    maxNotifications?: number;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({
    children,
    defaultDuration = 5000,
    defaultPosition = 'bottom-left',
    maxNotifications = 5,
}) => {
    const [notifications, setNotifications] = useState<NotificationState[]>([]);
    const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Generate unique ID
    const generateId = useCallback(() => {
        return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }, []);

    // Play notification sound
    const playSound = useCallback((sound: NotificationConfig['sound'], variant: NotificationConfig['variant'] = 'info') => {
        if (!sound) return;

        let src = NOTIFICATION_CHIME;
        let volume = 0.5;

        if (typeof sound === 'object') {
            src = sound.src || getNotificationSound(variant || 'info');
            volume = sound.volume ?? 0.5;
        } else if (sound === true) {
            // Use variant-appropriate sound
            src = getNotificationSound(variant || 'info');
        }

        try {
            if (!audioRef.current) {
                audioRef.current = new Audio();
            }
            audioRef.current.src = src;
            audioRef.current.volume = Math.max(0, Math.min(1, volume));
            audioRef.current.play().catch(() => {
                // Audio play failed, likely due to autoplay policy
            });
        } catch {
            // Audio not supported
        }
    }, []);

    // Show notification
    const show = useCallback((config: NotificationConfig): string => {
        const id = config.id || generateId();
        const duration = config.duration ?? defaultDuration;

        const notification: NotificationState = {
            id,
            title: config.title,
            message: config.message,
            structuredContent: config.structuredContent,
            variant: config.variant || 'info',
            position: config.position || defaultPosition,
            image: config.image,
            sound: config.sound,
            input: config.input,
            actions: config.actions,
            dismissible: config.dismissible ?? true,
            icon: config.icon,
            onDismiss: config.onDismiss,
            progress: config.progress,
            className: config.className,
            createdAt: Date.now(),
            duration,
        };

        setNotifications((prev) => {
            const existingIndex = prev.findIndex((n) => n.id === id);

            if (existingIndex >= 0) {
                // In-place update — avoids unmount/remount blink
                const updated = [...prev];
                updated[existingIndex] = notification;
                return updated;
            }

            // New notification — prepend and limit to max
            return [notification, ...prev].slice(0, maxNotifications);
        });

        // Play sound
        if (config.sound) {
            playSound(config.sound, config.variant);
        }

        // Set auto-dismiss timer if duration > 0
        if (duration > 0) {
            // Clear existing timer for this ID
            const existingTimer = timersRef.current.get(id);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timer = setTimeout(() => {
                dismiss(id);
            }, duration);

            timersRef.current.set(id, timer);
        }

        return id;
    }, [defaultDuration, defaultPosition, generateId, maxNotifications, playSound]);

    // Dismiss notification
    const dismiss = useCallback((id: string) => {
        setNotifications((prev) => {
            const notification = prev.find((n) => n.id === id);
            if (notification?.onDismiss) {
                notification.onDismiss();
            }
            return prev.filter((n) => n.id !== id);
        });

        // Clear timer
        const timer = timersRef.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
    }, []);

    // Dismiss all notifications
    const dismissAll = useCallback(() => {
        notifications.forEach((n) => {
            if (n.onDismiss) {
                n.onDismiss();
            }
        });
        setNotifications([]);

        // Clear all timers
        timersRef.current.forEach((timer) => clearTimeout(timer));
        timersRef.current.clear();
    }, [notifications]);

    // Update notification
    const update = useCallback((id: string, config: Partial<NotificationConfig>) => {
        setNotifications((prev) =>
            prev.map((n) => {
                if (n.id !== id) return n;
                return {
                    ...n,
                    ...config,
                    // Preserve non-overridable fields
                    id: n.id,
                    createdAt: n.createdAt,
                } as NotificationState;
            })
        );
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            timersRef.current.forEach((timer) => clearTimeout(timer));
        };
    }, []);

    const value: NotificationContextValue = {
        notifications,
        show,
        dismiss,
        dismissAll,
        update,
    };

    // Group notifications by position
    const groupedNotifications = notifications.reduce<Record<NotificationPosition, NotificationState[]>>(
        (acc, notification) => {
            const pos = notification.position;
            if (!acc[pos]) acc[pos] = [];
            acc[pos].push(notification);
            return acc;
        },
        {
            'top-left': [],
            'top-right': [],
            'bottom-left': [],
            'bottom-right': [],
        }
    );

    return (
        <NotificationContext.Provider value={value}>
            {children}
            {createPortal(
                <>
                    {(Object.keys(groupedNotifications) as NotificationPosition[]).map((position) => {
                        const items = groupedNotifications[position];
                        if (items.length === 0) return null;

                        return (
                            <NotificationContainer key={position} position={position}>
                                {items.map((notification) => (
                                    <NotificationItem
                                        key={notification.id}
                                        notification={notification}
                                        onDismiss={() => dismiss(notification.id)}
                                    />
                                ))}
                            </NotificationContainer>
                        );
                    })}
                </>,
                document.getElementById('notification-root') || document.body
            )}
        </NotificationContext.Provider>
    );
};

interface NotificationContainerProps {
    position: NotificationPosition;
    children: React.ReactNode;
}

const NotificationContainer: React.FC<NotificationContainerProps> = ({ position, children }) => {
    const positionStyles: React.CSSProperties = {
        position: 'fixed',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px',
        pointerEvents: 'none',
        maxWidth: '420px',
        maxHeight: 'calc(100vh - 24px)',
        overflowY: 'auto',
        overflowX: 'hidden',
    };

    const positionMap: Record<NotificationPosition, React.CSSProperties> = {
        'top-left': { top: 0, left: 0 },
        'top-right': { top: 0, right: 0 },
        'bottom-left': { bottom: 0, left: 0 },
        'bottom-right': { bottom: 0, right: 0 },
    };

    // Reverse order for bottom positions (newest at bottom)
    const isBottom = position.startsWith('bottom');

    return (
        <div
            style={{
                ...positionStyles,
                ...positionMap[position],
                flexDirection: isBottom ? 'column-reverse' : 'column',
            }}
            className="notification-container custom-scrollbar"
        >
            {children}
        </div>
    );
};

export { NotificationContext };
