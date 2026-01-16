import React from 'react';
import { clsx } from 'clsx';
import { TrashIcon } from '@radix-ui/react-icons';

interface Fact {
  id: string;
  text: string;
  category: string;
  created_at: string;
}

interface TimelineJourneyProps {
  events: Fact[];
  onDelete: (id: string) => void;
}

export function TimelineJourney({ events, onDelete }: TimelineJourneyProps) {
  // Group by date
  const groupedEvents = events.reduce((acc, event) => {
    const date = new Date(event.created_at).toLocaleDateString('en-US', { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric' 
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(event);
    return acc;
  }, {} as Record<string, Fact[]>);

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="relative">
        {/* Central Line */}
        <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/10 via-primary/40 to-transparent" />

        {Object.entries(groupedEvents).map(([date, dateEvents], dateIdx) => (
          <div key={date} className="mb-12 relative">
            {/* Date Header */}
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 text-right text-xs font-black text-theme-muted uppercase tracking-widest pl-1 font-stuard">
                {date.split(',')[0]}
              </div>
              <div className="relative z-10 w-4 h-4 rounded-full bg-primary shadow-lg ring-4 ring-theme-bg" />
              <div className="text-sm font-black text-theme-fg bg-theme-card border border-theme px-3 py-1 rounded-theme-button shadow-sm font-stuard">
                {date.split(',')[1]}
              </div>
            </div>

            {/* Events List */}
            <div className="space-y-4 pl-20">
              {dateEvents.map((event, idx) => (
                <div 
                  key={event.id}
                  className="group relative bg-theme-card p-5 rounded-theme-card border border-theme shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5"
                >
                  {/* Connector Line to Main Timeline */}
                  <div className="absolute top-7 -left-12 w-12 h-px bg-theme-border opacity-50" />
                  <div className="absolute top-7 -left-[49px] w-1.5 h-1.5 rounded-full bg-theme-muted opacity-50" />

                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <p className="text-theme-fg leading-relaxed text-sm font-medium">{event.text}</p>
                      <p className="text-[10px] text-theme-muted mt-3 font-bold tracking-tight uppercase">
                        {new Date(event.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <button
                      onClick={() => onDelete(event.id)}
                      className="opacity-0 group-hover:opacity-100 p-2 text-theme-muted hover:text-red-500 hover:bg-red-500/10 rounded-md transition-all"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        
        {events.length === 0 && (
            <div className="text-center py-24">
                <div className="text-5xl mb-6 opacity-40">🕰️</div>
                <h3 className="text-xl font-stuard font-bold text-theme-fg">Your Journey Begins</h3>
                <p className="text-theme-muted mt-2 font-medium">Events will appear here as you interact with Stuard.</p>
            </div>
        )}
      </div>
    </div>
  );
}
