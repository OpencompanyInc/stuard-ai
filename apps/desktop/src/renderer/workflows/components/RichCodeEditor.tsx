import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Search, Replace, X, ChevronUp, ChevronDown, Copy, Check, Regex, CaseSensitive, Wand2, WrapText, Minimize2, Maximize2 } from "lucide-react";

// VS Code Dark+ inspired color tokens
const VSCODE = {
  bg: '#1e1e1e',
  gutterBg: '#1e1e1e',
  gutterText: '#858585',
  gutterActiveLine: '#c6c6c6',
  gutterBorder: '#333333',
  activeLine: '#2a2d2e',
  selection: 'rgba(38,79,120,0.5)',
  caret: '#aeafad',
  toolbar: '#252526',
  toolbarBorder: '#3c3c3c',
  statusBar: '#007acc',
  searchBg: '#252526',
  searchBorder: '#3c3c3c',
  searchInputBg: '#3c3c3c',
  searchInputBorder: '#007acc',
  findMatch: 'rgba(234,92,0,0.33)',
  font: '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", "Menlo", monospace',
  fontSize: '13px',
  lineHeight: '20px',
};

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
  const highlightedRef = useRef<HTMLPreElement>(null);
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

  // Sync scroll between textarea and backdrop
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
      while ((match = regex.exec(value)) !== null) newMatches.push(match.index);
      setMatches(newMatches);
      if (newMatches.length > 0) { setCurrentMatchIndex(0); scrollToMatch(newMatches[0]); }
      else setCurrentMatchIndex(-1);
    } catch { setMatches([]); }
  }, [searchTerm, value, useRegex, matchCase]);

  const scrollToMatch = (index: number) => {
    if (!textareaRef.current) return;
    const activeEl = document.activeElement;
    // Set selection and briefly focus to trigger scroll-to-selection
    textareaRef.current.setSelectionRange(index, index + searchTerm.length);
    textareaRef.current.blur();
    textareaRef.current.focus();
    // Sync gutter and backdrop to new scroll position
    const scrollTop = textareaRef.current.scrollTop;
    if (backdropRef.current) backdropRef.current.scrollTop = scrollTop;
    if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
    // Restore focus to previous element (e.g. search input) so user can keep typing
    if (activeEl && activeEl instanceof HTMLElement && activeEl !== textareaRef.current) {
      activeEl.focus();
    }
  };

  const nextMatch = () => { if (matches.length === 0) return; const next = (currentMatchIndex + 1) % matches.length; setCurrentMatchIndex(next); scrollToMatch(matches[next]); };
  const prevMatch = () => { if (matches.length === 0) return; const prev = (currentMatchIndex - 1 + matches.length) % matches.length; setCurrentMatchIndex(prev); scrollToMatch(matches[prev]); };

  const replaceCurrent = () => {
    if (currentMatchIndex === -1 || matches.length === 0) return;
    const index = matches[currentMatchIndex];
    const newValue = value.substring(0, index) + replaceTerm + value.substring(index + searchTerm.length);
    onChange(newValue);
  };

  const replaceAll = () => {
    if (!searchTerm) return;
    try {
      const flags = matchCase ? "g" : "gi";
      const regex = useRegex ? new RegExp(searchTerm, flags) : new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      onChange(value.replace(regex, replaceTerm));
    } catch { }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Line count
  const lineCount = useMemo(() => value.split('\n').length, [value]);
  const gutterWidth = useMemo(() => Math.max(40, String(lineCount).length * 10 + 20), [lineCount]);

  // Generate line numbers
  const lineNumbers = useMemo(() => {
    return Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
  }, [lineCount]);

  // VS Code Dark+ Syntax Highlighting
  const highlightedCode = useMemo(() => {
    const esc = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    if (language === 'json') {
      return esc(value).replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
        (match) => {
          if (/^"/.test(match)) {
            if (/:$/.test(match)) return `<span style="color:#9cdcfe">${match}</span>`; // key - light blue
            return `<span style="color:#ce9178">${match}</span>`; // string - orange
          }
          if (/true|false/.test(match)) return `<span style="color:#569cd6">${match}</span>`; // boolean - blue
          if (/null/.test(match)) return `<span style="color:#569cd6;font-style:italic">${match}</span>`; // null
          return `<span style="color:#b5cea8">${match}</span>`; // number - green
        }
      );
    }

    if (language === 'css') {
      let h = esc(value);
      h = h.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#6a9955;font-style:italic">$1</span>');
      h = h.replace(/([.#]?[\w-]+)(\s*\{)/g, '<span style="color:#d7ba7d">$1</span>$2');
      h = h.replace(/([\w-]+)(\s*:)/g, '<span style="color:#9cdcfe">$1</span>$2');
      return h;
    }

    if (language === 'html') {
      let h = esc(value);
      h = h.replace(/(&lt;)(\/?)(\w+)/g, '$1$2<span style="color:#569cd6">$3</span>');
      h = h.replace(/([\w-]+)(=)/g, '<span style="color:#9cdcfe">$1</span><span style="color:#d4d4d4">$2</span>');
      h = h.replace(/(&quot;[^&]*?&quot;)/g, '<span style="color:#ce9178">$1</span>');
      h = h.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span style="color:#6a9955;font-style:italic">$1</span>');
      return h;
    }

    if (language === 'python' || language === 'javascript' || language === 'typescript') {
      let h = esc(value);
      // Comments
      h = h.replace(/(#.*)$/gm, '<span style="color:#6a9955">$1</span>');
      h = h.replace(/(\/\/.*)$/gm, '<span style="color:#6a9955">$1</span>');
      // Strings
      h = h.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;|'[^']*?'|`[^`]*?`)/g, '<span style="color:#ce9178">$1</span>');
      // Keywords
      const kw = language === 'python'
        ? 'def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|with|yield|lambda|pass|break|continue|raise|and|or|not|in|is|True|False|None|async|await'
        : 'const|let|var|function|class|if|else|for|while|return|import|from|export|default|try|catch|finally|throw|new|typeof|instanceof|async|await|yield|true|false|null|undefined|void|this|super';
      h = h.replace(new RegExp(`\\b(${kw})\\b`, 'g'), '<span style="color:#c586c0">$1</span>');
      // Numbers
      h = h.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#b5cea8">$1</span>');
      return h;
    }

    return esc(value);
  }, [value, language]);

  useEffect(() => {
    if (highlightedRef.current) {
      highlightedRef.current.innerHTML = highlightedCode;
    }
  }, [highlightedCode]);

  // Dynamic height
  const editorHeight = isExpanded ? '80vh' : undefined;
  const editorMinHeight = isExpanded ? '80vh' : `${minHeight}px`;
  const editorMaxHeight = isExpanded ? '80vh' : (maxHeight ? `${maxHeight}px` : undefined);

  // Language display name
  const langLabel = useMemo(() => {
    const map: Record<string, string> = { json: 'JSON', javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', css: 'CSS', html: 'HTML', text: 'Plain Text', markdown: 'Markdown', yaml: 'YAML', shell: 'Shell' };
    return map[language] || language.toUpperCase();
  }, [language]);

  return (
    <div className={`flex flex-col overflow-hidden transition-all ${isExpanded ? 'fixed inset-3 z-50 rounded-lg shadow-2xl' : ''} ${className}`} style={{ background: VSCODE.bg, minHeight: isExpanded ? '80vh' : `${minHeight + 22}px` }}>
      {/* VS Code-style Search Widget (floating, top-right like VS Code) */}
      {showSearch && (
        <div
          className="absolute top-0 right-4 z-40 rounded-b-md shadow-xl"
          style={{ background: VSCODE.searchBg, border: `1px solid ${VSCODE.searchBorder}`, borderTop: 'none', minWidth: 340 }}
        >
          <div className="p-2 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <input
                  id="code-search"
                  autoFocus
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Find"
                  className="w-full py-1 pl-2 pr-16 text-[13px] rounded-sm focus:outline-none"
                  style={{ background: VSCODE.searchInputBg, color: '#cccccc', border: `1px solid transparent`, fontFamily: VSCODE.font, fontSize: '12px' }}
                  onFocus={e => (e.target.style.borderColor = VSCODE.searchInputBorder)}
                  onBlur={e => (e.target.style.borderColor = 'transparent')}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { if (e.shiftKey) prevMatch(); else nextMatch(); }
                    else if (e.key === 'Escape') setShowSearch(false);
                  }}
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-px">
                  <button onClick={() => setMatchCase(!matchCase)} className={`p-0.5 rounded-sm ${matchCase ? 'bg-[#007acc55] text-white' : 'text-[#969696] hover:text-[#cccccc]'}`} title="Match Case"><CaseSensitive className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setUseRegex(!useRegex)} className={`p-0.5 rounded-sm ${useRegex ? 'bg-[#007acc55] text-white' : 'text-[#969696] hover:text-[#cccccc]'}`} title="Regex"><Regex className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <span className="text-[11px] min-w-[60px] text-center" style={{ color: '#969696' }}>
                {matches.length > 0 ? `${currentMatchIndex + 1}/${matches.length}` : 'No results'}
              </span>
              <button onClick={prevMatch} disabled={!matches.length} className="p-1 rounded-sm text-[#cccccc] hover:bg-[#ffffff15] disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
              <button onClick={nextMatch} disabled={!matches.length} className="p-1 rounded-sm text-[#cccccc] hover:bg-[#ffffff15] disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
              <button onClick={() => setShowSearch(false)} className="p-1 rounded-sm text-[#cccccc] hover:bg-[#ffffff15]"><X className="w-3.5 h-3.5" /></button>
            </div>
            {showReplace && !readOnly && (
              <div className="flex items-center gap-1.5">
                <input
                  value={replaceTerm}
                  onChange={e => setReplaceTerm(e.target.value)}
                  placeholder="Replace"
                  className="flex-1 py-1 px-2 text-[12px] rounded-sm focus:outline-none"
                  style={{ background: VSCODE.searchInputBg, color: '#cccccc', border: '1px solid transparent', fontFamily: VSCODE.font }}
                  onFocus={e => (e.target.style.borderColor = VSCODE.searchInputBorder)}
                  onBlur={e => (e.target.style.borderColor = 'transparent')}
                  onKeyDown={e => { if (e.key === 'Enter') replaceCurrent(); }}
                />
                <button onClick={replaceCurrent} disabled={!matches.length} className="px-1.5 py-1 text-[11px] rounded-sm text-[#cccccc] hover:bg-[#ffffff15] disabled:opacity-30" title="Replace">↻</button>
                <button onClick={replaceAll} disabled={!matches.length} className="px-1.5 py-1 text-[11px] rounded-sm text-[#cccccc] hover:bg-[#ffffff15] disabled:opacity-30" title="Replace All">↻↻</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* JSON Error Banner */}
      {jsonError && (
        <div className="px-3 py-1.5 flex items-center gap-2" style={{ background: '#5a1d1d', borderBottom: '1px solid #6e2a2a' }}>
          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0" style={{ background: '#f14c4c', color: '#1e1e1e', fontWeight: 700 }}>!</span>
          <span className="text-[12px] truncate" style={{ color: '#f48771' }}>{jsonError}</span>
        </div>
      )}

      {/* Editor Area */}
      <div
        className="flex-1 relative flex overflow-hidden"
        style={{ minHeight: editorMinHeight, maxHeight: editorMaxHeight, height: editorHeight }}
      >
        {/* Gutter (Line Numbers) */}
        <div
          ref={scrollRef}
          className="select-none overflow-hidden shrink-0"
          style={{
            width: gutterWidth,
            background: VSCODE.gutterBg,
            borderRight: `1px solid ${VSCODE.gutterBorder}`,
            color: VSCODE.gutterText,
            fontFamily: VSCODE.font,
            fontSize: VSCODE.fontSize,
            lineHeight: VSCODE.lineHeight,
            padding: '4px 0',
            textAlign: 'right',
          }}
        >
          <pre className="m-0 pr-2" style={{ fontFamily: VSCODE.font, fontSize: VSCODE.fontSize, lineHeight: VSCODE.lineHeight }}>{lineNumbers}</pre>
        </div>

        {/* Code Area */}
        <div className="flex-1 relative overflow-hidden" style={{ background: VSCODE.bg }}>
          {/* Syntax Highlighting Backdrop */}
          <div ref={backdropRef} className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
            <pre
              ref={highlightedRef}
              className={`m-0 ${wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
              style={{
                fontFamily: VSCODE.font,
                fontSize: VSCODE.fontSize,
                lineHeight: VSCODE.lineHeight,
                padding: '4px 12px',
                color: '#d4d4d4',
                background: 'transparent',
              }}
            />
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onScroll={handleScroll}
            className={`absolute inset-0 w-full h-full bg-transparent resize-none focus:outline-none ${readOnly ? 'cursor-default' : 'cursor-text'}`}
            style={{
              fontFamily: VSCODE.font,
              fontSize: VSCODE.fontSize,
              lineHeight: VSCODE.lineHeight,
              padding: '4px 12px',
              color: 'transparent',
              caretColor: VSCODE.caret,
              whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
              wordBreak: wordWrap ? 'break-word' : 'normal',
              overflowWrap: wordWrap ? 'break-word' : 'normal',
              WebkitTextFillColor: 'transparent',
            }}
            spellCheck={false}
            readOnly={readOnly}
            placeholder={placeholder}
          />
        </div>
      </div>

      {/* VS Code-style Status Bar */}
      <div className="flex items-center justify-between shrink-0" style={{ height: 22, background: VSCODE.statusBar, padding: '0 8px' }}>
        <div className="flex items-center gap-3">
          {!readOnly && language === 'json' && (
            <>
              <button onClick={formatCode} disabled={!!jsonError} className="text-[11px] hover:bg-[#ffffff20] px-1.5 rounded-sm disabled:opacity-40 transition-colors" style={{ color: '#ffffff' }} title="Format">Format</button>
              <button onClick={minifyCode} disabled={!!jsonError} className="text-[11px] hover:bg-[#ffffff20] px-1.5 rounded-sm disabled:opacity-40 transition-colors" style={{ color: '#ffffff' }} title="Minify">Minify</button>
            </>
          )}
          {jsonError && <span className="text-[11px]" style={{ color: '#f48771' }}>⚠ Error</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>Ln {lineCount}, Col 1</span>
          <button
            onClick={() => { setShowSearch(!showSearch); if (!showSearch) setTimeout(() => document.getElementById('code-search')?.focus(), 50); }}
            className="text-[11px] hover:bg-[#ffffff20] px-1.5 rounded-sm transition-colors" style={{ color: 'rgba(255,255,255,0.8)' }}
            title="Find (Ctrl+F)"
          >
            <Search className="w-3 h-3 inline-block" />
          </button>
          {!readOnly && (
            <button
              onClick={() => { setShowReplace(!showReplace); setShowSearch(true); }}
              className="text-[11px] hover:bg-[#ffffff20] px-1.5 rounded-sm transition-colors" style={{ color: 'rgba(255,255,255,0.8)' }}
              title="Replace (Ctrl+H)"
            >
              <Replace className="w-3 h-3 inline-block" />
            </button>
          )}
          <button onClick={() => setWordWrap(!wordWrap)} className={`text-[11px] px-1.5 rounded-sm transition-colors ${wordWrap ? 'bg-[#ffffff20]' : 'hover:bg-[#ffffff20]'}`} style={{ color: 'rgba(255,255,255,0.8)' }} title="Word Wrap">
            <WrapText className="w-3 h-3 inline-block" />
          </button>
          <button onClick={handleCopy} className="text-[11px] hover:bg-[#ffffff20] px-1.5 rounded-sm transition-colors" style={{ color: 'rgba(255,255,255,0.8)' }} title="Copy">
            {copied ? <Check className="w-3 h-3 inline-block" /> : <Copy className="w-3 h-3 inline-block" />}
          </button>
          <button onClick={() => setIsExpanded(!isExpanded)} className="text-[11px] hover:bg-[#ffffff20] px-1.5 rounded-sm transition-colors" style={{ color: 'rgba(255,255,255,0.8)' }} title={isExpanded ? 'Restore' : 'Maximize'}>
            {isExpanded ? <Minimize2 className="w-3 h-3 inline-block" /> : <Maximize2 className="w-3 h-3 inline-block" />}
          </button>
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>{langLabel}</span>
        </div>
      </div>

      {/* Expanded backdrop */}
      {isExpanded && <div className="fixed inset-0 bg-black/60 -z-10" onClick={() => setIsExpanded(false)} />}
    </div>
  );
}
