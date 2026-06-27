import React, { useState, useMemo } from 'react';
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
  
  const getTypeColor = (val: any) => {
    if (val === null) return 'text-neutral-400';
    if (typeof val === 'string') return 'text-emerald-600';
    if (typeof val === 'number') return 'text-blue-600';
    if (typeof val === 'boolean') return 'text-amber-600';
    return 'text-neutral-700';
  };

  const renderValue = () => {
    if (value === null) return <span className="text-neutral-400 italic">null</span>;
    if (typeof value === 'string') return <span className="text-emerald-600">"{value}"</span>;
    if (typeof value === 'number') return <span className="text-blue-600">{value}</span>;
    if (typeof value === 'boolean') return <span className="text-amber-600">{String(value)}</span>;
    return null;
  };

  if (!isObject) {
    return (
      <div className="flex items-baseline gap-1 py-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
        {keyName && (
          <>
            <span className="text-purple-600 font-medium">"{keyName}"</span>
            <span className="text-neutral-400">:</span>
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
            <span className="text-purple-600 font-medium">"{keyName}"</span>
            <span className="text-neutral-400">:</span>
          </>
        )}
        <span className="text-neutral-400">{isArray ? '[]' : '{}'}</span>
      </div>
    );
  }

  if (depth >= maxDepth) {
    return (
      <div className="flex items-baseline gap-1 py-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
        {keyName && (
          <>
            <span className="text-purple-600 font-medium">"{keyName}"</span>
            <span className="text-neutral-400">:</span>
          </>
        )}
        <span className="text-neutral-400 italic">
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
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 py-0.5 hover:bg-neutral-100 rounded transition-colors w-full text-left"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <ChevronRight 
          className={clsx(
            "w-3 h-3 text-neutral-400 transition-transform shrink-0",
            expanded && "rotate-90"
          )}
        />
        {keyName && (
          <>
            <span className="text-purple-600 font-medium">"{keyName}"</span>
            <span className="text-neutral-400 mx-0.5">:</span>
          </>
        )}
        <span className="text-neutral-500">
          {isArray ? '[' : '{'}
          {!expanded && <span className="text-neutral-400 mx-1">...</span>}
          {!expanded && (isArray ? ']' : '}')}
        </span>
        {!expanded && (
          <span className="text-[10px] text-neutral-400 ml-1">
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
          <div style={{ paddingLeft: `${depth * 16}px` }} className="text-neutral-500">
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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="w-full max-w-xl bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden my-3">
      {/* Header */}
      <div className="px-3 py-2 bg-neutral-50 border-b border-neutral-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Braces className="w-4 h-4 text-neutral-400" />
          <span className="text-xs font-medium text-neutral-700">
            {title || 'JSON'}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-neutral-500 hover:bg-neutral-100 transition-colors"
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
      <div className="p-3 font-mono text-xs max-h-[300px] overflow-auto custom-scrollbar">
        <JsonNode value={data} depth={0} maxDepth={maxDepth} />
      </div>
    </div>
  );
};


