import React, { useRef, useCallback } from 'react';
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

  // Stop propagation to prevent triggering parent click handlers
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div className="w-full my-3" onClick={handleContainerClick}>
      {title && (
        <h4 className="text-sm font-medium text-theme-muted mb-2 px-1 uppercase tracking-wider text-[11px]">
          {title}
        </h4>
      )}

      <div
        ref={scrollRef}
        className="flex overflow-x-auto gap-3 pb-2 -mx-1 px-1 genui-scrollbar"
      >
        {options.map((opt) => {
          const isSelected = String(selectedId) === String(opt.id);
          const isDisabled = disabled || opt.disabled;

          return (
            <motion.button
              key={opt.id}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation();
                if (!isDisabled) {
                  onSelect(opt.id);
                }
              }}
              type="button"
              layout
              whileHover={!isDisabled ? { y: -2 } : undefined}
              whileTap={!isDisabled ? { scale: 0.98 } : undefined}
              className={clsx(
                "flex-shrink-0 flex flex-col items-start min-w-[160px] max-w-[220px] p-4 rounded-xl border text-left transition-all relative",
                isSelected
                  ? "bg-primary/10 border-primary ring-1 ring-primary shadow-md"
                  : "bg-theme-card border-theme/20 hover:border-theme/40 hover:shadow-md",
                isDisabled && !isSelected && "opacity-50 grayscale cursor-not-allowed bg-theme-hover",
                isDisabled && isSelected && "opacity-80 cursor-default"
              )}
            >
              <div className="flex items-center justify-between w-full mb-3">
                {opt.icon ? (
                  <div className={clsx(
                    "text-theme-muted p-2 rounded-lg bg-theme-hover",
                    isSelected && "text-primary bg-primary/20"
                  )}>{opt.icon}</div>
                ) : (
                  <div className={clsx(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                    isSelected ? "border-primary bg-primary" : "border-theme/30 bg-theme-card"
                  )}>
                    {isSelected && <Check className="w-3 h-3 text-primary-fg" />}
                  </div>
                )}

                {opt.badge && (
                  <span className={clsx(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium border",
                    isSelected
                      ? "bg-primary/20 text-primary border-primary/30"
                      : "bg-theme-hover text-theme-muted border-theme/20"
                  )}>
                    {opt.badge}
                  </span>
                )}
              </div>

              <span className={clsx(
                "font-semibold text-sm block mb-1 leading-snug",
                isSelected ? "text-primary" : "text-theme-fg"
              )}>
                {opt.label}
              </span>

              {opt.sublabel && (
                <div className={clsx(
                  "text-xs block w-full opacity-80",
                  isSelected ? "text-primary/80" : "text-theme-muted"
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

