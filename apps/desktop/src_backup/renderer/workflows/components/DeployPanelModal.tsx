/**
 * Deploy Panel Modal - Shows deployment status and actions
 */
import React from "react";
import { 
  Rocket, X, Check, Download, Upload, Play, Square, RefreshCw,
  Clock, Keyboard, FolderOpen, Link2, Zap, CircleDot
} from "lucide-react";
import type { DesignerModel, DesignerTrigger } from "../types";

interface DeployPanelModalProps {
  model: DesignerModel;
  deployStatus: { deployed: boolean; running: boolean; triggers: string[] } | null;
  onClose: () => void;
  onDeploy: () => void;
  onUndeploy: () => void;
  onExport: () => void;
  onPublish: () => void;
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
    case 'manual':
      return { 
        icon: <Play className="w-3.5 h-3.5" />, 
        label: 'Manual', 
        color: 'text-slate-600 bg-slate-50 border-slate-200'
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
  model, deployStatus, onClose, onDeploy, onUndeploy, onExport, onPublish 
}: DeployPanelModalProps) {
  const isDeployed = deployStatus?.deployed;
  const triggerCount = model.triggers?.length || 0;

  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-150" 
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-[460px] max-w-[90vw] overflow-hidden animate-in zoom-in-95 duration-200" 
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-200">
              <Rocket className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Deploy Workflow</h3>
              <p className="text-xs text-slate-500">{model.name || 'Untitled Workflow'}</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
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
              : 'border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100'
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
                  <Rocket className="w-6 h-6 text-slate-400" />
                )}
              </div>
              
              {/* Status Text */}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${isDeployed ? 'text-emerald-700' : 'text-slate-700'}`}>
                    {isDeployed ? 'Deployed & Active' : 'Not Deployed'}
                  </span>
                  {isDeployed && (
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 rounded-full">
                      Live
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
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
                <Zap className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-700">Triggers</span>
                <span className="ml-auto text-xs text-slate-400">{triggerCount} configured</span>
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
                        <code className="ml-auto px-2 py-1 text-xs font-mono bg-white/60 rounded-md text-slate-600">
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
                className="group w-full flex items-center justify-center gap-2.5 px-4 py-3.5 text-sm font-medium text-white bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 rounded-xl shadow-lg shadow-violet-200 transition-all hover:shadow-xl hover:shadow-violet-300 hover:-translate-y-0.5"
              >
                <Rocket className="w-4 h-4 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
                <span>Deploy Workflow</span>
              </button>
            )}
          </div>
        </div>
        
        {/* Footer - Secondary Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100">
          <div className="flex items-center gap-3">
            <button 
              onClick={onExport}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition-all hover:border-slate-300"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
            <button 
              onClick={onPublish}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-violet-600 bg-white hover:bg-violet-50 border border-violet-200 rounded-xl transition-all hover:border-violet-300"
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
