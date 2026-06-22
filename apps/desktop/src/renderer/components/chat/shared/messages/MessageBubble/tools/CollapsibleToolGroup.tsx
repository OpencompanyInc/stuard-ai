import React, { useState } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { ChainOfThoughtStep } from '../../../../../ai-elements/ChainOfThought';
import { getGroupLabel } from '../helpers/toolGroups';
import type { AssistantTraceStepData, TraceStatus } from '../types';
import { ToolTraceContent } from './ToolTraceContent';

interface CollapsibleToolGroupProps {
  toolName: string;
  steps: { step: AssistantTraceStepData; idx: number }[];
  totalSteps: number;
}

export const CollapsibleToolGroup: React.FC<CollapsibleToolGroupProps> = ({ toolName, steps, totalSteps }) => {
  const [expanded, setExpanded] = useState(false);
  const allComplete = steps.every(({ step }) => step.status === 'complete');
  const anyActive = steps.some(({ step }) => step.status === 'active');
  const groupStatus: TraceStatus = anyActive ? 'active' : allComplete ? 'complete' : 'pending';
  const label = getGroupLabel(toolName, steps.length);

  return (
    <div>
      <ChainOfThoughtStep
        status={groupStatus}
        isLast={steps[steps.length - 1].idx === totalSteps - 1 && !expanded}
        label={
          <button
            type="button"
            className="flex items-center gap-1.5 text-left"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronRight
              className={clsx(
                'h-3 w-3 shrink-0 transition-transform duration-150',
                expanded && 'rotate-90',
              )}
              style={{ color: 'color-mix(in srgb, var(--foreground-muted) 50%, transparent)' }}
            />
            {groupStatus === 'active' ? (
              <span className="text-theme-muted/80">{label}</span>
            ) : (
              <span>{label}</span>
            )}
          </button>
        }
      />
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="overflow-hidden ml-3 border-l-[1.5px] border-l-cot-rail pl-3"
          >
            {steps.map(({ step, idx }) => (
              <ChainOfThoughtStep
                key={step.id}
                status={step.status}
                isLast={idx === totalSteps - 1}
                label={step.status === 'active' ? (
                  <span className="text-theme-muted/80">{step.label}</span>
                ) : step.label}
              >
                {step.kind === 'tool' && step.tool ? (
                  <ToolTraceContent tool={step.tool} />
                ) : null}
              </ChainOfThoughtStep>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
