import React from "react";
import { 
  MessageSquare, 
  ArrowRight,
  Sparkles,
  Lock,
  WalletCards,
  History,
  Wand2,
  Loader2,
} from "lucide-react";

interface OverviewViewProps {
  creditsInfo: any | null;
  creditsFallback: any | null;
  creditsLoading?: boolean;
  profile: any | null;
  usageCount: number;
  usageCountLoading: boolean;
  conversations: any[];
  conversationsLoading: boolean;
  onNavigate: (tab: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  creditsInfo,
  creditsFallback,
  creditsLoading,
  profile,
  usageCount,
  usageCountLoading,
  conversations,
  conversationsLoading,
  onNavigate,
}) => {
  const isCreditsLoading = !!creditsLoading && !creditsInfo;
  const planLabel = String(creditsInfo?.plan || profile?.plan || profile?.plan_name || 'Starter');
  const remaining = Math.max(0, creditsInfo?.remaining ?? creditsFallback?.remaining ?? 0);
  const limit = Math.max(1, creditsInfo?.limit ?? creditsFallback?.limit ?? 0);
  const used = Math.max(0, creditsInfo?.used ?? creditsFallback?.used ?? 0);
  const remainingPct = Math.min(100, Math.max(0, (remaining / Math.max(1, limit)) * 100));
  const remainingWidth = `${remainingPct}%`;
  const openPricing = () => {
    try { (window as any).desktopAPI?.openExternal?.('https://stuard.ai/pricing'); } catch { window.open('https://stuard.ai/pricing', '_blank'); }
  };
  const openWorkflows = () => {
    try { (window as any).desktopAPI?.openWorkflows?.(); } catch { }
  };

  return (
    <div className="space-y-6 pb-6" data-onboarding="overview-panel">
      {/* Header */}
      <div className="hidden rounded-2xl border border-theme/50 bg-theme-card/60 px-5 py-4 shadow-sm">
        <p className="text-theme-muted text-sm font-medium flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary/70" />
          Here's what's happening with your Stuard today.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr_1fr]">
        {/* Plan & Credits Card */}
        <div className="dashboard-card dashboard-card-premium relative p-5 md:p-6 min-h-[188px] flex flex-col justify-between group">
          <div className="absolute top-0 right-0 h-44 w-44 rounded-full bg-primary/25 blur-3xl translate-x-8 -translate-y-8 pointer-events-none opacity-90"></div>
          
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <div className="text-[18px] font-semibold text-theme-fg tracking-tight">Plan Overview</div>
              </div>
              <span className="dashboard-pill px-3 py-1 text-[10px] font-semibold text-theme-muted">
                {isCreditsLoading ? (
                  <span className="inline-block h-3 w-12 rounded-full bg-theme-muted/20 animate-pulse" />
                ) : (
                  planLabel
                )}
              </span>
            </div>

            <div className="space-y-4">
              {isCreditsLoading ? (
                <>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <div className="h-[46px] md:h-[50px] w-32 rounded-xl bg-theme-muted/20 animate-pulse" />
                    <div className="h-7 w-16 rounded-md bg-theme-muted/15 animate-pulse" />
                    <div className="h-4 w-14 rounded bg-theme-muted/10 animate-pulse" />
                  </div>
                  <div className="h-3 rounded-full w-full bg-theme-muted/20 animate-pulse border border-[color:var(--dashboard-panel-border)]" />
                </>
              ) : creditsInfo?.unlimited ? (
                 <div>
                   <div className="text-4xl font-semibold tracking-tight text-theme-fg">Unlimited</div>
                   <div className="text-sm text-theme-muted font-medium mt-1">Credits available</div>
                 </div>
              ) : (
                <>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <div className="text-[46px] md:text-[50px] font-semibold tracking-tight text-theme-fg leading-none">
                      {remaining}
                    </div>
                    <div className="text-[28px] text-theme-muted font-medium leading-none">
                      / {limit}
                    </div>
                    <div className="text-sm text-theme-muted font-medium leading-none mb-1">
                      Credits
                    </div>
                  </div>

                  <div className="h-3 rounded-full overflow-hidden w-full bg-black/30 dark:bg-black/45 border border-black/20 dark:border-white/10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.35)]">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-300 via-sky-400 to-blue-500 rounded-full transition-all duration-1000 ease-out shadow-[0_0_12px_rgba(56,189,248,0.7)]"
                      style={{ width: remainingWidth, minWidth: remaining > 0 ? '8px' : '0px' }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6 relative z-10">
            <button 
              onClick={openPricing}
              className="dashboard-button-primary flex-1 py-3 px-4 rounded-2xl text-[14px] font-semibold hover:opacity-95 transition-all duration-300 active:scale-[0.98] inline-flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              Unlock Pro
            </button>
            <button 
              onClick={openPricing}
              className="dashboard-button-secondary flex-1 py-3 px-4 rounded-2xl text-[14px] font-semibold hover:scale-[1.01] transition-all duration-300 active:scale-[0.98] inline-flex items-center justify-center gap-2"
            >
              <WalletCards className="w-4 h-4" />
              Add Credits
            </button>
          </div>
        </div>

        {/* Usage & Stats */}
        <div className="dashboard-card relative overflow-hidden p-5 md:p-6 min-h-[188px] flex flex-col justify-between group">
          
          <div className="relative z-10">
             <div className="text-center space-y-3 pt-1">
                <div className="text-[18px] font-semibold text-theme-fg tracking-tight">Monthly Activity</div>
              
              <div className="text-[50px] font-semibold text-theme-fg tracking-tight leading-none">
                {usageCountLoading ? (
                  <Loader2 className="w-10 h-10 animate-spin mx-auto text-theme-muted" />
                ) : (
                  usageCount
                )}
              </div>
              <div className="text-base text-theme-muted font-medium">Events processed</div>
            </div>
          </div>

          <div className="mt-5 relative z-10">
             <button 
              onClick={() => onNavigate('history')}
              className="dashboard-card-muted w-full flex items-center justify-center gap-2 text-[14px] font-medium text-theme-fg py-3 px-4 rounded-2xl transition-all duration-300 group/btn"
             >
               <span className="flex items-center gap-2.5">
                 <History className="w-4 h-4 text-theme-muted transition-colors" />
                 View History
               </span>
             </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="dashboard-card dashboard-card-accent relative p-5 md:p-6 min-h-[188px] flex flex-col justify-between group">
          <div className="absolute bottom-0 left-1/2 h-36 w-36 rounded-full bg-primary/25 blur-3xl -translate-x-1/2 translate-y-8 pointer-events-none opacity-90"></div>
          
          <div className="relative z-10 text-center pt-3 space-y-3">
            <div className="text-[34px] font-semibold leading-none text-theme-fg">Stuard Studio</div>
            <p className="text-sm text-theme-muted font-medium">All your workflows in one place</p>
          </div>

          <div className="mt-5 relative z-10">
            <button 
              onClick={openWorkflows}
              className="dashboard-card-muted w-full flex items-center justify-center gap-2 text-[14px] font-medium text-theme-fg py-3 px-4 rounded-2xl transition-all duration-300 group/action"
            >
              <Wand2 className="w-4 h-4 text-theme-muted group-hover/action:text-theme-fg transition-colors" />
              Create Magic
            </button>
          </div>
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="dashboard-card overflow-hidden relative z-10 min-h-[420px] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--dashboard-panel-border)]">
          <h2 className="text-[20px] font-semibold font-stuard text-theme-fg tracking-tight flex items-center gap-3">
            Recent Conversations
          </h2>
          <button 
            onClick={() => onNavigate('history')}
            className="dashboard-pill px-3 py-2 text-[13px] font-medium text-theme-fg transition-colors flex items-center gap-1.5 group"
          >
            View all
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden relative group/list">
          <div className="absolute top-0 right-0 p-32 bg-gradient-to-bl from-primary/5 to-transparent rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-50 group-hover/list:opacity-100 transition-opacity duration-700"></div>
          
          {conversationsLoading && conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-20 px-6 text-center relative z-10">
              <Loader2 className="w-7 h-7 animate-spin text-theme-muted/70 mb-4" />
              <p className="text-[15px] text-theme-muted font-medium">Loading conversations...</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-20 px-6 text-center relative z-10">
              <div className="w-16 h-16 dashboard-card-muted rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                <MessageSquare className="w-7 h-7 text-theme-muted/60" />
              </div>
              <p className="text-[22px] font-semibold text-theme-fg tracking-tight mb-2">No Conversations yet</p>
              <p className="text-[15px] text-theme-muted max-w-xl font-medium leading-relaxed">Start chatting with Stuard to get help with your tasks, coding, and questions.</p>
              <button 
                onClick={() => onNavigate('history')} 
                className="dashboard-card-muted mt-8 px-5 py-3 text-[14px] font-medium text-theme-fg inline-flex items-center gap-2 rounded-2xl transition-all duration-300"
              >
                <Sparkles className="w-4 h-4 text-theme-muted" />
                Ask Stuard
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[color:var(--dashboard-panel-border)] relative z-10">
              {conversations.slice(0, 5).map((c: any) => {
                const preview = (() => {
                  const last = typeof c.last_message === 'string' ? c.last_message.trim() : '';
                  if (last) return last;
                  const count = Number(c.message_count) || 0;
                  if (count > 0) return `${count} message${count === 1 ? '' : 's'}`;
                  const updated = c.updated_at || c.created_at;
                  if (updated) {
                    try {
                      return `Started ${new Date(updated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
                    } catch { }
                  }
                  return 'New conversation';
                })();
                return (
                <div
                  key={c.id}
                  className="group flex items-center gap-6 p-6 hover:bg-[color:var(--dashboard-hover)] transition-all duration-300 cursor-pointer relative overflow-hidden"
                  onClick={() => onNavigate('history')}
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300 shadow-[0_0_12px_rgba(0,122,204,0.5)]" />

                  <div className="w-14 h-14 rounded-2xl dashboard-card-muted flex items-center justify-center shrink-0 shadow-sm group-hover:scale-110 transition-all duration-300">
                    <MessageSquare className="w-6 h-6 text-theme-muted group-hover:text-primary transition-colors duration-300" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[16px] text-theme-fg truncate group-hover:text-primary transition-colors duration-300 tracking-tight">
                      {c.title || `Conversation ${String(c.id).slice(0, 8)}`}
                    </div>
                    <div className="text-[13px] text-theme-muted mt-1.5 truncate font-medium opacity-80 group-hover:opacity-100 transition-opacity duration-300">
                      {preview}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-3 shrink-0 pl-4">
                    <div className="text-[11px] text-theme-muted font-semibold tracking-wide uppercase dashboard-pill px-3 py-1.5 shadow-sm">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}
                    </div>
                    <ArrowRight className="w-5 h-5 text-primary opacity-0 group-hover:opacity-100 -translate-x-4 group-hover:translate-x-0 transition-all duration-300" />
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
