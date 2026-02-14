import React, { useEffect, useState, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { CheckCircle, XCircle, Circle, Send, MessageSquare, Activity, Globe, Zap } from 'lucide-react'
import './index.css'

interface ActivityEntry {
    timestamp: number;
    action: string;
    status: 'pending' | 'success' | 'error';
    details?: string;
}

interface PageContext {
    url: string;
    title: string;
    tabId?: number;
}

type Tab = 'chat' | 'activity';

const Popup = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
    const [activeTab, setActiveTab] = useState<Tab>('chat');
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [pageContext, setPageContext] = useState<PageContext | null>(null);
    const [chatHistory, setChatHistory] = useState<Array<{ text: string; fromUser: boolean; time: number }>>([]);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        chrome.runtime.sendMessage({ type: 'get_status' }, (response: { connected: boolean }) => {
            if (response) setIsConnected(response.connected);
        });

        chrome.runtime.sendMessage({ type: 'get_activity' }, (response: { log: ActivityEntry[] }) => {
            if (response?.log) setActivityLog(response.log);
        });

        chrome.runtime.sendMessage({ type: 'get_page_context' }, (response: PageContext) => {
            if (response) setPageContext(response);
        });

        const listener = (message: any) => {
            if (message.type === 'status') {
                setIsConnected(message.connected);
            }
            if (message.type === 'activity') {
                setActivityLog(message.log);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory]);

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const formatTimeShort = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'success':
                return <CheckCircle size={13} className="log-icon-success" />;
            case 'error':
                return <XCircle size={13} className="log-icon-error" />;
            default:
                return <Circle size={13} className="log-icon-pending" />;
        }
    };

    const formatAction = (action: string) => {
        return action
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase())
            .replace('Get ', '')
            .replace('Browser ', '');
    };

    const handleSend = async () => {
        const text = message.trim();
        if (!text || sending || !isConnected) return;

        setSending(true);
        setChatHistory(prev => [...prev, { text, fromUser: true, time: Date.now() }]);
        setMessage('');

        try {
            const response = await new Promise<any>((resolve) => {
                chrome.runtime.sendMessage({ type: 'send_chat', text }, resolve);
            });
            if (!response?.ok) {
                setChatHistory(prev => [...prev, { text: response?.error || 'Failed to send', fromUser: false, time: Date.now() }]);
            }
        } catch {
            setChatHistory(prev => [...prev, { text: 'Failed to send message', fromUser: false, time: Date.now() }]);
        } finally {
            setSending(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const truncateUrl = (url: string) => {
        try {
            const u = new URL(url);
            const path = u.pathname.length > 20 ? u.pathname.substring(0, 20) + '...' : u.pathname;
            return u.hostname + (path !== '/' ? path : '');
        } catch {
            return url.substring(0, 40);
        }
    };

    const activityCount = activityLog.filter(a => a.status === 'pending').length;

    return (
        <div className="popup-root">
            {/* Header */}
            <div className="popup-header">
                <div className="header-left">
                    <div className="brand-mark">
                        <Zap size={14} strokeWidth={2.5} />
                    </div>
                    <span className="brand-name">Stuard</span>
                </div>
                <div className={`conn-badge ${isConnected ? 'connected' : ''}`}>
                    <span className="conn-dot" />
                    <span>{isConnected ? 'Live' : 'Offline'}</span>
                </div>
            </div>

            {/* Page Context Bar */}
            {pageContext?.url && (
                <div className="page-bar">
                    <Globe size={11} />
                    <span className="page-url">{truncateUrl(pageContext.url)}</span>
                </div>
            )}

            {/* Tab Switcher */}
            <div className="tab-bar">
                <button
                    className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
                    onClick={() => setActiveTab('chat')}
                >
                    <MessageSquare size={13} />
                    <span>Chat</span>
                </button>
                <button
                    className={`tab-btn ${activeTab === 'activity' ? 'active' : ''}`}
                    onClick={() => setActiveTab('activity')}
                >
                    <Activity size={13} />
                    <span>Logs</span>
                    {activityCount > 0 && <span className="tab-badge">{activityCount}</span>}
                </button>
            </div>

            {/* Content */}
            <div className="popup-content">
                {activeTab === 'chat' ? (
                    <div className="chat-view">
                        <div className="chat-messages">
                            {chatHistory.length === 0 ? (
                                <div className="chat-empty">
                                    <div className="chat-empty-icon">
                                        <MessageSquare size={28} strokeWidth={1.5} />
                                    </div>
                                    <p className="chat-empty-title">Talk to Stuard</p>
                                    <p className="chat-empty-hint">Send a message to control this page, ask questions, or trigger automations.</p>
                                </div>
                            ) : (
                                chatHistory.map((msg, i) => (
                                    <div key={i} className={`chat-bubble ${msg.fromUser ? 'user' : 'assistant'}`}>
                                        <span className="bubble-text">{msg.text}</span>
                                        <span className="bubble-time">{formatTimeShort(msg.time)}</span>
                                    </div>
                                ))
                            )}
                            <div ref={chatEndRef} />
                        </div>

                        {/* Input */}
                        <div className="chat-input-area">
                            <div className={`input-container ${!isConnected ? 'disabled' : ''}`}>
                                <textarea
                                    ref={inputRef}
                                    value={message}
                                    onChange={e => setMessage(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={isConnected ? 'Ask Stuard anything...' : 'Connect to Stuard Desktop first'}
                                    disabled={!isConnected || sending}
                                    rows={1}
                                    className="chat-textarea"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!message.trim() || !isConnected || sending}
                                    className="send-btn"
                                >
                                    <Send size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="activity-view">
                        {activityLog.length === 0 ? (
                            <div className="activity-empty">
                                <Activity size={28} strokeWidth={1.5} className="empty-icon" />
                                <p className="empty-title">No activity yet</p>
                                <p className="empty-hint">Automation actions will appear here in real time.</p>
                            </div>
                        ) : (
                            <div className="log-list">
                                {activityLog.map((entry, index) => (
                                    <div key={index} className={`log-item status-${entry.status}`}>
                                        <div className="log-icon">
                                            {getStatusIcon(entry.status)}
                                        </div>
                                        <div className="log-body">
                                            <span className="log-action">{formatAction(entry.action)}</span>
                                            {entry.details && (
                                                <span className="log-details">{entry.details}</span>
                                            )}
                                        </div>
                                        <span className="log-time">{formatTime(entry.timestamp)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}


ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Popup />
    </React.StrictMode>,
)
