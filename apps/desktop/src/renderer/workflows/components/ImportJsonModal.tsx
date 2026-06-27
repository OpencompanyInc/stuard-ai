/**
 * Import JSON Modal - Import workflows from file or JSON
 */
import React from "react";
import { X, Folder, Grid } from "lucide-react";
import { RichCodeEditor } from "./RichCodeEditor";

interface ImportJsonModalProps {
  importJson: string;
  setImportJson: (json: string) => void;
  importErr: string;
  onClose: () => void;
  onImport: () => void;
  onOpenMarketplace: () => void;
}

export function ImportJsonModal({ 
  importJson, setImportJson, importErr, onClose, onImport, onOpenMarketplace 
}: ImportJsonModalProps) {
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setImportJson(text);
    } catch (err: any) {
      // Error will be handled by parent through importErr
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white/[0.04] rounded-xl shadow-2xl w-[600px] max-w-[90vw] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Import Workflow</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/[0.1] rounded"><X className="w-4 h-4" /></button>
        </div>
        
        {/* File Picker */}
        <div className="mb-4">
          <input 
            type="file" 
            id="workflow-file-input"
            accept=".json,.stuard"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button 
            onClick={() => document.getElementById('workflow-file-input')?.click()}
            className="w-full px-4 py-6 border-2 border-dashed border-white/[0.12] rounded-lg text-white/50 hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50 transition-colors flex flex-col items-center gap-2"
          >
            <Folder className="w-6 h-6" />
            <span className="font-medium">Choose .json or .stuard file</span>
            <span className="text-xs text-white/40">or paste JSON below</span>
          </button>
        </div>
        
        {/* Marketplace Import */}
        <div className="mb-4 p-3 bg-violet-50 rounded-lg">
          <button 
            onClick={onOpenMarketplace}
            className="w-full text-left flex items-center gap-3 text-violet-700 hover:bg-violet-100 -m-3 p-3 rounded-lg transition-colors"
          >
            <Grid className="w-5 h-5" />
            <div>
              <div className="font-medium text-sm">Browse Marketplace</div>
              <div className="text-xs text-violet-500">Find pre-built workflows</div>
            </div>
          </button>
        </div>
        
        <div className="h-64 mb-3 border border-white/[0.08] rounded-xl overflow-hidden">
          <RichCodeEditor
            value={importJson}
            onChange={setImportJson}
            language="json"
            placeholder="Paste workflow JSON here..."
            className="h-full border-0 rounded-none"
          />
        </div>

        {importErr && <div className="text-red-600 text-sm mb-3 px-1">{importErr}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/70 hover:bg-white/[0.1] rounded-lg">Cancel</button>
          <button onClick={onImport} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 shadow-sm">Import</button>
        </div>
      </div>
    </div>
  );
}

