import React from "react";
import { 
  Rocket, 
  MessageSquare, 
  Calendar, 
  User,
  Clock,
  Zap,
  BookOpen,
  ArrowRight,
  Sparkles
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
  return (
    <div className="space-y-8 pb-10" data-onboarding="overview-panel">
      {/* Header */}
      <div className="rounded-2xl border border-theme/50 bg-theme-card/60 px-5 py-4 shadow-sm">
        <p className="text-theme-muted text-sm font-medium flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary/70" />
          Here's what's happening with your Stuard today.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Plan & Credits Card */}
        <div className="relative overflow-hidden rounded-theme-card border border-theme bg-theme-card text-theme-fg p-6 shadow-lg hover:shadow-xl hover:border-primary/30 transition-all duration-300 flex flex-col justify-between min-h-[220px] group">
          <div className="absolute top-0 right-0 p-40 bg-gradient-to-br from-primary/10 to-blue-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none opacity-50 group-hover:opacity-70 transition-opacity duration-500"></div>
          
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-xl border border-primary/20 shadow-inner">
                  <Rocket className="w-5 h-5 text-primary" />
                </div>
                <span className="text-sm font-bold text-theme-muted uppercase tracking-wider">Current Plan</span>
              </div>
              <span className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-black tracking-widest text-primary shadow-sm">
                {(creditsInfo?.plan || profile?.plan || profile?.plan_name || 'Free').toUpperCase()}
              </span>
            </div>
            
            <div className="space-y-4">
              {creditsInfo?.unlimited ? (
                 <div>
                   <div className="text-4xl font-black tracking-tighter text-theme-fg">Unlimited</div>
                   <div className="text-xs text-theme-muted font-bold uppercase tracking-wide opacity-80 mt-1">Credits available</div>
                 </div>
              ) : (
                <>
                  <div className="flex items-baseline gap-2">
                    <div className="text-5xl font-black tracking-tighter text-theme-fg leading-none">
                      {Math.max(0, creditsInfo?.remaining ?? creditsFallback?.remaining ?? 0)}
                    </div>
                    <div className="text-sm text-theme-muted font-bold uppercase tracking-wide opacity-80 mb-1">
                      / {creditsInfo?.limit ?? creditsFallback?.limit ?? 0} credits
                    </div>
                  </div>
                  
                  <div className="h-2 bg-theme-hover/50 rounded-full overflow-hidden w-full border border-theme/50 shadow-inner">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-blue-500 rounded-full transition-all duration-1000 ease-out relative"
                      style={{ 
                        width: `${Math.min(100, Math.max(0, ((creditsInfo?.used ?? creditsFallback?.used ?? 0) / Math.max(1, creditsInfo?.limit ?? creditsFallback?.limit ?? 1)) * 100))}%` 
                      }}
                    >
                      <div className="absolute inset-0 bg-white/20 w-full h-full animate-[shimmer_2s_infinite] -skew-x-12" />
                    </div>
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
              className="flex-1 py-2.5 px-4 bg-primary text-primary-fg rounded-xl text-[13px] font-black hover:opacity-90 hover:scale-105 hover:shadow-lg hover:shadow-primary/20 transition-all duration-300 active:scale-95"
            >
              Upgrade Plan
            </button>
            <button 
              onClick={() => {
                try { (window as any).desktopAPI?.openExternal?.('https://stuard.ai/pricing'); } catch { window.open('https://stuard.ai/pricing', '_blank'); }
              }}
              className="flex-1 py-2.5 px-4 bg-theme-hover/50 border border-theme/50 text-theme-fg rounded-xl text-[13px] font-black hover:bg-theme-hover hover:scale-105 transition-all duration-300 active:scale-95"
            >
              Buy Credits
            </button>
          </div>
        </div>

        {/* Usage & Stats */}
        <div className="rounded-theme-card border border-theme bg-theme-card p-6 shadow-lg hover:shadow-xl hover:border-primary/30 transition-all duration-300 flex flex-col justify-between min-h-[220px] group relative overflow-hidden">
          <div className="absolute bottom-0 left-0 p-32 bg-gradient-to-tr from-emerald-500/5 to-transparent rounded-full blur-3xl -ml-16 -mb-16 pointer-events-none opacity-50 group-hover:opacity-70 transition-opacity duration-500"></div>
          
          <div className="relative z-10">
             <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-inner">
                  <Clock className="w-5 h-5 text-emerald-500" />
                </div>
                <span className="text-sm font-bold text-theme-muted uppercase tracking-wider">Monthly Usage</span>
              </div>
              
              <div className="text-5xl font-black text-theme-fg tracking-tighter">
                {usage?.length ?? 0}
              </div>
              <div className="text-xs font-bold text-theme-muted mt-2 uppercase tracking-wide opacity-80">Total events processed</div>
          </div>

          <div className="mt-4 pt-4 border-t border-theme relative z-10">
             <button 
              onClick={() => onNavigate('history')}
              className="w-full flex items-center justify-between gap-2 text-xs font-bold text-theme-muted hover:text-theme-fg py-2.5 px-4 rounded-xl hover:bg-theme-hover transition-all duration-300 group/btn border border-transparent hover:border-theme/50"
             >
               <span className="flex items-center gap-2.5">
                 <BookOpen className="w-4 h-4 text-emerald-500/70 group-hover/btn:text-emerald-500 transition-colors" />
                 View Usage History
               </span>
               <ArrowRight className="w-4 h-4 opacity-0 group-hover/btn:opacity-100 -translate-x-4 group-hover/btn:translate-x-0 transition-all duration-300 text-emerald-500" />
             </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="rounded-theme-card border border-theme bg-theme-card p-6 shadow-lg hover:shadow-xl hover:border-primary/30 transition-all duration-300 min-h-[220px] relative overflow-hidden group">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-32 bg-gradient-to-br from-amber-500/5 to-orange-500/5 rounded-full blur-3xl pointer-events-none opacity-50 group-hover:opacity-70 transition-opacity duration-500"></div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-amber-500/10 rounded-xl border border-amber-500/20 shadow-inner">
                <Zap className="w-5 h-5 text-amber-500" />
              </div>
              <span className="text-sm font-bold text-theme-muted uppercase tracking-wider">Quick Actions</span>
            </div>

            <div className="grid grid-cols-2 gap-4 h-[calc(100%-60px)]">
              <button 
                onClick={() => onNavigate('planner')}
                className="flex flex-col items-center justify-center gap-3 p-4 rounded-2xl border border-theme/50 bg-theme-hover/50 hover:bg-theme-hover hover:border-amber-500/30 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group/action"
              >
                <div className="p-3 bg-theme-card rounded-xl border border-theme/50 text-theme-muted group-hover/action:text-amber-500 group-hover/action:border-amber-500/30 group-hover/action:bg-amber-500/10 transition-all duration-300 shadow-sm">
                  <Calendar className="w-6 h-6" />
                </div>
                <span className="text-xs font-black text-theme-muted group-hover/action:text-theme-fg uppercase tracking-wider">Planner</span>
              </button>
              
              <button 
                onClick={() => onNavigate('automations')}
                className="flex flex-col items-center justify-center gap-3 p-4 rounded-2xl border border-theme/50 bg-theme-hover/50 hover:bg-theme-hover hover:border-blue-500/30 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group/action"
              >
                <div className="p-3 bg-theme-card rounded-xl border border-theme/50 text-theme-muted group-hover/action:text-blue-500 group-hover/action:border-blue-500/30 group-hover/action:bg-blue-500/10 transition-all duration-300 shadow-sm">
                  <Rocket className="w-6 h-6" />
                </div>
                <span className="text-xs font-black text-theme-muted group-hover/action:text-theme-fg uppercase tracking-wider">Automations</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Conversations */}
      <div className="space-y-6 relative z-10">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-2xl font-stuard text-theme-fg tracking-tight flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-primary/70" />
            Recent Conversations
          </h2>
          <button 
            onClick={() => onNavigate('history')}
            className="text-[13px] font-black text-theme-muted hover:text-primary transition-colors flex items-center gap-1.5 group uppercase tracking-wider"
          >
            View all
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </button>
        </div>

        <div className="bg-theme-card border border-theme/50 rounded-3xl shadow-lg overflow-hidden relative group/list">
          <div className="absolute top-0 right-0 p-32 bg-gradient-to-bl from-primary/5 to-transparent rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-50 group-hover/list:opacity-100 transition-opacity duration-700"></div>
          
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center relative z-10">
              <div className="w-20 h-20 bg-theme-hover/50 rounded-2xl flex items-center justify-center mb-6 border border-theme/50 shadow-inner">
                <MessageSquare className="w-8 h-8 text-theme-muted/50" />
              </div>
              <p className="text-lg font-black text-theme-fg tracking-tight mb-2">No conversations yet</p>
              <p className="text-[13px] text-theme-muted max-w-sm font-medium leading-relaxed">Start chatting with Stuard to get help with your tasks, coding, and questions.</p>
              <button 
                onClick={() => onNavigate('history')} 
                className="mt-8 px-6 py-3 bg-primary text-primary-fg rounded-xl text-[13px] font-black hover:opacity-90 hover:scale-105 hover:shadow-lg hover:shadow-primary/20 transition-all duration-300 active:scale-95"
              >
                Start a Conversation
              </button>
            </div>
          ) : (
            <div className="divide-y divide-theme/30 relative z-10">
              {conversations.slice(0, 5).map((c: any) => (
                <div 
                  key={c.id} 
                  className="group flex items-center gap-6 p-6 hover:bg-theme-hover/50 transition-all duration-300 cursor-pointer relative overflow-hidden"
                  onClick={() => onNavigate('history')}
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary opacity-0 group-hover:opacity-100 transition-opacity duration-300 shadow-[0_0_12px_rgba(0,122,204,0.5)]" />
                  
                  <div className="w-14 h-14 rounded-2xl bg-theme-hover/50 flex items-center justify-center shrink-0 border border-theme/50 shadow-sm group-hover:bg-theme-card group-hover:scale-110 group-hover:border-primary/30 transition-all duration-300">
                    <MessageSquare className="w-6 h-6 text-theme-muted group-hover:text-primary transition-colors duration-300" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-[16px] text-theme-fg truncate group-hover:text-primary transition-colors duration-300 tracking-tight">
                      {c.title || `Conversation ${String(c.id).slice(0, 8)}`}
                    </div>
                    <div className="text-[13px] text-theme-muted mt-1.5 truncate font-medium opacity-80 group-hover:opacity-100 transition-opacity duration-300">
                      {c.last_message || "No messages preview"}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-3 shrink-0 pl-4">
                    <div className="text-[11px] text-theme-muted font-black tracking-widest uppercase bg-theme-hover/50 px-3 py-1.5 rounded-lg border border-theme/50 shadow-sm">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}
                    </div>
                    <ArrowRight className="w-5 h-5 text-primary opacity-0 group-hover:opacity-100 -translate-x-4 group-hover:translate-x-0 transition-all duration-300" />
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
