import React, { useEffect, useRef } from 'react';
import { NotificationProvider, useNotification, NotificationConfig } from './components/NotificationSystem';

// Component to handle IPC events and show notifications
const NotificationListener = () => {
    const { show, update, dismiss } = useNotification();

    useEffect(() => {
        // Listen for show-notification events from Main process
        const removeListener = (window as any).desktopAPI?.onShowNotification?.((config: NotificationConfig) => {
            show(config);
        });

        // Listen for proactive progress stages (visualizer toast)
        const PROGRESS_ID = 'proactive-progress';
        const removeProgress = (window as any).desktopAPI?.onProactiveProgress?.((data: any) => {
            const { stage, label, progress, detail } = data;

            if (stage === 'complete' || stage === 'failed') {
                show({
                    id: PROGRESS_ID,
                    title: '✦ Stuard Waking Up',
                    message: detail ? `${label}\n${detail}` : label,
                    variant: stage === 'failed' ? 'error' : 'success',
                    position: 'top-right',
                    duration: 12000,
                    dismissible: true,
                    progress: 100,
                });
                return;
            }

            show({
                id: PROGRESS_ID,
                title: '✦ Stuard Waking Up',
                message: detail ? `${label}\n${detail}` : label,
                variant: 'neutral',
                position: 'top-right',
                duration: 0,
                dismissible: true,
                progress,
            });
        });

        // Listen for proactive check-in notifications (with reply support)
        const removeProactive = (window as any).desktopAPI?.onProactiveCheckin?.((data: any) => {
            const { wakeUpId, agentMessage, screenshotUsed, tasksCompleted } = data;

            dismiss(PROGRESS_ID);

            show({
                title: '✦ Stuard Check-in',
                message: agentMessage,
                variant: 'info',
                position: 'top-right',
                duration: 0,
                dismissible: true,
                sound: true,
                input: {
                    placeholder: 'Reply to Stuard...',
                    submitText: 'Send',
                    onSubmit: (value: string) => {
                        (window as any).desktopAPI?.proactiveReply?.({ wakeUpId, text: value });
                    },
                },
                actions: [
                    {
                        label: 'Open Chat',
                        variant: 'primary',
                        onClick: () => {
                            (window as any).desktopAPI?.openDashboard?.({ tab: 'proactive' });
                        },
                    },
                ],
            });
        });

        return () => {
            removeListener && removeListener();
            removeProgress && removeProgress();
            removeProactive && removeProactive();
        };
    }, [show, update, dismiss]);

    return null;
};

export const NotificationApp = () => {
    return (
        <NotificationProvider defaultPosition="top-right" maxNotifications={6}>
            <NotificationOverlayHandler />
            <div className="w-screen h-screen overflow-hidden pointer-events-none">
                <NotificationListener />
            </div>
        </NotificationProvider>
    );
};

const NotificationOverlayHandler = () => {
    const { notifications } = useNotification();
    const lastIgnoreRef = useRef<boolean | null>(null);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            // If no notifications, we should be completely click-through without forwarding to avoid flicker
            if (notifications.length === 0) {
                if (lastIgnoreRef.current !== true) {
                    (window as any).desktopAPI?.setIgnoreMouseEvents?.(true);
                    lastIgnoreRef.current = true;
                }
                return;
            }

            const el = document.elementFromPoint(e.clientX, e.clientY);
            // elementFromPoint skips pointer-events: none, so if we hit something 
            // that isn't the body or html, it MUST be a notification element.
            const isInteractive = !!(el && el !== document.body && el !== document.documentElement);
            const shouldIgnore = !isInteractive;

            // Only update if state changed to avoid rapid cursor flickering and IPC spam
            if (lastIgnoreRef.current !== shouldIgnore) {
                if (shouldIgnore) {
                    // Use forward: true when notifications ARE present so we can detect when mouse enters them
                    (window as any).desktopAPI?.setIgnoreMouseEvents?.(true, { forward: true });
                } else {
                    (window as any).desktopAPI?.setIgnoreMouseEvents?.(false);
                }
                lastIgnoreRef.current = shouldIgnore;
            }
        };

        window.addEventListener('mousemove', handleMouseMove);

        // Initial state
        if (notifications.length === 0) {
            (window as any).desktopAPI?.setIgnoreMouseEvents?.(true);
            lastIgnoreRef.current = true;
        } else {
            // Force a check if notifications appear while mouse is already there
            (window as any).desktopAPI?.setIgnoreMouseEvents?.(true, { forward: true });
            lastIgnoreRef.current = true;
        }

        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [notifications.length]);

    return null;
};
