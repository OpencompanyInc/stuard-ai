import React, { useEffect, useRef, useState } from "react";
import { Calendar, FileCode, FolderOpen, LayoutGrid, Sparkles, Wand2, X } from "lucide-react";
import { WORKFLOW_TEMPLATES, getWorkflowTemplate, type WorkflowTemplateIcon } from "../constants/workflowTemplates";

interface ProjectNameModalProps {
  onConfirm: (name: string, templateId: string) => void;
  onClose: () => void;
  initialTemplateId?: string;
}

const TEMPLATE_ICONS: Record<WorkflowTemplateIcon, any> = {
  blank: LayoutGrid,
  function: FileCode,
  morning: Calendar,
  starter: Sparkles,
  ui: Wand2,
};

export function ProjectNameModal({ onConfirm, onClose, initialTemplateId }: ProjectNameModalProps) {
  const initialTemplate = getWorkflowTemplate(initialTemplateId);
  const [templateId, setTemplateId] = useState(initialTemplate.id);
  const [name, setName] = useState(initialTemplate.defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, templateId);
  };

  const selectTemplate = (id: string) => {
    const template = getWorkflowTemplate(id);
    setTemplateId(template.id);
    if (!name.trim() || WORKFLOW_TEMPLATES.some((item) => item.defaultName === name.trim())) {
      setName(template.defaultName);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#141418] border border-white/[0.08] rounded-2xl shadow-2xl w-[640px] max-w-[92vw] p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 flex items-center justify-center text-blue-400">
              <FolderOpen className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-white text-[15px]">New Workflow</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-white/45 mb-4 leading-relaxed">
          Pick a starting point, then name it.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
          {WORKFLOW_TEMPLATES.map((template) => {
            const Icon = TEMPLATE_ICONS[template.icon] || Sparkles;
            const active = template.id === templateId;
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => selectTemplate(template.id)}
                className={`text-left rounded-xl border p-3 transition-all ${active ? "border-blue-500/70 bg-blue-500/10" : "border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.06] hover:border-white/[0.14]"}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-blue-500/20 text-blue-300" : "bg-white/[0.06] text-white/45"}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-[13px] font-semibold text-white truncate">{template.title}</div>
                      <span className="text-[9px] uppercase tracking-wide text-white/35 border border-white/[0.08] rounded-full px-1.5 py-0.5 shrink-0">
                        {template.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-white/40 mt-1 leading-relaxed line-clamp-2">{template.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onClose();
          }}
          placeholder="My Workflow"
          className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/25 outline-none focus:border-blue-500/60 focus:bg-white/[0.07] transition-colors mb-5"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/50 hover:text-white hover:bg-white/[0.06] rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-5 py-2 text-sm font-medium bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
          >
            Create Workflow
          </button>
        </div>
      </div>
    </div>
  );
}
