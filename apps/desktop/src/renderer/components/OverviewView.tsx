import React from "react";
import { 
  Rocket, 
  MessageSquare, 
  Calendar, 
  User,
  Clock,
  Zap,
  BookOpen,
  ArrowRight
} from "lucide-react";
import { clsx } from "clsx";

interface OverviewViewProps {
  creditsInfo: any | null;
  creditsFallback: any | null;
  profile: any | null;
  usage: any[];
  conversations: any[];
  onNavigate: (tab: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  creditsInfo,
  creditsFallback,
  profile,
  usage,
  conversations,
  onNavigate,
}) => {
  const firstName = profile?.first_name || profile?.name?.split(' ')[0] || 'there';

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="space-y-8 pb-10" data-onboarding="overview-panel">
      {/* Header */}
      <div className="flex flex-col gap-1 relative overflow-hidden">
        {/* Subtle background section watermark matching the personality */}
        <div className="absolute -top-6 -left-2 text-[80px] font-bold text-theme-fg opacity-[0.03] select-none pointer-events-none font-stuard leading-none">
          overview
        </div>
        
        <h1 className="text-5xl font-stuard text-theme-fg tracking-tight mb-1 relative z-10">
          {getGreeting()}, {firstName}
        </h1>
        <p className="text-theme-muted text-sm font-medium relative z-10 pl-1">
          Here's what's happening with your Stuard today.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Plan & Credits Card */}
        <div className="relative overflow-hidden rounded-theme-card border border-theme bg-theme-card text-theme-fg p-6 shadow-sm flex flex-col justify-between min-h-[220px] group transition-all">
          <div className="absolute top-0 right-0 p-40 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none opacity-50"></div>
          
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-md border border-primary/20">
                  <Rocket className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-theme-muted">Current Plan</span>
              </div>
              <span className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-black tracking-widest text-primary shadow-sm">
                {(creditsInfo?.plan || profile?.plan || profile?.plan_name || 'Free').toUpperCase()}
              </span>
            </div>
            
            <div className="space-y-3">
              {creditsInfo?.unlimited ? (
                 <div>
                   <div className="text-3xl font-bold tracking-tight text-theme-fg">Unlimited</div>
                   <div className="text-xs text-theme-muted font-medium">Credits available</div>
                 </div>
              ) : (
                <>
                  <div className="flex items-end gap-2">
                    <div className="text-4xl font-bold tracking-tight text-theme-fg">
                      {Math.max(0, creditsInfo?.remaining ?? creditsFallback?.remaining ?? 0)}
                    </div>
                    <div className="text-sm text-theme-muted mb-2 font-medium">
                      / {creditsInfo?.limit ?? creditsFallback?.limit ?? 0} credits
                    </div>
                  </div>
                  
                  <div className="h-1.5 bg-theme-hover rounded-full overflow-hidden w-full border border-theme">
                    <div
                      className="h-full bg-[#007acc] rounded-full transition-all duration-1000 ease-out"
                      style={{ 
                        width: `${Math.min(100, Math.max(0, ((creditsInfo?.used ?? creditsFallback?.used ?? 0) / Math.max(1, creditsInfo?.limit ?? creditsFallback?.limit ?? 1)) * 100))}%` 
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6 relative z-10">
            <button 
              onClick={() => {
                try { (window as any).desktopAPI?.openExternal?.('https://stuard.ai/pricing'); } catch { window.open('https://stuard.ai/pricing', '_blank'); }
              }}
              className="flex-1 py-1.5 px-3 bg-[#0e639c] text-white rounded-theme-button text-xs font-medium hover:bg-[#1177bb] transition-all"
            >
              Upgrade Plan
            </button>
            <button 
              onClick={() => {
                try { (window as any).desktopAPI?.openExternal?.('https://stuard.ai/pricing'); } catch { window.open('https://stuard.ai/pricing', '_blank'); }
              }}
              className="flex-1 py-1.5 px-3 bg-theme-hover border border-theme text-theme-fg rounded-theme-button text-xs font-medium hover:bg-theme-active transition-colors"
            >
              Buy Credits
            </button>
          </div>
        </div>

        {/* Usage & Stats */}
        <div className="rounded-theme-card border border-theme bg-theme-card p-6 shadow-sm hover:border-theme transition-all flex flex-col justify-between min-h-[220px] group">
          <div>
             <div className="flex items-center gap-2 mb-6">
                <div className="p-1.5 bg-primary/10 rounded-md border border-primary/20">
                  <Clock className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm font-medium text-theme-muted">Monthly Usage</span>
              </div>
              
              <div className="text-4xl font-bold text-theme-fg tracking-tight">
                {usage?.length ?? 0}
              </div>
              <div className="text-xs font-medium text-theme-muted mt-1">Total events processed</div>
          </div>

          <div className="mt-4 pt-4 border-t border-theme">
             <button 
              onClick={() => onNavigate('history')}
              className="w-full flex items-center justify-between gap-2 text-xs font-medium text-theme-muted hover:text-theme-fg py-2 px-3 rounded-theme-button hover:bg-theme-hover transition-colors group/btn"
             >
               <span className="flex items-center gap-2">
                 <BookOpen className="w-3.5 h-3.5" />
                 View Usage History
               </span>
               <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover/btn:opacity-100 -translate-x-2 group-hover/btn:translate-x-0 transition-all" />
             </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="rounded-theme-card border border-theme bg-theme-card p-6 shadow-sm hover:border-theme transition-all min-h-[220px]">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-1.5 bg-primary/10 rounded-md border border-primary/20">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-medium text-theme-muted">Quick Actions</span>
          </div>

          <div className="grid grid-cols-2 gap-4 h-[calc(100%-60px)]">
            <button 
              onClick={() => onNavigate('planner')}
              className="flex flex-col items-center justify-center gap-3 p-4 rounded-theme-card border border-theme bg-slate-200/50 hover:bg-slate-200 hover:border-primary/30 hover:shadow-md transition-all group dark:bg-theme-hover dark:hover:bg-theme-active"
            >
              <div className="p-2 bg-theme-card rounded-md border border-theme text-theme-muted group-hover:text-primary transition-colors">
                <Calendar className="w-5 h-5" />
              </div>
              <span className="text-xs font-bold text-theme-muted group-hover:text-theme-fg">Planner</span>
            </button>
            
            <button 
              onClick={() => onNavigate('automations')}
              className="flex flex-col items-center justify-center gap-3 p-4 rounded-theme-card border border-theme bg-slate-200/50 hover:bg-slate-200 hover:border-primary/30 hover:shadow-md transition-all group dark:bg-theme-hover dark:hover:bg-theme-active"
            >
              <div className="p-2 bg-theme-card rounded-md border border-theme text-theme-muted group-hover:text-primary transition-colors">
                <Rocket className="w-5 h-5" />
              </div>
              <span className="text-xs font-bold text-theme-muted group-hover:text-theme-fg">Automations</span>
            </button>
          </div>
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xl font-stuard text-theme-fg tracking-tight">Recent Conversations</h2>
          <button 
            onClick={() => onNavigate('history')}
            className="text-xs font-semibold text-theme-muted hover:text-theme-fg transition-colors flex items-center gap-1 group"
          >
            View all
            <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>

        <div className="bg-theme-card border border-theme rounded-theme-card shadow-sm overflow-hidden">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-16 h-16 bg-theme-hover rounded-theme-card flex items-center justify-center mb-4 border border-theme">
                <MessageSquare className="w-6 h-6 text-theme-muted" />
              </div>
              <p className="text-sm font-semibold text-theme-fg">No conversations yet</p>
              <p className="text-xs text-theme-muted mt-1 max-w-xs font-medium">Start chatting with Stuard to get help with your tasks and questions.</p>
              <button 
                onClick={() => onNavigate('history')} 
                className="mt-6 px-4 py-2 bg-[#0e639c] text-white rounded-theme-button text-xs font-medium hover:bg-[#1177bb] transition-all"
              >
                Start a Conversation
              </button>
            </div>
          ) : (
            <div className="divide-y divide-theme">
              {conversations.slice(0, 5).map((c: any) => (
                <div 
                  key={c.id} 
                  className="group flex items-center gap-5 p-5 hover:bg-theme-hover transition-all cursor-pointer relative overflow-hidden"
                  onClick={() => onNavigate('history')}
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="w-12 h-12 rounded-theme-card bg-theme-hover flex items-center justify-center shrink-0 border border-theme shadow-sm group-hover:bg-theme-card group-hover:scale-105 transition-all">
                    <MessageSquare className="w-6 h-6 text-theme-muted group-hover:text-primary transition-colors" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[15px] text-theme-fg truncate group-hover:text-primary transition-all">
                      {c.title || `Conversation ${String(c.id).slice(0, 8)}`}
                    </div>
                    <div className="text-sm text-theme-muted mt-1 truncate font-medium opacity-80 group-hover:opacity-100">
                      {c.last_message || "No messages preview"}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0 pl-4">
                    <div className="text-xs text-theme-muted font-bold tracking-tight bg-theme-hover px-2 py-1 rounded-full border border-theme">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}
                    </div>
                    <ArrowRight className="w-4 h-4 text-theme-muted opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
