// Background script to communicate with Stuard Desktop App

const WS_URL = 'ws://127.0.0.1:18081';
const RECONNECT_INTERVAL = 3000;
const RECONNECT_ALARM = 'stuard-reconnect';
const RECONNECT_ALARM_PERIOD_MINUTES = 1;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isConnected = false;

function ensureReconnectAlarm() {
    chrome.alarms.create(RECONNECT_ALARM, {
        periodInMinutes: RECONNECT_ALARM_PERIOD_MINUTES,
    });
}

interface ActivityLog {
    timestamp: number;
    action: string;
    status: 'pending' | 'success' | 'error';
    details?: string;
}

const activityLog: ActivityLog[] = [];
const MAX_LOG_ENTRIES = 50;

function addActivity(action: string, status: 'pending' | 'success' | 'error' = 'pending', details?: string) {
    const entry: ActivityLog = {
        timestamp: Date.now(),
        action,
        status,
        details
    };
    activityLog.unshift(entry);
    if (activityLog.length > MAX_LOG_ENTRIES) {
        activityLog.pop();
    }
    chrome.runtime.sendMessage({ type: 'activity', log: activityLog.slice(0, 20) }).catch(() => {});
}

function setConnected(state: boolean) {
    isConnected = state;
    chrome.action.setBadgeText({ text: state ? '' : '!' });
    chrome.action.setBadgeBackgroundColor({ color: state ? '#10b981' : '#ef4444' });

    if (state) {
        addActivity('Connected to Stuard', 'success');
    } else {
        addActivity('Disconnected from Stuard', 'error');
    }

    chrome.runtime.sendMessage({ type: 'status', connected: isConnected }).catch(() => {});
}

function connect() {
    if (socket) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) return;
    }

    console.log('[Stuard-Ext] Connecting to Desktop App...');

    try {
        socket = new WebSocket(WS_URL);
    } catch (e) {
        console.error('[Stuard-Ext] Failed to create WebSocket:', e);
        scheduleReconnect();
        return;
    }

    socket.onopen = () => {
        console.log('[Stuard-Ext] Connected to Stuard Desktop');
        setConnected(true);
        socket?.send(JSON.stringify({ type: 'identify', client: 'extension' }));
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('[Stuard-Ext] Received:', data);
            handleMessage(data);
        } catch (e) {
            console.error('[Stuard-Ext] Failed to parse message:', e);
        }
    };

    socket.onclose = () => {
        console.log('[Stuard-Ext] Disconnected');
        setConnected(false);
        socket = null;
        scheduleReconnect();
    };

    socket.onerror = (error) => {
        console.error('[Stuard-Ext] WebSocket error:', error);
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            scheduleReconnect();
        }
    };
}

function scheduleReconnect() {
    if (!reconnectTimer) {
        console.log('[Stuard-Ext] Reconnecting in 3s...');
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, RECONNECT_INTERVAL);
    }
}

// Actions that target specific elements - should broadcast to all frames
const ELEMENT_TARGETING_ACTIONS = new Set([
    'click', 'type', 'hover', 'select_option', 'wait_for_element',
    'fill_form', 'get_form_fields', 'get_element_position', 'find_clickable',
    'find_text', 'scroll_to', 'press_key', 'upload_file', 'set_toggle'
]);

// Actions that should only run in the top frame
const PAGE_LEVEL_ACTIONS = new Set([
    'get_content', 'get_page_info', 'execute_script', 'ping'
]);

function isUnknownActionError(response: any): boolean {
    const error = response?.error;
    return typeof error === 'string' && error.startsWith('Unknown action:');
}

async function reinjectContentScripts(tabId: number): Promise<{ ok: boolean; error?: string }> {
    try {
        const manifest = chrome.runtime.getManifest() as any;
        const contentScripts = Array.isArray(manifest?.content_scripts) ? manifest.content_scripts : [];
        const scriptFiles: string[] = Array.from(
            new Set(
                contentScripts
                    .flatMap((entry: any) => Array.isArray(entry?.js) ? entry.js : [])
                    .filter((file: unknown): file is string => typeof file === 'string' && file.length > 0)
            )
        );

        if (scriptFiles.length === 0) {
            return { ok: false, error: 'no_content_scripts_configured' };
        }

        for (const file of scriptFiles) {
            await chrome.scripting.executeScript({
                target: { tabId, allFrames: true },
                files: [file],
            });
        }

        await new Promise((resolve) => setTimeout(resolve, 150));
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message || 'failed_to_reinject_content_scripts' };
    }
}

async function dispatchActionToTab(
    tabId: number,
    actionName: string,
    message: any,
    targetOverride?: 'content' | 'content_v2'
): Promise<any> {
    const outboundMessage = targetOverride ? { ...message, target: targetOverride } : message;

    if (ELEMENT_TARGETING_ACTIONS.has(actionName)) {
        // Broadcast to all frames - first success wins
        return Promise.race([
            broadcastToFrames(tabId, outboundMessage),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 25000)
            )
        ]).catch((err) => {
            return { ok: false, error: err.message || 'timeout' };
        });
    }

    // Page-level action - send to top frame only
    return Promise.race([
        chrome.tabs.sendMessage(tabId, outboundMessage),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 25000)
        )
    ]).catch((err) => {
        return { ok: false, error: err.message || 'timeout' };
    });
}

async function ensureContentScriptInjected(tabId: number): Promise<{ ok: boolean; error?: string }> {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { target: 'content', action: 'ping' }).catch(() => null);
        if (response && response.ok) {
            return { ok: true };
        }
    } catch {}

    try {
        const tab = await chrome.tabs.get(tabId);

        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
            tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:') ||
            tab.url.startsWith('file://')) {
            return { ok: false, error: `Cannot control this page` };
        }

        await new Promise(resolve => setTimeout(resolve, 200));

        const retryResponse = await chrome.tabs.sendMessage(tabId, { target: 'content', action: 'ping' }).catch(() => null);
        if (retryResponse && retryResponse.ok) {
            return { ok: true };
        }

        return { ok: false, error: 'Please refresh the page' };
    } catch (e: any) {
        return { ok: false, error: e.message || 'Failed to connect to page' };
    }
}

/**
 * Broadcast an action to all frames in a tab.
 * Tries top frame first, then each iframe. Returns the first successful response.
 */
async function broadcastToFrames(tabId: number, message: any): Promise<any> {
    let frames: chrome.webNavigation.GetAllFrameResultDetails[] | null = null;
    try {
        frames = await chrome.webNavigation.getAllFrames({ tabId });
    } catch {
        // Fallback: just send to tab (top frame)
        return chrome.tabs.sendMessage(tabId, message).catch(() => null);
    }

    if (!frames || frames.length === 0) {
        return { ok: false, error: 'no_frames_found' };
    }

    // Sort: top frame (0) first, then others
    frames.sort((a, b) => (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : 0));

    let lastError = 'element_not_found_in_any_frame';
    // Prefer specific errors over generic "Unknown action:*" from stale frames
    let hasSpecificError = false;

    for (const frame of frames) {
        try {
            const response = await Promise.race([
                chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('frame_timeout')), 5000)
                )
            ]).catch(() => null);

            if (response && (response as any).ok) {
                // Add frame info to response
                const result = response as any;
                result.result = result.result || {};
                if (typeof result.result === 'object') {
                    result.result._frame = {
                        frameId: frame.frameId,
                        url: frame.url || 'unknown'
                    };
                }
                return result;
            }

            if (response && (response as any).error) {
                const err = (response as any).error as string;
                const isStaleError = typeof err === 'string' && err.startsWith('Unknown action:');
                // Don't let stale-frame "Unknown action" errors overwrite real errors
                if (!isStaleError) {
                    lastError = err;
                    hasSpecificError = true;
                } else if (!hasSpecificError) {
                    lastError = err;
                }
            }
        } catch {
            // Frame didn't respond, try next
        }
    }

    return { ok: false, error: lastError };
}

async function handleMessage(message: any) {
    if (message.requestId) {
        if (message.target === 'content') {
            const actionName = message.action || 'unknown';
            addActivity(actionName, 'pending');

            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

                if (!tabs[0]?.id) {
                    addActivity(actionName, 'error', 'No active tab');
                    sendResponse(message.requestId, { ok: false, error: 'no_active_tab' });
                    return;
                }

                const tabId = tabs[0].id;
                const checkResult = await ensureContentScriptInjected(tabId);
                if (!checkResult.ok) {
                    addActivity(actionName, 'error', checkResult.error);
                    sendResponse(message.requestId, {
                        ok: false,
                        error: checkResult.error || 'content_script_not_ready',
                    });
                    return;
                }

                let response = await dispatchActionToTab(tabId, actionName, message);

                // If content script on the page is stale (e.g. extension updated but tab not refreshed),
                // reinject the latest scripts and retry once.
                // Retry uses target=content_v2 so legacy listeners (which only accept target=content)
                // do not race and return stale "Unknown action" errors first.
                if (isUnknownActionError(response)) {
                    const reinject = await reinjectContentScripts(tabId);
                    if (reinject.ok) {
                        response = await dispatchActionToTab(tabId, actionName, message, 'content_v2');
                    } else {
                        response = {
                            ok: false,
                            error: `${response.error} (retry failed: ${reinject.error})`,
                        };
                    }
                }

                if (response === undefined) {
                    addActivity(actionName, 'error', 'No response');
                    sendResponse(message.requestId, { ok: false, error: 'no_response' });
                    return;
                }

                if ((response as any)?.ok) {
                    addActivity(actionName, 'success');
                } else {
                    addActivity(actionName, 'error', (response as any)?.error || 'Failed');
                }

                sendResponse(message.requestId, response);

            } catch (e: any) {
                addActivity(actionName, 'error', e.message);
                sendResponse(message.requestId, { ok: false, error: e.message || 'unknown_error' });
            }
        }
    } else if (message.type === 'navigate') {
        if (message.url) {
            chrome.tabs.create({ url: message.url });
        }
    }
}

function sendResponse(requestId: string, payload: any) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'response',
            requestId,
            payload
        }));
    }
}

connect();
ensureReconnectAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== RECONNECT_ALARM) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        connect();
    }
});

chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (message.type === 'get_status') {
        sendResponse({ connected: isConnected });
    } else if (message.type === 'get_activity') {
        sendResponse({ log: activityLog.slice(0, 20) });
    } else if (message.type === 'send_chat') {
        // Send a chat message from the popup to Stuard Desktop
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            sendResponse({ ok: false, error: 'Not connected to Stuard Desktop' });
            return true;
        }

        const msgId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Get current tab context for the message
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            const pageContext = tab ? {
                url: tab.url || '',
                title: tab.title || '',
                tabId: tab.id,
            } : undefined;

            socket!.send(JSON.stringify({
                type: 'chat_message',
                text: message.text,
                messageId: msgId,
                pageContext,
            }));

            addActivity('Sent message', 'success', message.text.substring(0, 60));
            sendResponse({ ok: true, messageId: msgId });
        });
        return true; // Keep channel open for async
    } else if (message.type === 'get_page_context') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs[0];
            sendResponse({
                url: tab?.url || '',
                title: tab?.title || '',
                tabId: tab?.id,
            });
        });
        return true;
    }
    return true;
});

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(ensureReconnectAlarm);
chrome.runtime.onInstalled.addListener(ensureReconnectAlarm);

setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        connect();
    }
}, 25000);

chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
        console.log('[Stuard-Ext] Tab ready:', tabId, tab.url?.substring(0, 50));
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            connect();
        }
    }
});

chrome.tabs.onActivated.addListener(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        connect();
    }
});
