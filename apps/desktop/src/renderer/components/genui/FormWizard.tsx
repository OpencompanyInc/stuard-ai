import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, Send, X } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FormFieldOption {
    id: string;
    label: string;
    sublabel?: string;
    icon?: string;
    disabled?: boolean;
}

export interface FormField {
    id: string;
    type: 'select' | 'multiselect' | 'text' | 'textarea' | 'toggle' | 'number' | 'slider';
    label: string;
    description?: string;
    placeholder?: string;
    options?: FormFieldOption[];
    required?: boolean;
    defaultValue?: any;
    min?: number;
    max?: number;
    step?: number;
}

export interface FormPage {
    id: string;
    title: string;
    description?: string;
    fields: FormField[];
}

export interface FormWizardProps {
    title: string;
    description?: string;
    pages: FormPage[];
    submitLabel?: string;
    cancelLabel?: string;
    showProgress?: boolean;
    onSubmit: (data: Record<string, any>) => void;
    onCancel: () => void;
    disabled?: boolean;
    isSubmitted?: boolean;
    isCancelled?: boolean;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const SelectField: React.FC<{
    field: FormField;
    value: string;
    onChange: (val: string) => void;
    disabled?: boolean;
}> = ({ field, value, onChange, disabled }) => {
    return (
        <div className="flex flex-wrap gap-2">
            {(field.options || []).map((opt) => {
                const isSelected = value === opt.id;
                return (
                    <motion.button
                        key={opt.id}
                        type="button"
                        whileHover={!disabled && !opt.disabled ? { scale: 1.02 } : undefined}
                        whileTap={!disabled && !opt.disabled ? { scale: 0.98 } : undefined}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!disabled && !opt.disabled) onChange(opt.id);
                        }}
                        className={clsx(
                            'px-3 py-2 rounded-lg border text-left text-sm transition-all flex items-center gap-2 min-w-[100px]',
                            isSelected
                                ? 'bg-primary/15 border-primary text-primary ring-1 ring-primary/30'
                                : 'bg-theme-card border-theme/20 text-theme-fg hover:border-theme/40',
                            (disabled || opt.disabled) && 'opacity-50 cursor-not-allowed'
                        )}
                    >
                        <div
                            className={clsx(
                                'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all',
                                isSelected ? 'border-primary bg-primary' : 'border-theme/30'
                            )}
                        >
                            {isSelected && <Check className="w-2.5 h-2.5 text-primary-fg" />}
                        </div>
                        <div className="flex flex-col">
                            <span className={clsx('font-medium', isSelected && 'text-primary')}>{opt.label}</span>
                            {opt.sublabel && (
                                <span className="text-[10px] opacity-60 mt-0.5">{opt.sublabel}</span>
                            )}
                        </div>
                    </motion.button>
                );
            })}
        </div>
    );
};

const MultiSelectField: React.FC<{
    field: FormField;
    value: string[];
    onChange: (val: string[]) => void;
    disabled?: boolean;
}> = ({ field, value, onChange, disabled }) => {
    const selectedSet = new Set(value);
    return (
        <div className="flex flex-wrap gap-2">
            {(field.options || []).map((opt) => {
                const isSelected = selectedSet.has(opt.id);
                return (
                    <motion.button
                        key={opt.id}
                        type="button"
                        whileHover={!disabled && !opt.disabled ? { scale: 1.02 } : undefined}
                        whileTap={!disabled && !opt.disabled ? { scale: 0.98 } : undefined}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (disabled || opt.disabled) return;
                            if (isSelected) {
                                onChange(value.filter((v) => v !== opt.id));
                            } else {
                                onChange([...value, opt.id]);
                            }
                        }}
                        className={clsx(
                            'px-3 py-2 rounded-lg border text-sm transition-all flex items-center gap-2',
                            isSelected
                                ? 'bg-primary/15 border-primary text-primary'
                                : 'bg-theme-card border-theme/20 text-theme-fg hover:border-theme/40',
                            (disabled || opt.disabled) && 'opacity-50 cursor-not-allowed'
                        )}
                    >
                        <div
                            className={clsx(
                                'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all',
                                isSelected ? 'bg-primary border-primary' : 'border-theme/30'
                            )}
                        >
                            {isSelected && <Check className="w-2.5 h-2.5 text-primary-fg" />}
                        </div>
                        <span className={clsx('font-medium', isSelected && 'text-primary')}>{opt.label}</span>
                    </motion.button>
                );
            })}
        </div>
    );
};

const TextField: React.FC<{
    field: FormField;
    value: string;
    onChange: (val: string) => void;
    disabled?: boolean;
}> = ({ field, value, onChange, disabled }) => {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            disabled={disabled}
            className={clsx(
                'w-full px-3 py-2 rounded-lg border bg-theme-card border-theme/20 text-theme-fg text-sm',
                'placeholder:text-theme-muted/50 outline-none transition-all',
                'focus:border-primary focus:ring-1 focus:ring-primary/30',
                disabled && 'opacity-50 cursor-not-allowed'
            )}
        />
    );
};

const TextareaField: React.FC<{
    field: FormField;
    value: string;
    onChange: (val: string) => void;
    disabled?: boolean;
}> = ({ field, value, onChange, disabled }) => {
    return (
        <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            disabled={disabled}
            rows={3}
            className={clsx(
                'w-full px-3 py-2 rounded-lg border bg-theme-card border-theme/20 text-theme-fg text-sm',
                'placeholder:text-theme-muted/50 outline-none transition-all resize-none genui-scrollbar',
                'focus:border-primary focus:ring-1 focus:ring-primary/30',
                disabled && 'opacity-50 cursor-not-allowed'
            )}
        />
    );
};

const ToggleField: React.FC<{
    field: FormField;
    value: boolean;
    onChange: (val: boolean) => void;
    disabled?: boolean;
}> = ({ field, value, onChange, disabled }) => {
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                if (!disabled) onChange(!value);
            }}
            className={clsx(
                'w-10 h-5.5 rounded-full transition-all relative flex-shrink-0',
                value ? 'bg-primary' : 'bg-theme/30',
                disabled && 'opacity-50 cursor-not-allowed'
            )}
        >
            <motion.div
                className="w-4 h-4 rounded-full bg-white shadow-sm absolute top-0.5"
                animate={{ left: value ? '22px' : '2px' }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
        </button>
    );
};

const NumberField: React.FC<{
    field: FormField;
    value: number;
    onChange: (val: number) => void;
    disabled?: boolean;
}> = ({ field, value, onChange, disabled }) => {
    return (
        <input
            type="number"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            min={field.min}
            max={field.max}
            step={field.step}
            disabled={disabled}
            className={clsx(
                'w-32 px-3 py-2 rounded-lg border bg-theme-card border-theme/20 text-theme-fg text-sm',
                'outline-none transition-all',
                'focus:border-primary focus:ring-1 focus:ring-primary/30',
                disabled && 'opacity-50 cursor-not-allowed'
            )}
        />
    );
};

const SliderField: React.FC<{
    field: FormField;
    value: number;
    onChange: (val: number) => void;
    disabled?: boolean;
}> = ({ field, value, onChange, disabled }) => {
    const min = field.min ?? 0;
    const max = field.max ?? 100;
    const step = field.step ?? 1;
    return (
        <div className="flex items-center gap-3 w-full">
            <input
                type="range"
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                className="flex-1 accent-primary"
            />
            <span className="text-xs text-theme-muted font-mono min-w-[32px] text-right">{value}</span>
        </div>
    );
};

// ─── Main FormWizard ─────────────────────────────────────────────────────────

export const FormWizard: React.FC<FormWizardProps> = ({
    title,
    description,
    pages,
    submitLabel = 'Submit',
    cancelLabel = 'Cancel',
    showProgress = true,
    onSubmit,
    onCancel,
    disabled,
    isSubmitted,
    isCancelled,
}) => {
    const [currentPage, setCurrentPage] = useState(0);
    const [formData, setFormData] = useState<Record<string, any>>(() => {
        // Initialize with defaults
        const data: Record<string, any> = {};
        for (const page of pages) {
            for (const field of page.fields) {
                if (field.defaultValue !== undefined) {
                    data[field.id] = field.defaultValue;
                } else {
                    switch (field.type) {
                        case 'multiselect':
                            data[field.id] = [];
                            break;
                        case 'toggle':
                            data[field.id] = false;
                            break;
                        case 'number':
                        case 'slider':
                            data[field.id] = field.min ?? 0;
                            break;
                        default:
                            data[field.id] = '';
                    }
                }
            }
        }
        return data;
    });

    const handleContainerClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    const setFieldValue = useCallback((fieldId: string, value: any) => {
        setFormData((prev) => ({ ...prev, [fieldId]: value }));
    }, []);

    const page = pages[currentPage];
    const isFirstPage = currentPage === 0;
    const isLastPage = currentPage === pages.length - 1;
    const isSinglePage = pages.length === 1;
    const totalPages = pages.length;

    // Check if current page has all required fields filled
    const isCurrentPageValid = page?.fields.every((field) => {
        if (!field.required) return true;
        const val = formData[field.id];
        if (val === undefined || val === null || val === '') return false;
        if (Array.isArray(val) && val.length === 0) return false;
        return true;
    });

    const handleNext = () => {
        if (isLastPage) {
            onSubmit(formData);
        } else {
            setCurrentPage((p) => Math.min(p + 1, totalPages - 1));
        }
    };

    const handlePrev = () => {
        setCurrentPage((p) => Math.max(p - 1, 0));
    };

    // Completed state
    if (isSubmitted || isCancelled) {
        return (
            <div onClick={handleContainerClick} className="my-3">
                <div
                    className={clsx(
                        'rounded-xl border p-4',
                        isSubmitted
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : 'bg-rose-500/10 border-rose-500/30'
                    )}
                >
                    <div className="flex items-center gap-2 text-sm">
                        {isSubmitted ? (
                            <>
                                <Check className="w-4 h-4 text-emerald-400" />
                                <span className="text-emerald-300 font-medium">Form submitted</span>
                            </>
                        ) : (
                            <>
                                <X className="w-4 h-4 text-rose-400" />
                                <span className="text-rose-300 font-medium">Form cancelled</span>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div onClick={handleContainerClick} className="my-3 w-full max-w-lg">
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-theme/20 bg-theme-card overflow-hidden shadow-lg"
            >
                {/* Header */}
                <div className="px-4 pt-4 pb-2">
                    <h3 className="text-sm font-semibold text-theme-fg">{title}</h3>
                    {description && <p className="text-xs text-theme-muted mt-0.5">{description}</p>}
                </div>

                {/* Progress bar */}
                {showProgress && totalPages > 1 && (
                    <div className="px-4 pb-2">
                        <div className="flex items-center gap-1.5">
                            {pages.map((p, i) => (
                                <div key={p.id} className="flex items-center flex-1">
                                    <div
                                        className={clsx(
                                            'h-1 rounded-full flex-1 transition-all duration-300',
                                            i < currentPage
                                                ? 'bg-primary'
                                                : i === currentPage
                                                    ? 'bg-primary/60'
                                                    : 'bg-theme/15'
                                        )}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-between mt-1">
                            <span className="text-[10px] text-theme-muted uppercase tracking-wider">
                                Step {currentPage + 1} of {totalPages}
                            </span>
                            <span className="text-[10px] text-theme-muted">{page?.title}</span>
                        </div>
                    </div>
                )}

                {/* Page Content */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={page?.id || currentPage}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.2 }}
                        className="px-4 pb-3"
                    >
                        {/* Page title (for multi-page only) */}
                        {totalPages > 1 && page && (
                            <div className="mb-3">
                                <h4 className="text-xs font-medium text-theme-fg">{page.title}</h4>
                                {page.description && (
                                    <p className="text-[11px] text-theme-muted mt-0.5">{page.description}</p>
                                )}
                            </div>
                        )}

                        {/* Fields */}
                        <div className="space-y-4">
                            {page?.fields.map((field) => (
                                <div key={field.id}>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-xs font-medium text-theme-fg">
                                            {field.label}
                                            {field.required && <span className="text-rose-400 ml-0.5">*</span>}
                                        </label>
                                        {field.type === 'toggle' && (
                                            <ToggleField
                                                field={field}
                                                value={!!formData[field.id]}
                                                onChange={(v) => setFieldValue(field.id, v)}
                                                disabled={disabled}
                                            />
                                        )}
                                    </div>
                                    {field.description && (
                                        <p className="text-[10px] text-theme-muted mb-1.5">{field.description}</p>
                                    )}
                                    {field.type === 'select' && (
                                        <SelectField
                                            field={field}
                                            value={formData[field.id] || ''}
                                            onChange={(v) => setFieldValue(field.id, v)}
                                            disabled={disabled}
                                        />
                                    )}
                                    {field.type === 'multiselect' && (
                                        <MultiSelectField
                                            field={field}
                                            value={formData[field.id] || []}
                                            onChange={(v) => setFieldValue(field.id, v)}
                                            disabled={disabled}
                                        />
                                    )}
                                    {field.type === 'text' && (
                                        <TextField
                                            field={field}
                                            value={formData[field.id] || ''}
                                            onChange={(v) => setFieldValue(field.id, v)}
                                            disabled={disabled}
                                        />
                                    )}
                                    {field.type === 'textarea' && (
                                        <TextareaField
                                            field={field}
                                            value={formData[field.id] || ''}
                                            onChange={(v) => setFieldValue(field.id, v)}
                                            disabled={disabled}
                                        />
                                    )}
                                    {field.type === 'number' && (
                                        <NumberField
                                            field={field}
                                            value={formData[field.id] ?? 0}
                                            onChange={(v) => setFieldValue(field.id, v)}
                                            disabled={disabled}
                                        />
                                    )}
                                    {field.type === 'slider' && (
                                        <SliderField
                                            field={field}
                                            value={formData[field.id] ?? (field.min || 0)}
                                            onChange={(v) => setFieldValue(field.id, v)}
                                            disabled={disabled}
                                        />
                                    )}
                                    {/* toggle is rendered inline with the label above */}
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </AnimatePresence>

                {/* Footer / Navigation */}
                <div className="px-4 py-3 border-t border-theme/10 flex items-center justify-between gap-2">
                    <div>
                        {!isSinglePage && !isFirstPage && (
                            <motion.button
                                type="button"
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handlePrev();
                                }}
                                disabled={disabled}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                                Back
                            </motion.button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <motion.button
                            type="button"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onCancel();
                            }}
                            disabled={disabled}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-theme-muted hover:text-theme-fg hover:bg-theme-hover border border-theme/15 transition-all"
                        >
                            {cancelLabel}
                        </motion.button>

                        <motion.button
                            type="button"
                            whileHover={!disabled && isCurrentPageValid ? { scale: 1.02 } : undefined}
                            whileTap={!disabled && isCurrentPageValid ? { scale: 0.98 } : undefined}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (isCurrentPageValid) handleNext();
                            }}
                            disabled={disabled || !isCurrentPageValid}
                            className={clsx(
                                'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
                                isCurrentPageValid
                                    ? 'bg-primary text-primary-fg hover:bg-primary/90 shadow-sm'
                                    : 'bg-theme/10 text-theme-muted cursor-not-allowed'
                            )}
                        >
                            {isLastPage ? (
                                <>
                                    <Send className="w-3 h-3" />
                                    {submitLabel}
                                </>
                            ) : (
                                <>
                                    Next
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </>
                            )}
                        </motion.button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};
