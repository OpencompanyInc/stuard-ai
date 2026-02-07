import React, { useEffect, useRef } from 'react';
import { NotificationProvider, useNotification, NotificationConfig } from './components/NotificationSystem';

// Component to handle IPC events and show notifications
const NotificationListener = () => {
    const { show, update } = useNotification();

    useEffect(() => {
        // Listen for show-notification events from Main process
        const removeListener = (window as any).desktopAPI?.onShowNotification?.((config: NotificationConfig) => {
            // Logic to recreate functions if we had an event bus (omitted for now)
            show(config);
        });

        // Expose demo for testing directly in this window
        (window as any).runNotificationDemo = () => {
            console.log('Running Notification Demo (Overlay Window)...');

            // 1. Success
            show({
                title: 'System Online',
                message: 'Notification system is working perfectly.',
                variant: 'success',
                sound: true
            });

            // 2. Info with Progress
            setTimeout(() => {
                const id = show({
                    title: 'Processing Data',
                    message: 'Analyzing local files...',
                    variant: 'info',
                    progress: 0,
                    duration: 0
                });

                let p = 0;
                const interval = setInterval(() => {
                    p += 10;
                    if (p > 100) {
                        clearInterval(interval);
                        update(id, { title: 'Processing Complete', progress: 100, duration: 3000, variant: 'success' });
                    } else {
                        update(id, { progress: p });
                    }
                }, 200);
            }, 1000);

            // 3. Image
            setTimeout(() => {
                show({
                    title: 'Screenshot Saved',
                    message: 'Saved to capture.png',
                    variant: 'info',
                    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=200&auto=format&fit=crop',
                });
            }, 4000);
        };

        // Auto-run demo on mount for immediate feedback
        /*
        setTimeout(() => {
            if ((window as any).runNotificationDemo) {
                (window as any).runNotificationDemo();
            }
        }, 1500);
        */

        return () => {
            removeListener && removeListener();
            delete (window as any).runNotificationDemo;
        };
    }, [show, update]);

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
