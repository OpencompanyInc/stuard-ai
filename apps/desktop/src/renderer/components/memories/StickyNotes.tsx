import React, { useState } from 'react';
import { PlusIcon, Cross2Icon, CheckIcon, TrashIcon } from '@radix-ui/react-icons';

interface Fact {
  id: string;
  text: string;
  category: string;
  subtype: string;
  created_at: string;
  attribute_key?: string;
}

interface StickyNotesProps {
  notes: Fact[];
  onAdd: (text: string, type: 'bio' | 'instruction') => Promise<void>;
  onDelete: (id: string, type: 'bio' | 'instruction') => Promise<void>;
}

function formatContextDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(new Date(value));
}

function splitNoteText(text: string) {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { title: 'Untitled', body: '' };

  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  const shortSentence = firstSentence.length <= 40 ? firstSentence : '';

  if (shortSentence) {
    const title = shortSentence.replace(/[.!?]+$/, '');
    const remaining = cleaned.slice(shortSentence.length).trim();
    return {
      title,
      body: remaining || cleaned,
    };
  }

  const words = cleaned.split(' ');
  const title = words.slice(0, 3).join(' ');
  return {
    title: title.replace(/[.!?,:;]+$/, ''),
    body: cleaned,
  };
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

  const profileNotes = notes.filter(n => n.category === 'personal' && n.subtype === 'core');
  const bioNotes = notes.filter(n => n.category === 'personal' && n.subtype === 'bio');
  const instructionNotes = notes.filter(n => n.category === 'instruction');

  return (
    <div className="memory-context-surface memory-context-scrollbar h-full overflow-y-auto rounded-[26px] px-5 pb-10 pt-5 md:px-6">
      <div className="space-y-12">
        {profileNotes.length > 0 && (
          <section className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[1.35rem] font-semibold text-theme-fg">Profile</h2>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {profileNotes.map((note, index) => (
                <ProfileCard key={note.id} note={note} index={index} />
              ))}
            </div>
          </section>
        )}

        <ContextSection
          title="About You"
          addLabel="Add Note"
          type="bio"
          notes={bioNotes}
          isAdding={isAdding === 'bio'}
          newText={newText}
          onStartAdd={() => setIsAdding('bio')}
          onCancel={() => {
            setIsAdding(null);
            setNewText('');
          }}
          onTextChange={setNewText}
          onSubmit={handleAddSubmit}
          onDelete={onDelete}
          emptyText="Add notes about preferences, work, goals, and personal context."
        />

        <ContextSection
          title="System Instructions"
          addLabel="Add Instruction"
          type="instruction"
          notes={instructionNotes}
          isAdding={isAdding === 'instruction'}
          newText={newText}
          onStartAdd={() => setIsAdding('instruction')}
          onCancel={() => {
            setIsAdding(null);
            setNewText('');
          }}
          onTextChange={setNewText}
          onSubmit={handleAddSubmit}
          onDelete={onDelete}
          emptyText="Add standing instructions that should guide responses and behavior."
        />
      </div>
    </div>
  );
}

function ContextSection({
  title,
  addLabel,
  type,
  notes,
  isAdding,
  newText,
  onStartAdd,
  onCancel,
  onTextChange,
  onSubmit,
  onDelete,
  emptyText,
}: {
  title: string;
  addLabel: string;
  type: 'bio' | 'instruction';
  notes: Fact[];
  isAdding: boolean;
  newText: string;
  onStartAdd: () => void;
  onCancel: () => void;
  onTextChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onDelete: (id: string, type: 'bio' | 'instruction') => Promise<void>;
  emptyText: string;
}) {
  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[1.35rem] font-semibold text-theme-fg">{title}</h2>

        <button
          onClick={onStartAdd}
          className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg shadow-sm transition-all hover:opacity-90"
        >
          <PlusIcon />
          <span>{addLabel}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3 xl:grid-cols-4">
        {isAdding && (
          <ComposerCard
            value={newText}
            placeholder={type === 'bio' ? 'Type your note...' : 'Type instruction...'}
            onCancel={onCancel}
            onChange={onTextChange}
            onSubmit={onSubmit}
          />
        )}

        {notes.map((note, index) => (
          <ContextCard
            key={note.id}
            note={note}
            index={index}
            onDelete={() => onDelete(note.id, type)}
          />
        ))}

        {!isAdding && notes.length === 0 && (
          <div className="rounded-[24px] bg-theme-card px-5 py-6 text-sm text-theme-muted shadow-sm">
            {emptyText}
          </div>
        )}
      </div>
    </section>
  );
}

function ProfileCard({ note, index }: { note: Fact; index: number }) {
  const rotation = [-0.8, 0.6, -0.35][index % 3];

  return (
    <div
      className="memory-context-card group relative overflow-hidden rounded-[24px] px-5 py-5 shadow-sm transition-all hover:scale-[1.01] hover:shadow-md"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-primary/50" />
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
          {note.attribute_key || 'Profile'}
        </div>
        <div className="text-[11px] font-medium text-theme-muted">
          {formatContextDate(note.created_at)}
        </div>
      </div>
      <p className="text-[15px] leading-8 text-theme-fg">{note.text}</p>
    </div>
  );
}

function ComposerCard({
  value,
  placeholder,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
}) {
  return (
    <div className="memory-context-card rounded-[24px] px-5 py-5 shadow-sm">
      <textarea
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="memory-context-scrollbar min-h-[170px] w-full resize-none bg-transparent text-[15px] leading-7 text-theme-fg outline-none placeholder:text-theme-muted"
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void onSubmit();
          }
        }}
      />

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-theme-hover text-theme-muted transition-colors hover:bg-theme-bg hover:text-theme-fg"
        >
          <Cross2Icon className="h-4 w-4" />
        </button>
        <button
          onClick={() => void onSubmit()}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary transition-colors hover:bg-primary/18"
        >
          <CheckIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ContextCard({ note, index, onDelete }: { note: Fact; index: number; onDelete: () => void }) {
  const { title, body } = splitNoteText(note.text);
  const rotation = [0.9, -0.7, 0.45, -0.35][index % 4];

  return (
    <div
      className="memory-context-card group relative min-h-[260px] rounded-[24px] px-5 py-5 shadow-sm transition-all hover:scale-[1.015] hover:shadow-md"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <div className="absolute inset-x-0 top-0 h-1 rounded-t-[24px] bg-primary/80" />
      <button
        onClick={onDelete}
        className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-theme-hover text-theme-muted opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
      >
        <TrashIcon className="h-4 w-4" />
      </button>

      <div className="flex h-full flex-col">
        <h3 className="pr-10 pt-3 text-[1.05rem] font-semibold leading-7 text-theme-fg">
          {title}
        </h3>
        <p className="memory-context-scrollbar mt-4 flex-1 overflow-y-auto pr-1 text-[15px] leading-8 text-theme-fg">
          {body}
        </p>
        <div className="mt-5 text-[12px] font-medium text-theme-muted">
          {formatContextDate(note.created_at)}
        </div>
      </div>
    </div>
  );
}
