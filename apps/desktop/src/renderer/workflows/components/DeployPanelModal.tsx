/**
 * Deploy Panel Modal - Shows deployment status and actions
 */
import React from "react";
import { 
  Rocket, X, Check, Download, Upload, Play, Square, RefreshCw,
  Clock, Keyboard, FolderOpen, Link2, Zap, CircleDot, Cloud,
  Server, Loader2, CheckCircle2, AlertCircle, ChevronRight, AppWindow
} from "lucide-react";
import type { DesignerModel, DesignerTrigger } from "../types";
import type { CloudVM, CloudDeployState } from "../hooks/useWorkflowDeploy";
import { useWorkflowTheme } from "../WorkflowThemeContext";

interface DeployPanelModalProps {
  model: DesignerModel;
  deployStatus: { deployed: boolean; running: boolean; triggers: string[] } | null;
  onClose: () => void;
  onDeploy: () => void;
  onUndeploy: () => void;
  onExport: () => void;
  onPublish: () => void;
  // Cloud deploy props
  cloudVMs: CloudVM[];
  selectedVM: string | null;
  onSelectVM: (vmId: string) => void;
  cloudDeployState: CloudDeployState;
  cloudDeployError: string | null;
  cloudDeployId: string | null;
  onDeployToCloud: (vmId?: string) => void;
  onResetCloudDeploy: () => void;
}

// Helper to get trigger display info
function getTriggerInfo(trigger: DesignerTrigger, d: boolean): { icon: React.ReactNode; label: string; value?: string; color: string } {
  switch (trigger.type) {
    case 'schedule.cron':
      return { 
        icon: <Clock className="w-3.5 h-3.5" />, 
        label: 'Schedule', 
        value: trigger.args?.cron,
        color: 'text-amber-600 bg-amber-50 border-amber-200'
      };
    case 'hotkey':
      return { 
        icon: <Keyboard className="w-3.5 h-3.5" />, 
        label: 'Hotkey', 
        value: trigger.args?.accelerator,
        color: 'text-blue-600 bg-blue-50 border-blue-200'
      };
    case 'fs.watch':
      return { 
        icon: <FolderOpen className="w-3.5 h-3.5" />, 
        label: 'File Watcher', 
        value: trigger.args?.path,
        color: 'text-orange-600 bg-orange-50 border-orange-200'
      };
    case 'gmail.new_email':
      return {
        icon: <Zap className="w-3.5 h-3.5" />,
        label: 'Gmail (Native)',
        value: trigger.args?.profile || 'default',
        color: 'text-red-600 bg-red-50 border-red-200'
      };
    case 'drive.new_file':
      return {
        icon: <Cloud className="w-3.5 h-3.5" />,
        label: 'Drive (Native)',
        value: trigger.args?.profile || 'default',
        color: 'text-amber-700 bg-amber-50 border-amber-200'
      };
    case 'manual':
      return { 
        icon: <Play className="w-3.5 h-3.5" />, 
        label: 'Manual', 
        color: d ? 'text-blue-300 bg-blue-500/10 border-blue-500/20' : 'text-blue-700 bg-blue-50 border-blue-200'
      };
    case 'app_start':
      return {
        icon: <AppWindow className="w-3.5 h-3.5" />,
        label: 'On App Start',
        color: d ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' : 'text-emerald-700 bg-emerald-50 border-emerald-200'
      };
    default:
      return { 
        icon: <Link2 className="w-3.5 h-3.5" />, 
        label: trigger.type, 
        color: 'text-violet-600 bg-violet-50 border-violet-200'
      };
  }
}

export function DeployPanelModal({ 
  model, deployStatus, onClose, onDeploy, onUndeploy, onExport, onPublish,
  cloudVMs, selectedVM, onSelectVM, cloudDeployState, cloudDeployError, cloudDeployId, onDeployToCloud, onResetCloudDeploy,
}: DeployPanelModalProps) {
  const { isDark } = useWorkflowTheme();
  const d = isDark;
  const isDeployed = deployStatus?.deployed;
  const triggerCount = model.triggers?.length || 0;
  const runningVMs = cloudVMs.filter((vm) => vm.status === 'running');
  const hasRunningVM = runningVMs.length > 0;
  const panelStyle = { background: d ? "#0f1117" : "#ffffff", borderColor: "var(--wf-border)", color: "var(--wf-fg)" } as React.CSSProperties;
  const headerStyle = { background: d ? "#0c0f14" : "#ffffff", borderColor: "var(--wf-border)" } as React.CSSProperties;
  const sectionCardStyle = { background: d ? "rgba(255,255,255,0.03)" : "#ffffff", borderColor: "var(--wf-border)" } as React.CSSProperties;
  const subtleCardStyle = { background: d ? "rgba(255,255,255,0.02)" : "var(--wf-bg)", borderColor: "var(--wf-border)" } as React.CSSProperties;
  const footerStyle = { background: d ? "#0c0f14" : "#ffffff", borderColor: "var(--wf-border)" } as React.CSSProperties;

  return (
    <div 
      className="fixed inset-0 backdrop-blur-md flex items-center justify-center z-50 animate-in fade-in duration-150 p-4" 
      style={{ background: d ? "rgba(2, 6, 23, 0.78)" : "rgba(15, 23, 42, 0.18)" }}
      onClick={onClose}
    >
      <div 
        className="rounded-[28px] border shadow-2xl w-[560px] max-w-[92vw] overflow-hidden animate-in zoom-in-95 duration-200" 
        style={panelStyle}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between" style={headerStyle}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center shadow-lg shadow-rose-500/20">
              <Rocket className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold wf-fg">Deploy Workflow</h3>
              <p className="text-xs wf-fg-muted">{model.name || 'Untitled Workflow'}</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 rounded-lg transition-colors"
            style={{ color: "var(--wf-fg-faint)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Status Card */}
          <div
            className="relative overflow-hidden rounded-2xl border transition-all"
            style={isDeployed
              ? { background: d ? "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(34,197,94,0.06))" : "linear-gradient(135deg, #ecfdf5, #f0fdf4)", borderColor: d ? "rgba(16,185,129,0.22)" : "#bbf7d0" }
              : { background: d ? "rgba(255,255,255,0.03)" : "linear-gradient(135deg, #f8fafc, #f1f5f9)", borderColor: "var(--wf-border)" }}
          >
            <div className="p-4 flex items-center gap-4">
              {/* Status Indicator */}
              <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center ${
                isDeployed ? 'bg-emerald-100' : d ? 'bg-white/[0.06]' : 'bg-slate-200'
              }`}>
                {isDeployed ? (
                  <>
                    <Check className="w-6 h-6 text-emerald-600" />
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white">
                      <span className="absolute inset-0 bg-emerald-400 rounded-full animate-ping" />
                    </span>
                  </>
                ) : (
                  <Rocket className={`w-6 h-6 ${d ? 'text-white/40' : 'text-slate-400'}`} />
                )}
              </div>
              
              {/* Status Text */}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${isDeployed ? 'text-emerald-700' : 'wf-fg'}`}>
                    {isDeployed ? 'Deployed & Active' : 'Not Deployed'}
                  </span>
                  {isDeployed && (
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 rounded-full">
                      Live
                    </span>
                  )}
                </div>
                <p className="text-sm wf-fg-muted mt-0.5">
                  {isDeployed 
                    ? `Running with ${triggerCount} active trigger${triggerCount !== 1 ? 's' : ''}`
                    : 'Deploy to enable automatic triggers'}
                </p>
              </div>
            </div>
            
            {/* Decorative element */}
            {isDeployed && (
              <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-emerald-200/30 rounded-full blur-2xl" />
            )}
          </div>
          
          {/* Triggers Section */}
          {triggerCount > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 wf-fg-faint" />
                <span className="text-sm font-medium wf-fg">Triggers</span>
                <span className="ml-auto text-xs wf-fg-faint">{triggerCount} configured</span>
              </div>
              <div className="grid gap-2">
                {model.triggers.map((trigger, i) => {
                  const info = getTriggerInfo(trigger, d);
                  return (
                    <div 
                      key={i} 
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border ${info.color} transition-all hover:shadow-sm`}
                    >
                      <div className={`flex items-center justify-center w-7 h-7 rounded-lg ${d ? 'bg-black/20' : 'bg-white/70'}`}>
                        {info.icon}
                      </div>
                      <span className="font-medium text-sm">{info.label}</span>
                      {info.value && (
                        <code className={`ml-auto px-2 py-1 text-xs font-mono rounded-md ${d ? 'bg-black/20 text-white/75' : 'bg-white/70 text-slate-700'}`}>
                          {info.value}
                        </code>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Primary Actions */}
          <div className="pt-2">
            {isDeployed ? (
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={onUndeploy} 
                  className="group flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-all hover:shadow-md hover:shadow-red-100"
                >
                  <Square className="w-4 h-4" />
                  <span>Stop & Undeploy</span>
                </button>
                <button 
                  onClick={onDeploy} 
                  className="group flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-white bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 rounded-xl shadow-lg shadow-emerald-200 transition-all hover:shadow-xl hover:shadow-emerald-200 hover:-translate-y-0.5"
                >
                  <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                  <span>Redeploy</span>
                </button>
              </div>
            ) : (
              <button
                onClick={onDeploy}
                className="group w-full flex items-center justify-center gap-2.5 px-4 py-3.5 text-sm font-medium text-white bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 rounded-xl shadow-lg shadow-rose-500/20 transition-all hover:shadow-xl hover:shadow-rose-500/30 hover:-translate-y-0.5"
              >
                <Rocket className="w-4 h-4 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
                <span>Deploy Workflow</span>
              </button>
            )}
          </div>
          {/* Cloud Deploy Section */}
          <div className="pt-1">
            <div className="flex items-center gap-2 mb-3">
              <Cloud className="w-4 h-4 text-rose-500" />
              <span className="text-sm font-medium wf-fg">Deploy to Cloud VM</span>
              {hasRunningVM && (
                <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  {runningVMs.length} Online
                </span>
              )}
            </div>

            {/* VM selector */}
            {cloudVMs.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed p-4 text-center" style={{ borderColor: "var(--wf-input-border)", background: d ? "rgba(255,255,255,0.02)" : "var(--wf-bg)" }}>
                <Server className={`w-8 h-8 mx-auto mb-2 ${d ? 'text-white/35' : 'text-slate-300'}`} />
                <p className="text-sm wf-fg font-medium">No Cloud VMs found</p>
                <p className="text-xs wf-fg-muted mt-1">Set up a Cloud Engine in Settings to deploy workflows to the cloud</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cloudVMs.map((vm) => {
                  const isSelected = selectedVM === vm.id;
                  const isRunning = vm.status === 'running';
                  return (
                    <button
                      key={vm.id}
                      onClick={() => onSelectVM(vm.id)}
                      disabled={!isRunning}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
                        isSelected && isRunning
                          ? 'border-rose-300 bg-rose-50 shadow-sm shadow-rose-100'
                          : isRunning
                            ? d ? 'border-white/[0.08] bg-white/[0.03] hover:border-rose-300/60 hover:bg-rose-500/10' : 'border-slate-200 bg-white hover:border-rose-200 hover:bg-rose-50/50'
                            : d ? 'border-white/[0.04] bg-white/[0.02] opacity-60 cursor-not-allowed' : 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                      }`}
                    >
                      {/* Status dot */}
                      <div className="relative">
                        <Server className={`w-5 h-5 ${isRunning ? 'text-rose-500' : 'text-slate-300'}`} />
                        <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                          isRunning ? 'bg-emerald-500' : vm.status === 'provisioning' ? 'bg-amber-400' : 'bg-slate-300'
                        }`}>
                          {isRunning && <span className="absolute inset-0 bg-emerald-400 rounded-full animate-ping" />}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate wf-fg">{vm.instance_name || 'Cloud Engine'}</span>
                          <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${
                            isRunning ? 'bg-emerald-100 text-emerald-700' : d ? 'bg-white/[0.06] text-white/50' : 'bg-slate-200 text-slate-500'
                          }`}>
                            {vm.status}
                          </span>
                        </div>
                        <div className="text-xs wf-fg-faint mt-0.5 flex items-center gap-2">
                          <span>{vm.tier}</span>
                          <span className={d ? 'text-white/20' : 'text-slate-300'}>•</span>
                          <span>{vm.zone}</span>
                          {vm.external_ip && (
                            <>
                              <span className={d ? 'text-white/20' : 'text-slate-300'}>•</span>
                              <span>{vm.external_ip}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Selection indicator */}
                      {isSelected && isRunning && (
                        <CheckCircle2 className="w-5 h-5 text-rose-500 flex-shrink-0" />
                      )}
                      {!isSelected && isRunning && (
                        <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 ${d ? 'border-white/[0.08]' : 'border-slate-300'}`} />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Cloud Deploy Button */}
            {hasRunningVM && (
              <div className="mt-3">
                {cloudDeployState === 'idle' && (
                  <button
                    onClick={() => onDeployToCloud(selectedVM || undefined)}
                    disabled={!selectedVM}
                    className={`group w-full flex items-center justify-center gap-2.5 px-4 py-3 text-sm font-medium rounded-xl transition-all ${
                      selectedVM
                        ? 'text-white bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 shadow-lg shadow-rose-500/20 hover:shadow-xl hover:shadow-rose-500/30 hover:-translate-y-0.5'
                        : d ? 'text-white/40 bg-white/[0.06] cursor-not-allowed' : 'text-slate-400 bg-slate-100 cursor-not-allowed'
                    }`}
                  >
                    <Cloud className="w-4 h-4" />
                    <span>Deploy to Cloud VM</span>
                    <ChevronRight className="w-3.5 h-3.5 opacity-60 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                )}

                {cloudDeployState === 'deploying' && (
                  <div className="flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-rose-50 border border-rose-200">
                    <Loader2 className="w-4 h-4 text-rose-500 animate-spin" />
                    <span className="text-sm font-medium text-rose-700">Deploying to cloud...</span>
                  </div>
                )}

                {cloudDeployState === 'success' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-emerald-700">Deployed successfully!</span>
                        {cloudDeployId && (
                          <p className="text-xs text-emerald-500 mt-0.5 font-mono">{cloudDeployId.slice(0, 8)}...</p>
                        )}
                      </div>
                      <button
                        onClick={onResetCloudDeploy}
                        className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}

                {cloudDeployState === 'error' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
                      <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-red-700">Deploy failed</span>
                        {cloudDeployError && (
                          <p className="text-xs text-red-500 mt-0.5 truncate">{cloudDeployError}</p>
                        )}
                      </div>
                      <button
                        onClick={onResetCloudDeploy}
                        className="text-xs text-red-600 hover:text-red-800 font-medium flex-shrink-0"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Footer - Secondary Actions */}
        <div className="px-6 py-4 border-t" style={footerStyle}>
          <div className="flex items-center gap-3">
            <button 
              onClick={onExport}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium border rounded-xl transition-all"
              style={{ background: d ? "rgba(255,255,255,0.03)" : "#ffffff", borderColor: "var(--wf-input-border)", color: "var(--wf-fg)" }}
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
            <button
              onClick={onPublish}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all border"
              style={{ background: d ? "rgba(244,63,94,0.10)" : "#fef2f2", color: d ? "#fda4af" : "#e11d48", borderColor: d ? "rgba(244,63,94,0.20)" : "#fecdd3" }}
            >
              <Upload className="w-4 h-4" />
              <span>Publish to Marketplace</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
