// Background script to communicate with Stuard Desktop App

const WS_URL = 'ws://127.0.0.1:18081';
const RECONNECT_INTERVAL = 3000;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isConnected = false;

function setConnected(state: boolean) {
    isConnected = state;
    // Update badge to show connection status
    chrome.action.setBadgeText({ text: state ? '' : '!' });
    chrome.action.setBadgeBackgroundColor({ color: state ? '#4CAF50' : '#F44336' });

    chrome.runtime.sendMessage({ type: 'status', connected: isConnected }).catch(() => {
        // Popup might be closed, ignore
    });
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
        // Identify ourselves
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
        // Don't call close() here - onclose will be triggered automatically
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

async function ensureContentScriptInjected(tabId: number): Promise<{ ok: boolean; error?: string }> {
    try {
        // First, try to ping the content script
        const response = await chrome.tabs.sendMessage(tabId, { target: 'content', action: 'ping' }).catch(() => null);
        if (response && response.ok) {
            return { ok: true }; // Content script is already there and responding
        }
    } catch {
        // Content script not responding
    }

    try {
        // Get tab info to check if we can inject
        const tab = await chrome.tabs.get(tabId);

        // Can't inject into chrome:// or edge:// pages
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
            tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:') ||
            tab.url.startsWith('file://')) {
            console.log('[Stuard-Ext] Cannot inject into restricted page:', tab.url);
            return { ok: false, error: `Cannot control this page (${tab.url?.split('/')[2] || 'restricted'}). Try a regular web page.` };
        }

        // Try to find and inject the content script
        // The crx plugin generates content scripts with varying hashes, so we need to find it
        console.log('[Stuard-Ext] Content script not responding on tab', tabId, '- requesting page refresh');

        // Instead of trying to inject (which is fragile with dynamic filenames),
        // we'll reload the tab which will cause the content script to load naturally
        // But first, let's try one more time after a short delay
        await new Promise(resolve => setTimeout(resolve, 200));

        const retryResponse = await chrome.tabs.sendMessage(tabId, { target: 'content', action: 'ping' }).catch(() => null);
        if (retryResponse && retryResponse.ok) {
            return { ok: true };
        }

        return {
            ok: false,
            error: 'Content script not loaded. Please refresh the page (F5) and try again.'
        };
    } catch (e: any) {
        console.error('[Stuard-Ext] Failed to check content script:', e);
        return { ok: false, error: e.message || 'Failed to connect to page' };
    }
}

async function handleMessage(message: any) {
    // If message has a requestId, it's a request from the desktop that needs a reply
    if (message.requestId) {
        if (message.target === 'content') {
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

                if (!tabs[0]?.id) {
                    sendResponse(message.requestId, { ok: false, error: 'no_active_tab' });
                    return;
                }

                const tabId = tabs[0].id;

                // Ensure content script is ready
                const checkResult = await ensureContentScriptInjected(tabId);
                if (!checkResult.ok) {
                    sendResponse(message.requestId, {
                        ok: false,
                        error: checkResult.error || 'content_script_not_ready',
                        details: 'Content script not responding. Please refresh the page.'
                    });
                    return;
                }

                // Send message to content script with timeout
                const response = await Promise.race([
                    chrome.tabs.sendMessage(tabId, message),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Content script timeout')), 25000)
                    )
                ]).catch((err) => {
                    console.error('[Stuard-Ext] sendMessage error:', err);
                    return { ok: false, error: err.message || 'content_script_error' };
                });

                // Handle undefined response
                if (response === undefined) {
                    sendResponse(message.requestId, {
                        ok: false,
                        error: 'no_response',
                        details: 'Content script did not respond. Try refreshing the page.'
                    });
                    return;
                }

                sendResponse(message.requestId, response);

            } catch (e: any) {
                console.error('[Stuard-Ext] Error handling message:', e);
                sendResponse(message.requestId, {
                    ok: false,
                    error: e.message || 'unknown_error'
                });
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
    } else {
        console.error('[Stuard-Ext] Cannot send response - WebSocket not connected');
    }
}

// Initial connection
connect();

// Listen for status requests from popup
chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (message.type === 'get_status') {
        sendResponse({ connected: isConnected });
    }
    return true; // Keep channel open for async response
});

// Keep service worker alive - Chrome MV3 can kill it after 30 seconds
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);

// Periodic keepalive to prevent service worker termination
setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        connect();
    }
}, 25000);

// Listen for tab updates to know when pages finish loading
chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
        // Content script should auto-inject on page load
        // But we can use this to track which tabs are ready
        console.log('[Stuard-Ext] Tab ready:', tabId, tab.url?.substring(0, 50));
    }
});
