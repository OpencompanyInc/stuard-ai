"use client";

import { useState, useEffect } from 'react';

// --- Icons (Lucide matches Desktop App) ---
const Icons = {
  Mic: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>,
  Layout: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>,
  Home: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  Clock: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Plus: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>,
  Video: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>,
  CheckSquare: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  Cursor: (props: any) => (
    <svg {...props} viewBox="0 0 24 24" fill="currentColor" stroke="white" strokeWidth="1.5">
      <path d="M5.5 3.21l12.32 11.33-5.91 1.25 2.8 5.75-2.26 1.1-2.8-5.75-3.8 3.5V3.21z" />
    </svg>
  ),
  Check: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Zap: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Terminal: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  MessageSquare: (props: any) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
};

// --- Types & Config ---
interface CursorState {
  x: number; // Percentage 0-100
  y: number; // Percentage 0-100
  clicking: boolean;
}

interface Step {
  action: 'wait' | 'move' | 'click' | 'type' | 'stuard-type' | 'stuard-status' | 'stuard-mode';
  x?: number; // Percentage
  y?: number; // Percentage
  text?: string;
  statusText?: string;
  statusIcon?: 'video' | 'task';
  mode?: 'compact' | 'hud';
  duration?: number;
}

const STEPS: Step[] = [
  // 1. Initial State: HUD Active
  { action: 'stuard-mode', mode: 'hud', duration: 1500 },
  
  // 2. Select Stuard from HUD
  { action: 'move', x: 50, y: 70, duration: 800 },
  { action: 'click', x: 50, y: 70, duration: 200 },
  
  // 3. HUD closes, Compact bar appears
  { action: 'stuard-mode', mode: 'compact', duration: 500 },
  { action: 'stuard-status', statusText: 'Ready', statusIcon: 'video', duration: 1000 },
  
  // 4. User types instruction into Stuard
  { action: 'stuard-type', text: "Add Sarah Connor to CRM", duration: 2500 },
  { action: 'wait', duration: 1000 },
  
  // 5. Stuard acknowledges
  { action: 'stuard-status', statusText: 'Processing...', statusIcon: 'video', duration: 1000 },
  { action: 'stuard-status', statusText: 'Adding contact...', statusIcon: 'task', duration: 800 },
  
  // 6. Automation Begins - Cursor moves to Name field
  { action: 'move', x: 40, y: 35, duration: 1200 },
  { action: 'click', x: 40, y: 35, duration: 200 },
  { action: 'type', text: "Sarah Connor", duration: 1000 },
  
  // 7. Email field
  { action: 'move', x: 40, y: 52, duration: 1000 },
  { action: 'click', x: 40, y: 52, duration: 200 },
  { action: 'type', text: "sarah@skynet.com", duration: 1200 },
  
  // 8. Role Dropdown
  { action: 'move', x: 40, y: 69, duration: 1000 },
  { action: 'click', x: 40, y: 69, duration: 250 },
  { action: 'wait', duration: 500 },
  // Select "Resistance Leader"
  { action: 'move', x: 40, y: 78, duration: 800 },
  { action: 'click', x: 40, y: 78, duration: 250 },
  
  // 9. Save Button
  { action: 'move', x: 65, y: 88, duration: 1200 },
  { action: 'click', x: 65, y: 88, duration: 250 },
  
  // 10. Success State
  { action: 'wait', duration: 1000 },
  { action: 'stuard-status', statusText: 'Task Complete', statusIcon: 'task', duration: 3000 },
];

export default function AutomationDemo() {
  const [query, setQuery] = useState("");
  const [statusText, setStatusText] = useState("Ready");
  const [statusIcon, setStatusIcon] = useState<'video' | 'task'>('video');
  const [stuardMode, setStuardMode] = useState<'compact' | 'hud'>('hud');
  
  // Start cursor parked at the Stuard bar to signify "handoff"
  const [cursor, setCursor] = useState<CursorState>({ x: 50, y: 70, clicking: false });
  
  // Fake CRM State
  const [formData, setFormData] = useState({ name: '', email: '', role: 'Developer' });
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const runSequence = async () => {
      while (!isCancelled) {
        // Reset Logic
        setQuery("");
        setStatusText("Ready");
        setStatusIcon('video');
        setStuardMode('hud');
        setCursor({ x: 50, y: 70, clicking: false });
        setFormData({ name: '', email: '', role: 'Developer' });
        setShowDropdown(false);
        setIsSubmitted(false);
        setActiveField(null);
        await new Promise(r => setTimeout(r, 1000));

        for (const step of STEPS) {
          if (isCancelled) break;

          switch (step.action) {
            case 'wait':
              await new Promise(r => setTimeout(r, step.duration!));
              break;
              
            case 'stuard-mode':
              setStuardMode(step.mode!);
              if (step.mode === 'compact') {
                setCursor({ x: 50, y: 85, clicking: false }); // Move cursor to input bar
              }
              await new Promise(r => setTimeout(r, step.duration!));
              break;

            case 'stuard-type':
              const txt = step.text || "";
              for (let i = 0; i <= txt.length; i++) {
                if (isCancelled) return;
                setQuery(txt.slice(0, i));
                await new Promise(r => setTimeout(r, 80));
              }
              await new Promise(r => setTimeout(r, step.duration!));
              break;
              
            case 'stuard-status':
              setStatusText(step.statusText || "");
              if (step.statusIcon) setStatusIcon(step.statusIcon);
              // Clear query when automation starts
              if (step.statusIcon === 'task') setQuery(""); 
              await new Promise(r => setTimeout(r, step.duration!));
              break;
              
            case 'move':
              setCursor(prev => ({ ...prev, x: step.x!, y: step.y! }));
              await new Promise(r => setTimeout(r, step.duration!));
              break;
              
            case 'click':
              setCursor(prev => ({ ...prev, clicking: true }));
              await new Promise(r => setTimeout(r, 200)); // Click down
              
              // --- Simulation Logic ---
              if (step.y === 35) setActiveField('name');
              if (step.y === 52) setActiveField('email');
              if (step.y === 69) { setActiveField('role'); setShowDropdown(p => !p); }
              if (step.y === 78) { 
                  setFormData(p => ({ ...p, role: 'Resistance Leader' })); 
                  setShowDropdown(false); 
              }
              if (step.y === 88) { setIsSubmitted(true); }
              // ------------------------

              setCursor(prev => ({ ...prev, clicking: false }));
              await new Promise(r => setTimeout(r, step.duration!));
              break;
              
            case 'type':
              const field = activeField as keyof typeof formData;
              if (field) {
                const text = step.text || "";
                for (let i = 0; i <= text.length; i++) {
                    if (isCancelled) return;
                    setFormData(p => ({ ...p, [field]: text.slice(0, i) }));
                    await new Promise(r => setTimeout(r, 80));
                }
              }
              await new Promise(r => setTimeout(r, step.duration!));
              break;
          }
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    };

    runSequence();
    return () => { isCancelled = true; };
  }, [activeField]);

  return (
    <div className="w-full h-full bg-[#f3f4f6] relative font-sans overflow-hidden select-none flex flex-col items-center justify-center p-6">
      
      {/* 1. Fake CRM Window */}
      <div className="w-full max-w-lg bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col z-10 transition-all duration-500 ease-out"
           style={{ 
             transform: stuardMode === 'compact' && statusIcon === 'task' ? 'scale(1)' : 'scale(0.95)', 
             opacity: stuardMode === 'compact' ? 1 : 0.4,
             filter: stuardMode === 'hud' ? 'blur(2px)' : 'none'
           }}>
         
         {/* Window Chrome */}
         <div className="h-9 bg-slate-50 border-b border-slate-200 flex items-center px-4 gap-2">
             <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
             </div>
             <div className="w-px h-4 bg-slate-200 mx-2" />
             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">CRM - New Entry</span>
         </div>
         
         {/* App Content */}
         <div className="p-8 h-[320px] relative">
            {isSubmitted ? (
               <div className="flex flex-col items-center justify-center h-full animate-fade-in">
                   <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
                       <Icons.Check className="w-8 h-8 text-emerald-500" />
                   </div>
                   <div className="text-lg font-bold text-slate-800">Record Created</div>
                   <div className="text-sm text-slate-400 mt-1">Sarah Connor added to contacts</div>
               </div>
            ) : (
               <div className="space-y-5">
                   {/* Name Field */}
                   <div>
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Full Name</label>
                       <div className={`h-10 w-full rounded-lg border flex items-center px-3 transition-all duration-200 ${
                           activeField === 'name' ? 'border-[#007acc] ring-4 ring-[#007acc]/10 bg-white' : 'border-slate-200 bg-slate-50'
                       }`}>
                           <span className="text-sm font-medium text-slate-800">{formData.name}</span>
                           {activeField === 'name' && <div className="w-0.5 h-5 bg-[#007acc] animate-pulse ml-0.5" />}
                       </div>
                   </div>

                   {/* Email Field */}
                   <div>
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Email Address</label>
                       <div className={`h-10 w-full rounded-lg border flex items-center px-3 transition-all duration-200 ${
                           activeField === 'email' ? 'border-[#007acc] ring-4 ring-[#007acc]/10 bg-white' : 'border-slate-200 bg-slate-50'
                       }`}>
                           <span className="text-sm font-medium text-slate-800">{formData.email}</span>
                           {activeField === 'email' && <div className="w-0.5 h-5 bg-[#007acc] animate-pulse ml-0.5" />}
                       </div>
                   </div>

                   {/* Role Field */}
                   <div className="relative">
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Role</label>
                       <div className={`h-10 w-full rounded-lg border flex items-center justify-between px-3 transition-all duration-200 ${
                           activeField === 'role' ? 'border-[#007acc] ring-4 ring-[#007acc]/10 bg-white' : 'border-slate-200 bg-slate-50'
                       }`}>
                           <span className="text-sm font-medium text-slate-800">{formData.role}</span>
                           <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
                       </div>
                       
                       {/* Dropdown Menu */}
                       {showDropdown && (
                           <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-xl z-20 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-150">
                               <div className="px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">Developer</div>
                               <div className="px-4 py-2.5 text-xs font-bold text-[#007acc] bg-[#007acc]/5 cursor-pointer border-l-2 border-[#007acc]">Resistance Leader</div>
                               <div className="px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">Designer</div>
                           </div>
                       )}
                   </div>

                   <div className="flex justify-end pt-2">
                       <button className="px-6 py-2.5 bg-slate-900 text-white text-xs font-bold rounded-lg shadow-md hover:bg-black transition-colors">
                           Save Record
                       </button>
                   </div>
               </div>
            )}
         </div>
      </div>

      {/* 2. HUD Mode (Curved HUD Simulation) */}
      <div className={`absolute bottom-0 left-0 right-0 h-64 flex items-end justify-center pointer-events-none transition-all duration-500 z-40 ${
          stuardMode === 'hud' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20'
      }`}>
         <div className="relative w-full max-w-2xl flex items-center justify-center gap-4 pb-12">
            {[
               { id: '1', icon: Icons.Zap, color: '#fbbf24', label: 'Automations' },
               { id: '2', icon: Icons.Terminal, color: '#10b981', label: 'Dashboard' },
               { id: '3', icon: Icons.MessageSquare, color: '#3b82f6', label: 'Stuard', active: true },
               { id: '4', icon: Icons.Layout, color: '#a855f7', label: 'Workflows' },
               { id: '5', icon: Icons.Clock, color: '#64748b', label: 'History' },
            ].map((item) => (
               <div key={item.id} className={`flex flex-col items-center gap-3 transition-all duration-300 ${item.active ? 'scale-125 z-10' : 'opacity-50 scale-90'}`}>
                  <div className="w-16 h-16 rounded-[24px] bg-white/90 backdrop-blur-xl border border-slate-200 flex items-center justify-center shadow-xl shadow-slate-200/50">
                     <item.icon className="w-8 h-8" style={{ color: item.color }} />
                  </div>
                  {item.active && (
                    <div className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[9px] font-black text-slate-800 uppercase tracking-widest shadow-sm">
                        {item.label}
                    </div>
                  )}
               </div>
            ))}
         </div>
      </div>

      {/* 3. Stuard Overlay (Compact Mode) */}
      <div className={`absolute bottom-8 z-30 w-full max-w-sm transition-all duration-500 ${
          stuardMode === 'compact' ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-10 scale-95 pointer-events-none'
      }`}>
        <div className="w-full bg-white/90 backdrop-blur-xl rounded-[24px] border border-slate-200 shadow-2xl p-2">
            
            {/* Status Bar */}
            <div className="flex items-center gap-3 px-3 py-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shadow-sm transition-colors duration-300 ${
                    statusIcon === 'task' ? 'bg-emerald-500' : 'bg-[#007acc]'
                }`}>
                    {statusIcon === 'task' ? <Icons.CheckSquare className="w-3 h-3 text-white" /> : <Icons.Video className="w-3 h-3 text-white" />}
                </div>
                <span className="text-[13px] font-bold text-slate-700 flex-1 truncate transition-all duration-300">
                    {statusText}
                </span>
                
                {/* Mock Actions */}
                <div className="flex gap-1">
                    <div className="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400"><Icons.Layout className="w-3.5 h-3.5" /></div>
                    <div className="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400"><Icons.Home className="w-3.5 h-3.5" /></div>
                </div>
            </div>

            {/* Input Area */}
            <div className="flex items-center gap-2 bg-slate-50 rounded-[20px] p-1 border border-slate-100">
                <button className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-200/50 transition-colors">
                    <Icons.Plus className="w-4 h-4" />
                </button>
                <div className="flex-1 h-8 flex items-center">
                    {query ? (
                        <span className="text-[13px] font-semibold text-slate-800">{query}</span>
                    ) : (
                        <span className="text-[13px] font-medium text-slate-400">Ask Stuard...</span>
                    )}
                    {query && statusText === 'Ready' && <div className="w-0.5 h-4 bg-[#007acc] ml-0.5 animate-pulse" />}
                </div>
                <div className="w-8 h-8 rounded-[14px] bg-[#007acc] flex items-center justify-center text-white shadow-sm">
                    <Icons.Mic className="w-4 h-4" />
                </div>
            </div>
        </div>
      </div>

      {/* 4. Ghost Cursor (Animated) */}
      <div 
        className="absolute z-50 pointer-events-none transition-all duration-[inherit] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ 
            left: `${cursor.x}%`, 
            top: `${cursor.y}%`,
            transitionDuration: `${cursor.clicking ? 100 : 800}ms`
        }}
      >
         <div className="relative">
             <div className={`transition-transform duration-150 ${cursor.clicking ? 'scale-90 translate-y-1' : 'scale-100'}`}>
                <Icons.Cursor className="w-8 h-8 text-slate-900 drop-shadow-xl" />
             </div>
             
             {/* Stuard Badge */}
             <div className="absolute left-6 top-6 bg-[#007acc] text-white text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap animate-in fade-in zoom-in duration-300">
                 Stuard
             </div>
             
             {/* Click Ripple */}
             {cursor.clicking && (
                 <div className="absolute -left-3 -top-3 w-12 h-12 border-2 border-[#007acc] rounded-full animate-ping opacity-75" />
             )}
         </div>
      </div>

    </div>
  );
}