import React, { useEffect, useRef } from 'react';
import { NotificationProvider, useNotification, NotificationConfig } from './components/NotificationSystem';

// Component to handle IPC events and show notifications
const NotificationListener = () => {
    const { show, update, dismiss } = useNotification();

    useEffect(() => {
        // Listen for show-notification events from Main process
        const removeListener = (window as any).desktopAPI?.onShowNotification?.((config: NotificationConfig & { permissionRequest?: any }) => {
            // If this is a permission request, inject Accept/Reject actions
            if (config.permissionRequest) {
                const { id, tool, args, description } = config.permissionRequest;
                const toolLabel = tool.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

                // Build a short summary of the args
                let argsSummary = '';
                if (args && typeof args === 'object') {
                    const importantKeys = ['command', 'path', 'code', 'query', 'file', 'content', 'to', 'subject'];
                    for (const key of importantKeys) {
                        if (args[key]) {
                            const val = String(args[key]);
                            argsSummary = val.length > 80 ? val.slice(0, 80) + '...' : val;
                            break;
                        }
                    }
                    if (!argsSummary) {
                        const firstKey = Object.keys(args)[0];
                        if (firstKey) {
                            const val = String(args[firstKey]);
                            argsSummary = val.length > 80 ? val.slice(0, 80) + '...' : val;
                        }
                    }
                }

                const message = [
                    description || `Stuard wants to use **${toolLabel}**`,
                    argsSummary ? `\n\`${argsSummary}\`` : '',
                ].join('');

                show({
                    ...config,
                    message,
                    actions: [
                        {
                            label: 'Deny',
                            variant: 'secondary',
                            onClick: () => {
                                (window as any).desktopAPI?.respondToPermission?.(id, false);
                            },
                        },
                        {
                            label: 'Allow',
                            variant: 'primary',
                            onClick: () => {
                                (window as any).desktopAPI?.respondToPermission?.(id, true);
                            },
                        },
                    ],
                });
                return;
            }

            show(config);
        });

        // Listen for proactive check-in notifications (with reply support)
        const CHECKIN_ID = 'proactive-checkin';
        const removeProactive = (window as any).desktopAPI?.onProactiveCheckin?.((data: any) => {
            const { wakeUpId, agentMessage, structuredContent, screenshotUsed, tasksCompleted, isFollowUp } = data;

            show({
                id: CHECKIN_ID,
                title: isFollowUp ? '✦ Stuard' : '✦ Stuard Check-in',
                message: agentMessage,
                structuredContent,
                variant: 'info',
                position: 'top-right',
                duration: 0,
                dismissible: true,
                sound: !isFollowUp,
                input: {
                    placeholder: 'Reply to Stuard...',
                    submitText: 'Send',
                    keepAfterSubmit: false,
                    onSubmit: (value: string) => {
                        // Dismiss the notification immediately while waiting for the response
                        dismiss(CHECKIN_ID);
                        (window as any).desktopAPI?.proactiveReply?.({ wakeUpId, text: value });
                    },
                },
                actions: [
                    {
                        label: 'Open Chat',
                        variant: 'primary',
                        keepNotification: true,
                        onClick: () => {
                            (window as any).desktopAPI?.openDashboard?.({ tab: 'proactive' });
                        },
                    },
                ],
            });
        });

        return () => {
            removeListener && removeListener();
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

    // Filter out ghost notifications (empty title + very short duration used for dismissal)
    const visibleCount = notifications.filter(n => !!(n.title || n.message || n.structuredContent)).length;

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            // If no visible notifications, stay completely click-through without forwarding to avoid flicker
            if (visibleCount === 0) {
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
        if (visibleCount === 0) {
            (window as any).desktopAPI?.setIgnoreMouseEvents?.(true);
            lastIgnoreRef.current = true;
        } else {
            // Force a check if notifications appear while mouse is already there
            (window as any).desktopAPI?.setIgnoreMouseEvents?.(true, { forward: true });
            lastIgnoreRef.current = true;
        }

        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [visibleCount]);

    return null;
};
