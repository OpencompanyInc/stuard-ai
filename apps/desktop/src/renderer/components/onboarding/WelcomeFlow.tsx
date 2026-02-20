import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboarding } from './OnboardingContext';
import { supabase } from '../../lib/supabaseClient';
import { startBrowserSignIn } from '../../auth/browserSignIn';
import { usePreferences, type TonePreset } from '../../hooks/usePreferences';
import { MockOverlay } from './MockOverlay';
import {
  Sparkles,
  ArrowRight,
  Check,
  Keyboard,
  Settings,
  X,
  Zap,
  MessageSquare,
  Workflow,
  LayoutGrid,
  Brain,
  ChevronRight,
  ChevronLeft,
  User,
  Globe,
  Command,
  Mic,
  Paperclip,
  Clock,
  FolderOpen,
  Shield,
  Lock,
  Eye,
  FileText,
  AtSign,
  History,
  Minimize2
} from 'lucide-react';
import { clsx } from 'clsx';

// =============================================================================
// STEP COMPONENTS
// =============================================================================

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const [signedIn, setSignedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSignedIn(!!data?.session);
      setUserEmail(data?.session?.user?.email ?? null);
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      setUserEmail(session?.user?.email ?? null);
      setSigningIn(false);
    });
    return () => { try { subscription.unsubscribe(); } catch { } };
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    const res = await startBrowserSignIn();
    if (!res.ok) setSigningIn(false);
  };

  return (
    <div className="text-center pt-8">
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-semibold text-white mb-2 tracking-tight"
      >
        Meet Stuard
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-white/60 text-sm mb-8 leading-relaxed"
      >
        Your intelligent desktop assistant.
        <br />
        Private, Fast, and ready to act.
      </motion.p>

      {/* Feature Grid */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-2 gap-3 mb-8"
      >
        {[
          { icon: Brain, label: 'Local Intelligence' },
          { icon: Workflow, label: 'Automation' },
          { icon: LayoutGrid, label: 'Unified Planner' },
          { icon: MessageSquare, label: 'Smart Context' },
        ].map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-left"
          >
            <item.icon className="w-4 h-4 text-white/70" />
            <span className="text-xs text-white/90 font-medium">{item.label}</span>
          </div>
        ))}
      </motion.div>

      {/* Auth & Continue */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="space-y-3"
      >
        {signedIn ? (
          <div className="w-full py-3 rounded-xl bg-white/10 border border-white/10 flex items-center px-4 gap-3 mb-3">
             <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
               <Check size={12} className="text-white" />
             </div>
             <div className="text-left overflow-hidden">
               <div className="text-white font-medium text-xs">Signed In</div>
               <div className="text-white/50 text-[10px] truncate">{userEmail}</div>
             </div>
          </div>
        ) : (
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full py-3 rounded-xl bg-white text-black font-semibold text-sm 
                     hover:bg-gray-100 transition-transform active:scale-[0.98] 
                     flex items-center justify-center shadow-lg shadow-white/5"
          >
            {signingIn ? "Syncing..." : "Sync your account"}
          </button>
        )}

        <button
          onClick={onNext}
          className="w-full py-3 rounded-xl border border-white/10 text-white/80 font-medium 
                   text-sm hover:bg-white/5 hover:text-white transition-all 
                   flex items-center justify-center gap-2 group"
        >
          Continue
          <ArrowRight size={14} className="opacity-50 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </motion.div>
    </div>
  );
}

function PrivacyStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const points = [
    {
      icon: Lock,
      title: 'Local-First Processing',
      desc: 'Your data stays on your device unless you explicitly opt into cloud.'
    },
    {
      icon: Eye,
      title: 'Transparent Audits',
      desc: 'Every agent action is logged. You can review and audit everything.'
    },
    {
      icon: Check,
      title: 'Explicit Consent',
      desc: 'High-impact tasks require your approval. No silent background actions.'
    },
    {
      icon: FileText,
      title: 'Editable Memory',
      desc: 'You control what Stuard remembers. Delete or Edit anytime.'
    }
  ];

  return (
    <div className="pt-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h2 className="text-2xl font-semibold text-white mb-2">Trustworthy by Design</h2>
        <p className="text-white/60 text-sm">Built to be a safe, private teammate.</p>
      </motion.div>

      <div className="grid gap-3 mb-8">
        {points.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.08 }}
            className="flex gap-4 p-4 rounded-xl border border-white/10 bg-white/5"
          >
            <div className="shrink-0 mt-0.5">
              <p.icon className="w-4 h-4 text-white/90" />
            </div>
            <div>
              <h3 className="font-medium text-white text-sm mb-1">{p.title}</h3>
              <p className="text-xs text-white/50 leading-relaxed">{p.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-medium text-sm 
                   hover:bg-white/10 transition-all active:scale-[0.98]"
        >
          Go Back
        </button>
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          onClick={onNext}
          className="flex-1 py-3 rounded-xl bg-white text-black font-semibold text-sm 
                   hover:bg-gray-100 transition-all active:scale-[0.98] 
                   flex items-center justify-center gap-2"
        >
          Sounds Good
          <ArrowRight size={14} />
        </motion.button>
      </div>
    </div>
  );
}

function PersonaStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { tone, setTone, customTone, setCustomTone } = usePreferences();

  const personas = [
    { id: 'concise' as TonePreset, label: 'Concise', desc: 'Short, direct answers', icon: Zap },
    { id: 'friendly' as TonePreset, label: 'Friendly', desc: 'Warm and helpful', icon: MessageSquare },
    { id: 'technical' as TonePreset, label: 'Technical', desc: 'Detailed & precise', icon: Command },
    { id: 'custom' as TonePreset, label: 'Custom', desc: 'Define your own style', icon: Settings },
  ];

  return (
    <div className="pt-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h2 className="text-2xl font-semibold text-white mb-2">How should I speak?</h2>
        <p className="text-white/60 text-sm">Choose a communication style</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="space-y-3 mb-8"
      >
        {personas.map((p, i) => (
          <motion.button
            key={p.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.05 }}
            onClick={() => setTone(p.id)}
            className={clsx(
              "w-full flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 text-left",
              tone === p.id
                ? 'border-blue-500/50 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/50'
                : 'border-white/10 bg-white/5 hover:bg-white/10 text-white'
            )}
          >
            <div className={clsx(
              "w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0",
              tone === p.id ? "bg-blue-500 text-white" : "bg-white/10 text-white/50"
            )}>
              <p.icon size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <span className={clsx("font-medium text-sm", tone === p.id ? "text-blue-400" : "text-white")}>
                  {p.label}
                </span>
              </div>
              <p className="text-xs text-white/50 truncate">{p.desc}</p>
            </div>
          </motion.button>
        ))}
      </motion.div>

      {tone === 'custom' && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mb-8"
        >
          <textarea
            value={customTone}
            onChange={(e) => setCustomTone(e.target.value)}
            autoFocus
            placeholder="e.g., Talk like a helpful colleague, explain like I'm 5..."
            className="w-full bg-white/5 rounded-xl px-4 py-3 text-sm outline-none 
                     placeholder:text-white/30 border border-white/10 focus:border-white/30 
                     transition-all text-white resize-none"
            rows={3}
          />
        </motion.div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white font-medium text-sm 
                   hover:bg-white/10 transition-all active:scale-[0.98]"
        >
          Go Back
        </button>
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          onClick={onNext}
          className="flex-1 py-3 rounded-xl bg-white text-black font-semibold text-sm 
                   hover:bg-gray-100 transition-all active:scale-[0.98] 
                   flex items-center justify-center gap-2"
        >
          Continue
          <ArrowRight size={14} />
        </motion.button>
      </div>
    </div>
  );
}

function ShortcutStep({ onNext }: { onNext: () => void }) {
  const [recording, setRecording] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validModifiers = ['Control', 'Alt', 'Shift', 'Meta', 'Cmd', 'Command'];
  const validKeys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
                     'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
                     '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Space', 'Enter',
                     'Tab', 'Escape', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
                     'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F2', 'F3', 'F4',
                     'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const keys: string[] = [];
      if (e.ctrlKey) keys.push('Control');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');
      if (e.metaKey) keys.push('Command');

      // Handle normal keys
      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      
      // Only add non-modifier keys if they are valid
      if (key && !['Control', 'Alt', 'Shift', 'Meta', 'Command'].includes(key)) {
        if (validKeys.includes(key)) {
          keys.push(key);
        }
      }

      // Remove duplicates and sort modifiers first
      const uniqueKeys = Array.from(new Set(keys));
      const sortedKeys = [
        ...uniqueKeys.filter(k => validModifiers.includes(k)),
        ...uniqueKeys.filter(k => !validModifiers.includes(k))
      ];

      setRecordedKeys(sortedKeys);
      setError(null);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const hasModifier = recordedKeys.some(k => validModifiers.includes(k));
      const hasKey = recordedKeys.some(k => !validModifiers.includes(k));
      
      if (hasModifier && hasKey && recording) {
        setRecording(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [recording, recordedKeys]);

  const startRecording = () => {
    setRecording(true);
    setRecordedKeys([]);
    setSaved(false);
    setError(null);
  };

  const saveShortcut = async () => {
    if (recordedKeys.length < 2) {
      setError('Please use at least one modifier key + a letter/number');
      return;
    }

    try {
      // Convert to Electron accelerator format
      const accelerator = recordedKeys.map(k => {
        if (k === 'Control') return 'Ctrl';
        if (k === 'Command') return 'Cmd';
        if (k === 'Space') return 'Space';
        return k;
      }).join('+');

      // actually register
      const result = await window.desktopAPI.setGlobalHotkey(accelerator);
      if (!result?.ok) {
        setError(result?.error || 'Failed to register shortcut');
        return;
      }

      try {
        localStorage.setItem('stuard_global_hotkey', accelerator);
      } catch {}
      
      setSaved(true);
      onNext();
    } catch (e) {
      setError('An error occurred while saving the shortcut');
    }
  };

  const clearRecording = () => {
    setRecordedKeys([]);
    setSaved(false);
    setError(null);
  };

  // Helper to use default
  const useDefault = () => {
     // Default is Ctrl+Shift+Space
     setRecordedKeys(['Control', 'Shift', 'Space']);
     // We don't save immediately, user has to click Complete Setup? 
     // Or we can save immediately? The screenshot implies "Use Default" is an action.
     // Let's just set the keys so the UI updates to "Recorded" state, then user clicks "Complete Setup".
     // Or better: auto-save defaults might be nicer UX but inconsistent with manual record flow.
     // I'll just set keys.
  };

  return (
    <div className="text-center pt-8">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h2 className="text-2xl font-semibold text-white mb-2">Your Magic Shortcut</h2>
        <p className="text-white/60 text-sm">Set a global hotkey to summon Stuard</p>
      </motion.div>

      {/* Recording Area */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="bg-white/5 border border-white/10 rounded-2xl p-8 mb-6 min-h-[220px] flex flex-col items-center justify-center relative overflow-hidden"
      >
        {recording ? (
             <div className="flex flex-col items-center gap-4">
                  <div className="text-white/60 animate-pulse text-sm">Press keys now...</div>
                   <div className="flex items-center gap-2 flex-wrap justify-center">
                      {recordedKeys.map((key, i) => (
                        <span key={i} className="text-3xl font-mono text-white">
                            {i > 0 && " + "}{key === 'Control' ? 'Ctrl' : key}
                        </span>
                      ))}
                    </div>
             </div>
        ) : recordedKeys.length > 0 ? (
            <div className="flex flex-col items-center gap-6">
                 <div className="text-4xl font-semibold text-white tracking-tight">
                      {recordedKeys.map((key, i) => (
                          <span key={i}>
                              {i > 0 && " + "}{key === 'Control' ? 'Ctrl' : key}
                          </span>
                      ))}
                 </div>
                 <button 
                    onClick={clearRecording}
                    className="px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white/60 text-xs hover:text-white hover:bg-white/10 transition-colors flex items-center gap-2"
                 >
                    <X size={12} />
                    Delete Binding
                 </button>
            </div>
        ) : (
            <div className="flex flex-col items-center gap-6">
                 <button
                   onClick={startRecording}
                   className="px-8 py-3 rounded-lg bg-white text-black font-semibold text-sm 
                            hover:bg-gray-100 transition-all active:scale-[0.98]
                            flex items-center gap-2 shadow-lg shadow-white/5"
                 >
                   <Command size={16} />
                   Record Key Binding
                 </button>
                 <p className="text-white/40 text-xs">
                   Tip: Use Ctrl, Alt, or Shift + a letter key
                 </p>
            </div>
        )}
      </motion.div>

      {/* Bottom Area */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="space-y-4"
      >
         {/* If recorded, show Complete Setup Button */}
         {recordedKeys.length > 0 ? (
             <button
                onClick={saveShortcut}
                disabled={saved}
                className="w-full py-3.5 rounded-xl bg-white text-black font-semibold text-sm 
                         hover:bg-gray-100 transition-all active:scale-[0.98] 
                         flex items-center justify-center gap-2 shadow-lg shadow-white/5"
             >
                {saved ? "Saved!" : "Complete Setup"}
                <ArrowRight size={14} />
             </button>
         ) : (
            <>
                <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="text-left">
                        <div className="text-white font-medium text-sm">Default Shortcut</div>
                        <div className="text-white/50 text-xs mt-0.5">Ctrl + Shift + Space</div>
                    </div>
                    <button
                        onClick={useDefault}
                        className="px-4 py-2 rounded-lg bg-white/10 text-white text-xs font-medium hover:bg-white/20 transition-colors"
                    >
                        Use Default
                    </button>
                </div>
                
                <button
                    onClick={onNext}
                    className="w-full py-3 rounded-xl border border-white/10 text-white/50 font-medium 
                             text-sm hover:text-white hover:bg-white/5 transition-all 
                             flex items-center justify-center gap-2"
                >
                    Skip for now
                    <ArrowRight size={14} />
                </button>
            </>
         )}
      </motion.div>
    </div>
  );
}

function InteractiveTourStep({ onNext }: { onNext: () => void }) {
  const [tourStep, setTourStep] = useState(0);

  const tourSteps = [
    {
      id: "mentions",
      targetId: "stuard-input-area",
      title: "@ Mentions",
      description: "Type @ to add files or folders as context",
      icon: <AtSign size={20} />,
    },
    {
      id: "attachments",
      targetId: "stuard-attach-btn",
      title: "Attachments",
      description: "Use the + button to attach files or images",
      icon: <Paperclip size={20} />,
    },
    {
      id: "voice",
      targetId: "stuard-mic-btn",
      title: "Voice Mode",
      description: "Press to speak, then click again when you're done",
      icon: <Mic size={20} />,
    },
    {
      id: "history",
      targetId: "stuard-history-btn",
      title: "Chat History",
      description: "Access your past conversations here",
      icon: <History size={20} />,
    },
    {
      id: "dashboard",
      targetId: "stuard-dashboard-btn",
      title: "Dashboard",
      description: "Open the full dashboard for settings and workflows",
      icon: <LayoutGrid size={20} />,
    },
    {
      id: "collapse",
      targetId: "stuard-collapse-btn",
      title: "Layout Options",
      description: "Switch between compact and expanded views",
      icon: <Minimize2 size={20} />,
    },
    {
      id: "done",
      title: "All Set!",
      description: "You're ready to use Stuard!",
      icon: <Sparkles size={20} />,
    },
  ];

  const currentStep = tourSteps[tourStep];
  const isDone = tourStep === tourSteps.length - 1;

  const handleNext = () => {
    if (isDone) {
      onNext();
    } else {
      setTourStep(s => s + 1);
    }
  };

  return (
    <div className="relative w-full h-full min-h-[400px]">
      {/* The Mock UI we are touring */}
      <MockOverlay />

      {/* Spotlight Effect */}
      {currentStep?.targetId ? (
        <SpotlightOverlay targetId={currentStep.targetId} />
      ) : (
        <div className="absolute inset-0 bg-black/60 pointer-events-none" />
      )}

      {/* Tour Card */}
      <motion.div
        key={tourStep}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="absolute top-24 left-0 right-0 mx-auto w-full max-w-[320px] pointer-events-auto z-20"
      >
        <div className="bg-[#1a1a1e] border border-white/10 rounded-xl p-4 shadow-2xl relative overflow-hidden">
          {/* Accent Line */}
          <div className="absolute top-0 left-0 w-1 h-full bg-white/20" />
          
          <div className="flex items-start gap-3 pl-2">
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-white/90 shrink-0">
              {currentStep?.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-medium text-sm mb-1">{currentStep?.title}</h3>
              <p className="text-white/60 text-xs leading-relaxed">{currentStep?.description}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between mt-4 pl-2 pt-3 border-t border-white/5">
            <div className="flex gap-1">
              {tourSteps.map((_, i) => (
                <div
                  key={i}
                  className={clsx(
                    "w-1.5 h-1.5 rounded-full transition-colors",
                    i === tourStep ? 'bg-white' : 'bg-white/10'
                  )}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {!isDone && (
                <button
                  onClick={onNext}
                  className="text-[11px] text-white/40 hover:text-white/70 transition-colors px-2 py-1"
                >
                  Skip
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors"
              >
                {isDone ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// Spotlight Component
function SpotlightOverlay({ targetId }: { targetId: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const updateRect = () => {
      const el = document.getElementById(targetId);
      if (el) {
        setRect(el.getBoundingClientRect());
      }
    };

    updateRect();
    // Check frequently as layout might shift slightly
    const interval = setInterval(updateRect, 100);
    window.addEventListener('resize', updateRect);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', updateRect);
    };
  }, [targetId]);

  if (!rect) return null; // Don't show blocking overlay if target not found yet

  // We need to calculate position relative to the container if possible, 
  // but since we are using fixed/absolute overlay inside the step, 
  // and MockOverlay is rendered in the same flow, getBoundingClientRect should be correct relative to viewport.
  // However, our "hole" divs need to be positioned relative to the closest positioned ancestor (likely the step container).
  // The step container is `relative w-full h-full`.
  // Wait, `MockOverlay` is inside `InteractiveTourStep`. `SpotlightOverlay` is also inside it.
  // We should use a portal or fixed positioning for the spotlight to ensure it covers everything.
  // Let's use absolute positioning relative to the `InteractiveTourStep` container which wraps everything.
  // But `rect` is viewport coordinates.
  // We can convert rect to relative coordinates if we knew the container rect.
  // EASIER: Just use fixed positioning for the spotlight overlay layer, matching the behavior in OnboardingFlow.
  
  const padding = 4;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none">
      {/* 4-div method for the "hole" */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: rect.top - padding, background: 'rgba(0,0,0,0.7)' }} />
      <div style={{ position: 'absolute', top: rect.bottom + padding, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)' }} />
      <div style={{ position: 'absolute', top: rect.top - padding, bottom: 0, left: 0, width: rect.left - padding, height: rect.height + padding * 2, background: 'rgba(0,0,0,0.7)' }} />
      <div style={{ position: 'absolute', top: rect.top - padding, bottom: 0, right: 0, left: rect.right + padding, height: rect.height + padding * 2, background: 'rgba(0,0,0,0.7)' }} />
      
      {/* Ring */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="absolute"
        style={{
          top: rect.top - padding,
          left: rect.left - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        }}
      >
        <div className="absolute inset-0 rounded-xl border-2 border-white/50 shadow-[0_0_20px_rgba(255,255,255,0.1)]" />
      </motion.div>
    </div>
  );
}

// =============================================================================
// MAIN WELCOME FLOW COMPONENT
// =============================================================================

interface WelcomeFlowProps {
  onComplete: () => void;
  onSkip?: () => void;
}

export function WelcomeFlow({ onComplete, onSkip }: WelcomeFlowProps) {
  const [step, setStep] = useState(0);
  // Updated order to match screenshots: Welcome -> Persona -> Privacy -> Shortcut
  const steps = ['welcome', 'persona', 'privacy', 'shortcut'];
  
  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(s => s - 1);
    }
  };

  return (
    <div className="w-full h-full flex flex-col relative overflow-hidden bg-[#09090b]">
      {/* Background ambient effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 via-transparent to-transparent pointer-events-none" />
      
      {/* Step Indicators */}
      <div className="absolute top-8 left-0 right-0 z-20 flex justify-center gap-2">
        {steps.map((_, i) => (
          <div
            key={i}
            className={clsx(
              "h-1 rounded-full transition-all duration-300",
              i === step ? "w-8 bg-white" : "w-8 bg-white/20"
            )}
          />
        ))}
      </div>

      <div className="flex-1 flex items-center justify-center p-6 mt-8 relative z-10">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div 
              key="welcome"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm"
            >
              <WelcomeStep onNext={handleNext} />
            </motion.div>
          )}
          {step === 1 && (
            <motion.div 
              key="persona"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full max-w-sm"
            >
              <PersonaStep onBack={handleBack} onNext={handleNext} />
            </motion.div>
          )}
          {step === 2 && (
            <motion.div 
              key="privacy"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full max-w-sm"
            >
              <PrivacyStep onBack={handleBack} onNext={handleNext} />
            </motion.div>
          )}
          {step === 3 && (
            <motion.div 
              key="shortcut"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full max-w-sm"
            >
              <ShortcutStep onNext={handleNext} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
