import React, { useState } from 'react';
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

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const handlePrevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  const handleDateClick = (day: number) => {
    if (disabled) return;
    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    // Keep time if already selected
    if (selectedDate) {
      newDate.setHours(selectedDate.getHours());
      newDate.setMinutes(selectedDate.getMinutes());
    }
    onSelect(newDate);
    setMode('time');
  };

  const handleTimeSelect = (hour: number, minute: number) => {
    if (disabled || !selectedDate) return;
    const newDate = new Date(selectedDate);
    newDate.setHours(hour);
    newDate.setMinutes(minute);
    onSelect(newDate);
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(viewDate.getFullYear(), viewDate.getMonth());
    const firstDay = getFirstDayOfMonth(viewDate.getFullYear(), viewDate.getMonth());
    const blanks = Array(firstDay).fill(null);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    return (
      <div className="p-3">
        <div className="flex items-center justify-between mb-4">
          <button onClick={handlePrevMonth} className="p-1 hover:bg-neutral-100 rounded">
            <ChevronLeft className="w-4 h-4 text-neutral-500" />
          </button>
          <span className="font-medium text-sm text-neutral-800">
            {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
          </span>
          <button onClick={handleNextMonth} className="p-1 hover:bg-neutral-100 rounded">
            <ChevronRight className="w-4 h-4 text-neutral-500" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {DAYS.map(d => (
            <span key={d} className="text-[10px] font-medium text-neutral-400 uppercase">
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
            const isPast = date < new Date(new Date().setHours(0,0,0,0));
            const isDisabled = disabled || (minDate && date < new Date(minDate.setHours(0,0,0,0)));

            return (
              <button
                key={day}
                onClick={() => !isDisabled && handleDateClick(day)}
                disabled={isDisabled}
                className={clsx(
                  "h-8 w-8 rounded-full text-xs flex items-center justify-center transition-colors relative",
                  isSelected 
                    ? "bg-blue-600 text-white font-medium shadow-sm" 
                    : isDisabled
                      ? "text-neutral-300 cursor-not-allowed"
                      : "text-neutral-700 hover:bg-neutral-100",
                  isToday && !isSelected && "text-blue-600 font-medium ring-1 ring-inset ring-blue-200"
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
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const timeSlots = [9, 10, 11, 12, 13, 14, 15, 16, 17]; // Common business hours for quick pick

    return (
      <div className="p-3">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setMode('date')} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            <ChevronLeft className="w-3 h-3" /> Back
          </button>
          <span className="font-medium text-sm text-neutral-800 ml-auto">Select Time</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {timeSlots.map(h => {
             const isSelected = selectedDate?.getHours() === h;
             return (
              <button
                key={h}
                onClick={() => handleTimeSelect(h, 0)}
                className={clsx(
                  "px-2 py-2 rounded-lg text-xs border transition-all",
                  isSelected 
                    ? "bg-blue-50 border-blue-500 text-blue-700 font-medium" 
                    : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 text-neutral-600"
                )}
              >
                {h > 12 ? h - 12 : h}:00 {h >= 12 ? 'PM' : 'AM'}
              </button>
             );
          })}
        </div>
        
        <div className="mt-4 pt-3 border-t border-neutral-100">
           <p className="text-[10px] text-neutral-400 text-center">
             Custom time? Type it in the chat like "at 4:15pm"
           </p>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-[280px] bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden my-3">
      {label && (
        <div className="px-3 py-2 bg-neutral-50 border-b border-neutral-100 flex items-center gap-2">
          {mode === 'date' ? <CalendarIcon className="w-3.5 h-3.5 text-neutral-500" /> : <Clock className="w-3.5 h-3.5 text-neutral-500" />}
          <span className="text-xs font-medium text-neutral-600">{label}</span>
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


