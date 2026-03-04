/**
 * Deploy Panel Modal - Shows deployment status and actions
 */
import React from "react";
import { 
  Rocket, X, Check, Download, Upload, Play, Square, RefreshCw,
  Clock, Keyboard, FolderOpen, Link2, Zap, CircleDot, Cloud,
  Server, Loader2, CheckCircle2, AlertCircle, ChevronRight
} from "lucide-react";
import type { DesignerModel, DesignerTrigger } from "../types";
import type { CloudVM, CloudDeployState } from "../hooks/useWorkflowDeploy";

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
function getTriggerInfo(trigger: DesignerTrigger): { icon: React.ReactNode; label: string; value?: string; color: string } {
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
        color: 'text-white/70 bg-white/[0.06] border-white/[0.08]'
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
  const isDeployed = deployStatus?.deployed;
  const triggerCount = model.triggers?.length || 0;
  const runningVMs = cloudVMs.filter((vm) => vm.status === 'running');
  const hasRunningVM = runningVMs.length > 0;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-150" 
      onClick={onClose}
    >
      <div 
        className="bg-white/[0.04] rounded-2xl shadow-2xl w-[460px] max-w-[90vw] overflow-hidden animate-in zoom-in-95 duration-200" 
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.04] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-sky-600 flex items-center justify-center shadow-lg shadow-blue-200">
              <Rocket className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Deploy Workflow</h3>
              <p className="text-xs text-white/50">{model.name || 'Untitled Workflow'}</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-white/[0.1] rounded-lg transition-colors text-white/40 hover:text-white/70"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Status Card */}
          <div className={`relative overflow-hidden rounded-xl border-2 transition-all ${
            isDeployed 
              ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50' 
              : 'border-white/[0.08] bg-gradient-to-br from-slate-50 to-slate-100'
          }`}>
            <div className="p-4 flex items-center gap-4">
              {/* Status Indicator */}
              <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center ${
                isDeployed ? 'bg-emerald-100' : 'bg-slate-200'
              }`}>
                {isDeployed ? (
                  <>
                    <Check className="w-6 h-6 text-emerald-600" />
                    <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white">
                      <span className="absolute inset-0 bg-emerald-400 rounded-full animate-ping" />
                    </span>
                  </>
                ) : (
                  <Rocket className="w-6 h-6 text-white/40" />
                )}
              </div>
              
              {/* Status Text */}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${isDeployed ? 'text-emerald-700' : 'text-white/80'}`}>
                    {isDeployed ? 'Deployed & Active' : 'Not Deployed'}
                  </span>
                  {isDeployed && (
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 rounded-full">
                      Live
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/50 mt-0.5">
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
                <Zap className="w-4 h-4 text-white/40" />
                <span className="text-sm font-medium text-white/80">Triggers</span>
                <span className="ml-auto text-xs text-white/40">{triggerCount} configured</span>
              </div>
              <div className="grid gap-2">
                {model.triggers.map((trigger, i) => {
                  const info = getTriggerInfo(trigger);
                  return (
                    <div 
                      key={i} 
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border ${info.color} transition-all hover:shadow-sm`}
                    >
                      <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/60">
                        {info.icon}
                      </div>
                      <span className="font-medium text-sm">{info.label}</span>
                      {info.value && (
                        <code className="ml-auto px-2 py-1 text-xs font-mono bg-white/60 rounded-md text-white/70">
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
                className="group w-full flex items-center justify-center gap-2.5 px-4 py-3.5 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-sky-600 hover:from-blue-600 hover:to-sky-700 rounded-xl shadow-lg shadow-blue-200 transition-all hover:shadow-xl hover:shadow-blue-300 hover:-translate-y-0.5"
              >
                <Rocket className="w-4 h-4 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
                <span>Deploy Workflow</span>
              </button>
            )}
          </div>
          {/* Cloud Deploy Section */}
          <div className="pt-1">
            <div className="flex items-center gap-2 mb-3">
              <Cloud className="w-4 h-4 text-sky-500" />
              <span className="text-sm font-medium text-white/80">Deploy to Cloud VM</span>
              {hasRunningVM && (
                <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  {runningVMs.length} Online
                </span>
              )}
            </div>

            {/* VM selector */}
            {cloudVMs.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-white/[0.08] p-4 text-center">
                <Server className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-white/50 font-medium">No Cloud VMs found</p>
                <p className="text-xs text-white/40 mt-1">Set up a Cloud Engine in Settings to deploy workflows to the cloud</p>
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
                          ? 'border-sky-300 bg-sky-50 shadow-sm shadow-sky-100'
                          : isRunning
                            ? 'border-white/[0.08] bg-white/[0.04] hover:border-sky-200 hover:bg-sky-50/50'
                            : 'border-white/[0.04] bg-white/[0.06] opacity-60 cursor-not-allowed'
                      }`}
                    >
                      {/* Status dot */}
                      <div className="relative">
                        <Server className={`w-5 h-5 ${isRunning ? 'text-sky-500' : 'text-slate-300'}`} />
                        <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                          isRunning ? 'bg-emerald-500' : vm.status === 'provisioning' ? 'bg-amber-400' : 'bg-slate-300'
                        }`}>
                          {isRunning && <span className="absolute inset-0 bg-emerald-400 rounded-full animate-ping" />}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white/90 truncate">{vm.instance_name || 'Cloud Engine'}</span>
                          <span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${
                            isRunning ? 'bg-emerald-100 text-emerald-700' : 'bg-white/[0.06] text-white/50'
                          }`}>
                            {vm.status}
                          </span>
                        </div>
                        <div className="text-xs text-white/40 mt-0.5 flex items-center gap-2">
                          <span>{vm.tier}</span>
                          <span className="text-slate-200">•</span>
                          <span>{vm.zone}</span>
                          {vm.external_ip && (
                            <>
                              <span className="text-slate-200">•</span>
                              <span>{vm.external_ip}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Selection indicator */}
                      {isSelected && isRunning && (
                        <CheckCircle2 className="w-5 h-5 text-sky-500 flex-shrink-0" />
                      )}
                      {!isSelected && isRunning && (
                        <div className="w-5 h-5 rounded-full border-2 border-white/[0.08] flex-shrink-0" />
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
                        ? 'text-white bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 shadow-lg shadow-sky-200 hover:shadow-xl hover:shadow-sky-300 hover:-translate-y-0.5'
                        : 'text-white/40 bg-white/[0.06] cursor-not-allowed'
                    }`}
                  >
                    <Cloud className="w-4 h-4" />
                    <span>Deploy to Cloud VM</span>
                    <ChevronRight className="w-3.5 h-3.5 opacity-60 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                )}

                {cloudDeployState === 'deploying' && (
                  <div className="flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-sky-50 border border-sky-200">
                    <Loader2 className="w-4 h-4 text-sky-500 animate-spin" />
                    <span className="text-sm font-medium text-sky-700">Deploying to cloud...</span>
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
        <div className="px-6 py-4 bg-white/[0.06] border-t border-white/[0.04]">
          <div className="flex items-center gap-3">
            <button 
              onClick={onExport}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white/70 bg-white/[0.04] hover:bg-white/[0.06] border border-white/[0.08] rounded-xl transition-all hover:border-white/[0.12]"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
            <button 
              onClick={onPublish}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-600 bg-white/[0.04] hover:bg-blue-50 border border-blue-200 rounded-xl transition-all hover:border-blue-300"
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

