import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import clsx from "clsx";
import { User, Bot, AlertCircle, CheckCircle2, RotateCw, Zap, Sparkles, X, Undo2 } from "lucide-react";
import { ModelSelector } from "../../../components/ModelSelector";
import { AudioPlayer } from "../../../components/AudioPlayer";
import { ReasoningBlock } from "../../../components/ReasoningBlock";
import type { Message, StreamItem, ToolEvent } from "../../hooks/useWorkflowChat";

// --- Helpers ---

function toMediaSrc(src: string): string {
  if (!src) return '';
  if (/^(https?:|data:|file:)/i.test(src)) return src;
  let path = src.trim();

  // Handle Windows paths
  if (/^[a-zA-Z]:[/\\]/.test(path)) {
    path = path.replace(/\\/g, '/');
    const parts = path.split('/');
    // Encode parts but preserve drive letter colon
    const encodedPath = parts.map((p, i) => i === 0 ? p : encodeURIComponent(p)).join('/');
    return `file:///${encodedPath}`;
  }

  if (path.startsWith('/')) {
    const encodedPath = path.split('/').map(p => encodeURIComponent(p)).join('/');
    return `file://${encodedPath}`;
  }

  // Fallback
  return `file:///${path.replace(/\\/g, '/').split('/').map(p => encodeURIComponent(p)).join('/')}`;
}

function preprocessMessageContent(content: string): string {
  if (!content) return '';
  let processed = content.replace(/<<([^<>]+)>>/g, '![attachment](<$1>)');

  // Comprehensive regex for media paths (Windows and Unix)
  // Matches files ending in common media extensions that are not already in markdown
  const mediaPathRegex = /(^|[\s\n])(?!!\[)((?:[a-zA-Z]:\\[^<>:"|?*\n\r]+|(?:\/[^<>:"|?*\n\r]+))\.(?:mp4|webm|mov|wav|mp3|ogg|m4a|aac|png|jpg|jpeg|gif|webp))(?=$|[\s\n])/gmi;

  processed = processed.replace(mediaPathRegex, (match, prefix, path) => {
    const ext = path.toLowerCase().split('.').pop();
    let type = 'image';
    if (['mp4', 'webm', 'mov'].includes(ext)) type = 'video';
    else if (['wav', 'mp3', 'ogg', 'm4a', 'aac'].includes(ext)) type = 'audio';
    return `${prefix}![${type}](<${path}>)`;
  });

  return processed;
}

const ChatMedia: React.FC<{ src: string; alt?: string }> = ({ src, alt }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const mediaSrc = toMediaSrc(src || '');

  const isAudio = /\.(wav|mp3|ogg|m4a|aac)(\?|$)/i.test(mediaSrc) || alt === 'audio';
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(mediaSrc) || alt === 'video';
  const isImage = !isAudio && !isVideo;

  if (error) {
    const fileName = decodeURIComponent(src.split(/[/\\]/).pop() || 'File');
    return (
      <div className="flex items-center gap-2 p-3 my-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs max-w-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <div className="flex flex-col truncate">
          <span className="font-semibold uppercase text-[9px] opacity-70">Failed to load {alt || 'Media'}</span>
          <span className="truncate" title={src}>{fileName}</span>
        </div>
      </div>
    );
  }

  if (isAudio) {
    return <AudioPlayer src={mediaSrc} className="my-2 max-w-sm" />;
  }

  if (isVideo) {
    return (
      <span className="block my-2 relative group max-w-2xl">
        <video
          src={mediaSrc}
          controls
          preload="metadata"
          crossOrigin="anonymous"
          className="w-full rounded-lg border border-slate-200 shadow-sm bg-black max-h-[400px]"
          onError={(e) => {
            console.error(`[ChatMedia] Video load error for ${mediaSrc}:`, e.currentTarget.error);
            setError(true);
          }}
        />
      </span>
    );
  }

  return (
    <span className="block my-2 relative group">
      <div className={`absolute inset-0 bg-slate-100 rounded-lg animate-pulse ${loaded ? 'hidden' : 'block'}`} />
      <img
        src={mediaSrc}
        alt={alt || 'Image'}
        onLoad={() => setLoaded(true)}
        onError={() => {
          console.error(`[ChatMedia] Image load error: ${mediaSrc}`);
          setError(true);
        }}
        className={`max-w-full max-h-[240px] rounded-lg border border-slate-200 shadow-sm object-contain bg-white transition-all duration-300 ${loaded ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      />
    </span>
  );
};

// --- Tool Rendering ---

function parseModifyWorkflowArgs(jsonStr: string) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    const result: any = {};
    const instrMatch = jsonStr.match(/"instructions"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (instrMatch) {
      try { result.instructions = JSON.parse(`"${instrMatch[1]}"`); } catch { }
    }
    return result;
  }
}

function formatToolName(name: string): string {
  if (name === 'workflow_modify' || name === 'modify_workflow') return 'Modify Workflow';
  if (name === 'create_workflow') return 'Create Workflow';
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const ModifyWorkflowView = ({
  args,
  result,
  workflowBefore,
  onUndo
}: {
  args: any;
  result?: any;
  workflowBefore?: any;
  onUndo?: (snapshot: any) => void;
}) => {
  const instructions = args?.instructions;
  const resultSpec = result?.spec || result?.workflow;
  const rawError = result?.error;
  const resultError = typeof rawError === 'string' && rawError.trim().length > 0 ? rawError : undefined;
  const resultOk = result?.ok === true || result?.ok === 'true';
  const resultFailed = result?.ok === false || result?.ok === 'false';

  const hasError = resultError || resultFailed;
  const errorMessage = resultError || (resultFailed ? 'Modification failed' : null);

  const showSuccess = resultOk && (resultSpec || result?.changes);
  const showError = hasError && errorMessage;
  const showPending = !result;
  const showUnknown = result && !showSuccess && !showError;

  const canUndo = showSuccess && workflowBefore && onUndo;

  return (
    <div className="mt-3 flex flex-col gap-px text-[11px] border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm">
      <div className="bg-slate-50/80 px-3 py-2 text-slate-700 text-[10px] font-semibold uppercase tracking-wider border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-white rounded-md border border-slate-200 shadow-sm">
            <Sparkles className="w-3 h-3 text-blue-500" />
          </div>
          {showSuccess ? 'Updates Applied' : showPending ? 'Applying Updates...' : 'Update Status'}
        </div>
        {canUndo && (
          <button
            type="button"
            onClick={() => onUndo(workflowBefore)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            title="Undo this change"
          >
            <Undo2 className="w-3 h-3" />
            Undo
          </button>
        )}
      </div>

      {instructions && (
        <div className="p-3 bg-white border-b border-slate-50 whitespace-pre-wrap break-words text-slate-600">
          <div className="text-[11px] leading-relaxed">{instructions}</div>
        </div>
      )}

      {showError && (
        <div className="bg-red-50/50 text-red-800 p-3 border-b border-red-100 whitespace-pre-wrap break-words flex gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-[10px] uppercase mb-0.5 text-red-600">Failed</div>
            <div className="text-[11px] opacity-90">{errorMessage}</div>
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="bg-emerald-50/30 text-emerald-900 p-3 whitespace-pre-wrap break-words flex gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-[10px] uppercase mb-0.5 text-emerald-600">Success</div>
            <div className="text-[11px] opacity-90">
              {result?.message ? (
                <span>{result.message}</span>
              ) : (
                <span>Updates applied successfully</span>
              )}
            </div>
          </div>
        </div>
      )}

      {showPending && (
        <div className="bg-white p-3 whitespace-pre-wrap break-words">
          <div className="text-[11px] flex items-center gap-2 text-slate-500">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            Processing workflow changes...
          </div>
        </div>
      )}

      {showUnknown && (
        <div className="bg-slate-50 text-slate-600 p-3 whitespace-pre-wrap break-words">
          <div className="flex select-none text-slate-400 mb-1 text-[9px] uppercase font-bold">Raw Result</div>
          <div className="text-[10px] font-mono max-h-24 overflow-y-auto scrollbar-minimal">
            {JSON.stringify(result, null, 2)}
          </div>
        </div>
      )}
    </div>
  );
};

const ToolCallItem = ({ evt, onUndo }: { evt: ToolEvent; onUndo?: (snapshot: any) => void }) => {
  const toolName = (evt.tool || '').toLowerCase().trim();
  const isModify = toolName === 'workflow_modify' || toolName === 'modify_workflow' || toolName === 'create_workflow';
  const args = useMemo(() => {
    if (evt.args) return evt.args;
    if (evt.argsText) {
      if (isModify) return parseModifyWorkflowArgs(evt.argsText);
      try { return JSON.parse(evt.argsText); } catch { return {}; }
    }
    return {};
  }, [evt.args, evt.argsText, isModify]);

  const resultFailed = evt.result && evt.result.ok === false;
  const resultError = evt.result?.error;

  const statusColor =
    resultFailed ? 'text-amber-600' :
      evt.status === 'completed' ? 'text-emerald-600' :
        evt.status === 'error' || evt.status === 'failed' ? 'text-red-600' :
          'text-indigo-600';

  const isRunning =
    !resultFailed && evt.status !== 'completed' && evt.status !== 'error' && evt.status !== 'failed';

  const statusIcon =
    isModify && isRunning ? (
      <span className="inline-flex items-center justify-center">
        <RotateCw className="w-3 h-3 animate-spin" />
      </span>
    ) :
      resultFailed ? <AlertCircle className="w-3 h-3" /> :
        evt.status === 'completed' ? <CheckCircle2 className="w-3 h-3" /> :
          evt.status === 'error' || evt.status === 'failed' ? <X className="w-3 h-3" /> :
            <RotateCw className="w-3 h-3" />;

  if (isModify) {
    return (
      <div className="mb-4">
        <ModifyWorkflowView
          args={args}
          result={evt.result}
          workflowBefore={evt.workflowBefore}
          onUndo={onUndo}
        />
      </div>
    );
  }

  return (
    <div className={`mb-3 rounded-lg border ${resultFailed ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white'} shadow-sm overflow-hidden transition-all group`}>
      <div className={`px-3 py-2 ${resultFailed ? 'bg-amber-50' : 'bg-slate-50/50'} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] border shadow-sm ${resultFailed ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-white text-indigo-600 border-slate-200'}`}>
            <Zap className="w-3 h-3" />
          </div>
          <span className="text-[11px] font-semibold text-slate-700">{formatToolName(evt.tool)}</span>
        </div>
        <span className={`text-[10px] font-medium flex items-center gap-1.5 opacity-80 ${statusColor}`}>
          {statusIcon}
        </span>
      </div>

      <div className="px-3 py-2 hidden group-hover:block transition-all border-t border-slate-100">
        {resultFailed && resultError && (
          <div className="mb-2 p-2 bg-amber-50 border border-amber-100 rounded text-amber-800 text-[11px] flex gap-2">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Error:</span> {resultError}
            </div>
          </div>
        )}
        <div className="text-[10px] font-mono text-slate-500 whitespace-pre-wrap break-all max-h-32 overflow-y-auto scrollbar-minimal">
          {JSON.stringify(args, null, 2)}
        </div>
      </div>
    </div>
  );
};

// --- Main Component ---

export function ChatHistory({
  messages,
  streamItems,
  reasoningText,
  showReasoning,
  setShowReasoning,
  busy,
  onUndo,
  selectedModelId,
  onSelectModel,
}: {
  messages: Message[];
  streamItems: StreamItem[];
  reasoningText: string;
  showReasoning: boolean;
  setShowReasoning: (v: boolean) => void;
  busy: boolean;
  onUndo?: (snapshot: any) => void;
  selectedModelId: string | 'auto';
  onSelectModel: (id: string | 'auto') => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-[#fdfdfd]">
      <div className="px-4 py-2.5 border-b border-slate-200/80 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-indigo-100 rounded-md flex items-center justify-center">
              <Bot className="w-3 h-3 text-indigo-600" />
            </div>
            <span className="text-[13px] font-semibold text-slate-800">AI Assistant</span>
          </div>
          <ModelSelector
            selectedModelId={selectedModelId}
            onSelectModel={onSelectModel}
            side="bottom"
            align="end"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto scrollbar-minimal px-4 py-4 space-y-5">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border shadow-sm mt-0.5
              ${msg.role === 'user'
                ? 'bg-slate-100 border-slate-200 text-slate-600'
                : 'bg-indigo-600 border-indigo-700 text-white'}`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>

            <div className={`flex flex-col gap-1.5 max-w-[90%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-1 justify-end">
                  {msg.images.map((img, idx) => {
                    const src = img.dataUrl || toMediaSrc(img.path);
                    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(src) || (img.mimeType && img.mimeType.startsWith('video/'));

                    return (
                      <div key={idx} className="relative rounded-lg overflow-hidden border border-slate-200 shadow-sm max-w-[200px] bg-slate-50">
                        {isVideo ? (
                          <video src={src} className="max-h-48 w-full object-cover" controls={false} muted onMouseOver={e => e.currentTarget.play()} onMouseOut={e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />
                        ) : (
                          <img src={src} alt="Attached" className="max-h-48 object-cover" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className={`px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed
                ${msg.role === 'user'
                  ? 'bg-slate-900 text-white rounded-tr-sm'
                  : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'}`}>
                <div className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                      img: (props) => <ChatMedia {...props as any} />,
                      p: ({ children }) => <p className="mb-2 last:mb-0 leading-[1.7]">{children}</p>,
                      a: ({ node, ...props }) => <a {...props} className="text-indigo-500 hover:text-indigo-600 underline underline-offset-2 decoration-indigo-500/30 hover:decoration-indigo-500/50 transition-all" target="_blank" rel="noopener noreferrer" />,
                      code: ({ node, className, children, ...props }) => {
                        const isInline = !String(className).includes('language-');
                        return isInline ? (
                          <code className={`${msg.role === 'user' ? 'bg-slate-700/50 text-slate-100' : 'bg-slate-100 text-slate-800'} px-2 py-0.5 rounded-md text-[85%] font-mono font-semibold border border-slate-600/20 shadow-sm`} {...props}>
                            {children}
                          </code>
                        ) : (
                          <div className="my-4 rounded-xl overflow-hidden bg-gradient-to-br from-slate-900/95 to-slate-800/95 border border-slate-700/50 shadow-xl">
                            <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-700/50 flex items-center justify-between">
                              <span className="text-xs text-slate-400 font-mono">{className?.replace('language-', '') || 'code'}</span>
                              <div className="flex gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                                <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                              </div>
                            </div>
                            <div className="overflow-x-auto overflow-y-auto max-h-[400px] custom-scrollbar p-4">
                              <code className={clsx(className, "font-mono text-[13px] block min-w-full leading-[1.7] text-slate-100")} {...props}>{children}</code>
                            </div>
                          </div>
                        )
                      },
                      ul: (props) => <ul className="list-disc pl-6 mb-3 space-y-1.5 marker:text-slate-400 marker:text-sm" {...props} />,
                      ol: (props) => <ol className="list-decimal pl-6 mb-3 space-y-1.5 marker:text-slate-400 marker:text-sm marker:font-semibold" {...props} />,
                      li: (props) => <li className="leading-[1.7] pl-1" {...props} />,
                      blockquote: (props) => (
                        <blockquote className="border-l-4 border-indigo-500/40 pl-4 my-3 py-2 bg-gradient-to-r from-indigo-500/10 to-transparent rounded-r-lg" {...props}>
                          <span className="text-slate-600 italic leading-[1.7]">{props.children}</span>
                        </blockquote>
                      ),
                      h1: (props) => <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 tracking-tight border-b border-slate-200 pb-2" {...props} />,
                      h2: (props) => <h2 className="text-base font-bold mb-2.5 mt-3.5 first:mt-0 tracking-tight" {...props} />,
                      h3: (props) => <h3 className="text-sm font-bold mb-2 mt-3 first:mt-0" {...props} />,
                      h4: (props) => <h4 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0" {...props} />,
                      strong: (props) => <strong className="font-bold" {...props} />,
                      em: (props) => <em className="italic" {...props} />,
                      table: (props) => (
                        <div className="overflow-x-auto my-3 rounded-xl border border-slate-200 shadow-sm">
                          <table className="min-w-full divide-y divide-slate-200 text-sm" {...props} />
                        </div>
                      ),
                      thead: (props) => <thead className="bg-gradient-to-b from-slate-50 to-slate-100/50" {...props} />,
                      tbody: (props) => <tbody className="divide-y divide-slate-100 bg-white/50" {...props} />,
                      tr: (props) => <tr className="hover:bg-slate-50 transition-colors" {...props} />,
                      th: (props) => <th className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-[11px] text-slate-600" {...props} />,
                      td: (props) => <td className="px-4 py-2.5 whitespace-pre-wrap" {...props} />,
                      hr: (props) => <hr className="my-4 border-slate-200" {...props} />,
                    }}
                  >
                    {preprocessMessageContent(msg.content)}
                  </ReactMarkdown>
                </div>
              </div>

              {msg.reasoning && (
                <div className="w-full">
                  <ReasoningBlock
                    text={msg.reasoning}
                    isOpen={false}
                    onToggle={() => { }}
                  />
                </div>
              )}

              {msg.parts && msg.parts.length > 0 && (
                <div className="w-full space-y-2 mt-1">
                  {msg.parts
                    .filter(p => p.type === 'tool')
                    .map((p: any, idx) => (
                      <ToolCallItem key={idx} evt={p.event} onUndo={onUndo} />
                    ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {(streamItems.length > 0 || busy || reasoningText) && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 border border-indigo-700 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
              <Bot className="w-4 h-4" />
            </div>
            <div className="flex flex-col gap-2 max-w-[90%] w-full">
              {reasoningText && (
                <ReasoningBlock
                  text={reasoningText}
                  isOpen={!!(reasoningText && busy)}
                  onToggle={() => setShowReasoning(!showReasoning)}
                  isComplete={!busy}
                />
              )}

              {streamItems.map((item, i) => (
                item.type === 'text' ? (
                  <div key={i} className="px-4 py-3 rounded-2xl rounded-tl-sm bg-white border border-slate-200 text-slate-700 shadow-sm text-sm leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={{
                        img: (props) => <ChatMedia {...props as any} />,
                        p: ({ children }) => <p className="mb-2 last:mb-0 leading-[1.7]">{children}</p>,
                        a: ({ node, ...props }) => <a {...props} className="text-indigo-500 hover:text-indigo-600 underline underline-offset-2 decoration-indigo-500/30 hover:decoration-indigo-500/50 transition-all" target="_blank" rel="noopener noreferrer" />,
                        code: ({ node, className, children, ...props }) => (
                          <code className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded-md text-[85%] font-mono font-semibold border border-slate-600/20 shadow-sm" {...props}>
                            {children}
                          </code>
                        ),
                        ul: (props) => <ul className="list-disc pl-6 mb-3 space-y-1.5 marker:text-slate-400 marker:text-sm" {...props} />,
                        ol: (props) => <ol className="list-decimal pl-6 mb-3 space-y-1.5 marker:text-slate-400 marker:text-sm marker:font-semibold" {...props} />,
                        li: (props) => <li className="leading-[1.7] pl-1" {...props} />,
                        blockquote: (props) => (
                          <blockquote className="border-l-4 border-indigo-500/40 pl-4 my-3 py-2 bg-gradient-to-r from-indigo-500/10 to-transparent rounded-r-lg" {...props}>
                            <span className="text-slate-600 italic leading-[1.7]">{props.children}</span>
                          </blockquote>
                        ),
                        h1: (props) => <h1 className="text-lg font-bold mb-3 mt-4 first:mt-0 tracking-tight border-b border-slate-200 pb-2" {...props} />,
                        h2: (props) => <h2 className="text-base font-bold mb-2.5 mt-3.5 first:mt-0 tracking-tight" {...props} />,
                        h3: (props) => <h3 className="text-sm font-bold mb-2 mt-3 first:mt-0" {...props} />,
                        h4: (props) => <h4 className="text-sm font-semibold mb-1.5 mt-2.5 first:mt-0" {...props} />,
                        strong: (props) => <strong className="font-bold" {...props} />,
                        em: (props) => <em className="italic" {...props} />,
                        table: (props) => (
                          <div className="overflow-x-auto my-3 rounded-xl border border-slate-200 shadow-sm">
                            <table className="min-w-full divide-y divide-slate-200 text-sm" {...props} />
                          </div>
                        ),
                        thead: (props) => <thead className="bg-gradient-to-b from-slate-50 to-slate-100/50" {...props} />,
                        tbody: (props) => <tbody className="divide-y divide-slate-100 bg-white/50" {...props} />,
                        tr: (props) => <tr className="hover:bg-slate-50 transition-colors" {...props} />,
                        th: (props) => <th className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-[11px] text-slate-600" {...props} />,
                        td: (props) => <td className="px-4 py-2.5 whitespace-pre-wrap" {...props} />,
                        hr: (props) => <hr className="my-4 border-slate-200" {...props} />,
                      }}
                    >
                      {preprocessMessageContent(item.content)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <ToolCallItem key={i} evt={item.event} onUndo={onUndo} />
                )
              ))}

              {busy && streamItems.length === 0 && !reasoningText && (
                <div className="flex items-center gap-2 text-slate-400 text-xs px-2 py-1">
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-75" />
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce delay-150" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
