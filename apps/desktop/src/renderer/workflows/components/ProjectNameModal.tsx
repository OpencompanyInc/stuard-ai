import React, { useEffect, useRef, useState } from "react";
import { FolderOpen, X } from "lucide-react";

interface ProjectNameModalProps {
  onConfirm: (name: string) => void;
  onClose: () => void;
}

export function ProjectNameModal({ onConfirm, onClose }: ProjectNameModalProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#141418] border border-white/[0.08] rounded-2xl shadow-2xl w-[420px] max-w-[90vw] p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 flex items-center justify-center text-blue-400">
              <FolderOpen className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-white text-[15px]">New Project</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-white/45 mb-4 leading-relaxed">
          Give your project a name to get started.
        </p>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onClose();
          }}
          placeholder="My Workflow Project"
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
            Create Project
          </button>
        </div>
      </div>
    </div>
  );
}
