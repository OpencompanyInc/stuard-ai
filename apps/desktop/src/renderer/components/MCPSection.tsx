import React, { useState } from "react";
import { Link2, Zap, X } from "lucide-react";
import { clsx } from 'clsx';

interface MCPIntegration {
  slug: string;
  name: string;
  description: string;
  category: string;
  homepage: string;
  mcpUrl: string;
}

const MCP_INTEGRATIONS: MCPIntegration[] = [
  {
    slug: "notion",
    name: "Notion",
    description: "Access and manage Notion pages, databases, and content.",
    category: "Productivity",
    homepage: "https://www.notion.so/",
    mcpUrl: "https://mcp.notion.com/sse",
  },
  {
    slug: "linear",
    name: "Linear",
    description: "Manage Linear issues, projects, and workflows.",
    category: "Development",
    homepage: "https://linear.app/",
    mcpUrl: "https://mcp.linear.app/sse",
  },
  {
    slug: "stripe",
    name: "Stripe",
    description: "Access Stripe payments, customers, and transaction data.",
    category: "Payments",
    homepage: "https://stripe.com/",
    mcpUrl: "https://mcp.stripe.com/sse",
  },
];

interface MCPSectionProps {
  connectedMCPs: Record<string, boolean>;
  mcpTokens: Record<string, string>;
  onConnect: (slug: string, mcpUrl: string, token: string) => void;
  onDisconnect: (slug: string) => void;
  onLearnMore: (url: string) => void;
}

export const MCPSection: React.FC<MCPSectionProps> = ({
  connectedMCPs,
  mcpTokens,
  onConnect,
  onDisconnect,
  onLearnMore,
}) => {
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const connectedCount = Object.values(connectedMCPs).filter(Boolean).length;

  const handleOpenConnect = (slug: string) => {
    setConnectingSlug(slug);
    setTokenInput(mcpTokens[slug] || "");
  };

  const handleCloseConnect = () => {
    setConnectingSlug(null);
    setTokenInput("");
  };

  const handleSubmitConnect = () => {
    if (!connectingSlug || !tokenInput.trim()) return;
    const mcp = MCP_INTEGRATIONS.find(m => m.slug === connectingSlug);
    if (mcp) {
      onConnect(connectingSlug, mcp.mcpUrl, tokenInput.trim());
    }
    handleCloseConnect();
  };

  const connectingMCP = MCP_INTEGRATIONS.find(m => m.slug === connectingSlug);

  return (
    <div className="mt-10 pt-8 border-t border-theme">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-theme-hover border border-theme flex items-center justify-center">
            <Zap className="w-4 h-4 text-theme-fg" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-theme-fg">MCP Servers</h3>
            <p className="text-xs text-theme-muted">Model Context Protocol integrations</p>
          </div>
        </div>
        {connectedCount > 0 && (
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-bold border border-primary/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            {connectedCount} Connected
          </span>
        )}
      </div>

      {/* MCP Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {MCP_INTEGRATIONS.map((mcp) => {
          const isConnected = !!connectedMCPs[mcp.slug];

          return (
            <div
              key={mcp.slug}
              className="group relative flex flex-col bg-theme-card rounded-theme-card border border-theme p-5 shadow-sm hover:border-theme hover:shadow-md transition-all duration-300"
            >
              {/* Header */}
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-theme-hover border border-theme shadow-sm flex items-center justify-center text-[18px] font-bold text-theme-fg group-hover:scale-105 transition-transform duration-300">
                    {mcp.name[0]}
                  </div>
                  <div>
                    <h3 className="font-bold text-[14px] text-theme-fg tracking-tight">{mcp.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-medium text-theme-muted px-1.5 py-0.5 bg-theme-hover rounded-sm">
                        {mcp.category}
                      </span>
                      <span className="text-[10px] font-medium text-theme-muted px-1.5 py-0.5 bg-theme-hover rounded-sm">
                        MCP
                      </span>
                    </div>
                  </div>
                </div>
                {isConnected && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-900/20 text-emerald-400 text-[10px] font-bold border border-emerald-900/30 tracking-wide uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Active
                  </span>
                )}
              </div>

              {/* Description */}
              <p className="text-[12px] text-theme-muted leading-relaxed mb-5 flex-1 font-medium">
                {mcp.description}
              </p>

              {/* Actions */}
              <div className="pt-4 border-t border-theme flex items-center gap-2 mt-auto">
                {isConnected ? (
                  <>
                    <button
                      onClick={() => onDisconnect(mcp.slug)}
                      className="flex-1 px-3 py-2 rounded-theme-button border border-theme bg-transparent text-[11px] font-bold text-theme-muted hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all shadow-sm active:scale-95"
                    >
                      Disconnect
                    </button>
                    <button
                      onClick={() => onLearnMore(mcp.homepage)}
                      className="px-3 py-2 rounded-theme-button text-theme-muted hover:text-theme-fg hover:bg-theme-hover border border-transparent hover:border-theme transition-all"
                      title="Documentation"
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleOpenConnect(mcp.slug)}
                      className="flex-1 px-3 py-2 rounded-theme-button bg-primary text-primary-fg text-[11px] font-bold hover:opacity-90 shadow-sm transition-all active:scale-95"
                    >
                      Connect
                    </button>
                    <button
                      onClick={() => onLearnMore(mcp.homepage)}
                      className="px-3 py-2 rounded-theme-button text-theme-muted hover:text-theme-fg hover:bg-theme-hover border border-transparent hover:border-theme transition-all"
                      title="Documentation"
                    >
                      <Link2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Token Input Modal */}
      {connectingSlug && connectingMCP && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-theme-card border border-theme rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-theme">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-theme-hover border border-theme flex items-center justify-center text-lg font-bold text-theme-fg">
                  {connectingMCP.name[0]}
                </div>
                <div>
                  <h3 className="font-bold text-theme-fg">Connect {connectingMCP.name}</h3>
                  <p className="text-xs text-theme-muted">Enter your access token</p>
                </div>
              </div>
              <button
                onClick={handleCloseConnect}
                className="p-2 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-theme-muted uppercase tracking-wide mb-2">
                  Access Token
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Enter your access token..."
                  className="w-full px-4 py-3 rounded-xl border border-theme bg-theme-bg text-theme-fg text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-theme-muted"
                  autoFocus
                />
              </div>

              <div className="p-3 rounded-lg bg-theme-hover border border-theme">
                <p className="text-xs text-theme-muted leading-relaxed">
                  <span className="font-semibold text-theme-fg">How to get your token:</span><br />
                  Visit <button onClick={() => onLearnMore(connectingMCP.homepage)} className="text-primary hover:underline">{connectingMCP.name}</button> and
                  generate an API token or integration token from your account settings.
                </p>
              </div>

              <div className="text-[10px] text-theme-muted font-mono bg-theme-bg p-2 rounded-lg border border-theme overflow-x-auto">
                {connectingMCP.mcpUrl}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 p-5 border-t border-theme bg-theme-hover/30">
              <button
                onClick={handleCloseConnect}
                className="flex-1 px-4 py-2.5 rounded-xl border border-theme bg-transparent text-theme-fg text-sm font-semibold hover:bg-theme-hover transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitConnect}
                disabled={!tokenInput.trim()}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-fg text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
