import React from "react";

export default function HotkeysHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-24">
      <div className="w-[640px] rounded-xl border border-white/10 bg-neutral-900 text-white shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 text-[14px] font-semibold">Hotkeys & Shortcuts</div>
        <div className="p-4 space-y-4 text-[13px]">
          <div>
            <div className="text-white/70 mb-1 font-medium">Global</div>
            <ul className="space-y-1">
              <li className="flex items-center justify-between bg-white/5 rounded px-3 py-1.5">
                <span>Toggle overlay</span>
                <span className="text-white/60">Ctrl + Shift + Space</span>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-white/70 mb-1 font-medium">When overlay is visible but unfocused</div>
            <ul className="space-y-1">
              <li className="flex items-center justify-between bg-white/5 rounded px-3 py-1.5">
                <span>Nudge overlay</span>
                <span className="text-white/60">Ctrl + Arrow keys</span>
              </li>
              <li className="flex items-center justify-between bg-white/5 rounded px-3 py-1.5">
                <span>Fast nudge</span>
                <span className="text-white/60">Ctrl + Shift + Arrow keys</span>
              </li>
            </ul>
          </div>
          <div>
            <div className="text-white/70 mb-1 font-medium">In the chat input</div>
            <ul className="space-y-1">
              <li className="flex items-center justify-between bg-white/5 rounded px-3 py-1.5">
                <span>Send message</span>
                <span className="text-white/60">Enter</span>
              </li>
              <li className="flex items-center justify-between bg-white/5 rounded px-3 py-1.5">
                <span>New line</span>
                <span className="text-white/60">Shift + Enter</span>
              </li>
              <li className="flex items-center justify-between bg-white/5 rounded px-3 py-1.5">
                <span>Hide overlay</span>
                <span className="text-white/60">Esc</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="px-4 py-2 border-t border-white/10 text-[12px] text-white/60 flex items-center justify-between">
          <div>Tip: You can move the overlay even when it's not focused.</div>
          <button onClick={onClose} className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15">Close</button>
        </div>
      </div>
    </div>
  );
}
