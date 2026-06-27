"use client";

import { useState, useEffect, useCallback } from "react";

const DEMO_PROMPTS = [
  "Open my GTM dashboard",
  "@Documents/quarterly-report.pdf",
  "Summarize the last meeting notes",
  "@Downloads/presentation.pptx",
  "Shutdown my PC in 5 minutes",
  "Take a screenshot and analyze it",
];

const FILE_SUGGESTIONS = [
  { name: "quarterly-report.pdf", path: "Documents", icon: "pdf", size: "2.4 MB" },
  { name: "presentation.pptx", path: "Downloads", icon: "ppt", size: "15.2 MB" },
  { name: "README.md", path: "Projects/stuard-ai", icon: "md", size: "4.2 KB" },
  { name: "budget-2024.xlsx", path: "Documents/Finance", icon: "xls", size: "1.1 MB" },
];

const TYPING_SPEED = 50;
const DELETING_SPEED = 30;
const PAUSE_AFTER_TYPING = 2000;
const PAUSE_AFTER_DELETING = 500;

export default function OverlayDemo() {
  const [displayedText, setDisplayedText] = useState("");
  const [promptIndex, setPromptIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showWebOptions, setShowWebOptions] = useState(false);
  const [defaultEngineId, setDefaultEngineId] = useState('google');

  const currentPrompt = DEMO_PROMPTS[promptIndex];
  const isFileSearch = displayedText.startsWith("@");

  const searchEngines = [
    {
      id: 'google',
      name: 'Google',
      color: 'text-blue-500',
      bg: 'bg-blue-500',
      icon: (
        <svg viewBox="0 0 24 24" width="20" height="20" className="w-5 h-5">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
      )
    },
    {
      id: 'bing',
      name: 'Bing',
      color: 'text-cyan-600',
      bg: 'bg-cyan-500',
      icon: (
        <svg viewBox="0 0 24 24" width="20" height="20" className="w-5 h-5">
           <path d="M10.1 3.5l-5.6 2v14.1l8-4.5 5.5 3.3V7.2l-7.9-3.7zm.4 12.3l-3.1-1.7V7.1l3.1 1.6v7.1zm1.2-6.2l3.4-1.7v7.5l-3.4-1.9V9.6z" fill="#008373"/>
        </svg>
      )
    },
    {
      id: 'duckduckgo',
      name: 'DuckDuckGo',
      color: 'text-orange-500',
      bg: 'bg-orange-500',
      icon: (
        <svg viewBox="0 0 24 24" width="20" height="20" className="w-5 h-5">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm4 0h-2v-2h2v2zm0-4h-2V7h2v6z" fill="#DE5833"/>
        </svg>
      )
    },
    {
      id: 'youtube',
      name: 'YouTube',
      color: 'text-red-600',
      bg: 'bg-red-500',
      icon: (
        <svg viewBox="0 0 24 24" width="20" height="20" className="w-5 h-5">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" fill="#FF0000"/>
        </svg>
      )
    },
    {
      id: 'github',
      name: 'GitHub',
      color: 'text-gray-700',
      bg: 'bg-gray-700',
      icon: (
        <svg viewBox="0 0 24 24" width="20" height="20" className="w-5 h-5">
           <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z" fill="#24292f"/>
        </svg>
      )
    }
  ];

  const activeEngine = searchEngines.find(e => e.id === defaultEngineId) || searchEngines[0];

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'pdf':
        return <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM9 13h2v4H9v-4zm4 0h2v4h-2v-4z"/></svg>;
      case 'ppt':
        return <svg className="w-5 h-5 text-orange-500" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM9 13h3a2 2 0 010 4H9v-4z"/></svg>;
      case 'xls':
        return <svg className="w-5 h-5 text-green-600" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM8 13l2 3-2 3h2l1-1.5 1 1.5h2l-2-3 2-3h-2l-1 1.5-1-1.5H8z"/></svg>;
      case 'md':
        return <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM7 13h2v5l2-2 2 2v-5h2v7h-2l-2-2-2 2H7v-7z"/></svg>;
      default:
        return <svg className="w-5 h-5 text-gray-500" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4z"/></svg>;
    }
  };

  const typeNextChar = useCallback(() => {
    if (isPaused) return;

    if (!isDeleting) {
      if (displayedText.length < currentPrompt.length) {
        setDisplayedText(currentPrompt.slice(0, displayedText.length + 1));
        if (displayedText.length === 0) setIsRecording(true);
      } else {
        setIsPaused(true);
        setIsRecording(false);
        setTimeout(() => {
          setIsPaused(false);
          setIsDeleting(true);
        }, PAUSE_AFTER_TYPING);
      }
    } else {
      if (displayedText.length > 0) {
        setDisplayedText(displayedText.slice(0, -1));
      } else {
        setIsPaused(true);
        setTimeout(() => {
          setIsPaused(false);
          setIsDeleting(false);
          setPromptIndex((prev) => (prev + 1) % DEMO_PROMPTS.length);
        }, PAUSE_AFTER_DELETING);
      }
    }
  }, [displayedText, currentPrompt, isDeleting, isPaused]);

  useEffect(() => {
    if (isPaused) return;
    const speed = isDeleting ? DELETING_SPEED : TYPING_SPEED;
    const timer = setTimeout(typeNextChar, speed);
    return () => clearTimeout(timer);
  }, [typeNextChar, isDeleting, isPaused]);

  const filteredFiles = isFileSearch
    ? FILE_SUGGESTIONS.filter(f => {
        const searchText = displayedText.slice(1).toLowerCase();
        const fullPath = `${f.path}/${f.name}`.toLowerCase();
        // Match if search is contained in full path, or full path is contained in search
        return fullPath.includes(searchText) || searchText.includes(fullPath.split('/').pop() || '');
      })
    : [];

  return (
    <div className="w-full flex justify-center mt-12 mb-8 px-4 overflow-visible">
      <div className="w-full max-w-[520px] overflow-visible pb-[380px]">
        {/* Main Card + Dropdown Wrapper */}
        <div className="relative">
          {/* Main Card */}
          <div className="relative bg-white rounded-[28px] shadow-2xl border border-gray-200 p-2 flex flex-col gap-2 transition-all duration-300 transform hover:scale-[1.01]">

          {/* Top Row: Status & Actions */}
          <div className="flex items-center justify-between px-2 pt-1">
            {/* Status Badge - Reminder */}
            <div className="flex items-center gap-2.5">
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center shadow-sm">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </div>
              <span className="text-[13px] font-medium text-gray-700">Flight to Tokyo in 3 hours</span>
            </div>

            {/* Top Right Actions */}
            <div className="flex items-center gap-2">
              <button className="w-8 h-8 rounded-[10px] bg-white border border-gray-100 text-gray-600 hover:bg-gray-50 flex items-center justify-center transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
              </button>
              <button className="w-8 h-8 rounded-[10px] bg-white border border-gray-100 text-gray-600 hover:bg-gray-50 flex items-center justify-center transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </button>
              <button className="w-8 h-8 rounded-[10px] bg-white border border-gray-100 text-gray-600 hover:bg-gray-50 flex items-center justify-center transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </button>
            </div>
          </div>

          {/* Bottom Row: Input Area */}
          <div className="flex items-center gap-2 px-1 pb-1">
            <button className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0">
              <div className="w-4 h-4 rounded-full border-2 border-current flex items-center justify-center">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
            </button>

            <div className={`flex-1 relative rounded-full border flex items-center min-h-[42px] px-4 transition-all ${isFileSearch ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-500/20' : 'bg-gray-50 border-gray-200'}`}>
              <div className="w-full text-[14px] leading-normal text-gray-800 font-medium py-2.5">
                {isFileSearch && <span className="text-blue-500 font-bold">@</span>}
                <span className={isFileSearch ? "text-blue-600" : ""}>{isFileSearch ? displayedText.slice(1) : displayedText}</span>
                <span className="inline-block w-0.5 h-4 bg-blue-500 ml-0.5 animate-pulse align-middle" />
              </div>
            </div>

            <button className={`w-[42px] h-[42px] rounded-[14px] flex items-center justify-center transition-all flex-shrink-0 ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-500 text-white hover:bg-blue-600'}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          </div>
        </div>

          {/* Expanded Dropdown */}
          <div
            className={`absolute top-full left-0 right-0 mt-1 transition-all duration-300 transform origin-top z-10 ${
              displayedText.length > 0 ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
            }`}
          >
          {isFileSearch ? (
            /* File Search Results */
            <div className="bg-white rounded-[24px] border border-blue-200 shadow-2xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-blue-100 bg-blue-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M11 21H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h5l2 3h9a2 2 0 0 1 2 2v2" />
                    <circle cx="16.5" cy="17.5" r="2.5" />
                    <path d="M18.5 19.5L21 22" />
                  </svg>
                  <span className="text-[11px] font-black uppercase tracking-[0.15em] text-blue-600">Files Found</span>
                </div>
                <span className="text-[10px] text-blue-500 font-bold bg-blue-100 px-2 py-0.5 rounded-full">{filteredFiles.length} results</span>
              </div>

              <div className="p-2 space-y-1">
                {filteredFiles.map((file, idx) => (
                  <button
                    key={idx}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-blue-50 transition-all group border border-transparent hover:border-blue-200/50"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center group-hover:bg-white group-hover:scale-110 transition-all border border-gray-100">
                      {getFileIcon(file.icon)}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-[14px] font-bold text-gray-900 group-hover:text-blue-600 transition-colors truncate">{file.name}</div>
                      <div className="text-[11px] text-gray-500 font-medium truncate">{file.path}</div>
                    </div>
                    <div className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded-lg">{file.size}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Quick Actions */
            <div className="bg-white rounded-[24px] border border-gray-200 shadow-2xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-[0.15em] text-gray-400">Quick Actions</span>
                <span className="text-[10px] text-gray-400 font-bold bg-gray-100 px-2 py-0.5 rounded-full">{displayedText.length} chars</span>
              </div>

              <div className="p-2 space-y-1">
                {/* Ask Stuard */}
                <button className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-gray-50 transition-all group border border-transparent hover:border-gray-200/50">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 group-hover:scale-110 transition-all ring-1 ring-blue-500/10 group-hover:ring-blue-500/30">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-[14px] font-black text-gray-900 group-hover:text-blue-600 transition-colors">Ask Stuard</div>
                    <div className="text-[11px] text-gray-500 font-bold">Get an AI assistant response</div>
                  </div>
                  <span className="text-[10px] font-black text-gray-400 bg-gray-100 px-2.5 py-1.5 rounded-lg border border-gray-200 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-all">Enter</span>
                </button>

                {/* Search Files */}
                <button className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-gray-50 transition-all group border border-transparent hover:border-gray-200/50">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 group-hover:scale-110 transition-all ring-1 ring-emerald-500/10 group-hover:ring-emerald-500/30">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                      <path d="M11 21H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h5l2 3h9a2 2 0 0 1 2 2v2" />
                      <circle cx="16.5" cy="17.5" r="2.5" />
                      <path d="M18.5 19.5L21 22" />
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-[14px] font-black text-gray-900 group-hover:text-emerald-600 transition-colors">Search Files</div>
                    <div className="text-[11px] text-gray-500 font-bold">Find apps, docs, folders & more</div>
                  </div>
                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200 group-hover:bg-emerald-600 group-hover:text-white group-hover:border-emerald-600 transition-all">@</span>
                </button>

                {/* Web Search */}
                <div className="rounded-2xl overflow-hidden bg-gray-50/50 border border-gray-100">
                  <div className="flex items-stretch">
                    <button className="flex-1 flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-all group text-left">
                      <div className={`absolute inset-y-0 left-0 w-1 ${activeEngine.bg} opacity-30`} />
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white border border-gray-100 group-hover:scale-110 transition-all shadow-sm">
                        {activeEngine.icon}
                      </div>
                      <div className="flex-1">
                        <div className="text-[14px] font-black text-gray-900">Search {activeEngine.name}</div>
                        <div className="text-[11px] text-gray-500 font-bold">Ctrl + Enter</div>
                      </div>
                    </button>
                    <button
                      onClick={() => setShowWebOptions(!showWebOptions)}
                      className={`w-12 flex items-center justify-center border-l border-gray-100 hover:bg-gray-100 transition-all ${showWebOptions ? 'bg-gray-100 text-blue-600' : 'text-gray-400'}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-300 ${showWebOptions ? 'rotate-180' : ''}`}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>

                  {showWebOptions && (
                    <div className="grid grid-cols-5 gap-2 p-3 bg-gray-50 border-t border-gray-100">
                      {searchEngines.map((engine) => (
                        <button
                          key={engine.id}
                          onClick={() => { setDefaultEngineId(engine.id); setShowWebOptions(false); }}
                          className={`flex flex-col items-center gap-2 p-2 rounded-xl transition-all hover:scale-105 ${engine.id === defaultEngineId ? 'bg-white ring-1 ring-blue-500/50 shadow-sm' : 'hover:bg-white'}`}
                        >
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white border border-gray-100 shadow-sm">
                            {engine.icon}
                          </div>
                          <span className={`text-[9px] font-black uppercase tracking-wider ${engine.id === defaultEngineId ? 'text-gray-900' : 'text-gray-400'}`}>
                            {engine.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* More Actions */}
                <button className="w-full flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-gray-50 transition-all group border border-transparent hover:border-gray-200/50">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 group-hover:scale-110 transition-all ring-1 ring-amber-500/10 group-hover:ring-amber-500/30">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-[14px] font-black text-gray-900 group-hover:text-amber-600 transition-colors">More Actions</div>
                    <div className="text-[11px] text-gray-500 font-bold">Full list of commands & shortcuts</div>
                  </div>
                  <span className="text-[10px] font-black text-gray-400 bg-gray-100 px-2.5 py-1.5 rounded-lg border border-gray-200 group-hover:bg-amber-500 group-hover:text-white group-hover:border-amber-500 transition-all">Tab</span>
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
