import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Search, Replace, X, ChevronUp, ChevronDown, Copy, Check, Regex, CaseSensitive, Wand2, WrapText, Minimize2, Maximize2 } from "lucide-react";

interface RichCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  minHeight?: number;
  maxHeight?: number;
}

export function RichCodeEditor({
  value,
  onChange,
  language = "json",
  placeholder,
  readOnly = false,
  className = "",
  minHeight = 200,
  maxHeight,
}: RichCodeEditorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [matches, setMatches] = useState<number[]>([]);
  const [useRegex, setUseRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Validate JSON in real-time
  useEffect(() => {
    if (language === 'json' && value.trim()) {
      try {
        JSON.parse(value);
        setJsonError(null);
      } catch (e: any) {
        const match = e.message?.match(/position (\d+)/i);
        const pos = match ? parseInt(match[1]) : null;
        setJsonError(pos !== null ? `Error at position ${pos}: ${e.message}` : e.message);
      }
    } else {
      setJsonError(null);
    }
  }, [value, language]);

  // Format JSON
  const formatCode = useCallback(() => {
    if (language === 'json') {
      try {
        const parsed = JSON.parse(value);
        const formatted = JSON.stringify(parsed, null, 2);
        onChange(formatted);
      } catch {
        // Can't format invalid JSON
      }
    }
  }, [value, onChange, language]);

  // Minify JSON
  const minifyCode = useCallback(() => {
    if (language === 'json') {
      try {
        const parsed = JSON.parse(value);
        const minified = JSON.stringify(parsed);
        onChange(minified);
      } catch {
        // Can't minify invalid JSON
      }
    }
  }, [value, onChange, language]);

  // Sync scroll between textarea and backdrop (for line numbers/highlighting)
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (backdropRef.current) {
      backdropRef.current.scrollTop = e.currentTarget.scrollTop;
      backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
    if (scrollRef.current) {
        scrollRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Find matches when search term changes
  useEffect(() => {
    if (!searchTerm) {
      setMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    try {
      const flags = matchCase ? "g" : "gi";
      const regex = useRegex ? new RegExp(searchTerm, flags) : new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      
      const newMatches: number[] = [];
      let match;
      while ((match = regex.exec(value)) !== null) {
        newMatches.push(match.index);
      }
      
      setMatches(newMatches);
      if (newMatches.length > 0) {
        setCurrentMatchIndex(0);
        scrollToMatch(newMatches[0]);
      } else {
        setCurrentMatchIndex(-1);
      }
    } catch (e) {
      // Invalid regex
      setMatches([]);
    }
  }, [searchTerm, value, useRegex, matchCase]);

  const scrollToMatch = (index: number) => {
    if (textareaRef.current) {
      // Simple scroll logic - creates a selection to focus
      textareaRef.current.setSelectionRange(index, index + searchTerm.length);
      const lineHeight = 20; // Approx
      const lines = value.substring(0, index).split('\n').length;
      const top = (lines - 1) * lineHeight;
      // textareaRef.current.scrollTop = Math.max(0, top - 100);
      textareaRef.current.blur();
      textareaRef.current.focus();
    }
  };

  const nextMatch = () => {
    if (matches.length === 0) return;
    const next = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(next);
    scrollToMatch(matches[next]);
  };

  const prevMatch = () => {
    if (matches.length === 0) return;
    const prev = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prev);
    scrollToMatch(matches[prev]);
  };

  const replaceCurrent = () => {
    if (currentMatchIndex === -1 || matches.length === 0) return;
    
    const index = matches[currentMatchIndex];
    // Re-verify match at index (in case user edited)
    const currentText = value.substring(index, index + searchTerm.length);
    // Basic check - nuanced regex replace might differ but this is usually sufficient for simple find/replace
    
    const newValue = value.substring(0, index) + replaceTerm + value.substring(index + searchTerm.length);
    onChange(newValue);
    // Effect will re-run and find next matches
  };

  const replaceAll = () => {
    if (!searchTerm) return;
    try {
      const flags = matchCase ? "g" : "gi";
      const regex = useRegex ? new RegExp(searchTerm, flags) : new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      const newValue = value.replace(regex, replaceTerm);
      onChange(newValue);
    } catch (e) {
        // ignore
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Generate line numbers
  const lineNumbers = useMemo(() => {
    const lines = value.split('\n').length;
    return Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  }, [value]);

  // Syntax Highlighting - supports JSON, CSS, HTML
  const highlightedCode = useMemo(() => {
    // Escape HTML entities first
    const escapeHtml = (str: string) => str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (language === 'json') {
      // JSON highlighter
      return escapeHtml(value).replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        (match) => {
          let cls = 'text-amber-400'; // number
          if (/^"/.test(match)) {
            if (/:$/.test(match)) {
              cls = 'text-sky-400 font-semibold'; // key
            } else {
              cls = 'text-emerald-400'; // string
            }
          } else if (/true|false/.test(match)) {
            cls = 'text-rose-400 font-semibold'; // boolean
          } else if (/null/.test(match)) {
            cls = 'text-slate-500 italic'; // null
          }
          return `<span class="${cls}">${match}</span>`;
        }
      );
    }

    if (language === 'css') {
      // CSS highlighter
      let highlighted = escapeHtml(value);
      // Comments
      highlighted = highlighted.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="text-slate-500 italic">$1</span>');
      // Selectors (before {)
      highlighted = highlighted.replace(/([.#]?[\w-]+)(\s*\{)/g, '<span class="text-violet-400 font-semibold">$1</span>$2');
      // Properties
      highlighted = highlighted.replace(/([\w-]+)(\s*:)/g, '<span class="text-sky-400">$1</span>$2');
      // Values with units
      highlighted = highlighted.replace(/:\s*([^;{}]+)(;|$)/g, (m, val, end) => {
        // Highlight colors
        val = val.replace(/(#[0-9a-fA-F]{3,8})/g, '<span class="text-amber-400">$1</span>');
        // Highlight numbers with units
        val = val.replace(/(\d+(?:\.\d+)?)(px|em|rem|%|vh|vw|s|ms)?/g, '<span class="text-emerald-400">$1</span><span class="text-slate-400">$2</span>');
        return `: <span class="text-rose-300">${val}</span>${end}`;
      });
      return highlighted;
    }

    if (language === 'html') {
      // HTML highlighter - use placeholders to avoid regex conflicts
      let highlighted = escapeHtml(value);

      // Process complete tags with their attributes
      highlighted = highlighted.replace(
        /(&lt;)(\/?)(\w+)((?:\s+[\w-]+(?:=(?:&quot;[^&]*&quot;|'[^']*'|[^\s&gt;]*))?)*)\s*(\/?)(&gt;)/g,
        (match, lt, slash1, tagName, attrs, slash2, gt) => {
          // Highlight tag name
          let result = `${lt}${slash1}\u0001${tagName}\u0002`;

          // Highlight attributes
          if (attrs) {
            attrs = attrs.replace(
              /([\w-]+)(=)(&quot;[^&]*&quot;|'[^']*'|[^\s&gt;]*)/g,
              '\u0003$1\u0004$2\u0005$3\u0006'
            );
            attrs = attrs.replace(/([\w-]+)(?!=)/g, '\u0003$1\u0004');
            result += attrs;
          }

          result += `${slash2}${gt}`;
          return result;
        }
      );

      // Comments
      highlighted = highlighted.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '\u0007$1\u0008');

      // Replace placeholders with actual spans
      highlighted = highlighted
        .replace(/\u0001/g, '<span class="text-rose-400 font-semibold">')
        .replace(/\u0002/g, '</span>')
        .replace(/\u0003/g, '<span class="text-amber-400">')
        .replace(/\u0004/g, '</span>')
        .replace(/\u0005/g, '<span class="text-emerald-400">')
        .replace(/\u0006/g, '</span>')
        .replace(/\u0007/g, '<span class="text-slate-500 italic">')
        .replace(/\u0008/g, '</span>');

      return highlighted;
    }

    // Default: just escape HTML
    return escapeHtml(value);
  }, [value, language]);

  // Calculate dynamic height
  const editorHeight = isExpanded ? '70vh' : undefined;
  const editorMinHeight = isExpanded ? '70vh' : `${minHeight}px`;
  const editorMaxHeight = isExpanded ? '70vh' : (maxHeight ? `${maxHeight}px` : undefined);

  return (
    <div className={`flex flex-col border rounded-xl overflow-hidden shadow-sm transition-all ${jsonError ? 'border-red-400/50 bg-[#1e1e2e]' : 'border-slate-200 bg-[#1e1e2e]'} ${isExpanded ? 'fixed inset-4 z-50' : ''} ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#252538] border-b border-slate-700/50 text-slate-400">
        <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${jsonError ? 'bg-red-900/50 border-red-700/50 text-red-400' : 'bg-slate-800/50 border-slate-700/50 text-slate-500'}`}>
              {language}
            </span>
            <div className="h-4 w-px bg-slate-700/50 mx-0.5" />
            <button 
                onClick={() => { setShowSearch(!showSearch); if (!showSearch) setTimeout(() => document.getElementById('code-search')?.focus(), 50); }}
                className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${showSearch ? 'text-indigo-400 bg-slate-700' : ''}`}
                title="Find (Ctrl+F)"
            >
                <Search className="w-3.5 h-3.5" />
            </button>
            {!readOnly && (
                <button 
                    onClick={() => { setShowReplace(!showReplace); setShowSearch(true); }}
                    className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${showReplace ? 'text-indigo-400 bg-slate-700' : ''}`}
                    title="Replace (Ctrl+H)"
                >
                    <Replace className="w-3.5 h-3.5" />
                </button>
            )}
            {!readOnly && language === 'json' && (
              <>
                <div className="h-4 w-px bg-slate-700/50 mx-0.5" />
                <button 
                    onClick={formatCode}
                    className="p-1.5 rounded hover:bg-slate-700 transition-colors text-slate-400 hover:text-emerald-400"
                    title="Format JSON (Pretty Print)"
                    disabled={!!jsonError}
                >
                    <Wand2 className="w-3.5 h-3.5" />
                </button>
                <button 
                    onClick={minifyCode}
                    className="p-1.5 rounded hover:bg-slate-700 transition-colors text-slate-400 hover:text-amber-400"
                    title="Minify JSON"
                    disabled={!!jsonError}
                >
                    <Minimize2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
        </div>
        <div className="flex items-center gap-1.5">
             <div className="text-[10px] text-slate-500 font-mono hidden sm:block">
                {value.length} chars • {value.split('\n').length} lines
             </div>
             <div className="h-4 w-px bg-slate-700/50 mx-0.5 hidden sm:block" />
             <button 
                onClick={() => setWordWrap(!wordWrap)} 
                className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${wordWrap ? 'text-indigo-400 bg-slate-700' : 'text-slate-400'}`} 
                title={wordWrap ? "Disable Word Wrap" : "Enable Word Wrap"}
             >
                <WrapText className="w-3.5 h-3.5" />
             </button>
             <button onClick={handleCopy} className="p-1.5 hover:bg-slate-700 rounded text-slate-400 transition-colors" title="Copy Content">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
             </button>
             <button 
                onClick={() => setIsExpanded(!isExpanded)} 
                className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors" 
                title={isExpanded ? "Collapse" : "Expand"}
             >
                {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
             </button>
        </div>
      </div>

      {/* Search Bar */}
      {showSearch && (
        <div className="bg-[#2a2a3f] border-b border-slate-700/50 p-2 flex flex-col gap-2 animate-in slide-in-from-top-1">
             <div className="flex items-center gap-2">
                <div className="relative flex-1 group">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 group-focus-within:text-indigo-400" />
                    <input 
                        id="code-search"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Find..."
                        className="w-full bg-[#1e1e2e] border border-slate-700 rounded-md py-1 pl-8 pr-20 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-600"
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                if (e.shiftKey) prevMatch(); else nextMatch();
                            } else if (e.key === 'Escape') {
                                setShowSearch(false);
                            }
                        }}
                    />
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                        <button onClick={() => setMatchCase(!matchCase)} className={`p-1 rounded hover:bg-slate-700 ${matchCase ? 'text-indigo-400 bg-slate-700' : 'text-slate-500'}`} title="Match Case">
                            <CaseSensitive className="w-3 h-3" />
                        </button>
                        <button onClick={() => setUseRegex(!useRegex)} className={`p-1 rounded hover:bg-slate-700 ${useRegex ? 'text-indigo-400 bg-slate-700' : 'text-slate-500'}`} title="Regex">
                            <Regex className="w-3 h-3" />
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={prevMatch} disabled={matches.length === 0} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded disabled:opacity-50">
                        <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={nextMatch} disabled={matches.length === 0} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded disabled:opacity-50">
                        <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setShowSearch(false)} className="p-1.5 hover:bg-slate-700 text-slate-400 rounded">
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
             </div>
             {showReplace && !readOnly && (
                 <div className="flex items-center gap-2">
                    <div className="relative flex-1 group">
                         <Replace className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 group-focus-within:text-indigo-400" />
                        <input 
                            value={replaceTerm}
                            onChange={e => setReplaceTerm(e.target.value)}
                            placeholder="Replace with..."
                            className="w-full bg-[#1e1e2e] border border-slate-700 rounded-md py-1 pl-8 pr-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-600"
                            onKeyDown={e => {
                                if (e.key === 'Enter') replaceCurrent();
                            }}
                        />
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={replaceCurrent} disabled={matches.length === 0} className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium rounded border border-slate-700">
                            Replace
                        </button>
                        <button onClick={replaceAll} disabled={matches.length === 0} className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium rounded border border-slate-700">
                            All
                        </button>
                    </div>
                 </div>
             )}
             {matches.length > 0 && (
                <div className="text-[10px] text-slate-500 px-1">
                    {currentMatchIndex + 1} of {matches.length} matches
                </div>
             )}
        </div>
      )}

      {/* JSON Error Banner */}
      {jsonError && (
        <div className="px-3 py-2 bg-red-900/30 border-b border-red-800/50 text-xs text-red-300 flex items-center gap-2">
          <X className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="truncate">{jsonError}</span>
        </div>
      )}

      {/* Editor Area */}
      <div 
        className="flex-1 relative flex overflow-hidden"
        style={{ 
          minHeight: editorMinHeight,
          maxHeight: editorMaxHeight,
          height: editorHeight
        }}
      >
        {/* Line Numbers */}
        <div
            ref={scrollRef}
            className="w-10 bg-[#1e1e2e] border-r border-slate-700/50 text-slate-600 text-[11px] font-mono py-3 text-right pr-2 select-none overflow-hidden"
            style={{ 
              fontFamily: '"Menlo", "Consolas", "Monaco", monospace', 
              lineHeight: '1.6',
              whiteSpace: wordWrap ? 'pre-wrap' : 'pre'
            }}
        >
            {lineNumbers}
        </div>

        {/* Text Area Container */}
        <div className="flex-1 relative bg-[#1e1e2e] overflow-auto">
            {/* Syntax Highlighting Backdrop */}
            <div
                ref={backdropRef}
                className="absolute inset-0 pointer-events-none overflow-hidden"
                aria-hidden="true"
            >
                <pre
                    dangerouslySetInnerHTML={{ __html: highlightedCode }}
                    className={`p-3 m-0 text-slate-300 ${wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
                    style={{
                        fontFamily: '"Menlo", "Consolas", "Monaco", monospace',
                        fontSize: '11px',
                        lineHeight: '1.6',
                        background: 'transparent',
                    }}
                />
            </div>

            {/* Actual Textarea - transparent text, visible caret */}
            <textarea
                ref={textareaRef}
                value={value}
                onChange={e => onChange(e.target.value)}
                onScroll={handleScroll}
                className={`absolute inset-0 w-full h-full bg-transparent caret-white p-3 font-mono resize-none focus:outline-none selection:bg-indigo-500/30 ${readOnly ? 'cursor-default' : 'cursor-text'}`}
                style={{
                    fontFamily: '"Menlo", "Consolas", "Monaco", monospace',
                    fontSize: '11px',
                    lineHeight: '1.6',
                    color: 'transparent',
                    caretColor: 'white',
                    whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
                    wordBreak: wordWrap ? 'break-word' : 'normal',
                    overflowWrap: wordWrap ? 'break-word' : 'normal',
                }}
                spellCheck={false}
                readOnly={readOnly}
                placeholder={placeholder}
            />
        </div>
      </div>
      
      {/* Expanded backdrop */}
      {isExpanded && (
        <div 
          className="fixed inset-0 bg-black/50 -z-10" 
          onClick={() => setIsExpanded(false)}
        />
      )}
    </div>
  );
}
