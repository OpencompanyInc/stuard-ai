import React, { useEffect } from 'react';

interface NotificationControllerProps {
    subscribeProgress: (callback: (event: any) => void) => () => void;
}

export const NotificationController: React.FC<NotificationControllerProps> = ({ subscribeProgress }) => {
    useEffect(() => {
        // Expose demo for testing from main window console
        (window as any).runNotificationDemo = () => {
            console.log('Running Notification Demo (via IPC)...');

            // 1. Success
            (window as any).desktopAPI?.notify({
                title: 'System Online',
                message: 'Notification system is working perfectly (IPC).',
                variant: 'success',
                sound: true,
                className: 'stuard-notification',
            });

            // 2. Info (No progress bar support via simple IPC notify yet, sending generic)
            setTimeout(() => {
                (window as any).desktopAPI?.notify({
                    title: 'Processing Data',
                    message: 'Analyzing local files...',
                    variant: 'info',
                    className: 'stuard-notification',
                });
            }, 1000);

            // 3. Image
            setTimeout(() => {
                (window as any).desktopAPI?.notify({
                    title: 'Screenshot Saved',
                    message: 'Saved to capture.png',
                    variant: 'info',
                    className: 'stuard-notification',
                    image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=200&auto=format&fit=crop',
                });
            }, 3500);
        };

        // Events subscription
        const unsub = subscribeProgress((evt: any) => {
            const d = evt.data || {};

            if (evt.event === 'notification') {
                (window as any).desktopAPI?.notify({
                    title: d.title || 'Notification',
                    message: d.body,
                    variant: (d.variant as any) || 'info',
                    sound: true,
                    className: 'stuard-notification',
                });
            }
            else if (evt.event === 'reminder_triggered') {
                (window as any).desktopAPI?.notify({
                    title: 'Reminder',
                    message: d.message,
                    variant: 'neutral',
                    sound: true,
                    duration: 0,
                    className: 'stuard-notification',
                });
            }
        });

        return () => {
            unsub();
            delete (window as any).runNotificationDemo;
        };
    }, [subscribeProgress]);

    return null;
};
