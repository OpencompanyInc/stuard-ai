import React, { useState, useCallback } from 'react';
import { ChevronDown, FileText, Terminal, AlertCircle, Info, ChevronRight, LayoutList, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { RichText } from './RichText';

export interface AccordionSection {
  id: string;
  title: string;
  content: string;
  icon?: 'file' | 'terminal' | 'error' | 'info' | 'list' | 'success';
  defaultOpen?: boolean;
  badge?: string;
  badgeColor?: 'blue' | 'green' | 'amber' | 'red' | 'neutral';
}

export interface AccordionProps {
  sections: AccordionSection[];
  allowMultiple?: boolean;
  variant?: 'default' | 'separated' | 'minimal';
}

const iconMap = {
  file: FileText,
  terminal: Terminal,
  error: AlertCircle,
  info: Info,
  list: LayoutList,
  success: CheckCircle2,
};

export const Accordion: React.FC<AccordionProps> = ({
  sections,
  allowMultiple = false,
  variant = 'default'
}) => {
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    sections.forEach(s => { if (s.defaultOpen) initial.add(s.id); });
    return initial;
  });

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const toggle = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (!allowMultiple) next.clear();
        next.add(id);
      }
      return next;
    });
  }, [allowMultiple]);

  const containerClasses = clsx(
    "w-full max-w-2xl my-3",
    variant === 'default' && "rounded-xl border border-theme/20 overflow-hidden divide-y divide-theme/10 bg-theme-card shadow-sm",
    variant === 'separated' && "space-y-3",
    variant === 'minimal' && "divide-y divide-theme/10"
  );

  return (
    <div onClick={handleContainerClick} className={containerClasses}>
      {sections.map((section) => {
        const isOpen = openIds.has(section.id);
        const Icon = section.icon ? iconMap[section.icon] : null;

        const itemClasses = clsx(
          variant === 'separated' && "rounded-xl border border-theme/20 bg-theme-card overflow-hidden shadow-sm",
          variant === 'minimal' && "bg-transparent"
        );

        return (
          <div key={section.id} className={itemClasses}>
            <button
              onClick={(e) => toggle(e, section.id)}
              className={clsx(
                "w-full px-4 py-3 flex items-start gap-3 transition-colors text-left group",
                variant !== 'minimal' && "hover:bg-theme-hover",
                isOpen && variant === 'minimal' && "bg-theme-hover/50"
              )}
            >
              {Icon && (
                <div className={clsx(
                  "mt-0.5 p-1.5 rounded-md transition-colors shrink-0",
                  isOpen ? "bg-primary/10 text-primary" : "bg-theme-hover text-theme-muted group-hover:text-theme-fg"
                )}>
                  <Icon className="w-4 h-4" />
                </div>
              )}

              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={clsx(
                    "font-medium text-sm transition-colors",
                    isOpen ? "text-primary" : "text-theme-fg"
                  )}>
                    {section.title}
                  </span>
                  {section.badge && (
                    <span className={clsx(
                      "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border",
                      section.badgeColor === 'green' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" :
                      section.badgeColor === 'amber' ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" :
                      section.badgeColor === 'red' ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" :
                      "bg-primary/10 text-primary border-primary/20"
                    )}>
                      {section.badge}
                    </span>
                  )}
                </div>
              </div>

              <ChevronDown
                className={clsx(
                  "w-4 h-4 text-theme-muted transition-transform duration-200 mt-1 shrink-0",
                  isOpen && "rotate-180 text-primary"
                )}
              />
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className={clsx(
                    "px-4 pb-4 pt-1 ml-11",
                    !Icon && "ml-4"
                  )}>
                    <div className="text-sm text-theme-fg/80 leading-relaxed bg-theme-hover/50 rounded-lg p-3 border border-theme/10">
                      <RichText content={section.content} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};


