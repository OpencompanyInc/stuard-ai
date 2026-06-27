import React, { useState } from 'react';
import { clsx } from 'clsx';
import { PlusIcon, Cross2Icon, CheckIcon, TrashIcon } from '@radix-ui/react-icons';

interface Fact {
  id: string;
  text: string;
  category: string;
  subtype: string;
  created_at: string;
}

interface StickyNotesProps {
  notes: Fact[];
  onAdd: (text: string, type: 'bio' | 'instruction') => Promise<void>;
  onDelete: (id: string, type: 'bio' | 'instruction') => Promise<void>;
}

export function StickyNotes({ notes, onAdd, onDelete }: StickyNotesProps) {
  const [isAdding, setIsAdding] = useState<'bio' | 'instruction' | null>(null);
  const [newText, setNewText] = useState('');

  const handleAddSubmit = async () => {
    if (!newText.trim() || !isAdding) return;
    await onAdd(newText, isAdding);
    setNewText('');
    setIsAdding(null);
  };

  // Group by type for visual separation
  const profileNotes = notes.filter(n => n.category === 'personal' && n.subtype === 'core');
  const bioNotes = notes.filter(n => n.category === 'personal' && n.subtype === 'bio');
  const instructionNotes = notes.filter(n => n.category === 'instruction');

  return (
    <div className="h-full overflow-y-auto p-8 bg-theme-bg">
      {/* Profile Section - Core identity facts */}
      {profileNotes.length > 0 && (
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-theme-fg flex items-center gap-2 font-stuard">
              <span className="text-3xl">👤</span> Profile
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {profileNotes.map((note) => (
              <div 
                key={note.id} 
                className="bg-theme-card border border-theme rounded-theme-card p-4 shadow-sm group hover:border-primary/30 transition-all"
              >
                <div className="text-[10px] font-black text-primary uppercase tracking-widest mb-2">
                  {(note as any).attribute_key || 'info'}
                </div>
                <div className="text-sm text-theme-fg font-bold leading-tight">{note.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bio Section */}
      <div className="mb-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-theme-fg flex items-center gap-2 font-stuard">
            <span className="text-3xl">🌱</span> About You
          </h2>
          <button
            onClick={() => setIsAdding('bio')}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-fg rounded-theme-button hover:opacity-90 transition-all text-xs font-bold shadow-md"
          >
            <PlusIcon /> Add Note
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 pl-2">
          {isAdding === 'bio' && (
            <div className="aspect-square bg-theme-card rounded-theme-card shadow-xl p-6 flex flex-col transform rotate-1 transition-all border-2 border-primary/30 animate-in zoom-in duration-200">
              <textarea
                autoFocus
                value={newText}
                onChange={e => setNewText(e.target.value)}
                placeholder="Type your note..."
                className="flex-1 bg-transparent border-none resize-none focus:outline-none text-[15px] text-theme-fg placeholder:text-theme-muted font-stuard font-bold leading-relaxed"
                onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAddSubmit();
                    }
                }}
              />
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setIsAdding(null)} className="p-2 text-theme-muted hover:bg-theme-hover rounded-full transition-colors"><Cross2Icon className="w-5 h-5" /></button>
                <button onClick={handleAddSubmit} className="p-2 text-primary hover:bg-primary/10 rounded-full transition-colors"><CheckIcon className="w-5 h-5" /></button>
              </div>
            </div>
          )}

          {bioNotes.map((note, idx) => (
            <StickyNote 
              key={note.id} 
              note={note} 
              color="yellow" 
              rotation={idx % 2 === 0 ? 1 : -1} 
              onDelete={() => onDelete(note.id, 'bio')} 
            />
          ))}
        </div>
      </div>

      {/* Instructions Section */}
      <div className="pb-12">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-theme-fg flex items-center gap-2 font-stuard">
            <span className="text-3xl">⚙️</span> System Instructions
          </h2>
          <button
            onClick={() => setIsAdding('instruction')}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-fg rounded-theme-button hover:opacity-90 transition-all text-xs font-bold shadow-md"
          >
            <PlusIcon /> Add Instruction
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 pl-2">
          {isAdding === 'instruction' && (
            <div className="aspect-square bg-theme-card rounded-theme-card shadow-xl p-6 flex flex-col transform -rotate-1 transition-all border-2 border-primary/30 animate-in zoom-in duration-200">
              <textarea
                autoFocus
                value={newText}
                onChange={e => setNewText(e.target.value)}
                placeholder="Type instruction..."
                className="flex-1 bg-transparent border-none resize-none focus:outline-none text-[15px] text-theme-fg placeholder:text-theme-muted font-stuard font-bold leading-relaxed"
                onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAddSubmit();
                    }
                }}
              />
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setIsAdding(null)} className="p-2 text-theme-muted hover:bg-theme-hover rounded-full transition-colors"><Cross2Icon className="w-5 h-5" /></button>
                <button onClick={handleAddSubmit} className="p-2 text-primary hover:bg-primary/10 rounded-full transition-colors"><CheckIcon className="w-5 h-5" /></button>
              </div>
            </div>
          )}

          {instructionNotes.map((note, idx) => (
            <StickyNote 
              key={note.id} 
              note={note} 
              color="purple" 
              rotation={idx % 3 === 0 ? -1 : idx % 3 === 1 ? 2 : 0} 
              onDelete={() => onDelete(note.id, 'instruction')} 
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StickyNote({ note, color, rotation, onDelete }: { note: Fact, color: 'yellow' | 'purple', rotation: number, onDelete: () => void }) {
  const bgColors = {
    yellow: 'bg-[#FEFCE8] dark:bg-[#252526] border border-yellow-200 dark:border-[#3e3e3e]',
    purple: 'bg-[#F5F3FF] dark:bg-[#252526] border border-violet-200 dark:border-[#3e3e3e]'
  };
  
  const noteStyle = {
    lineHeight: '1.6rem',
    fontSize: '0.95rem',
  };

  return (
    <div 
      className={clsx(
        "group relative aspect-square p-0 shadow-sm transition-all hover:scale-[1.03] hover:z-10 hover:shadow-xl overflow-hidden rounded-theme-card",
        bgColors[color]
      )}
      style={{ 
        transform: `rotate(${rotation}deg)`,
      }}
    >
      <div className={clsx("absolute top-0 left-0 right-0 h-1.5", color === 'yellow' ? "bg-yellow-400 dark:bg-yellow-600" : "bg-violet-400 dark:bg-violet-600")} />

      <div className="h-full flex flex-col p-6 pt-8">
        <div 
            className="flex-1 text-theme-fg overflow-y-auto custom-scrollbar pr-2 font-stuard font-bold leading-relaxed"
            style={noteStyle}
        >
           {note.text}
        </div>
        <div className="mt-4 text-[10px] text-theme-muted font-bold tracking-tight text-right z-10 uppercase bg-theme-hover/30 px-2 py-1 rounded-full self-end border border-theme/20">
          {new Date(note.created_at).toLocaleDateString()}
        </div>
      </div>

      <button 
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-2 text-theme-muted hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all z-20"
      >
        <TrashIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
