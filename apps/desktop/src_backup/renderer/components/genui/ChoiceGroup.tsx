import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { RichText } from './RichText';

export interface ChoiceOption {
  id: string;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  badge?: string;
  disabled?: boolean;
}

export interface ChoiceGroupProps {
  title?: string;
  options: ChoiceOption[];
  onSelect: (optionId: string) => void;
  selectedId?: string;
  disabled?: boolean;
}

export const ChoiceGroup: React.FC<ChoiceGroupProps> = ({
  title,
  options,
  onSelect,
  selectedId,
  disabled
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="w-full my-3">
      {title && (
        <h4 className="text-sm font-medium text-neutral-500 mb-2 px-1 uppercase tracking-wider text-[11px]">
          {title}
        </h4>
      )}
      
      <div 
        ref={scrollRef}
        className="flex overflow-x-auto gap-3 pb-2 -mx-1 px-1 scrollbar-thin scrollbar-thumb-neutral-200"
      >
        {options.map((opt) => {
          const isSelected = String(selectedId) === String(opt.id);
          const isDisabled = disabled || opt.disabled;
          
          return (
            <motion.button
              key={opt.id}
              onClick={() => !isDisabled && onSelect(opt.id)}
              disabled={isDisabled}
              layout
              whileHover={!isDisabled ? { y: -2 } : undefined}
              whileTap={!isDisabled ? { scale: 0.98 } : undefined}
              className={clsx(
                "flex-shrink-0 flex flex-col items-start min-w-[160px] max-w-[220px] p-4 rounded-xl border text-left transition-all relative",
                isSelected 
                  ? "bg-blue-50/80 border-blue-500 ring-1 ring-blue-500 shadow-md" 
                  : "bg-white border-neutral-200 hover:border-neutral-300 hover:shadow-md",
                isDisabled && !isSelected && "opacity-50 grayscale cursor-not-allowed bg-neutral-50",
                isDisabled && isSelected && "opacity-80 cursor-default"
              )}
            >
              <div className="flex items-center justify-between w-full mb-3">
                {opt.icon ? (
                  <div className={clsx(
                    "text-neutral-600 p-2 rounded-lg bg-neutral-100/50",
                    isSelected && "text-blue-600 bg-blue-100/50"
                  )}>{opt.icon}</div>
                ) : (
                  <div className={clsx(
                    "w-5 h-5 rounded-full border flex items-center justify-center transition-colors",
                    isSelected ? "border-blue-500 bg-blue-500" : "border-neutral-300 bg-white"
                  )}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </div>
                )}
                
                {opt.badge && (
                  <span className={clsx(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium border",
                    isSelected 
                      ? "bg-blue-100 text-blue-700 border-blue-200" 
                      : "bg-neutral-100 text-neutral-600 border-neutral-200"
                  )}>
                    {opt.badge}
                  </span>
                )}
              </div>
              
              <span className={clsx(
                "font-semibold text-sm block mb-1 leading-snug",
                isSelected ? "text-blue-900" : "text-neutral-900"
              )}>
                {opt.label}
              </span>
              
              {opt.sublabel && (
                <div className={clsx(
                  "text-xs block w-full opacity-80",
                  isSelected ? "text-blue-700" : "text-neutral-500"
                )}>
                  {opt.sublabel.length > 60 || opt.sublabel.includes('\n') ? (
                    <RichText content={opt.sublabel} compact className="text-inherit text-xs" />
                  ) : (
                    <span className="line-clamp-3">{opt.sublabel}</span>
                  )}
                </div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

