import React, { useEffect, useRef } from 'react';
import { NotificationProvider, useNotification, NotificationConfig } from './components/NotificationSystem';
import { useNotificationTheme } from './components/NotificationSystem/useNotificationTheme';
import { normalizeAskUserPrompt } from '@stuardai/chat-ui/askUserPromptUtils';

type InteractiveNotificationConfig = NotificationConfig & {
    permissionRequest?: any;
    responseId?: string;
    askUser?: {
        type?: string;
        options?: any[];
    };
};

function buildOrchestratorDoneActions() {
    return [
        {
            label: 'Open Chat',
            variant: 'primary' as const,
            onClick: () => {
                try {
                    (window as any).desktopAPI?.show?.();
                } catch { /* no-op */ }
            },
        },
    ];
}

// Component to handle IPC events and show notifications
const NotificationListener = () => {
    const { show, update, dismiss } = useNotification();

    useEffect(() => {
        // Listen for show-notification events from Main process
        const removeListener = (window as any).desktopAPI?.onShowNotification?.((config: InteractiveNotificationConfig) => {
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
                    id: config.id || id,
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

            if (config.orchestratorDone) {
                show({
                    ...config,
                    className: config.className || 'stuard-notification',
                    actions: config.actions?.length ? config.actions : buildOrchestratorDoneActions(),
                });
                return;
            }

            const responseId = typeof config.responseId === 'string' ? config.responseId : '';
            if (!responseId) {
                show({
                    ...config,
                    className: config.className || 'stuard-notification',
                });
                return;
            }

            let hasResponded = false;
            const respond = (type: 'submit' | 'cancel' | 'dismiss', value?: string) => {
                if (hasResponded) return;
                hasResponded = true;
                try {
                    (window as any).desktopAPI?.respondToNotification?.({ responseId, type, value });
                } catch {
                    // no-op
                }
            };

            const askUserPrompt = config.askUser
                ? normalizeAskUserPrompt({
                    title: config.title,
                    message: config.message,
                    type: config.askUser?.type,
                    options: config.askUser?.options,
                    placeholder: config.input?.placeholder,
                })
                : null;
            const askUserQuestion = askUserPrompt?.pages[0]?.questions[0];

            const actions = askUserQuestion?.type === 'confirm'
                ? [
                    {
                        label: 'No',
                        variant: 'secondary' as const,
                        onClick: () => respond('submit', 'no'),
                    },
                    {
                        label: 'Yes',
                        variant: 'primary' as const,
                        onClick: () => respond('submit', 'yes'),
                    },
                ]
                : askUserQuestion?.type === 'choices'
                    ? askUserQuestion.options.map((option) => ({
                        label: option.label,
                        variant: 'secondary' as const,
                        onClick: () => respond('submit', option.id),
                    }))
                    : config.actions;

            const input = askUserQuestion
                ? (askUserQuestion.type === 'text'
                    ? {
                        ...(config.input || {}),
                        placeholder: askUserQuestion.placeholder || config.input?.placeholder || 'Type here...',
                        onSubmit: (value: string) => respond('submit', value),
                        onCancel: () => respond('cancel'),
                    }
                    : undefined)
                : (config.input ? {
                    ...config.input,
                    onSubmit: (value: string) => respond('submit', value),
                    onCancel: () => respond('cancel'),
                } : config.input);

            show({
                ...config,
                onDismiss: () => respond('dismiss'),
                input,
                actions,
            });
        });

        const removeDismissListener = (window as any).desktopAPI?.onDismissNotification?.((data: { id: string }) => {
            if (data?.id) {
                dismiss(data.id);
            }
        });

        // Listen for proactive check-in notifications (with reply support)
        const CHECKIN_ID = 'proactive-checkin';
        const removeProactive = (window as any).desktopAPI?.onProactiveCheckin?.((data: any) => {
            const { wakeUpId, agentMessage, structuredContent, screenshotUsed, tasksCompleted, isFollowUp } = data;

            show({
                id: CHECKIN_ID,
                title: isFollowUp ? 'Stuard' : 'Check-in',
                message: agentMessage,
                structuredContent,
                variant: 'info',
                position: 'top-right',
                duration: 0,
                dismissible: true,
                className: 'stuard-notification',
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
                            (window as any).desktopAPI?.openWorkflows?.({ view: 'agents' });
                        },
                    },
                ],
            });
        });

        return () => {
            removeListener && removeListener();
            removeDismissListener && removeDismissListener();
            removeProactive && removeProactive();
        };
    }, [show, update, dismiss]);

    return null;
};

export const NotificationApp = () => {
    useNotificationTheme();

    return (
        <NotificationProvider defaultPosition="top-right" maxNotifications={6} topInset={96}>
            <NotificationOverlayHandler />
            <div className="w-screen h-screen overflow-hidden pointer-events-none stuard-notification-shell">
                <NotificationListener />
            </div>
        </NotificationProvider>
    );
};

const NotificationOverlayHandler = () => {
    const { notifications } = useNotification();
    const lastIgnoreRef = useRef<boolean | null>(null);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Filter out ghost notifications (empty title + very short duration used for dismissal)
    const visibleCount = notifications.filter(n => !!(n.title || n.message || n.structuredContent)).length;

    // When there are no visible toasts, hide the always-on-top overlay window
    // after the exit animation so it doesn't sit above compact mode.
    useEffect(() => {
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        }
        if (visibleCount === 0) {
            idleTimerRef.current = setTimeout(() => {
                (window as any).desktopAPI?.notificationsIdle?.();
            }, 400);
        }
        return () => {
            if (idleTimerRef.current) {
                clearTimeout(idleTimerRef.current);
                idleTimerRef.current = null;
            }
        };
    }, [visibleCount]);

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
