/**
 * CronEditor - User-friendly cron expression editor
 *
 * Provides a visual interface for editing cron expressions with:
 * - Time picker (hour/minute/AM-PM) for specific times
 * - Interval inputs for "every X hours/minutes"
 * - Day/week/month selectors
 * - Raw mode for advanced users
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Clock, ChevronDown, Check, Calendar, Timer, RefreshCw, Code2 } from 'lucide-react';

interface CronEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const DAY_OF_MONTH_OPTIONS = [
  { value: '*', label: 'Every day' },
  { value: '1', label: '1st' },
  { value: '2', label: '2nd' },
  { value: '3', label: '3rd' },
  { value: '5', label: '5th' },
  { value: '10', label: '10th' },
  { value: '15', label: '15th' },
  { value: '20', label: '20th' },
  { value: '25', label: '25th' },
  { value: '1,15', label: '1st and 15th' },
  { value: '1-7', label: 'First week (1-7)' },
  { value: '8-14', label: 'Second week (8-14)' },
  { value: '15-21', label: 'Third week (15-21)' },
  { value: '22-28', label: 'Fourth week (22-28)' },
  { value: 'L', label: 'Last day of month' },
];

const MONTH_OPTIONS = [
  { value: '*', label: 'Every month' },
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
  { value: '1,4,7,10', label: 'Quarterly (Jan, Apr, Jul, Oct)' },
  { value: '1-3', label: 'Q1 (Jan-Mar)' },
  { value: '4-6', label: 'Q2 (Apr-Jun)' },
  { value: '7-9', label: 'Q3 (Jul-Sep)' },
  { value: '10-12', label: 'Q4 (Oct-Dec)' },
];

const DAY_OF_WEEK_OPTIONS = [
  { value: '*', label: 'Every day' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
  { value: '1-5', label: 'Weekdays (Mon-Fri)' },
  { value: '0,6', label: 'Weekends (Sat-Sun)' },
  { value: '1,3,5', label: 'Mon, Wed, Fri' },
  { value: '2,4', label: 'Tue, Thu' },
];

// Parse cron expression into parts
function parseCron(cron: string): { minute: string; hour: string; dayOfMonth: string; month: string; dayOfWeek: string } {
  const parts = (cron || '* * * * *').trim().split(/\s+/);
  return {
    minute: parts[0] || '*',
    hour: parts[1] || '*',
    dayOfMonth: parts[2] || '*',
    month: parts[3] || '*',
    dayOfWeek: parts[4] || '*',
  };
}

// Build cron from parts
function buildCron(parts: { minute: string; hour: string; dayOfMonth: string; month: string; dayOfWeek: string }): string {
  return `${parts.minute} ${parts.hour} ${parts.dayOfMonth} ${parts.month} ${parts.dayOfWeek}`;
}

// Human-readable description of cron expression
function describeCron(cron: string): string {
  const parts = parseCron(cron);
  const { minute, hour, dayOfMonth, month, dayOfWeek } = parts;

  let description = 'Runs ';

  // Time part
  if (minute === '*' && hour === '*') {
    description += 'every minute';
  } else if (minute.startsWith('*/')) {
    const interval = minute.slice(2);
    if (hour === '*') {
      description += `every ${interval} minutes`;
    } else if (hour.startsWith('*/')) {
      const hourInterval = hour.slice(2);
      description += `every ${interval} minutes, every ${hourInterval} hours`;
    } else {
      description += `every ${interval} minutes at hour ${hour}`;
    }
  } else if (hour.startsWith('*/')) {
    const interval = hour.slice(2);
    if (minute === '0') {
      description += `every ${interval} hours`;
    } else {
      description += `every ${interval} hours at minute ${minute}`;
    }
  } else if (hour === '*') {
    description += `at minute ${minute} of every hour`;
  } else if (minute === '0') {
    if (hour.includes('-')) {
      const [start, end] = hour.split('-');
      description += `every hour from ${formatHour(start)} to ${formatHour(end)}`;
    } else {
      description += `at ${formatHour(hour)}`;
    }
  } else {
    description += `at ${formatHourMinute(hour, minute)}`;
  }

  // Day part
  if (dayOfMonth !== '*' || dayOfWeek !== '*') {
    if (dayOfWeek !== '*') {
      description += ` on ${formatDayOfWeek(dayOfWeek)}`;
    }
    if (dayOfMonth !== '*') {
      if (dayOfWeek !== '*') {
        description += ' and';
      }
      description += ` on day ${dayOfMonth} of the month`;
    }
  }

  // Month part
  if (month !== '*') {
    description += ` in ${formatMonth(month)}`;
  }

  return description;
}

function formatHour(h: string): string {
  const hour = parseInt(h, 10);
  if (isNaN(hour)) return h;
  if (hour === 0) return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  if (hour > 12) return `${hour - 12}:00 PM`;
  return `${hour}:00 AM`;
}

function formatHourMinute(h: string, m: string): string {
  const hour = parseInt(h, 10);
  const minute = parseInt(m, 10);
  if (isNaN(hour)) return `${h}:${m}`;
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${displayHour}:${String(minute).padStart(2, '0')} ${ampm}`;
}

function formatDayOfWeek(d: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (d === '1-5') return 'weekdays';
  if (d === '0,6') return 'weekends';
  if (d === '1,3,5') return 'Mon, Wed, Fri';
  if (d === '2,4') return 'Tue, Thu';
  const num = parseInt(d, 10);
  return isNaN(num) ? d : (days[num] || d);
}

function formatMonth(m: string): string {
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (m.includes(',')) return m.split(',').map(formatMonth).join(', ');
  if (m.includes('-')) {
    const [start, end] = m.split('-');
    return `${months[parseInt(start, 10)] || start} to ${months[parseInt(end, 10)] || end}`;
  }
  const num = parseInt(m, 10);
  return isNaN(num) ? m : (months[num] || m);
}

// Dropdown component for cron fields
function CronFieldSelect({
  label,
  value,
  options,
  onChange,
  allowCustom = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const selectedOption = options.find(o => o.value === value);
  const displayLabel = selectedOption?.label || value;

  return (
    <div className="relative">
      <label className="block text-[10px] font-semibold text-theme-muted uppercase tracking-wider mb-1.5">{label}</label>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 text-sm border border-theme rounded-lg bg-theme-card hover:bg-theme-hover flex items-center justify-between gap-2 transition-all shadow-sm text-left"
      >
        <span className="truncate text-theme-fg font-medium">{displayLabel}</span>
        <ChevronDown className={`w-4 h-4 text-theme-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 w-full mt-1 bg-theme-card border border-theme rounded-lg shadow-xl max-h-56 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150">
            {allowCustom && (
              <div className="p-2 border-b border-theme sticky top-0 bg-theme-card">
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    placeholder="Custom value..."
                    className="flex-1 px-2 py-1.5 text-xs font-mono border border-theme rounded bg-theme-card text-theme-fg placeholder:text-theme-muted focus:outline-none focus:ring-1 focus:ring-indigo-200"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (customInput.trim()) {
                        onChange(customInput.trim());
                        setOpen(false);
                        setCustomInput('');
                      }
                    }}
                    className="px-2 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700"
                  >
                    Set
                  </button>
                </div>
              </div>
            )}
            {options.map(opt => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors ${
                  opt.value === value
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-theme-fg hover:bg-theme-hover'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {opt.value === value && <Check className="w-4 h-4 text-primary shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Simple dropdown for AM/PM
function AmPmSelect({ value, onChange }: { value: 'AM' | 'PM'; onChange: (v: 'AM' | 'PM') => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2.5 text-sm border border-theme rounded-lg bg-theme-card hover:bg-theme-hover flex items-center justify-between gap-1 transition-all shadow-sm font-medium text-theme-fg"
      >
        {value}
        <ChevronDown className={`w-3.5 h-3.5 text-theme-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 w-full mt-1 bg-theme-card border border-theme rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
            {(['AM', 'PM'] as const).map(opt => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false); }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between transition-colors ${
                  opt === value ? 'bg-primary/10 text-primary font-medium' : 'text-theme-fg hover:bg-theme-hover'
                }`}
              >
                {opt}
                {opt === value && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Schedule type selector
type ScheduleType = 'specific' | 'interval';

export function CronEditor({ value, onChange }: CronEditorProps) {
  const [mode, setMode] = useState<'builder' | 'raw'>('builder');
  const [customValue, setCustomValue] = useState(value || '* * * * *');

  // Builder state
  const [scheduleType, setScheduleType] = useState<ScheduleType>('interval');

  // Specific time state (12-hour format)
  const [hour12, setHour12] = useState(9);
  const [minute, setMinute] = useState(0);
  const [ampm, setAmpm] = useState<'AM' | 'PM'>('AM');

  // Interval state
  const [everyMinutes, setEveryMinutes] = useState(5);
  const [everyHours, setEveryHours] = useState(1);
  const [intervalMode, setIntervalMode] = useState<'minutes' | 'hours'>('minutes');

  const parts = useMemo(() => parseCron(value || '* * * * *'), [value]);
  const description = useMemo(() => describeCron(value || '* * * * *'), [value]);

  // Parse existing value into builder state
  useEffect(() => {
    const { minute: cronMin, hour: cronHour } = parts;

    // Check if it's an interval pattern
    if (cronMin.startsWith('*/')) {
      setScheduleType('interval');
      setIntervalMode('minutes');
      setEveryMinutes(parseInt(cronMin.slice(2), 10) || 5);
    } else if (cronHour.startsWith('*/')) {
      setScheduleType('interval');
      setIntervalMode('hours');
      setEveryHours(parseInt(cronHour.slice(2), 10) || 1);
    } else if (cronMin !== '*' && cronHour !== '*') {
      // Specific time
      setScheduleType('specific');
      const hourNum = parseInt(cronHour, 10);
      const minNum = parseInt(cronMin, 10);
      if (!isNaN(hourNum) && !isNaN(minNum)) {
        setMinute(minNum);
        if (hourNum === 0) {
          setHour12(12);
          setAmpm('AM');
        } else if (hourNum === 12) {
          setHour12(12);
          setAmpm('PM');
        } else if (hourNum > 12) {
          setHour12(hourNum - 12);
          setAmpm('PM');
        } else {
          setHour12(hourNum);
          setAmpm('AM');
        }
      }
    }
  }, []);

  // Convert 12-hour to 24-hour
  const to24Hour = useCallback((h12: number, period: 'AM' | 'PM'): number => {
    if (period === 'AM') {
      return h12 === 12 ? 0 : h12;
    } else {
      return h12 === 12 ? 12 : h12 + 12;
    }
  }, []);

  // Update cron when specific time changes
  const updateSpecificTime = useCallback((newHour12: number, newMinute: number, newAmpm: 'AM' | 'PM') => {
    const hour24 = to24Hour(newHour12, newAmpm);
    const newParts = { ...parts, minute: String(newMinute), hour: String(hour24) };
    onChange(buildCron(newParts));
  }, [parts, onChange, to24Hour]);

  // Update cron when interval changes
  const updateInterval = useCallback((minutes: number | null, hours: number | null) => {
    let newParts = { ...parts };
    if (minutes !== null) {
      newParts.minute = `*/${minutes}`;
      newParts.hour = '*';
    } else if (hours !== null) {
      newParts.minute = '0';
      newParts.hour = `*/${hours}`;
    }
    onChange(buildCron(newParts));
  }, [parts, onChange]);

  const updatePart = useCallback((key: keyof typeof parts, newValue: string) => {
    const newParts = { ...parts, [key]: newValue };
    onChange(buildCron(newParts));
  }, [parts, onChange]);

  const handleRawChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomValue(e.target.value);
  }, []);

  const applyRaw = useCallback(() => {
    const trimmed = customValue.trim();
    if (trimmed.split(/\s+/).length >= 5) {
      onChange(trimmed.split(/\s+/).slice(0, 5).join(' '));
    }
  }, [customValue, onChange]);

  // Handle hour input change with validation
  const handleHourChange = (val: string) => {
    const num = parseInt(val, 10);
    if (val === '' || (num >= 1 && num <= 12)) {
      setHour12(val === '' ? 1 : num);
      if (val !== '') {
        updateSpecificTime(num, minute, ampm);
      }
    }
  };

  // Handle minute input change with validation
  const handleMinuteChange = (val: string) => {
    const num = parseInt(val, 10);
    if (val === '' || (num >= 0 && num <= 59)) {
      setMinute(val === '' ? 0 : num);
      if (val !== '') {
        updateSpecificTime(hour12, num, ampm);
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode tabs - just builder and advanced */}
      <div className="flex gap-1 p-1 bg-theme-hover border border-theme rounded-xl">
        <button
          onClick={() => setMode('builder')}
          className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            mode === 'builder'
              ? 'bg-theme-card text-theme-fg shadow-sm border border-theme'
              : 'text-theme-muted hover:text-theme-fg'
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          Visual Builder
        </button>
        <button
          onClick={() => { setMode('raw'); setCustomValue(value || '* * * * *'); }}
          className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            mode === 'raw'
              ? 'bg-theme-card text-theme-fg shadow-sm border border-theme'
              : 'text-theme-muted hover:text-theme-fg'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          Cron Expression
        </button>
      </div>

      {/* Builder mode */}
      {mode === 'builder' && (
        <div className="space-y-4">
          {/* Schedule Type Toggle */}
          <div>
            <label className="block text-[10px] font-semibold text-theme-muted uppercase tracking-wider mb-2">Time</label>
            <div className="flex gap-2 p-1 bg-theme-hover border border-theme rounded-lg">
              <button
                onClick={() => {
                  setScheduleType('interval');
                  if (intervalMode === 'minutes') {
                    updateInterval(everyMinutes, null);
                  } else {
                    updateInterval(null, everyHours);
                  }
                }}
                className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                  scheduleType === 'interval'
                    ? 'bg-theme-card text-primary shadow-sm border border-theme'
                    : 'text-theme-muted hover:text-theme-fg'
                }`}
              >
                <Timer className="w-3.5 h-3.5" />
                Every X Time
              </button>
              <button
                onClick={() => {
                  setScheduleType('specific');
                  updateSpecificTime(hour12, minute, ampm);
                }}
                className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                  scheduleType === 'specific'
                    ? 'bg-theme-card text-primary shadow-sm border border-theme'
                    : 'text-theme-muted hover:text-theme-fg'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                At Specific Time
              </button>
            </div>
          </div>

          {/* Interval Picker */}
          {scheduleType === 'interval' && (
            <div className="p-4 bg-theme-card rounded-xl border border-theme space-y-4 shadow-sm">
              {/* Interval mode toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setIntervalMode('minutes');
                    updateInterval(everyMinutes, null);
                  }}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-all ${
                    intervalMode === 'minutes'
                      ? 'bg-primary/10 border-primary/20 text-primary'
                      : 'bg-theme-card border-theme text-theme-muted hover:bg-theme-hover hover:text-theme-fg'
                  }`}
                >
                  Minutes
                </button>
                <button
                  onClick={() => {
                    setIntervalMode('hours');
                    updateInterval(null, everyHours);
                  }}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-all ${
                    intervalMode === 'hours'
                      ? 'bg-primary/10 border-primary/20 text-primary'
                      : 'bg-theme-card border-theme text-theme-muted hover:bg-theme-hover hover:text-theme-fg'
                  }`}
                >
                  Hours
                </button>
              </div>

              {/* Interval input */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-theme-muted font-medium">Every</span>
                {intervalMode === 'minutes' ? (
                  <>
                    <input
                      type="number"
                      min={1}
                      max={59}
                      value={everyMinutes}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (val >= 1 && val <= 59) {
                          setEveryMinutes(val);
                          updateInterval(val, null);
                        }
                      }}
                      className="w-20 px-3 py-2.5 text-center text-lg font-semibold border border-theme rounded-lg bg-theme-card text-theme-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all shadow-sm"
                    />
                    <span className="text-sm text-theme-muted font-medium">minutes</span>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      min={1}
                      max={23}
                      value={everyHours}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (val >= 1 && val <= 23) {
                          setEveryHours(val);
                          updateInterval(null, val);
                        }
                      }}
                      className="w-20 px-3 py-2.5 text-center text-lg font-semibold border border-theme rounded-lg bg-theme-card text-theme-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all shadow-sm"
                    />
                    <span className="text-sm text-theme-muted font-medium">hours</span>
                  </>
                )}
              </div>

              {/* Quick interval buttons */}
              <div className="flex flex-wrap gap-2 pt-3 border-t border-theme">
                {intervalMode === 'minutes' ? (
                  <>
                    {[1, 2, 5, 10, 15, 20, 30, 45].map(m => (
                      <button
                        key={m}
                        onClick={() => {
                          setEveryMinutes(m);
                          updateInterval(m, null);
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                          everyMinutes === m
                            ? 'bg-primary/10 border-primary/20 text-primary'
                            : 'bg-theme-card border-theme text-theme-muted hover:bg-theme-hover hover:text-theme-fg'
                        }`}
                      >
                        {m} min
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    {[1, 2, 3, 4, 6, 8, 12].map(h => (
                      <button
                        key={h}
                        onClick={() => {
                          setEveryHours(h);
                          updateInterval(null, h);
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                          everyHours === h
                            ? 'bg-primary/10 border-primary/20 text-primary'
                            : 'bg-theme-card border-theme text-theme-muted hover:bg-theme-hover hover:text-theme-fg'
                        }`}
                      >
                        {h} hr
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Specific Time Picker */}
          {scheduleType === 'specific' && (
            <div className="p-4 bg-theme-card rounded-xl border border-theme space-y-4 shadow-sm">
              <div className="flex items-center gap-3">
                {/* Hour input */}
                <div className="flex flex-col items-center">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={hour12}
                    onChange={(e) => handleHourChange(e.target.value)}
                    className="w-16 px-3 py-2.5 text-center text-lg font-semibold border border-theme rounded-lg bg-theme-card text-theme-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all shadow-sm"
                  />
                  <span className="text-[10px] text-theme-muted mt-1">Hour</span>
                </div>

                <span className="text-2xl font-bold text-theme-muted mb-4">:</span>

                {/* Minute input */}
                <div className="flex flex-col items-center">
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={String(minute).padStart(2, '0')}
                    onChange={(e) => handleMinuteChange(e.target.value)}
                    className="w-16 px-3 py-2.5 text-center text-lg font-semibold border border-theme rounded-lg bg-theme-card text-theme-fg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all shadow-sm"
                  />
                  <span className="text-[10px] text-theme-muted mt-1">Minute</span>
                </div>

                {/* AM/PM dropdown */}
                <div className="w-20 mb-4">
                  <AmPmSelect
                    value={ampm}
                    onChange={(v) => {
                      setAmpm(v);
                      updateSpecificTime(hour12, minute, v);
                    }}
                  />
                </div>
              </div>

              {/* Quick time buttons */}
              <div className="flex flex-wrap gap-2 pt-3 border-t border-theme">
                {[
                  { h: 6, m: 0, p: 'AM' as const, label: '6:00 AM' },
                  { h: 8, m: 0, p: 'AM' as const, label: '8:00 AM' },
                  { h: 9, m: 0, p: 'AM' as const, label: '9:00 AM' },
                  { h: 12, m: 0, p: 'PM' as const, label: '12:00 PM' },
                  { h: 3, m: 0, p: 'PM' as const, label: '3:00 PM' },
                  { h: 5, m: 0, p: 'PM' as const, label: '5:00 PM' },
                  { h: 6, m: 0, p: 'PM' as const, label: '6:00 PM' },
                  { h: 9, m: 0, p: 'PM' as const, label: '9:00 PM' },
                  { h: 12, m: 0, p: 'AM' as const, label: '12:00 AM' },
                ].map(t => {
                  const isSelected = hour12 === t.h && minute === t.m && ampm === t.p;
                  return (
                    <button
                      key={t.label}
                      onClick={() => {
                        setHour12(t.h);
                        setMinute(t.m);
                        setAmpm(t.p);
                        updateSpecificTime(t.h, t.m, t.p);
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                        isSelected
                          ? 'bg-primary/10 border-primary/20 text-primary'
                          : 'bg-theme-card border-theme text-theme-muted hover:bg-theme-hover hover:text-theme-fg'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Day/Month options */}
          <div className="grid grid-cols-3 gap-3">
            <CronFieldSelect
              label="Day of Week"
              value={parts.dayOfWeek}
              options={DAY_OF_WEEK_OPTIONS}
              onChange={(v) => updatePart('dayOfWeek', v)}
              allowCustom
            />
            <CronFieldSelect
              label="Day of Month"
              value={parts.dayOfMonth}
              options={DAY_OF_MONTH_OPTIONS}
              onChange={(v) => updatePart('dayOfMonth', v)}
              allowCustom
            />
            <CronFieldSelect
              label="Month"
              value={parts.month}
              options={MONTH_OPTIONS}
              onChange={(v) => updatePart('month', v)}
              allowCustom
            />
          </div>
        </div>
      )}

      {/* Raw mode */}
      {mode === 'raw' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={customValue}
              onChange={handleRawChange}
              onBlur={applyRaw}
              onKeyDown={(e) => e.key === 'Enter' && applyRaw()}
              placeholder="* * * * *"
              className="flex-1 px-4 py-2.5 text-sm font-mono border border-theme rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all bg-theme-card text-theme-fg placeholder:text-theme-muted shadow-sm"
            />
            <button
              onClick={applyRaw}
              className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors"
            >
              Apply
            </button>
          </div>
          <div className="text-xs text-theme-muted bg-theme-card rounded-lg p-3 font-mono border border-theme">
            <div className="grid grid-cols-5 gap-2 text-center">
              <span>minute</span>
              <span>hour</span>
              <span>day</span>
              <span>month</span>
              <span>weekday</span>
            </div>
            <div className="grid grid-cols-5 gap-2 text-center text-theme-muted mt-1">
              <span>0-59</span>
              <span>0-23</span>
              <span>1-31</span>
              <span>1-12</span>
              <span>0-6</span>
            </div>
            <div className="mt-3 pt-3 border-t border-theme text-theme-muted space-y-1">
              <div><code>*</code> = every</div>
              <div><code>*/5</code> = every 5</div>
              <div><code>1,3,5</code> = specific values</div>
              <div><code>1-5</code> = range</div>
            </div>
          </div>
        </div>
      )}

      {/* Preview */}
      <div className="flex items-center gap-2 p-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 rounded-xl border border-amber-200 dark:border-amber-500/20">
        <RefreshCw className="w-4 h-4 text-amber-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-amber-900 dark:text-amber-100">{description}</div>
          <div className="text-xs text-amber-700/80 dark:text-amber-200/80 font-mono mt-0.5">{value || '* * * * *'}</div>
        </div>
      </div>
    </div>
  );
}

