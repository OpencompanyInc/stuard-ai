import React, { useEffect, useMemo, useState } from 'react';

type ViewMode = 'month' | 'day' | 'list';

interface Recurrence {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  days?: number[]; // 0=Mon, 6=Sun
}

export function PlannerPanel({ AGENT_HTTP }: { AGENT_HTTP: string }) {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState<string>('');
  const [newTaskPriority, setNewTaskPriority] = useState('normal');
  const [status, setStatus] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const [newReminderMessage, setNewReminderMessage] = useState('');
  const [newReminderWhen, setNewReminderWhen] = useState<string>('');

  // Recurrence State
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceFreq, setRecurrenceFreq] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]); // 0=Mon

  const firstOkJson = async (urls: string[]) => {
    for (const u of urls) {
      try {
        const resp = await fetch(u);
        if (!resp.ok) continue;
        const j = await resp.json().catch(() => null);
        if (j && typeof j === 'object') return j;
      } catch {}
    }
    return { ok: false } as any;
  };

  const postJson = async (urls: string[], body: any) => {
    for (const u of urls) {
      try {
        const resp = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await resp.json().catch(() => null);
        if (resp.ok && j && typeof j === 'object') return j;
      } catch {}
    }
    return { ok: false } as any;
  };

  const loadTasks = async () => {
    const j = await firstOkJson([`${AGENT_HTTP}/v1/tasks/list`, `${AGENT_HTTP}/tasks/list`]);
    if (j?.ok) {
      const items = Array.isArray(j.items) ? j.items : [];
      setTasks(items);
    }
  };

  const loadReminders = async () => {
    const j = await firstOkJson([`${AGENT_HTTP}/v1/reminders/list`, `${AGENT_HTTP}/reminders/list`]);
    if (j?.ok) {
      const items = Array.isArray(j.items) ? j.items : [];
      setReminders(items);
    }
  };

  useEffect(() => {
    setLoading(true);
    (async () => {
      await Promise.all([loadTasks(), loadReminders()]);
    })().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      loadTasks();
      loadReminders();
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const getRecurrencePayload = () => {
    if (!recurrenceEnabled) return null;
    const r: Recurrence = { frequency: recurrenceFreq, interval: 1 };
    if (recurrenceFreq === 'weekly' && recurrenceDays.length > 0) {
      r.days = recurrenceDays;
    }
    return r;
  };

  const createTask = async () => {
    if (!newTaskTitle.trim()) return;
    setStatus('Creating task…');
    const payload: any = { title: newTaskTitle.trim(), priority: newTaskPriority };
    if (newTaskDue) payload.due = newTaskDue;
    
    const rec = getRecurrencePayload();
    if (rec) payload.recurrence = rec;

    const j = await postJson([`${AGENT_HTTP}/v1/tasks/create`, `${AGENT_HTTP}/tasks/create`], payload);
    if (j?.ok) {
      setNewTaskTitle('');
      setNewTaskDue('');
      setNewTaskPriority('normal');
      setRecurrenceEnabled(false);
      setRecurrenceDays([]);
      await loadTasks();
      setStatus('Task created');
    } else {
      setStatus('Failed to create task');
    }
  };

  const updateTask = async (task: any, changes: any) => {
    const payload = { id: task.id, ...changes };
    const j = await postJson([`${AGENT_HTTP}/v1/tasks/update`, `${AGENT_HTTP}/tasks/update`], payload);
    if (j?.ok) await loadTasks();
  };

  const deleteTask = async (taskId: string) => {
    const j = await postJson([`${AGENT_HTTP}/v1/tasks/delete`, `${AGENT_HTTP}/tasks/delete`], { id: taskId });
    if (j?.ok) await loadTasks();
  };

  const scheduleReminder = async (when: string | number, message: string, taskId?: string, recurrence?: any) => {
    const payload: any = { when, message };
    if (taskId) payload.taskId = taskId;
    if (recurrence) payload.recurrence = recurrence;
    
    const j = await postJson([`${AGENT_HTTP}/v1/reminders/schedule`, `${AGENT_HTTP}/reminders/schedule`], payload);
    if (j?.ok) {
      setStatus(`Reminder set (${j.scheduledInSeconds ?? 'n/a'}s)`);
      await loadReminders();
    } else setStatus('Failed to schedule reminder');
  };

  const createReminder = async () => {
    const msg = newReminderMessage.trim() || 'Reminder';
    if (!newReminderWhen) {
      setStatus('Please pick a reminder time');
      return;
    }
    setStatus('Scheduling reminder…');
    const when = String(newReminderWhen);
    const rec = getRecurrencePayload();
    await scheduleReminder(when, msg, undefined, rec);
    setNewReminderMessage('');
    setNewReminderWhen('');
    setRecurrenceEnabled(false);
    setRecurrenceDays([]);
  };

  // Calendar utilities
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const days: Array<{ date: number | null; fullDate: Date | null }> = [];
    
    for (let i = 0; i < firstDay; i++) {
      days.push({ date: null, fullDate: null });
    }
    
    for (let date = 1; date <= daysInMonth; date++) {
      days.push({
        date,
        fullDate: new Date(currentDate.getFullYear(), currentDate.getMonth(), date)
      });
    }
    
    return days;
  }, [currentDate]);

  // JS implementation of next occurrence logic
  const calculateNextOccurrence = (last: Date, rec: Recurrence): Date => {
    const next = new Date(last);
    const interval = rec.interval || 1;
    
    if (rec.frequency === 'daily') {
      next.setDate(next.getDate() + interval);
      return next;
    }
    if (rec.frequency === 'weekly') {
       if (rec.days && rec.days.length > 0) {
          // 0=Mon, 6=Sun. JS .getDay() is 0=Sun.
          // Convert JS day to Mon=0
          const currentDayMon0 = (next.getDay() + 6) % 7;
          const sortedDays = [...rec.days].sort((a, b) => a - b);
          const nextDayInWeek = sortedDays.find(d => d > currentDayMon0);
          
          if (nextDayInWeek !== undefined) {
             const delta = nextDayInWeek - currentDayMon0;
             next.setDate(next.getDate() + delta);
             return next;
          } else {
             // Jump to next week first day
             const firstDay = sortedDays[0];
             const delta = (7 - currentDayMon0) + firstDay + (7 * Math.max(0, interval - 1));
             next.setDate(next.getDate() + delta);
             return next;
          }
       } else {
         next.setDate(next.getDate() + (7 * interval));
         return next;
       }
    }
    if (rec.frequency === 'monthly') {
      next.setMonth(next.getMonth() + interval);
      return next;
    }
    return next;
  };

  const expandEvents = (items: any[], start: Date, end: Date, type: 'task' | 'reminder') => {
    const expanded: any[] = [];
    for (const item of items) {
      const baseTime = item.due ? new Date(item.due) : (item.whenIso ? new Date(item.whenIso) : null);
      if (!baseTime) continue;

      // Add base item if in range
      if (baseTime >= start && baseTime < end) {
        expanded.push({ ...item, time: baseTime, type, isBase: true });
      }

      // Expand recurrence
      if (item.recurrence) {
         let curr = new Date(baseTime);
         // Calculate next immediately to avoid duplicating base if it was added
         curr = calculateNextOccurrence(curr, item.recurrence);
         
         // Limit iterations
         let limit = 100;
         while (curr < end && limit > 0) {
           if (curr >= start) {
             expanded.push({ 
               ...item, 
               time: new Date(curr), 
               type, 
               isRecurrence: true, 
               id: item.id + '_' + curr.getTime() 
             });
           }
           curr = calculateNextOccurrence(curr, item.recurrence);
           limit--;
         }
      }
    }
    return expanded;
  };

  const getEventsForRange = (start: Date, end: Date) => {
     const t = expandEvents(tasks, start, end, 'task');
     const r = expandEvents(reminders, start, end, 'reminder');
     return [...t, ...r].sort((a, b) => a.time.getTime() - b.time.getTime());
  };

  // Memoized events for current Month view (to show dots/lists in cells)
  // We calculate for the whole month range
  const monthEventsMap = useMemo(() => {
     const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
     const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
     const evts = getEventsForRange(start, end);
     
     const map: Record<string, any[]> = {};
     for (const e of evts) {
        const key = `${e.time.getFullYear()}-${String(e.time.getMonth() + 1).padStart(2, '0')}-${String(e.time.getDate()).padStart(2, '0')}`;
        if (!map[key]) map[key] = [];
        map[key].push(e);
     }
     return map;
  }, [tasks, reminders, currentDate]);

  // For Day view
  const eventsForDay = useMemo(() => {
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
    const end = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1);
    return getEventsForRange(start, end);
  }, [tasks, reminders, currentDate]);

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const isToday = (date: Date | null) => {
    if (!date) return false;
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  };

  const dayName = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const goToPreviousDay = () => { const d = new Date(currentDate); d.setDate(d.getDate() - 1); setCurrentDate(d); };
  const goToNextDay = () => { const d = new Date(currentDate); d.setDate(d.getDate() + 1); setCurrentDate(d); };

  const toggleRecurrenceDay = (d: number) => {
    if (recurrenceDays.includes(d)) setRecurrenceDays(recurrenceDays.filter(x => x !== d));
    else setRecurrenceDays([...recurrenceDays, d]);
  };

  const RecurrenceControls = () => (
    <div className="w-full mt-2 p-2 bg-neutral-50 rounded border border-neutral-100 flex flex-col gap-2">
       <div className="flex items-center gap-2">
         <span className="text-[12px] text-neutral-600">Frequency:</span>
         <select value={recurrenceFreq} onChange={(e) => setRecurrenceFreq(e.target.value as any)} className="text-[12px] px-2 py-1 rounded border border-neutral-200">
           <option value="daily">Daily</option>
           <option value="weekly">Weekly</option>
           <option value="monthly">Monthly</option>
         </select>
       </div>
       {recurrenceFreq === 'weekly' && (
         <div className="flex items-center gap-1 flex-wrap">
           {['M','T','W','T','F','S','S'].map((l, i) => (
             <button 
               key={i} 
               onClick={() => toggleRecurrenceDay(i)}
               className={`w-6 h-6 rounded text-[11px] font-medium border ${recurrenceDays.includes(i) ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-500 border-neutral-200'}`}
             >
               {l}
             </button>
           ))}
         </div>
       )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Planner header and view controls */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-[14px] font-medium text-neutral-900">Planner</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setViewMode('month')} className={`px-3 h-9 rounded-md text-[13px] border ${viewMode === 'month' ? 'bg-neutral-900 text-white border-neutral-900' : 'border-neutral-200 hover:bg-neutral-100'}`}>Month</button>
            <button onClick={() => setViewMode('day')} className={`px-3 h-9 rounded-md text-[13px] border ${viewMode === 'day' ? 'bg-neutral-900 text-white border-neutral-900' : 'border-neutral-200 hover:bg-neutral-100'}`}>Day</button>
            <button onClick={() => setViewMode('list')} className={`px-3 h-9 rounded-md text-[13px] border ${viewMode === 'list' ? 'bg-neutral-900 text-white border-neutral-900' : 'border-neutral-200 hover:bg-neutral-100'}`}>List</button>
          </div>
        </div>
      </div>

      {/* Add task form */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="text-[13px] font-medium text-neutral-900 mb-2">Add Task</div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)} placeholder="Task title" className="px-3 h-9 text-[13px] border border-neutral-200 rounded-md flex-1 min-w-[180px]" />
          <input type="datetime-local" value={newTaskDue} onChange={(e) => setNewTaskDue(e.target.value)} className="px-3 h-9 text-[13px] border border-neutral-200 rounded-md" />
          <select value={newTaskPriority} onChange={(e) => setNewTaskPriority(e.target.value)} className="px-3 h-9 text-[13px] border border-neutral-200 rounded-md">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
          <button onClick={() => setRecurrenceEnabled(!recurrenceEnabled)} className={`px-3 h-9 rounded-md border text-[13px] ${recurrenceEnabled ? 'bg-blue-50 text-blue-700 border-blue-200' : 'border-neutral-200 hover:bg-neutral-50'}`}>Repeat</button>
          <button onClick={createTask} className="px-4 h-9 rounded-md bg-neutral-900 text-white text-[13px] hover:bg-neutral-800">Add Task</button>
        </div>
        {recurrenceEnabled && <RecurrenceControls />}
      </div>

      {/* Add reminder form */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="text-[13px] font-medium text-neutral-900 mb-2">Add Reminder</div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={newReminderMessage} onChange={(e) => setNewReminderMessage(e.target.value)} placeholder="Reminder message" className="px-3 h-9 text-[13px] border border-neutral-200 rounded-md flex-1 min-w-[180px]" />
          <input type="datetime-local" value={newReminderWhen} onChange={(e) => setNewReminderWhen(e.target.value)} className="px-3 h-9 text-[13px] border border-neutral-200 rounded-md" />
          <button onClick={() => setRecurrenceEnabled(!recurrenceEnabled)} className={`px-3 h-9 rounded-md border text-[13px] ${recurrenceEnabled ? 'bg-blue-50 text-blue-700 border-blue-200' : 'border-neutral-200 hover:bg-neutral-50'}`}>Repeat</button>
          <button onClick={createReminder} className="px-4 h-9 rounded-md bg-neutral-900 text-white text-[13px] hover:bg-neutral-800">Add Reminder</button>
        </div>
        {recurrenceEnabled && <RecurrenceControls />}
      </div>

      {viewMode === 'month' ? (
          <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={goToPreviousMonth} className="px-3 h-8 rounded-md border border-neutral-200 hover:bg-neutral-100 text-[13px]">&larr;</button>
                <button onClick={goToToday} className="px-3 h-8 rounded-md border border-neutral-200 hover:bg-neutral-100 text-[13px]">Today</button>
                <button onClick={goToNextMonth} className="px-3 h-8 rounded-md border border-neutral-200 hover:bg-neutral-100 text-[13px]">&rarr;</button>
              </div>
              <div className="text-[15px] font-semibold text-neutral-900">{monthName}</div>
              <div className="text-[12px] text-neutral-500">{loading ? 'Loading…' : status}</div>
            </div>
            <div className="grid grid-cols-7 border-b border-neutral-200">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="px-2 py-2 text-center text-[11px] font-medium text-neutral-500 uppercase tracking-wide border-r border-neutral-200 last:border-r-0">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {calendarDays.map((day, idx) => {
                const dateKey = day.fullDate ? `${day.fullDate.getFullYear()}-${String(day.fullDate.getMonth() + 1).padStart(2, '0')}-${String(day.fullDate.getDate()).padStart(2, '0')}` : '';
                const dayTasks = monthEventsMap[dateKey] || [];
                const today = isToday(day.fullDate);
                return (
                  <div
                    key={idx}
                    className={`min-h-[100px] border-r border-b border-neutral-200 last:border-r-0 p-2 ${day.date ? 'bg-white hover:bg-neutral-50' : 'bg-neutral-50'} ${today ? 'bg-blue-50' : ''}`}
                  >
                    {day.date && (
                      <>
                        <div
                          className={`text-[12px] font-medium mb-1 ${today ? 'text-blue-600' : 'text-neutral-700'}`}
                          onClick={() => { if (day.fullDate) { setCurrentDate(day.fullDate); setViewMode('day'); } }}
                        >
                          {day.date}
                        </div>
                        <div className="space-y-1">
                          {dayTasks.map((item: any) => (
                            <div
                              key={item.id}
                              className={`text-[11px] px-2 py-1 rounded cursor-pointer truncate ${
                                item.completed
                                  ? 'bg-neutral-200 text-neutral-600 line-through'
                                  : item.priority === 'high'
                                  ? 'bg-red-100 text-red-900'
                                  : item.type === 'reminder'
                                  ? 'bg-blue-100 text-blue-900'
                                  : 'bg-neutral-100 text-neutral-700'
                              }`}
                              title={item.title || item.message}
                              onClick={() => {
                                if (item.isRecurrence) return; // Don't edit ghost instances
                                const newTitle = prompt('Edit task:', item.title);
                                if (newTitle !== null && item.type === 'task') updateTask(item, { title: newTitle });
                              }}
                            >
                              {item.recurrence && !item.isRecurrence ? '↻ ' : ''}{item.title || item.message}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : viewMode === 'day' ? (
          <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={goToPreviousDay} className="px-3 h-8 rounded-md border border-neutral-200 hover:bg-neutral-100 text-[13px]">&larr;</button>
                <button onClick={goToToday} className="px-3 h-8 rounded-md border border-neutral-200 hover:bg-neutral-100 text-[13px]">Today</button>
                <button onClick={goToNextDay} className="px-3 h-8 rounded-md border border-neutral-200 hover:bg-neutral-100 text-[13px]">&rarr;</button>
              </div>
              <div className="text-[15px] font-semibold text-neutral-900">{dayName}</div>
              <div className="text-[12px] text-neutral-500">{loading ? 'Loading…' : status}</div>
            </div>
            {eventsForDay.length === 0 ? (
              <div className="text-[13px] text-neutral-500 py-8 text-center">No events for this day.</div>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {eventsForDay.map((e: any) => (
                  <li key={e.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-20 text-[12px] text-neutral-600">{e.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className={`flex-1 text-[13px] ${e.type === 'reminder' ? 'text-blue-900' : 'text-neutral-900'}`}>
                      {e.recurrence && !e.isRecurrence ? '↻ ' : ''}
                      {e.type === 'reminder' ? `Reminder: ${e.title || e.message}` : e.title}
                      {e.isRecurrence && <span className="ml-2 text-neutral-400 text-[10px]">(Recurring)</span>}
                    </div>
                    {e.type === 'task' && !e.isRecurrence ? (
                      <button className="px-2 h-7 text-[12px] rounded border border-neutral-200 hover:bg-neutral-100" onClick={() => scheduleReminder(String(e.time.toISOString()), e.title || 'Task due', e.ref.id)}>Remind at time</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="text-[13px] font-medium text-neutral-900 mb-3">All Tasks</div>
            {tasks.length === 0 ? (
              <div className="text-[13px] text-neutral-500 py-8 text-center">No tasks yet.</div>
            ) : (
              <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 overflow-hidden">
                {tasks.map((t: any) => (
                  <li key={t.id} className="px-3 py-3 bg-white hover:bg-neutral-50">
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={!!t.completed} onChange={(e) => updateTask(t, { completed: e.target.checked })} className="mt-1" />
                      <div className="flex-1">
                        <input
                          className="w-full text-[13px] px-2 py-1 border border-transparent rounded hover:border-neutral-200 focus:outline-none focus:border-neutral-900"
                          value={t.title || ''}
                          onChange={(e) => updateTask(t, { title: e.target.value })}
                        />
                        <div className="text-[12px] text-neutral-500 flex flex-wrap items-center gap-2 mt-1">
                          {t.recurrence && <span className="text-blue-600">Recurring {t.recurrence.frequency}</span>}
                          <span>Priority:</span>
                          <select value={t.priority || 'normal'} onChange={(e) => updateTask(t, { priority: e.target.value })} className="px-2 h-7 text-[12px] border border-neutral-200 rounded">
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                          </select>
                          <span>Due:</span>
                          <input type="datetime-local" value={t.due ? String(t.due).slice(0,16) : ''} onChange={(e) => updateTask(t, { due: e.target.value })} className="px-2 h-7 text-[12px] border border-neutral-200 rounded" />
                          {/* TODO: Implement quickRemindIn - <button className="px-2 h-7 text-[12px] rounded border border-neutral-200 hover:bg-neutral-100" onClick={() => quickRemindIn(900, t)}>Remind 15m</button> */}
                        </div>
                      </div>
                      <button className="px-2 py-1 text-[12px] rounded border border-neutral-200 hover:bg-neutral-100" onClick={() => deleteTask(String(t.id))}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
    </div>
  );
}
