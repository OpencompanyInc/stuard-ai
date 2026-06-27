import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
    children?: ReactNode;
    fallback?: ReactNode;
    componentName?: string;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class GenUIErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(`[GenUIErrorBoundary] Error caught in ${this.props.componentName || 'unknown'}:`, error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="my-3 p-4 border border-red-500/20 rounded-xl bg-red-500/5 flex items-center gap-3 animate-in fade-in duration-300">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <div className="flex flex-col">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-red-500/80">
                            Component Error
                        </span>
                        <span className="text-[12px] text-theme-fg/70">
                            Failed to render {this.props.componentName || 'GenUI element'}
                        </span>
                        {this.state.error && (
                            <span className="text-[10px] text-red-400 font-mono mt-1 opacity-50 truncate max-w-[200px]">
                                {this.state.error.message}
                            </span>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
