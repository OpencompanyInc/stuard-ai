import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Activity, Globe, Zap, Cpu, MousePointerClick } from 'lucide-react'
import './index.css'

const Popup = () => {
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        // Initial status fetch
        chrome.runtime.sendMessage({ type: 'get_status' }, (response) => {
            if (response) setIsConnected(response.connected);
        });

        // Listen for status changes
        const listener = (message: any) => {
            if (message.type === 'status') {
                setIsConnected(message.connected);
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    return (
        <div className="container">
            <header className="header">
                <h1 className="font-stuard">Stuard</h1>
                <div style={{ opacity: 0.5 }}>
                    <Cpu size={14} />
                </div>
            </header>

            <main className="main-content">
                <div className="status-panel">
                    <div className="status-info">
                        <span className="status-label">System Connection</span>
                        <div className="status-connection">
                            <div className={`indicator ${isConnected ? 'online' : 'offline'}`} />
                            {isConnected ? 'Active' : 'Offline'}
                        </div>
                    </div>
                    <Activity
                        size={18}
                        color={isConnected ? 'var(--accent-active)' : 'var(--foreground-muted)'}
                        style={{ opacity: isConnected ? 1 : 0.3 }}
                    />
                </div>

                <div className="action-grid">
                    <div className="action-card">
                        <Globe size={16} color="var(--primary)" />
                        <span>Web Observer</span>
                    </div>
                    <div className="action-card">
                        <MousePointerClick size={16} color="var(--primary)" />
                        <span>Click Helper</span>
                    </div>
                </div>
            </main>

            <footer className="footer">
                Stuard AI Browser Extension v1.0.0
            </footer>
        </div>
    )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Popup />
    </React.StrictMode>,
)
