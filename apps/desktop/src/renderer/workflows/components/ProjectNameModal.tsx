import React, { useEffect, useRef, useState } from "react";
import { Calendar, FileCode, FolderOpen, LayoutGrid, Rocket, Wand2, X } from "lucide-react";
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
  starter: Rocket,
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
      <div
        className="rounded-2xl border shadow-2xl w-[640px] max-w-[92vw] p-6 wf-fg"
        style={{ background: "var(--wf-bg-elevated)", borderColor: "var(--wf-border)" }}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="wf-icon-chip w-8 h-8 rounded-xl flex items-center justify-center">
              <FolderOpen className="w-4 h-4" />
            </div>
            <h3 className="font-semibold wf-fg text-[15px]">New Workflow</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg wf-fg-faint hover:text-[color:var(--wf-fg)] hover:bg-[var(--wf-hover)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm wf-fg-muted mb-4 leading-relaxed">
          Pick a starting point, then name it.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
          {WORKFLOW_TEMPLATES.map((template) => {
            const Icon = TEMPLATE_ICONS[template.icon] || LayoutGrid;
            const active = template.id === templateId;
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => selectTemplate(template.id)}
                className={`text-left rounded-xl border p-3 transition-all ${
                  active
                    ? "border-[color:color-mix(in_srgb,var(--wf-accent)_45%,var(--wf-border))] wf-accent-soft-bg"
                    : "wf-card wf-card-interactive"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      active ? "text-[color:var(--wf-accent)] bg-[var(--wf-accent-soft)]" : "wf-icon-chip"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-[13px] font-semibold wf-fg truncate">{template.title}</div>
                      <span className="text-[9px] uppercase tracking-wide wf-fg-faint border wf-border rounded-full px-1.5 py-0.5 shrink-0">
                        {template.badge}
                      </span>
                    </div>
                    <p className="text-[11px] wf-fg-muted mt-1 leading-relaxed line-clamp-2">{template.description}</p>
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
          className="wf-input w-full rounded-xl px-4 py-2.5 text-sm outline-none transition-colors mb-5"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm wf-fg-muted hover:text-[color:var(--wf-fg)] hover:bg-[var(--wf-hover)] rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="wf-primary-btn px-5 py-2 text-sm font-semibold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create Workflow
          </button>
        </div>
      </div>
    </div>
  );
}
