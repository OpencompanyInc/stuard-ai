import React, { useEffect } from 'react';
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
        setTimeout(() => {
            if ((window as any).runNotificationDemo) {
                (window as any).runNotificationDemo();
            }
        }, 1500);

        return () => {
            removeListener && removeListener();
            delete (window as any).runNotificationDemo;
        };
    }, [show, update]);

    return null;
};

export const NotificationApp = () => {
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const isInteractive = el?.closest('.pointer-events-auto');

            if (isInteractive) {
                (window as any).desktopAPI?.setIgnoreMouseEvents?.(false);
            } else {
                (window as any).desktopAPI?.setIgnoreMouseEvents?.(true, { forward: true });
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);

    return (
        <NotificationProvider defaultPosition="top-right" maxNotifications={6}>
            <div className="w-screen h-screen overflow-hidden pointer-events-none">
                <NotificationListener />
            </div>
        </NotificationProvider>
    );
};
