import React, { useEffect, useState } from "react";
import { usePreferences, TonePreset } from "../../hooks/usePreferences";
import { supabase } from "../../lib/supabaseClient";
import { startBrowserSignIn } from "../../auth/browserSignIn";

export default function OnboardingWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setOnboardingComplete, tone, setTone, customTone, setCustomTone } = usePreferences();
  const [step, setStep] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSignedIn(!!data?.session);
      setUserEmail(data?.session?.user?.email ?? null);
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      setUserEmail(session?.user?.email ?? null);
    });
    return () => { try { subscription.unsubscribe(); } catch {} };
  }, []);

  if (!open) return null;

  const next = () => {
    // Prevent progressing past auth gate
    if (!signedIn) return;
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };
  const back = () => {
    // Prevent navigating back while auth-gated
    if (!signedIn) return;
    setStep((s) => Math.max(s - 1, 0));
  };
  const skip = () => {
    if (!signedIn) return;
    setOnboardingComplete(true); onClose();
  };
  const finish = () => { setOnboardingComplete(true); onClose(); };

  const handleSignIn = async () => {
    setStatus("Opening browser…");
    const res = await startBrowserSignIn();
    if (!res.ok) setStatus(`Error: ${res.error}`);
    else {
      setStatus("Signed in");
      try {
        if (steps[step]?.id === 'signin') next();
      } catch {}
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setStatus("");
  };

  const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-3">
      <div className="text-[16px] font-semibold text-white">{title}</div>
      <div className="text-[13px] text-white/75 leading-relaxed">{children}</div>
    </div>
  );

  const steps = [
    {
      id: "welcome",
      title: "Welcome to StuardAI",
      render: () => (
        <Card title="Welcome to StuardAI">
          <div>Stuard is a system-native desktop assistant that thinks, shows, does, and remembers. Toggle it anywhere and work without breaking flow.</div>
          <ul className="mt-3 space-y-1">
            <li className="bg-white/5 rounded px-3 py-1.5">Toggle overlay: <span className="text-white/70">Ctrl + Shift + Space</span></li>
            <li className="bg-white/5 rounded px-3 py-1.5">Move overlay (when unfocused): <span className="text-white/70">Ctrl + Arrow</span></li>
            <li className="bg-white/5 rounded px-3 py-1.5">Fast move: <span className="text-white/70">Ctrl + Shift + Arrow</span></li>
          </ul>
        </Card>
      ),
    },
    {
      id: "value",
      title: "What you can do",
      render: () => (
        <Card title="What you can do">
          <ul className="list-disc pl-5 space-y-1">
            <li>Ask and automate with rich local context.</li>
            <li>Attach files or images to ground responses.</li>
            <li>Open the dashboard for history, settings, and local memory.</li>
          </ul>
        </Card>
      ),
    },
    {
      id: "tone",
      title: "Choose a tone",
      render: () => (
        <Card title="Choose a tone">
          <div className="grid grid-cols-2 gap-2">
            {(["concise", "friendly", "formal", "technical", "custom"] as TonePreset[]).map((t) => (
              <button
                key={t}
                onClick={() => setTone(t)}
                className={`text-left px-3 py-2 rounded border ${tone === t ? 'border-white/60 bg-white/10' : 'border-white/10 hover:border-white/20'} transition`}
              >
                <div className="text-[13px] font-medium capitalize">{t}</div>
                <div className="text-[11px] text-white/60 mt-0.5">{t === 'concise' ? 'Short and direct' : t === 'friendly' ? 'Warm and approachable' : t === 'formal' ? 'Polite and professional' : t === 'technical' ? 'Precise and technical' : 'Write your own style'}</div>
              </button>
            ))}
          </div>
          {tone === 'custom' && (
            <div className="mt-3">
              <input
                value={customTone}
                onChange={(e) => setCustomTone(e.target.value)}
                autoFocus
                placeholder="Describe your tone (e.g., Friendly, succinct, no emojis)"
                className="w-full bg-neutral-800/60 rounded-md px-3 py-2 text-[13px] outline-none placeholder:text-white/40 border border-white/10 focus:border-white/20"
              />
              <div className="text-[11px] text-white/50 mt-1">Used when Tone is set to Custom.</div>
            </div>
          )}
        </Card>
      ),
    },
    {
      id: "hotkeys",
      title: "Master the shortcuts",
      render: () => (
        <Card title="Master the shortcuts">
          <ul className="space-y-1">
            <li className="bg-white/5 rounded px-3 py-1.5">Command palette: <span className="text-white/70">F1 or Ctrl + /</span></li>
            <li className="bg-white/5 rounded px-3 py-1.5">Send: <span className="text-white/70">Enter</span> • New line: <span className="text-white/70">Shift + Enter</span> • Hide: <span className="text-white/70">Esc</span></li>
          </ul>
        </Card>
      ),
    },
    {
      id: "signin",
      title: "Sign in",
      render: () => (
        <Card title="Sign in">
          <div>Sign in to sync conversations and preferences.</div>
          {signedIn ? (
            <div className="mt-3">
              <div className="text-[13px]">{`Signed in${userEmail ? ` as ${userEmail}` : ''}.`}</div>
              <div className="mt-2">
                <button onClick={handleSignOut} className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15">Sign out</button>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <button onClick={handleSignIn} className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15">Sign in via browser</button>
              {status && <div className="text-[12px] text-white/60 mt-1">{status}</div>}
            </div>
          )}
        </Card>
      ),
    },
    {
      id: "done",
      title: "You’re all set",
      render: () => (
        <Card title="You’re all set">
          <div>Open the palette to explore commands or start typing to chat. You can revisit onboarding anytime from the palette.</div>
        </Card>
      ),
    },
  ];

  useEffect(() => {
    if (!open) return;
    const i = steps.findIndex((s) => s.id === 'signin');
    setStep(signedIn ? 0 : (i >= 0 ? i : 0));
  }, [open, signedIn]);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      <div className="w-[680px] max-w-[92vw] rounded-xl border border-white/10 bg-neutral-900 text-white shadow-2xl overflow-hidden relative drag">
        <div className="px-4 py-3 border-b border-white/10 text-[14px] font-semibold drag">Onboarding</div>
        <div className="absolute top-2 right-2 flex flex-wrap gap-1.5 justify-end no-drag">
          <div className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[11px] text-white/80 shadow">Ctrl + Shift + Space</div>
          <div className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[11px] text-white/80 shadow">Ctrl + /</div>
          <div className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[11px] text-white/80 shadow">F1</div>
          <div className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[11px] text-white/80 shadow">Ctrl + Arrow</div>
          <div className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[11px] text-white/80 shadow">Ctrl + Shift + Arrow</div>
        </div>
        <div className="p-5 min-h-[260px] no-drag">{steps[step].render()}</div>
        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between text-[12px] no-drag">
          <div className="text-white/50">Step {step + 1} of {steps.length}</div>
          <div className="flex items-center gap-2">
            <button onClick={skip} disabled={!signedIn} className="px-3 py-1.5 rounded-md hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed">Skip</button>
            {step > 0 && !(steps[step]?.id === 'signin' && !signedIn) && (
              <button onClick={back} className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15">Back</button>
            )}
            {step < steps.length - 1 ? (
              <button onClick={next} disabled={!signedIn && steps[step]?.id === 'signin'} className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed">Next</button>
            ) : (
              <button onClick={finish} className="px-3 py-1.5 rounded-md bg-white text-neutral-900">Finish</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
