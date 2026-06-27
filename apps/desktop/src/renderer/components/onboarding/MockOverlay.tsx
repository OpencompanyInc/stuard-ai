import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mic, 
  Video,
  PanelRight,
  AppWindow,
  Home,
  Plus,
  Image,
  FileText,
  Folder,
  AtSign,
  Hash,
  Send,
  ChevronRight
} from 'lucide-react';

interface MockOverlayProps {
  highlightElement?: string;
  interactive?: boolean;
  onAction?: (action: string) => void;
  showAttachMenu?: boolean;
  showMentionMenu?: boolean;
  demoMode?: 'input' | 'attach' | 'mention' | 'voice' | null;
}

export function MockOverlay({ 
  highlightElement, 
  interactive = false,
  onAction,
  showAttachMenu = false,
  showMentionMenu = false,
  demoMode = null
}: MockOverlayProps) {
  const [inputValue, setInputValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(showAttachMenu);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(showMentionMenu);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAttachMenuOpen(showAttachMenu);
  }, [showAttachMenu]);

  useEffect(() => {
    setMentionMenuOpen(showMentionMenu);
  }, [showMentionMenu]);

  // Auto-focus input when in input demo mode
  useEffect(() => {
    if (demoMode === 'input' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [demoMode]);

  // Handle @ mentions
  useEffect(() => {
    if (inputValue.endsWith('@') && interactive) {
      setMentionMenuOpen(true);
    } else if (!inputValue.includes('@')) {
      setMentionMenuOpen(false);
    }
  }, [inputValue, interactive]);

  const isHighlighted = (id: string) => highlightElement === id;
  
  const highlightRing = (id: string) => 
    isHighlighted(id) ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-[#0a0a0f]' : '';

  const attachItems = [
    { icon: <Image className="w-4 h-4" />, label: 'Image', desc: 'Upload an image' },
    { icon: <FileText className="w-4 h-4" />, label: 'Document', desc: 'Attach a file' },
    { icon: <Folder className="w-4 h-4" />, label: 'Folder', desc: 'Add folder context' },
  ];

  const mentionItems = [
    { icon: <FileText className="w-4 h-4" />, label: 'README.md', path: '~/projects/app' },
    { icon: <Folder className="w-4 h-4" />, label: 'src/', path: '~/projects/app' },
    { icon: <Hash className="w-4 h-4" />, label: 'Current Tab', path: 'Browser context' },
  ];

  return (
    <div className="w-full flex flex-col items-center justify-center relative">
      {/* Mock Compact Overlay - White/Blue theme */}
      <div 
        className="w-full max-w-[520px] min-h-[114px] py-3 rounded-[28px] flex flex-col justify-center px-4 gap-2 bg-white/[0.08] backdrop-blur-2xl border border-white/[0.15] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
      >
        {/* Top Row: Status & Layout Actions */}
        <div className="flex items-center justify-between w-full pl-1">
          {/* Status indicator */}
          <div 
            className={`flex items-center gap-2.5 min-w-0 overflow-hidden mr-2 rounded-lg transition-all ${highlightRing('status')}`}
          >
            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
              <Video className="w-3 h-3 text-white" />
            </div>
            <div className="text-[13px] font-medium text-white/90 truncate select-none">
              Ready
            </div>
          </div>

          {/* Layout buttons */}
          <div className={`flex items-center gap-1.5 flex-shrink-0 rounded-xl p-1 transition-all ${highlightRing('layouts')}`}>
            <button
              onClick={() => onAction?.('sidebar')}
              className={`w-8 h-8 rounded-[10px] bg-white/[0.08] border border-white/[0.1] text-white/70 hover:text-white hover:bg-white/[0.15] flex items-center justify-center transition-all ${highlightRing('sidebar')}`}
              title="Sidebar mode"
            >
              <PanelRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAction?.('window')}
              className={`w-8 h-8 rounded-[10px] bg-white/[0.08] border border-white/[0.1] text-white/70 hover:text-white hover:bg-white/[0.15] flex items-center justify-center transition-all ${highlightRing('window')}`}
              title="Window mode"
            >
              <AppWindow className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onAction?.('dashboard')}
              className={`w-8 h-8 rounded-[10px] bg-white/[0.08] border border-white/[0.1] text-white/70 hover:text-white hover:bg-white/[0.15] flex items-center justify-center transition-all ${highlightRing('dashboard')}`}
              title="Dashboard"
            >
              <Home className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Bottom Row: Input & Mic */}
        <div className="flex items-center gap-2.5 w-full relative">
          {/* Input pill */}
          <div 
            className={`flex-1 relative min-h-[42px] bg-white/[0.08] rounded-[21px] border border-white/[0.15] flex items-center px-1.5 py-0.5 transition-all ${highlightRing('input')}`}
          >
            {/* Plus / Attach Button */}
            <button
              onClick={() => {
                if (interactive) setAttachMenuOpen(!attachMenuOpen);
                onAction?.('attach');
              }}
              className={`w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.1] text-white/60 hover:text-white hover:bg-white/[0.2] border border-white/[0.1] transition-all ${highlightRing('attach')}`}
              title="Attach files"
            >
              <Plus className="w-4 h-4" />
            </button>

            {/* Input field */}
            {interactive ? (
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Just ask Stuard... (try typing @)"
                className="flex-1 mx-2 text-[14px] text-white placeholder:text-white/40 font-medium bg-transparent outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && inputValue.trim()) {
                    onAction?.('send');
                    setInputValue('');
                  }
                }}
              />
            ) : (
              <div className="flex-1 mx-2 text-[14px] text-white/40 font-medium select-none">
                Just ask Stuard
              </div>
            )}

            {/* Send button when there's input */}
            {inputValue.trim() && (
              <button
                onClick={() => {
                  onAction?.('send');
                  setInputValue('');
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center bg-sky-500 text-white mr-0.5 transition-all hover:bg-sky-400"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Mic Button */}
          <button
            onClick={() => {
              if (interactive) setIsRecording(!isRecording);
              onAction?.('voice');
            }}
            className={`h-[42px] w-[42px] rounded-[14px] flex-shrink-0 inline-flex items-center justify-center transition-all ${
              isRecording 
                ? 'bg-red-500 animate-pulse' 
                : 'bg-sky-500 hover:bg-sky-400'
            } text-white ${highlightRing('mic')}`}
            title="Voice input"
          >
            <Mic className="w-5 h-5" />
          </button>

          {/* Attach Menu Dropdown */}
          <AnimatePresence>
            {attachMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="absolute bottom-full left-0 mb-2 w-56 bg-[#1a1a1f] border border-white/[0.1] rounded-xl shadow-xl overflow-hidden z-50"
              >
                <div className="p-1">
                  {attachItems.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        onAction?.(`attach-${item.label.toLowerCase()}`);
                        setAttachMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.08] transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
                        {item.icon}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{item.label}</div>
                        <div className="text-xs text-white/50">{item.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* @ Mention Menu */}
          <AnimatePresence>
            {mentionMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                className="absolute bottom-full left-10 mb-2 w-64 bg-[#1a1a1f] border border-white/[0.1] rounded-xl shadow-xl overflow-hidden z-50"
              >
                <div className="px-3 py-2 border-b border-white/[0.1]">
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <AtSign className="w-3 h-3" />
                    Add context
                  </div>
                </div>
                <div className="p-1">
                  {mentionItems.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInputValue(inputValue.replace(/@$/, `@${item.label} `));
                        setMentionMenuOpen(false);
                        onAction?.(`mention-${item.label}`);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.08] transition-colors text-left"
                    >
                      <div className="w-7 h-7 rounded-md bg-white/[0.1] text-white/70 flex items-center justify-center">
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate">{item.label}</div>
                        <div className="text-xs text-white/40 truncate">{item.path}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-white/30" />
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
