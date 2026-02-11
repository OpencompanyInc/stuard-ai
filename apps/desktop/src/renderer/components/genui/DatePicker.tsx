import React, { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock } from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';

export interface DatePickerProps {
  label?: string;
  onSelect: (date: Date) => void;
  selectedDate?: Date;
  minDate?: Date;
  disabled?: boolean;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DatePicker: React.FC<DatePickerProps> = ({
  label,
  onSelect,
  selectedDate,
  minDate = new Date(),
  disabled
}) => {
  const [viewDate, setViewDate] = useState(selectedDate || new Date());
  const [mode, setMode] = useState<'date' | 'time'>('date');

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  const handleDateClick = (e: React.MouseEvent, day: number) => {
    e.stopPropagation();
    if (disabled) return;
    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    if (selectedDate) {
      newDate.setHours(selectedDate.getHours());
      newDate.setMinutes(selectedDate.getMinutes());
    }
    onSelect(newDate);
    setMode('time');
  };

  const handleTimeSelect = (e: React.MouseEvent, hour: number, minute: number) => {
    e.stopPropagation();
    if (disabled || !selectedDate) return;
    const newDate = new Date(selectedDate);
    newDate.setHours(hour);
    newDate.setMinutes(minute);
    onSelect(newDate);
  };

  const handleBackToDate = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMode('date');
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(viewDate.getFullYear(), viewDate.getMonth());
    const firstDay = getFirstDayOfMonth(viewDate.getFullYear(), viewDate.getMonth());
    const blanks = Array(firstDay).fill(null);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    return (
      <div className="p-3">
        <div className="flex items-center justify-between mb-4">
          <button onClick={handlePrevMonth} className="p-1 hover:bg-theme-hover rounded">
            <ChevronLeft className="w-4 h-4 text-theme-muted" />
          </button>
          <span className="font-medium text-sm text-theme-fg">
            {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
          </span>
          <button onClick={handleNextMonth} className="p-1 hover:bg-theme-hover rounded">
            <ChevronRight className="w-4 h-4 text-theme-muted" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {DAYS.map(d => (
            <span key={d} className="text-[10px] font-medium text-theme-muted uppercase">
              {d}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {blanks.map((_, i) => <div key={`blank-${i}`} />)}
          {days.map(day => {
            const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
            const isSelected = selectedDate &&
              date.getDate() === selectedDate.getDate() &&
              date.getMonth() === selectedDate.getMonth() &&
              date.getFullYear() === selectedDate.getFullYear();

            const isToday = new Date().toDateString() === date.toDateString();
            const isDisabled = disabled || (minDate && date < new Date(minDate.setHours(0,0,0,0)));

            return (
              <button
                key={day}
                onClick={(e) => !isDisabled && handleDateClick(e, day)}
                disabled={isDisabled}
                className={clsx(
                  "h-8 w-8 rounded-full text-xs flex items-center justify-center transition-colors relative",
                  isSelected
                    ? "bg-primary text-primary-fg font-medium shadow-sm"
                    : isDisabled
                      ? "text-theme-muted/40 cursor-not-allowed"
                      : "text-theme-fg hover:bg-theme-hover",
                  isToday && !isSelected && "text-primary font-medium ring-1 ring-inset ring-primary/30"
                )}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTime = () => {
    const timeSlots = [9, 10, 11, 12, 13, 14, 15, 16, 17];

    return (
      <div className="p-3">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={handleBackToDate} className="text-xs text-primary hover:underline flex items-center gap-1">
            <ChevronLeft className="w-3 h-3" /> Back
          </button>
          <span className="font-medium text-sm text-theme-fg ml-auto">Select Time</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {timeSlots.map(h => {
             const isSelected = selectedDate?.getHours() === h;
             return (
              <button
                key={h}
                onClick={(e) => handleTimeSelect(e, h, 0)}
                className={clsx(
                  "px-2 py-2 rounded-lg text-xs border transition-all",
                  isSelected
                    ? "bg-primary/10 border-primary text-primary font-medium"
                    : "border-theme/20 hover:border-theme/40 hover:bg-theme-hover text-theme-fg"
                )}
              >
                {h > 12 ? h - 12 : h}:00 {h >= 12 ? 'PM' : 'AM'}
              </button>
             );
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-theme/10">
           <p className="text-[10px] text-theme-muted text-center">
             Custom time? Type it in the chat like "at 4:15pm"
           </p>
        </div>
      </div>
    );
  };

  return (
    <div onClick={handleContainerClick} className="w-full max-w-[280px] bg-theme-card rounded-xl border border-theme/20 shadow-sm overflow-hidden my-3">
      {label && (
        <div className="px-3 py-2 bg-theme-hover/50 border-b border-theme/10 flex items-center gap-2">
          {mode === 'date' ? <CalendarIcon className="w-3.5 h-3.5 text-theme-muted" /> : <Clock className="w-3.5 h-3.5 text-theme-muted" />}
          <span className="text-xs font-medium text-theme-fg">{label}</span>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, x: mode === 'time' ? 20 : -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: mode === 'time' ? -20 : 20 }}
          transition={{ duration: 0.15 }}
        >
          {mode === 'date' ? renderCalendar() : renderTime()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};



