import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Activity, Globe, Zap, Cpu, MousePointerClick, Settings, Menu, Search } from 'lucide-react'
import './index.css'

const Popup = () => {
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        chrome.runtime.sendMessage({ type: 'get_status' }, (response: { connected: boolean }) => {
            if (response) setIsConnected(response.connected);
        });

        const listener = (message: any) => {
            if (message.type === 'status') {
                setIsConnected(message.connected);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    return (
        <div className="overlay-container">
            <div className="status-row">
                <div className="status-pill">
                    <div className={`status-dot ${isConnected ? 'active' : ''}`} />
                    <span className="status-text">{isConnected ? 'System Connected' : 'System Offline'}</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', opacity: 0.6 }}>
                    <Settings size={16} strokeWidth={2.5} style={{ cursor: 'pointer' }} />
                    <Activity size={16} strokeWidth={2.5} style={{ cursor: 'pointer' }} />
                </div>
            </div>

            <div className="hero-section">
                <h2>What can I help with?</h2>
                <p>Ask Stuard, search web, or run automations</p>
            </div>

            <div className="search-fake">
                <Search size={18} strokeWidth={2.5} />
                <span>Ask Stuard anything...</span>
            </div>

            <div className="action-grid">
                <div className="action-button">
                    <div className="action-icon">
                        <Globe size={20} strokeWidth={2.5} />
                    </div>
                    <span className="action-label">Web Search</span>
                </div>
                <div className="action-button">
                    <div className="action-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--accent-warning)' }}>
                        <Zap size={20} strokeWidth={2.5} />
                    </div>
                    <span className="action-label">Workflows</span>
                </div>
                <div className="action-button">
                    <div className="action-icon">
                        <MousePointerClick size={20} strokeWidth={2.5} />
                    </div>
                    <span className="action-label">Click Helper</span>
                </div>
                <div className="action-button">
                    <div className="action-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-active)' }}>
                        <Cpu size={20} strokeWidth={2.5} />
                    </div>
                    <span className="action-label">Diagnostics</span>
                </div>
            </div>

            <footer className="footer">
                <span>Stuard AI</span>
                <div className="footer-dot" />
                <span>v1.0.0</span>
            </footer>
        </div>
    )
}


ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Popup />
    </React.StrictMode>,
)

