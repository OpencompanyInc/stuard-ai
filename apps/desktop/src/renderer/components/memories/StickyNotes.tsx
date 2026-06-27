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
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatAttributeKey(key?: string) {
  if (!key) return 'Profile';
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
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
    <div className="memory-context-scrollbar h-full overflow-y-auto px-5 pb-10 pt-2 md:px-8">
      <div className="mx-auto max-w-3xl space-y-10">
        {profileNotes.length > 0 && (
          <ProfileSection notes={profileNotes} />
        )}

        <ContextSection
          title="About You"
          description="Preferences, work, goals, and personal context."
          addLabel="Add note"
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
          emptyText="No notes yet."
        />

        <ContextSection
          title="System Instructions"
          description="Standing instructions that guide responses and behavior."
          addLabel="Add instruction"
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
          emptyText="No instructions yet."
        />
      </div>
    </div>
  );
}

function ProfileSection({ notes }: { notes: Fact[] }) {
  return (
    <section className="space-y-3">
      <SectionHeader title="Profile" description="Core identity facts Stuard knows about you." />

      <div className="overflow-hidden rounded-2xl border border-theme bg-theme-card shadow-sm">
        {notes.map((note, index) => (
          <div
            key={note.id}
            className={
              'flex items-baseline gap-4 px-5 py-3.5 ' +
              (index !== 0 ? 'border-t border-theme' : '')
            }
          >
            <div className="w-32 flex-none text-[12px] font-medium uppercase tracking-wide text-theme-muted">
              {formatAttributeKey(note.attribute_key)}
            </div>
            <div className="min-w-0 flex-1 text-[14px] leading-6 text-theme-fg">
              {note.text}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 pb-1">
      <div className="min-w-0">
        <h2 className="text-[1.05rem] font-semibold tracking-tight text-theme-fg">{title}</h2>
        {description && (
          <p className="mt-0.5 text-[13px] text-theme-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function ContextSection({
  title,
  description,
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
  description: string;
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
    <section className="space-y-3">
      <SectionHeader
        title={title}
        description={description}
        action={
          !isAdding ? (
            <button
              onClick={onStartAdd}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-theme bg-theme-card px-3.5 text-[13px] font-medium text-theme-fg shadow-sm transition-colors hover:bg-theme-hover"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span>{addLabel}</span>
            </button>
          ) : null
        }
      />

      <div className="space-y-2">
        {isAdding && (
          <Composer
            value={newText}
            placeholder={
              type === 'bio'
                ? 'e.g. I prefer concise answers without filler text.'
                : 'e.g. Always cite file paths when referencing code.'
            }
            onCancel={onCancel}
            onChange={onTextChange}
            onSubmit={onSubmit}
          />
        )}

        {notes.length === 0 && !isAdding && (
          <div className="rounded-2xl border border-dashed border-theme px-5 py-6 text-center text-[13px] text-theme-muted">
            {emptyText}
          </div>
        )}

        {notes.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-theme bg-theme-card shadow-sm">
            {notes.map((note, index) => (
              <NoteRow
                key={note.id}
                note={note}
                isFirst={index === 0}
                onDelete={() => onDelete(note.id, type)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function NoteRow({
  note,
  isFirst,
  onDelete,
}: {
  note: Fact;
  isFirst: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      className={
        'group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-theme-hover/40 ' +
        (isFirst ? '' : 'border-t border-theme')
      }
    >
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-[14px] leading-6 text-theme-fg">{note.text}</p>
        <div className="mt-1.5 text-[11px] text-theme-muted">
          {formatContextDate(note.created_at)}
        </div>
      </div>
      <button
        onClick={onDelete}
        className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg text-theme-muted opacity-0 transition-all hover:bg-theme-hover hover:text-red-400 group-hover:opacity-100"
        aria-label="Delete"
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function Composer({
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
    <div className="rounded-2xl border border-theme bg-theme-card px-4 py-3 shadow-sm">
      <textarea
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="memory-context-scrollbar min-h-[88px] w-full resize-none bg-transparent text-[14px] leading-6 text-theme-fg outline-none placeholder:text-theme-muted"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void onSubmit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="text-[11px] text-theme-muted">
          ⌘/Ctrl + Enter to save · Esc to cancel
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={onCancel}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-medium text-theme-muted transition-colors hover:bg-theme-hover hover:text-theme-fg"
          >
            <Cross2Icon className="h-3.5 w-3.5" />
            Cancel
          </button>
          <button
            onClick={() => void onSubmit()}
            disabled={!value.trim()}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <CheckIcon className="h-3.5 w-3.5" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
