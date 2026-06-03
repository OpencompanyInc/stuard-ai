import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ChevronRight, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

type ChainStatus = 'complete' | 'active' | 'pending' | 'error';

type ChainContextValue = {
  open: boolean;
  setOpen: (next: boolean) => void;
};

const ChainContext = createContext<ChainContextValue | null>(null);

function useChainContext(): ChainContextValue {
  const value = useContext(ChainContext);
  if (!value) {
    throw new Error('ChainOfThought components must be used inside <ChainOfThought>.');
  }
  return value;
}

export interface ChainOfThoughtProps
  extends ComponentPropsWithoutRef<'div'> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ChainOfThought({
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
  ...props
}: ChainOfThoughtProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? open : uncontrolledOpen;

  const contextValue = useMemo<ChainContextValue>(
    () => ({
      open: isOpen,
      setOpen: (next) => {
        if (!isControlled) setUncontrolledOpen(next);
        onOpenChange?.(next);
      },
    }),
    [isControlled, isOpen, onOpenChange],
  );

  return (
    <ChainContext.Provider value={contextValue}>
      <div className={clsx('w-full', className)} {...props}>
        {children}
      </div>
    </ChainContext.Provider>
  );
}

export function ChainOfThoughtHeader({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<'button'>) {
  const { open, setOpen } = useChainContext();

  return (
    <button
      type="button"
      className={clsx(
        'flex w-full items-center gap-2 py-1.5 text-left transition-colors',
        className,
      )}
      onClick={() => setOpen(!open)}
      {...props}
    >

      <ChevronRight
        className={clsx(
          'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
          open && 'rotate-90',
        )}
        style={{ color: 'color-mix(in srgb, var(--foreground-muted) 50%, transparent)' }}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </button>
  );
}

export function ChainOfThoughtContent({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  const { open } = useChainContext();

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <div className={clsx('pt-2 pb-1', className)} {...props}>
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

const DOT_SIZE = 6;

function StepDot({ status, icon: Icon }: { status: ChainStatus; icon?: LucideIcon }) {
  if (status === 'error') {
    return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  }
  if (Icon) {
    return (
      <Icon
        className="h-3.5 w-3.5"
        style={{ color: 'color-mix(in srgb, var(--foreground-muted) 70%, transparent)' }}
      />
    );
  }
  return (
    <span
      className="block shrink-0 rounded-full"
      style={{
        width: DOT_SIZE,
        height: DOT_SIZE,
        backgroundColor:
          status === 'active'
            ? 'color-mix(in srgb, var(--foreground) 40%, transparent)'
            : 'color-mix(in srgb, var(--foreground-muted) 50%, transparent)',
      }}
    />
  );
}

export interface ChainOfThoughtStepProps
  extends ComponentPropsWithoutRef<'div'> {
  icon?: LucideIcon;
  label?: React.ReactNode;
  description?: React.ReactNode;
  status?: ChainStatus;
  isLast?: boolean;
}

export function ChainOfThoughtStep({
  icon,
  label,
  description,
  status = 'pending',
  isLast = false,
  className,
  children,
  ...props
}: ChainOfThoughtStepProps) {
  const hasIcon = Boolean(icon) || status === 'error';
  const dotCenter = hasIcon ? 7 : DOT_SIZE / 2;

  return (
    <div className={clsx('relative flex', className)} {...props}>
      {!isLast && (
        <div
          className="absolute bottom-0"
          style={{
            left: dotCenter,
            width: 1.5,
            top: hasIcon ? 20 : 14,
            backgroundColor: 'color-mix(in srgb, var(--foreground-muted) 30%, transparent)',
          }}
        />
      )}

      <div
        className="relative z-10 shrink-0 flex items-start"
        style={{
          width: hasIcon ? 16 : DOT_SIZE,
          paddingTop: hasIcon ? 3 : 6,
        }}
      >
        <StepDot status={status} icon={icon} />
      </div>

      {/* Concrete padding (not a Tailwind class) so the dot/connector → text
          gutter can never be dropped by class scanning — a comfortable, even
          lane between the rail and the step label. */}
      <div
        className={clsx('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-4')}
        style={{ paddingLeft: 14 }}
      >
        {label ? (
          <div
            className="text-[13px] leading-5"
            style={{ color: 'color-mix(in srgb, var(--foreground) 72%, transparent)' }}
          >
            {label}
          </div>
        ) : null}
        {description ? (
          <div className="mt-0.5 text-[12px] leading-5 text-theme-muted">
            {description}
          </div>
        ) : null}
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </div>
  );
}

export function ChainOfThoughtSearchResults({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={clsx('flex flex-wrap gap-1.5', className)} {...props} />
  );
}

export function ChainOfThoughtSearchResult({
  className,
  ...props
}: ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium text-theme-muted',
        className,
      )}
      style={{
        backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 60%, transparent)',
      }}
      {...props}
    />
  );
}

export function ChainOfThoughtImage({
  caption,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'div'> & { caption?: string }) {
  return (
    <div className={clsx('space-y-1.5', className)} {...props}>
      <div
        className="flex items-center justify-center overflow-hidden rounded-xl p-6"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 40%, transparent)',
        }}
      >
        {children}
      </div>
      {caption ? (
        <p className="text-[12px] leading-relaxed text-theme-muted">{caption}</p>
      ) : null}
    </div>
  );
}

export default ChainOfThought;
