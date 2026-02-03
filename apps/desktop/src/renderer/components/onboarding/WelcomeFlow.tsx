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
    <div className="text-center">
      {/* Animated Logo */}
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.1 }}
        className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-lg"
      >
        <Sparkles className="w-8 h-8 text-white/90" />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-2xl font-bold text-white mb-2"
      >
        Meet Stuard
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="text-white/60 text-sm leading-relaxed mb-6"
      >
        Your intelligent desktop assistant.
        <br />
        <span className="opacity-80">Private, powerful, and ready to help.</span>
      </motion.p>

      {/* Feature Preview Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="grid grid-cols-2 gap-2 mb-6"
      >
        {[
          { icon: Brain, label: 'Local Intelligence' },
          { icon: Workflow, label: 'Automations' },
          { icon: LayoutGrid, label: 'Unified Planner' },
          { icon: MessageSquare, label: 'Smart Context' },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 + i * 0.08 }}
            className="flex items-center gap-2.5 p-3 rounded-lg border border-white/5 bg-white/5"
          >
            <item.icon className="w-4 h-4 text-white/70" />
            <span className="text-xs text-white/80 font-medium">{item.label}</span>
          </motion.div>
        ))}
      </motion.div>

      {/* Auth Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="space-y-3"
      >
        {signedIn ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white">
              <Check size={16} />
            </div>
            <div className="text-left flex-1 min-w-0">
              <div className="text-white font-medium text-sm">Signed In</div>
              <div className="text-white/50 text-xs truncate">{userEmail}</div>
            </div>
          </div>
        ) : (
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full py-2.5 rounded-lg bg-white text-black font-medium text-sm 
                     hover:bg-white/90 transition-all active:scale-[0.98] 
                     disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-2"
          >
            {signingIn ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <Globe size={16} />
                Sign in to sync your data
              </>
            )}
          </button>
        )}

        <button
          onClick={onNext}
          className="w-full py-2.5 rounded-lg border border-white/10 text-white/60 font-medium 
                   text-sm hover:text-white hover:bg-white/5 transition-all flex items-center justify-center gap-2
                   group"
        >
          {signedIn ? "Continue" : "Continue without signing in"}
          <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
        </button>
      </motion.div>
    </div>
  );
}

function PrivacyStep({ onNext }: { onNext: () => void }) {
  const points = [
    {
      icon: Lock,
      title: 'Local-First Processing',
      desc: 'Your data stays on your machine unless you explicitly opt into cloud sync.'
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
      desc: 'You control what Stuard remembers. Delete or edit anytime.'
    }
  ];

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6"
      >
        <div className="mx-auto mb-4 w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
          <Shield className="text-white/90" size={24} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Trustworthy by Design</h2>
        <p className="text-white/50 text-sm">Built to be a safe, private teammate.</p>
      </motion.div>

      <div className="grid gap-2 mb-6">
        {points.map((p, i) => (
          <motion.div
            key={p.title}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.08 }}
            className="flex gap-3 p-3 rounded-lg border border-white/5 bg-white/5"
          >
            <div className="shrink-0 mt-0.5">
              <p.icon className="w-4 h-4 text-white/70" />
            </div>
            <div>
              <h3 className="font-medium text-white text-sm mb-0.5">{p.title}</h3>
              <p className="text-xs text-white/50 leading-relaxed">{p.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        onClick={onNext}
        className="w-full py-2.5 rounded-lg bg-white text-black font-medium text-sm 
                 hover:bg-white/90 transition-all active:scale-[0.98] 
                 flex items-center justify-center gap-2"
      >
        Sounds Good
        <ArrowRight size={14} />
      </motion.button>
    </div>
  );
}

function PersonaStep({ onNext }: { onNext: () => void }) {
  const { tone, setTone, customTone, setCustomTone } = usePreferences();

  const personas = [
    { id: 'concise' as TonePreset, label: 'Concise', desc: 'Short, direct answers', icon: Zap },
    { id: 'friendly' as TonePreset, label: 'Friendly', desc: 'Warm and helpful', icon: MessageSquare },
    { id: 'technical' as TonePreset, label: 'Technical', desc: 'Detailed & precise', icon: Command },
    { id: 'custom' as TonePreset, label: 'Custom', desc: 'Define your own style', icon: Settings },
  ];

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6"
      >
        <div className="mx-auto mb-4 w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
          <User className="text-white/90" size={24} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">How should I speak?</h2>
        <p className="text-white/50 text-sm">Choose a communication style</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="space-y-2 mb-6"
      >
        {personas.map((p, i) => (
          <motion.button
            key={p.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.05 }}
            onClick={() => setTone(p.id)}
            className={clsx(
              "w-full flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 text-left",
              tone === p.id
                ? 'border-white bg-white text-black'
                : 'border-white/5 bg-white/5 hover:bg-white/10 text-white'
            )}
          >
            <div className={clsx(
              "w-8 h-8 rounded-md flex items-center justify-center transition-colors",
              tone === p.id ? "bg-black/5 text-black" : "bg-white/5 text-white/50"
            )}>
              <p.icon size={16} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{p.label}</span>
                {tone === p.id && <Check size={12} className="text-black" />}
              </div>
              <p className={clsx("text-xs", tone === p.id ? "text-black/60" : "text-white/40")}>{p.desc}</p>
            </div>
          </motion.button>
        ))}
      </motion.div>

      {tone === 'custom' && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mb-6"
        >
          <textarea
            value={customTone}
            onChange={(e) => setCustomTone(e.target.value)}
            autoFocus
            placeholder="e.g., Talk like a helpful colleague, explain like I'm 5..."
            className="w-full bg-white/5 rounded-lg px-4 py-3 text-sm outline-none 
                     placeholder:text-white/30 border border-white/10 focus:border-white/30 
                     transition-all text-white resize-none"
            rows={3}
          />
        </motion.div>
      )}

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        onClick={onNext}
        className="w-full py-2.5 rounded-lg bg-white text-black font-medium text-sm 
                 hover:bg-white/90 transition-all active:scale-[0.98] 
                 flex items-center justify-center gap-2"
      >
        Continue
        <ChevronRight size={14} />
      </motion.button>
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

      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      
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
      // If we have a valid shortcut, stop recording
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

      // Actually register the hotkey with the main process
      const result = await window.desktopAPI.setGlobalHotkey(accelerator);
      if (!result?.ok) {
        setError(result?.error || 'Failed to register shortcut');
        return;
      }

      // Also save to localStorage as backup
      try {
        localStorage.setItem('stuard_global_hotkey', accelerator);
      } catch {}
      
      setSaved(true);
      setTimeout(onNext, 800);
    } catch (e) {
      setError('An error occurred while saving the shortcut');
    }
  };

  const clearRecording = () => {
    setRecordedKeys([]);
    setSaved(false);
    setError(null);
  };

  const formatKeyDisplay = (key: string) => {
    const icons: Record<string, React.ReactNode> = {
      'Control': <span className="text-xs">Ctrl</span>,
      'Alt': <span className="text-xs">Alt</span>,
      'Shift': <span className="text-xs">⇧</span>,
      'Command': <span className="text-xs">⌘</span>,
      'Space': <span className="text-xs">Space</span>,
      'ArrowUp': <span className="text-xs">↑</span>,
      'ArrowDown': <span className="text-xs">↓</span>,
      'ArrowLeft': <span className="text-xs">←</span>,
      'ArrowRight': <span className="text-xs">→</span>,
      'Enter': <span className="text-xs">↵</span>,
    };
    return icons[key] || key;
  };

  return (
    <div className="text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="mx-auto mb-4 w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
          <Keyboard className="text-white/90" size={24} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Your Magic Shortcut</h2>
        <p className="text-white/50 text-sm">Set a global hotkey to summon Stuard</p>
      </motion.div>

      {/* Recording Area */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
        className={clsx(
          "rounded-xl p-6 mb-5 relative overflow-hidden transition-all duration-300",
          recording 
            ? 'bg-white/10 border-2 border-white' 
            : 'bg-white/5 border border-white/10'
        )}
      >
        {/* Recording indicator */}
        {recording && (
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="text-[10px] font-medium text-red-400 uppercase tracking-wide">REC</span>
          </div>
        )}

        {/* Key display */}
        <div className="min-h-[60px] flex items-center justify-center">
          {recordedKeys.length === 0 ? (
            <div className="text-center">
              {recording ? (
                <p className="text-white/60 animate-pulse text-sm">Press your keys...</p>
              ) : (
                <p className="text-white/40 text-sm">Click below to set your shortcut</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {recordedKeys.map((key, i) => (
                <React.Fragment key={i}>
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={clsx(
                      "px-3 py-1.5 rounded-lg font-medium text-sm min-w-[2rem] flex items-center justify-center border",
                      validModifiers.includes(key) 
                        ? 'bg-white text-black border-white shadow-sm' 
                        : 'bg-white/10 text-white border-white/20'
                    )}
                  >
                    {formatKeyDisplay(key)}
                  </motion.div>
                  {i < recordedKeys.length - 1 && (
                    <span className="text-white/30">+</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex gap-2 justify-center">
          {!recording && recordedKeys.length === 0 && (
            <button
              onClick={startRecording}
              className="px-5 py-2 rounded-lg bg-white text-black font-medium text-sm 
                       hover:bg-white/90 transition-all active:scale-[0.98]
                       flex items-center gap-2"
            >
              <Keyboard size={14} />
              Record Shortcut
            </button>
          )}

          {recording && (
            <button
              onClick={() => setRecording(false)}
              className="px-5 py-2 rounded-lg border border-white/20 text-white/70 font-medium text-sm 
                       hover:text-white hover:bg-white/5 transition-all"
            >
              Stop Recording
            </button>
          )}

          {!recording && recordedKeys.length > 0 && (
            <>
              <button
                onClick={saveShortcut}
                disabled={saved}
                className={clsx(
                  "px-5 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2",
                  saved 
                    ? 'bg-white text-black' 
                    : 'bg-white text-black hover:bg-white/90 active:scale-[0.98]'
                )}
              >
                {saved ? (
                  <>
                    <Check size={14} />
                    Saved!
                  </>
                ) : (
                  'Save & Continue'
                )}
              </button>
              <button
                onClick={clearRecording}
                className="px-4 py-2 rounded-lg border border-white/20 text-white/60 font-medium text-sm 
                         hover:text-white hover:bg-white/5 transition-all"
              >
                Clear
              </button>
            </>
          )}
        </div>

        {/* Error message */}
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 text-sm text-red-400 text-center"
          >
            {error}
          </motion.p>
        )}

        {/* Tips */}
        {!recording && recordedKeys.length === 0 && (
          <p className="mt-3 text-xs text-white/40">
            Tip: Use Ctrl, Alt, or Shift + a letter key
          </p>
        )}
      </motion.div>

      {/* Default option */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="space-y-2"
      >
        <div className="p-3 rounded-lg bg-white/5 border border-white/10">
          <div className="flex items-center justify-between">
            <div className="text-left">
              <div className="text-sm font-medium text-white">Use default</div>
              <div className="text-xs text-white/50">Ctrl + Shift + Space</div>
            </div>
            <button
              onClick={onNext}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-white/10
                       hover:bg-white/20 transition-all"
            >
              Use Default
            </button>
          </div>
        </div>

        <button
          onClick={onNext}
          className="w-full py-2.5 rounded-lg border border-white/10 text-white/50 font-medium 
                   text-sm hover:text-white hover:bg-white/5 transition-all 
                   flex items-center justify-center gap-2"
        >
          Skip for now
          <ArrowRight size={14} />
        </button>
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
  const steps = ['welcome', 'privacy', 'persona', 'shortcut', 'tour'];
  
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

  const isTour = step === 4;

  return (
    <div className="w-full h-full flex flex-col">
      {/* Progress bar at top - Hide during tour */}
      {!isTour && (
        <div className="px-6 pt-2 pb-4 shrink-0">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <div
                key={i}
                className={clsx(
                  "h-1 rounded-full transition-all duration-500 flex-1",
                  i === step 
                    ? 'bg-white' 
                    : i < step 
                      ? 'bg-white/40' 
                      : 'bg-white/10'
                )}
              />
            ))}
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-white/40">Step {step + 1} of {steps.length}</span>
            {step > 0 && (
              <button 
                onClick={handleBack}
                className="text-xs text-white/50 hover:text-white/80 transition-colors flex items-center gap-1"
              >
                <ChevronLeft size={14} />
                Back
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content area */}
      <div className={clsx("flex-1 overflow-y-auto custom-scrollbar", !isTour && "px-6 pb-6")}>
        <div className={clsx("flex items-center justify-center min-h-full", isTour ? "w-full" : "")}>
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className={clsx("w-full", isTour ? "h-full" : "max-w-lg")}
            >
              {step === 0 && <WelcomeStep onNext={handleNext} />}
              {step === 1 && <PrivacyStep onNext={handleNext} />}
              {step === 2 && <PersonaStep onNext={handleNext} />}
              {step === 3 && <ShortcutStep onNext={handleNext} />}
              {step === 4 && <InteractiveTourStep onNext={handleNext} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
