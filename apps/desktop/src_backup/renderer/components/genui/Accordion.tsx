import React, { useState } from 'react';
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

  const toggle = (id: string) => {
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
  };

  const containerClasses = clsx(
    "w-full max-w-2xl my-3",
    variant === 'default' && "rounded-xl border border-neutral-200 overflow-hidden divide-y divide-neutral-100 bg-white shadow-sm",
    variant === 'separated' && "space-y-3",
    variant === 'minimal' && "divide-y divide-neutral-100"
  );

  return (
    <div className={containerClasses}>
      {sections.map((section) => {
        const isOpen = openIds.has(section.id);
        const Icon = section.icon ? iconMap[section.icon] : null;

        const itemClasses = clsx(
          variant === 'separated' && "rounded-xl border border-neutral-200 bg-white overflow-hidden shadow-sm",
          variant === 'minimal' && "bg-transparent"
        );

        return (
          <div key={section.id} className={itemClasses}>
            <button
              onClick={() => toggle(section.id)}
              className={clsx(
                "w-full px-4 py-3 flex items-start gap-3 transition-colors text-left group",
                variant !== 'minimal' && "hover:bg-neutral-50",
                isOpen && variant === 'minimal' && "bg-neutral-50/50"
              )}
            >
              {Icon && (
                <div className={clsx(
                  "mt-0.5 p-1.5 rounded-md transition-colors shrink-0",
                  isOpen ? "bg-blue-50 text-blue-600" : "bg-neutral-100 text-neutral-500 group-hover:text-neutral-700"
                )}>
                  <Icon className="w-4 h-4" />
                </div>
              )}
              
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={clsx(
                    "font-medium text-sm transition-colors",
                    isOpen ? "text-blue-700" : "text-neutral-800"
                  )}>
                    {section.title}
                  </span>
                  {section.badge && (
                    <span className={clsx(
                      "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border",
                      section.badgeColor === 'green' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                      section.badgeColor === 'amber' ? "bg-amber-50 text-amber-700 border-amber-200" :
                      section.badgeColor === 'red' ? "bg-red-50 text-red-700 border-red-200" :
                      "bg-blue-50 text-blue-700 border-blue-200"
                    )}>
                      {section.badge}
                    </span>
                  )}
                </div>
              </div>

              <ChevronDown 
                className={clsx(
                  "w-4 h-4 text-neutral-400 transition-transform duration-200 mt-1 shrink-0",
                  isOpen && "rotate-180 text-blue-500"
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
                    "px-4 pb-4 pt-1 ml-11", // Indent content to align with title text
                    !Icon && "ml-4"
                  )}>
                    <div className="text-sm text-neutral-600 leading-relaxed bg-neutral-50/50 rounded-lg p-3 border border-neutral-100">
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


