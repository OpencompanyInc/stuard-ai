import React, { ErrorInfo } from "react";

export class PanelErrorBoundary extends React.Component<
  { children: React.ReactNode; name: string },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode; name: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[${this.props.name}] Render error:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-4 text-red-500 text-sm">
          <div className="text-center">
            <p className="font-medium">Panel Error</p>
            <p className="text-xs mt-1 text-red-400">{this.state.error?.message || "Unknown error"}</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
