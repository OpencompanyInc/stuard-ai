/**
 * UIBuilderPreview - Live preview in iframe
 * Shows the generated HTML/CSS/JS output
 */

import React, { useRef, useEffect, useState } from 'react';
import { RefreshCw, ExternalLink, Copy, Check, X, Maximize2, Minimize2 } from 'lucide-react';
import type { UIDesign } from './types';
import { generateCode } from './utils/codeGenerator';

interface UIBuilderPreviewProps {
  design: UIDesign;
  onClose: () => void;
}

export function UIBuilderPreview({ design, onClose }: UIBuilderPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'html' | 'css' | 'js'>('preview');

  const code = generateCode(design);

  // Update iframe content when design changes
  useEffect(() => {
    if (iframeRef.current && activeTab === 'preview') {
      const iframe = iframeRef.current;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(code.fullHtml);
        doc.close();
      }
    }
  }, [code.fullHtml, activeTab]);

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleRefresh = () => {
    if (iframeRef.current) {
      const iframe = iframeRef.current;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(code.fullHtml);
        doc.close();
      }
    }
  };

  const tabs = [
    { id: 'preview', label: 'Preview' },
    { id: 'html', label: 'HTML' },
    { id: 'css', label: 'CSS' },
    { id: 'js', label: 'JavaScript' },
  ] as const;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${isFullscreen ? 'p-0' : 'p-8'}`}>
      <div
        className={`bg-white rounded-xl shadow-2xl flex flex-col ${
          isFullscreen ? 'w-full h-full rounded-none' : 'w-full max-w-4xl h-[80vh]'
        }`}
      >
        {/* Header */}
        <div className="h-12 px-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-slate-800">Preview</div>
            <div className="text-xs text-slate-400">{design.name}</div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            {activeTab === 'preview' && (
              <button
                onClick={handleRefresh}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
            {activeTab !== 'preview' && (
              <button
                onClick={() => handleCopy(
                  activeTab === 'html' ? code.html :
                  activeTab === 'css' ? code.css : code.js
                )}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                title="Copy"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            )}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'preview' ? (
            <div className="w-full h-full bg-slate-50 flex items-center justify-center p-4">
              <div
                className="bg-white shadow-lg rounded-lg overflow-hidden"
                style={{
                  width: design.windowConfig.width,
                  height: design.windowConfig.height,
                  borderRadius: design.windowConfig.borderRadius,
                }}
              >
                <iframe
                  ref={iframeRef}
                  className="w-full h-full border-0"
                  title="UI Preview"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            </div>
          ) : (
            <div className="w-full h-full overflow-auto">
              <pre className="p-4 text-sm font-mono text-slate-700 bg-slate-50 min-h-full">
                <code>
                  {activeTab === 'html' ? code.html :
                   activeTab === 'css' ? code.css : code.js}
                </code>
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-10 px-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div>
            Window: {design.windowConfig.width}x{design.windowConfig.height} |
            Position: {design.windowConfig.position}
          </div>
          <div>
            {activeTab !== 'preview' && (
              <span>
                {activeTab === 'html' ? code.html.length :
                 activeTab === 'css' ? code.css.length : code.js.length} characters
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// === Code Panel Component (for inline viewing) ===

interface CodePanelProps {
  design: UIDesign;
  onClose: () => void;
}

export function CodePanel({ design, onClose }: CodePanelProps) {
  const [activeTab, setActiveTab] = useState<'html' | 'css' | 'js' | 'full'>('html');
  const [copied, setCopied] = useState(false);

  const code = generateCode(design);

  const handleCopy = async () => {
    const content = activeTab === 'html' ? code.html :
                    activeTab === 'css' ? code.css :
                    activeTab === 'js' ? code.js : code.fullHtml;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const tabs = [
    { id: 'html', label: 'HTML' },
    { id: 'css', label: 'CSS' },
    { id: 'js', label: 'JS' },
    { id: 'full', label: 'Full HTML' },
  ] as const;

  const getContent = () => {
    switch (activeTab) {
      case 'html': return code.html;
      case 'css': return code.css;
      case 'js': return code.js;
      case 'full': return code.fullHtml;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[70vh] flex flex-col">
        {/* Header */}
        <div className="h-12 px-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="text-sm font-semibold text-slate-800">Generated Code</div>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    activeTab === tab.id
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Code */}
        <div className="flex-1 overflow-auto bg-slate-900">
          <pre className="p-4 text-sm font-mono text-slate-200">
            <code>{getContent()}</code>
          </pre>
        </div>

        {/* Footer */}
        <div className="h-10 px-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div>
            {getContent().split('\n').length} lines | {getContent().length} characters
          </div>
        </div>
      </div>
    </div>
  );
}
