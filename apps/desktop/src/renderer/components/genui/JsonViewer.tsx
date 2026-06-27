import React, { useState, useMemo, useCallback } from 'react';
import { ChevronRight, Copy, Check, Braces } from 'lucide-react';
import clsx from 'clsx';

export interface JsonViewerProps {
  data: any;
  title?: string;
  defaultExpanded?: boolean;
  maxDepth?: number;
}

interface JsonNodeProps {
  keyName?: string;
  value: any;
  depth: number;
  maxDepth: number;
}

const JsonNode: React.FC<JsonNodeProps> = ({ keyName, value, depth, maxDepth }) => {
  const [expanded, setExpanded] = useState(depth < 2);

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);
  const isEmpty = isObject && Object.keys(value).length === 0;

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  }, [expanded]);

  const renderValue = () => {
    if (value === null) return <span className="text-theme-muted italic">null</span>;
    if (typeof value === 'string') return <span className="text-emerald-500">"{value}"</span>;
    if (typeof value === 'number') return <span className="text-blue-500">{value}</span>;
    if (typeof value === 'boolean') return <span className="text-amber-500">{String(value)}</span>;
    return null;
  };

  if (!isObject) {
    return (
      <div className="flex items-baseline gap-1 py-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
        {keyName && (
          <>
            <span className="text-violet-500 font-medium">"{keyName}"</span>
            <span className="text-theme-muted">:</span>
          </>
        )}
        {renderValue()}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex items-baseline gap-1 py-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
        {keyName && (
          <>
            <span className="text-violet-500 font-medium">"{keyName}"</span>
            <span className="text-theme-muted">:</span>
          </>
        )}
        <span className="text-theme-muted">{isArray ? '[]' : '{}'}</span>
      </div>
    );
  }

  if (depth >= maxDepth) {
    return (
      <div className="flex items-baseline gap-1 py-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
        {keyName && (
          <>
            <span className="text-violet-500 font-medium">"{keyName}"</span>
            <span className="text-theme-muted">:</span>
          </>
        )}
        <span className="text-theme-muted italic">
          {isArray ? `[${value.length} items]` : `{${Object.keys(value).length} keys}`}
        </span>
      </div>
    );
  }

  const entries = isArray
    ? value.map((v: any, i: number) => [i, v])
    : Object.entries(value);

  return (
    <div>
      <button
        onClick={handleToggle}
        className="flex items-center gap-1 py-0.5 hover:bg-theme-hover rounded transition-colors w-full text-left"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <ChevronRight
          className={clsx(
            "w-3 h-3 text-theme-muted transition-transform shrink-0",
            expanded && "rotate-90"
          )}
        />
        {keyName && (
          <>
            <span className="text-violet-500 font-medium">"{keyName}"</span>
            <span className="text-theme-muted mx-0.5">:</span>
          </>
        )}
        <span className="text-theme-muted">
          {isArray ? '[' : '{'}
          {!expanded && <span className="text-theme-muted/60 mx-1">...</span>}
          {!expanded && (isArray ? ']' : '}')}
        </span>
        {!expanded && (
          <span className="text-[10px] text-theme-muted/60 ml-1">
            {isArray ? `${value.length} items` : `${Object.keys(value).length} keys`}
          </span>
        )}
      </button>

      {expanded && (
        <>
          {entries.map((entry) => (
            <JsonNode
              key={String(entry[0])}
              keyName={isArray ? undefined : String(entry[0])}
              value={entry[1]}
              depth={depth + 1}
              maxDepth={maxDepth}
            />
          ))}
          <div style={{ paddingLeft: `${depth * 16}px` }} className="text-theme-muted">
            {isArray ? ']' : '}'}
          </div>
        </>
      )}
    </div>
  );
};

export const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  title,
  defaultExpanded = true,
  maxDepth = 5
}) => {
  const [copied, setCopied] = useState(false);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div onClick={handleContainerClick} className="w-full max-w-xl bg-theme-card rounded-xl border border-theme/20 shadow-sm overflow-hidden my-3">
      {/* Header */}
      <div className="px-3 py-2 bg-theme-hover/50 border-b border-theme/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Braces className="w-4 h-4 text-theme-muted" />
          <span className="text-xs font-medium text-theme-fg">
            {title || 'JSON'}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-theme-muted hover:bg-theme-hover hover:text-theme-fg transition-colors"
        >
          {copied ? (
            <Check className="w-3 h-3 text-emerald-500" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Content */}
      <div className="p-3 font-mono text-xs max-h-[300px] overflow-auto genui-scrollbar">
        <JsonNode value={data} depth={0} maxDepth={maxDepth} />
      </div>
    </div>
  );
};


