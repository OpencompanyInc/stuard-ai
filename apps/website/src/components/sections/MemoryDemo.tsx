"use client";

import { useState, useEffect } from 'react';

const Icons = {
  Sparkles: (props: any) => (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/>
    </svg>
  ),
  Send: (props: any) => (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="M22 2 11 13"/>
    </svg>
  ),
  Calendar: (props: any) => (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>
    </svg>
  ),
  User: (props: any) => (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  Coffee: (props: any) => (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/>
    </svg>
  ),
};

type Phase = 'idle' | 'user-typing' | 'thinking' | 'recalling' | 'responding' | 'done';

interface MemoryItem {
  id: string;
  icon: 'calendar' | 'user' | 'coffee';
  label: string;
  value: string;
  isNew?: boolean;
}

export default function MemoryDemo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [userMessage, setUserMessage] = useState('');
  const [response, setResponse] = useState('');
  const [memories, setMemories] = useState<MemoryItem[]>([
    { id: '1', icon: 'calendar', label: 'Next Flight', value: 'Tokyo, March 15' },
    { id: '2', icon: 'user', label: 'Boss', value: 'Sarah Connor' },
    { id: '3', icon: 'coffee', label: 'Preference', value: 'Oat milk latte' },
  ]);
  const [activeMemory, setActiveMemory] = useState<string | null>(null);
  const [thinkingText, setThinkingText] = useState('');

  const fullQuestion = "What time is my flight?";
  const fullResponse = "Your flight to Tokyo departs at 2:45 PM from Terminal 3. I've already added a reminder for 11:00 AM to leave for the airport.";

  useEffect(() => {
    let cancelled = false;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    const typeText = async (text: string, setter: (v: string) => void, delay = 50) => {
      for (let i = 0; i <= text.length; i++) {
        if (cancelled) return;
        setter(text.slice(0, i));
        await sleep(delay);
      }
    };

    const runDemo = async () => {
      while (!cancelled) {
        // Reset
        setPhase('idle');
        setUserMessage('');
        setResponse('');
        setActiveMemory(null);
        setThinkingText('');
        setMemories([
          { id: '1', icon: 'calendar', label: 'Next Flight', value: 'Tokyo, March 15' },
          { id: '2', icon: 'user', label: 'Boss', value: 'Sarah Connor' },
          { id: '3', icon: 'coffee', label: 'Preference', value: 'Oat milk latte' },
        ]);
        await sleep(1500);

        // User types question
        setPhase('user-typing');
        await typeText(fullQuestion, setUserMessage, 60);
        await sleep(600);

        // Thinking
        setPhase('thinking');
        setThinkingText('Searching memories...');
        await sleep(800);

        // Recall - highlight the flight memory
        setPhase('recalling');
        setActiveMemory('1');
        setThinkingText('Found: Flight details');
        await sleep(1200);

        // Responding
        setPhase('responding');
        setThinkingText('');
        await typeText(fullResponse, setResponse, 25);
        await sleep(500);

        // Done
        setPhase('done');
        await sleep(4000);
      }
    };

    runDemo();
    return () => { cancelled = true; };
  }, []);

  const getIcon = (type: string) => {
    switch (type) {
      case 'calendar': return <Icons.Calendar className="w-4 h-4" />;
      case 'user': return <Icons.User className="w-4 h-4" />;
      case 'coffee': return <Icons.Coffee className="w-4 h-4" />;
      default: return <Icons.Sparkles className="w-4 h-4" />;
    }
  };

  return (
    <div className="w-full h-full bg-gradient-to-br from-violet-50 to-slate-100 relative font-sans overflow-hidden select-none flex">

      {/* Left Side - Chat */}
      <div className="flex-1 flex flex-col p-4">

        {/* Chat Header */}
        <div className="flex items-center gap-2 mb-4">
          <img
            src="/stuard-logo.png"
            alt="Stuard"
            className="w-8 h-8"
          />
          <div>
            <div className="text-sm font-bold text-slate-800">Stuard</div>
            <div className="text-[10px] text-slate-500">Remembers everything</div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 flex flex-col justify-end gap-3 mb-4">

          {/* User Message */}
          {userMessage && (
            <div className="flex justify-end">
              <div className="bg-slate-800 text-white px-4 py-2.5 rounded-2xl rounded-br-sm text-sm font-medium max-w-[85%]">
                {userMessage}
                {phase === 'user-typing' && (
                  <span className="inline-block w-0.5 h-4 bg-white/70 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            </div>
          )}

          {/* Thinking State */}
          {(phase === 'thinking' || phase === 'recalling') && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 px-4 py-2.5 rounded-2xl rounded-bl-sm shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                  <span className="text-xs font-semibold text-violet-600">{thinkingText}</span>
                </div>
              </div>
            </div>
          )}

          {/* Assistant Response */}
          {response && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 px-4 py-2.5 rounded-2xl rounded-bl-sm shadow-sm text-sm font-medium text-slate-700 max-w-[90%]">
                {response}
                {phase === 'responding' && (
                  <span className="inline-block w-0.5 h-4 bg-violet-500 animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-10 bg-white border border-slate-200 rounded-xl flex items-center px-4 shadow-sm">
            <span className="text-sm text-slate-400">Ask anything...</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-md">
            <Icons.Send className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Right Side - Memory Panel */}
      <div className="w-44 bg-white/50 backdrop-blur-sm border-l border-slate-200 p-3 flex flex-col">

        {/* Memory Header */}
        <div className="flex items-center gap-2 mb-3 px-1">
          <Icons.Sparkles className="w-3.5 h-3.5 text-violet-600" />
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Memory</span>
        </div>

        {/* Memory Items */}
        <div className="space-y-2">
          {memories.map((memory) => (
            <div
              key={memory.id}
              className={`p-2.5 rounded-xl border transition-all duration-300 ${
                activeMemory === memory.id
                  ? 'bg-violet-50 border-violet-300 ring-2 ring-violet-200 scale-[1.02]'
                  : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-5 h-5 rounded-lg flex items-center justify-center ${
                  activeMemory === memory.id ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {getIcon(memory.icon)}
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase">{memory.label}</span>
              </div>
              <div className={`text-xs font-semibold ${
                activeMemory === memory.id ? 'text-violet-700' : 'text-slate-700'
              }`}>
                {memory.value}
              </div>
              {activeMemory === memory.id && (
                <div className="mt-1.5 text-[9px] font-bold text-violet-500 uppercase tracking-wider flex items-center gap-1">
                  <div className="w-1 h-1 bg-violet-500 rounded-full animate-pulse" />
                  Using this
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer Note */}
        <div className="mt-auto pt-3 text-[9px] text-slate-400 text-center">
          Stuard remembers your<br/>preferences & context
        </div>
      </div>
    </div>
  );
}
