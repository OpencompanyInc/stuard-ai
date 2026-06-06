import React, { useEffect, useMemo, useRef } from 'react';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { Expand, LayoutPanelLeft, Loader2 } from 'lucide-react';
import { GENUI_TOOL_NAMES } from '../messages/MessageBubble/constants';
import { humanizeToolName } from '../messages/MessageBubble/helpers/toolLabels';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { uniqueBrands, toolToBrand, type ToolBrand } from '../../../../utils/toolBrand';
import { AudioPlayer } from '../../../AudioPlayer';
import { LinkPreview } from '../../../LinkPreview';
import { extractContentSegments } from '../messages/MessageBubble/helpers/content';
import { toMediaSrc } from '../messages/MessageBubble/helpers/media';
import type { ContentSegment } from '../messages/MessageBubble/types';
import { InlineFilePreview } from '../messages/MessageBubble/inline/InlineFilePreview';
import { InlineImage } from '../messages/MessageBubble/inline/InlineImage';
import { InlineVideo } from '../messages/MessageBubble/inline/InlineVideo';
import { YouTubeEmbed } from '../messages/MessageBubble/inline/YouTubeEmbed';

interface ToolCallLike {
  id: string;
  tool: string;
  status: 'called' | 'running' | 'completed' | 'error';
}

interface CompactResponsePanelProps {
  /** The user's most recent prompt, shown as a right-aligned bubble. */
  userPrompt: string;
  /** The assistant's streamed reply, shown as a left-aligned bubble. */
  assistantText?: string;
  /** Show a "…" pulse while the assistant is still mid-stream. */
  isStreaming?: boolean;
  /** Tool calls from the in-flight assistant turn — feeds the brand chips. */
  toolCalls?: readonly ToolCallLike[];
  /** Expand to full chat window. */
  onExpand?: () => void;
  /** Hide the panel (chevron-down). */
  onCollapse?: () => void;
  /** Show frosted-glass tint behind the card. */
  translucentMode?: boolean;
  /** Max chips visible before collapsing into a "+N". */
  maxChips?: number;
  /** Strip outer chrome when nested inside CompactHub. */
  embedded?: boolean;
  /** Reports the panel's rendered height for compact window sizing. */
  onMeasuredHeightChange?: (height: number) => void;
}

// Theme tokens — `--compact-pill-*` flips between light/dark in styles.css.
const CARD_BG = 'rgb(var(--compact-pill-bg))';
const CARD_BG_TRANSLUCENT = 'color-mix(in srgb, rgb(var(--compact-pill-bg)) 88%, transparent)';
const CARD_BORDER = 'rgb(var(--compact-pill-fg) / 0.18)';
const ACTIVE_RING = '#FF383C';
const MUTED_FG = 'rgb(var(--compact-pill-fg-muted))';
const TEXT_FG = 'rgb(var(--compact-pill-fg))';

// User-message bubble in compact response panel.
const USER_BUBBLE_BG = '#FFFFFF';
const USER_BUBBLE_FG = '#171717';

const PANEL_MAX_HEIGHT = 460;

export { PANEL_MAX_HEIGHT as COMPACT_RESPONSE_PANEL_MAX_HEIGHT };

/** True when the reply includes GenUI (markdown blocks or tool calls) needing full view. */
export function hasCompactRichContent(
  text: string | undefined,
  toolCalls?: readonly { tool: string }[],
): boolean {
  if (text?.trim()) {
    const fromText = extractContentSegments(text).some(
      (s) => s.kind === 'genui' || s.kind === 'genui_loading',
    );
    if (fromText) return true;
  }
  return toolCalls?.some((t) => GENUI_TOOL_NAMES.has(t.tool)) ?? false;
}

type CompactRichMeta = { title: string; hint: string };

const COMPACT_RICH_META: Record<string, CompactRichMeta> = {
  chat_ui: {
    title: 'Interactive UI',
    hint: 'Custom buttons and layouts are easier to use in the full conversation view.',
  },
  ask_confirmation: {
    title: 'Confirmation needed',
    hint: 'Open the full view to confirm or cancel this step.',
  },
  show_choices: {
    title: 'Choose an option',
    hint: 'Open the full view to pick from the list.',
  },
  request_files: {
    title: 'File upload',
    hint: 'Open the full view to attach or drop files.',
  },
  show_files: {
    title: 'File browser',
    hint: 'Open the full view to browse and select files.',
  },
  show_form: {
    title: 'Form',
    hint: 'Open the full view to complete the form.',
  },
  show_feedback_form: {
    title: 'Feedback',
    hint: 'Open the full view to submit your bug report or feature request.',
  },
};

function getCompactRichContentMeta(component: string): CompactRichMeta {
  const key = component.toLowerCase();
  return (
    COMPACT_RICH_META[key] ?? {
      title: humanizeToolName(component),
      hint: 'This part of the reply needs more space — open the full conversation view.',
    }
  );
}

function activeBrandKey(
  toolCalls: readonly ToolCallLike[] | undefined,
): string | null {
  if (!toolCalls || toolCalls.length === 0) return null;
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const call = toolCalls[i];
    if (call.status === 'running' || call.status === 'called') {
      const brand = toolToBrand(call.tool);
      if (brand) return brand.key;
    }
  }
  const last = toolCalls[toolCalls.length - 1];
  return toolToBrand(last.tool)?.key ?? null;
}

const BrandChip: React.FC<{ brand: ToolBrand; active: boolean }> = ({
  brand,
  active,
}) => {
  return (
    <span
      title={brand.label}
      className="relative inline-flex items-center justify-center shrink-0 rounded-full overflow-hidden"
      style={{
        width: 14,
        height: 14,
        background: USER_BUBBLE_BG,
        border: active ? `0.2px solid ${ACTIVE_RING}` : `0.1px solid ${CARD_BORDER}`,
        margin: '0 -3px',
        boxSizing: 'border-box',
      }}
    >
      {brand.logo ? (
        <img
          src={brand.logo}
          alt={brand.label}
          draggable={false}
          className="object-contain select-none"
          style={{ width: 8.8, height: 8.8 }}
        />
      ) : brand.icon ? (
        <brand.icon
          strokeWidth={2}
          style={{
            width: 8.8,
            height: 8.8,
            color: brand.color || TEXT_FG,
          }}
        />
      ) : null}
    </span>
  );
};

/** Minimal markdown renderer for compact text segments. Media from <<path>>
 *  markers is handled by extractContentSegments before markdown runs. */
const COMPACT_MD_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p: ({ node, children, ...props }) => (
    <p style={{ margin: '0 0 6px 0' }} {...props}>
      {children}
    </p>
  ),
  ul: ({ node, children, ...props }) => (
    <ul style={{ paddingLeft: 18, margin: '0 0 6px 0' }} {...props}>
      {children}
    </ul>
  ),
  ol: ({ node, children, ...props }) => (
    <ol style={{ paddingLeft: 18, margin: '0 0 6px 0' }} {...props}>
      {children}
    </ol>
  ),
  li: ({ node, children, ...props }) => (
    <li style={{ margin: '0 0 2px 0' }} {...props}>
      {children}
    </li>
  ),
  code: ({ node, inline, className, children, ...props }: any) =>
    inline ? (
      <code
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: '0.92em',
          padding: '1px 4px',
          borderRadius: 4,
          background: 'rgb(var(--compact-pill-fg) / 0.08)',
        }}
        {...props}
      >
        {children}
      </code>
    ) : (
      <pre
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 11,
          padding: 8,
          borderRadius: 8,
          background: 'rgb(var(--compact-pill-fg) / 0.06)',
          overflowX: 'auto',
          margin: '0 0 6px 0',
        }}
      >
        <code {...props}>{children}</code>
      </pre>
    ),
  a: ({ href, children, ...props }: any) => (
    <a
      href={href}
      onClick={(e) => {
        if (typeof href === 'string' && !/^(javascript|vbscript):/i.test(href)) {
          e.preventDefault();
          e.stopPropagation();
          try {
            (window as any).desktopAPI?.openExternal?.(href);
          } catch {
            // ignore — external open is best-effort
          }
        }
      }}
      style={{
        color: '#818CF8',
        textDecoration: 'underline',
        textUnderlineOffset: 2,
      }}
      {...props}
    >
      {children}
    </a>
  ),
  h1: ({ node, children, ...props }) => (
    <div style={{ fontWeight: 600, fontSize: 14, margin: '0 0 6px 0' }} {...props}>
      {children}
    </div>
  ),
  h2: ({ node, children, ...props }) => (
    <div style={{ fontWeight: 600, fontSize: 13, margin: '0 0 4px 0' }} {...props}>
      {children}
    </div>
  ),
  h3: ({ node, children, ...props }) => (
    <div style={{ fontWeight: 600, fontSize: 12, margin: '0 0 4px 0' }} {...props}>
      {children}
    </div>
  ),
  img: ({ node, src, alt, ...props }: any) => {
    const nodeUrl = (node && (node.url || (node.properties && node.properties.src))) || '';
    const finalSrc = src || nodeUrl || '';
    const isAudio = /\.(wav|mp3|ogg|m4a|aac)(\?|$)/i.test(finalSrc) || alt === 'audio';
    const isVideo = /\.(mp4|mov|m4v|webm)(\?|$)/i.test(finalSrc) || alt === 'video';
    if (isAudio) return <AudioPlayer src={toMediaSrc(finalSrc)} />;
    if (isVideo) return <InlineVideo src={finalSrc} />;
    return <InlineImage src={finalSrc} alt={alt} />;
  },
};

const CompactRichContentPlaceholder: React.FC<{
  component: string;
  loading?: boolean;
  streamTitle?: string;
  onExpand?: () => void;
}> = ({ component, loading, streamTitle, onExpand }) => {
  if (component === 'agent_todo') return null;

  const meta = getCompactRichContentMeta(component);
  const title = streamTitle?.trim() || meta.title;

  return (
    <div
      className="compact-rich-content-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 12,
        border: `0.1px solid ${CARD_BORDER}`,
        background: 'rgb(var(--compact-pill-fg) / 0.05)',
        margin: '4px 0',
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className="shrink-0 flex items-center justify-center rounded-lg"
          style={{
            width: 28,
            height: 28,
            background: 'rgb(var(--compact-pill-fg) / 0.08)',
            color: MUTED_FG,
          }}
        >
          {loading ? (
            <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
          ) : (
            <LayoutPanelLeft strokeWidth={1.75} style={{ width: 14, height: 14 }} />
          )}
        </span>
        <div className="min-w-0 flex-1" style={{ gap: 2, display: 'flex', flexDirection: 'column' }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: 12,
              lineHeight: '16px',
              color: TEXT_FG,
            }}
          >
            {loading ? `Preparing ${title.toLowerCase()}…` : title}
          </span>
          <span
            style={{
              fontSize: 11,
              lineHeight: '15px',
              color: MUTED_FG,
            }}
          >
            {loading
              ? 'Still generating — you can open the full view to watch it appear.'
              : meta.hint}
          </span>
        </div>
      </div>
      {onExpand && (
        <button
          type="button"
          onClick={onExpand}
          className="no-drag self-start compact-rich-content-cta"
          style={{
            fontFamily: "'General Sans', system-ui, sans-serif",
            fontSize: 11,
            fontWeight: 600,
            lineHeight: '14px',
            padding: '6px 10px',
            borderRadius: 8,
            border: `0.1px solid ${CARD_BORDER}`,
            background: USER_BUBBLE_BG,
            color: USER_BUBBLE_FG,
            cursor: 'pointer',
          }}
        >
          Open full view
        </button>
      )}
    </div>
  );
};

function renderCompactSegment(
  seg: ContentSegment,
  idx: number,
  onExpand?: () => void,
) {
  if (seg.kind === 'genui' || seg.kind === 'genui_loading') {
    return (
      <CompactRichContentPlaceholder
        key={`compact-rich-${idx}`}
        component={seg.component}
        loading={seg.kind === 'genui_loading'}
        streamTitle={seg.kind === 'genui_loading' ? seg.title : undefined}
        onExpand={onExpand}
      />
    );
  }
  if (seg.kind === 'image') {
    return <InlineImage key={`compact-img-${idx}`} src={seg.src} />;
  }
  if (seg.kind === 'video') {
    return <InlineVideo key={`compact-vid-${idx}`} src={seg.src} />;
  }
  if (seg.kind === 'audio') {
    return <AudioPlayer key={`compact-aud-${idx}`} src={toMediaSrc(seg.src)} />;
  }
  if (seg.kind === 'file') {
    return <InlineFilePreview key={`compact-file-${idx}`} src={seg.src} />;
  }
  if (seg.kind === 'youtube') {
    return <YouTubeEmbed key={`compact-yt-${idx}`} videoId={seg.videoId} url={seg.url} />;
  }
  if (seg.kind === 'link_preview') {
    return <LinkPreview key={`compact-lp-${idx}`} url={seg.url} />;
  }
  if (seg.kind === 'text') {
    return (
      <ReactMarkdown
        key={`compact-md-${idx}`}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
        urlTransform={(url) => url}
        components={COMPACT_MD_COMPONENTS}
      >
        {seg.value}
      </ReactMarkdown>
    );
  }
  return null;
}

const CompactAssistantContent: React.FC<{
  text: string;
  onExpand?: () => void;
}> = ({ text, onExpand }) => {
  const segments = useMemo(() => extractContentSegments(text), [text]);
  const richOnly =
    segments.length > 0 &&
    segments.every((s) => s.kind === 'genui' || s.kind === 'genui_loading');

  if (segments.length === 0) return null;

  return (
    <>
      {richOnly && onExpand && (
        <p
          style={{
            margin: '0 0 6px 0',
            fontSize: 11,
            lineHeight: '15px',
            color: MUTED_FG,
          }}
        >
          This reply includes interactive content that is not shown in compact mode.
        </p>
      )}
      {segments.map((seg, idx) => renderCompactSegment(seg, idx, onExpand))}
    </>
  );
};

const TypingDots: React.FC = () => (
  <span
    aria-label="Assistant is typing"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      verticalAlign: 'middle',
      marginLeft: 4,
    }}
  >
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        style={{
          width: 3,
          height: 3,
          borderRadius: '50%',
          background: 'currentColor',
          opacity: 0.6,
          animation: `compactResponseDot 1.1s ${i * 0.18}s infinite ease-in-out`,
        }}
      />
    ))}
    <style>{`
      @keyframes compactResponseDot {
        0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
        40%          { opacity: 1;    transform: translateY(-2px); }
      }
    `}</style>
  </span>
);

/**
 * Floating response container for compact mode (Figma Frame 2147227545).
 *
 * Layout: ~372px-wide card with the user's most-recent prompt right-aligned
 * at the top, the assistant's streamed reply left-aligned below it, a header
 * row (expand / collapse), and a footer row showing which integrations the
 * assistant is currently touching.
 */
export const CompactResponsePanel: React.FC<CompactResponsePanelProps> = ({
  userPrompt,
  assistantText,
  isStreaming = false,
  toolCalls,
  onExpand,
  onCollapse,
  translucentMode = false,
  maxChips = 3,
  embedded = false,
  onMeasuredHeightChange,
}) => {
  // Tool calls clear from agent state the moment a turn ends, but the panel
  // stays open showing the user's prompt — so the brand chips would blink out.
  // Cache the most recent non-empty list keyed by the prompt and reuse it
  // until the next prompt arrives.
  const cachedRef = useRef<readonly ToolCallLike[]>([]);
  const cachedPromptRef = useRef<string>(userPrompt);
  useEffect(() => {
    if (userPrompt !== cachedPromptRef.current) {
      cachedPromptRef.current = userPrompt;
      cachedRef.current = [];
    }
    if (toolCalls && toolCalls.length > 0) {
      cachedRef.current = toolCalls;
    }
  }, [toolCalls, userPrompt]);

  const effectiveCalls =
    toolCalls && toolCalls.length > 0 ? toolCalls : cachedRef.current;
  const brands = uniqueBrands(effectiveCalls.map((t) => t.tool));
  const visibleBrands = brands.slice(-maxChips);
  const activeKey = activeBrandKey(effectiveCalls);
  const activeBrand =
    visibleBrands.find((b) => b.key === activeKey) ??
    visibleBrands[visibleBrands.length - 1] ??
    null;

  const hasAssistantText = !!(assistantText && assistantText.trim());

  const genUiToolName = useMemo(() => {
    for (let i = effectiveCalls.length - 1; i >= 0; i--) {
      const call = effectiveCalls[i];
      if (GENUI_TOOL_NAMES.has(call.tool)) return call.tool;
    }
    return null;
  }, [effectiveCalls]);

  const textHasRichBlocks = useMemo(() => {
    if (!assistantText?.trim()) return false;
    return extractContentSegments(assistantText).some(
      (s) => s.kind === 'genui' || s.kind === 'genui_loading',
    );
  }, [assistantText]);

  const showGenUiFromTools = !!genUiToolName && !textHasRichBlocks;

  // Auto-scroll the body to the latest content as the assistant streams.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [assistantText]);

  useEffect(() => {
    if (!onMeasuredHeightChange) return;
    const el = rootRef.current;
    if (!el) return;

    const report = () => {
      onMeasuredHeightChange(Math.ceil(el.getBoundingClientRect().height));
    };

    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasuredHeightChange, userPrompt, assistantText, isStreaming, embedded]);

  return (
    <div
      ref={rootRef}
      data-compact-hit-area="true"
      className={clsx('no-drag flex flex-col items-stretch w-full', embedded ? '' : 'mx-auto')}
      style={{
        width: embedded ? '100%' : '100%',
        maxWidth: embedded ? undefined : 372,
        maxHeight: embedded ? 280 : PANEL_MAX_HEIGHT,
        padding: embedded ? '8px 12px 12px' : 12,
        gap: 8,
        ...(embedded
          ? { boxSizing: 'border-box' as const }
          : {
              background: translucentMode ? CARD_BG_TRANSLUCENT : CARD_BG,
              border: `0.1px solid ${CARD_BORDER}`,
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
              borderRadius: 24,
              boxShadow: 'var(--compact-pill-shadow)',
              boxSizing: 'border-box' as const,
            }),
      }}
    >
        {/* Header — expand (left) / collapse-chevron (right) */}
        {!embedded && (
        <div
          className="flex flex-row items-center justify-between self-stretch shrink-0"
          style={{ height: 16, gap: 10 }}
        >
          <button
            type="button"
            title="Open full conversation view"
            aria-label="Open full conversation view"
            onClick={onExpand}
            className="no-drag flex items-center justify-center hover:opacity-80 transition-opacity"
            style={{ width: 16, height: 16, color: MUTED_FG }}
          >
            <Expand strokeWidth={1.5} style={{ width: 14, height: 14 }} />
          </button>
          <button
            type="button"
            title="Hide"
            onClick={onCollapse}
            className="no-drag flex items-center justify-center hover:opacity-80 transition-opacity"
            style={{ width: 16, height: 16, color: MUTED_FG }}
          >
            <ChevronDownIcon style={{ width: 16, height: 16 }} />
          </button>
        </div>
        )}

        {/* Body — user prompt (right) + assistant reply (left), scrolls when overflowing */}
        <div
          ref={bodyRef}
          className="flex flex-col self-stretch overflow-y-auto custom-scrollbar"
          style={{
            gap: 6,
            maxHeight: embedded ? 200 : PANEL_MAX_HEIGHT - 54,
          }}
        >
          <div className="flex justify-end shrink-0">
            <div
              className="flex flex-col items-end"
              style={{
                maxWidth: 260,
                padding: '7px 10px',
                background: USER_BUBBLE_BG,
                borderRadius: 14,
                boxSizing: 'border-box',
              }}
            >
              <div
                className="self-stretch"
                style={{
                  fontFamily: "'General Sans', system-ui, sans-serif",
                  fontWeight: 400,
                  fontSize: 12,
                  lineHeight: '18px',
                  color: USER_BUBBLE_FG,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {userPrompt}
              </div>
            </div>
          </div>

          {(hasAssistantText || isStreaming || showGenUiFromTools) && (
            <div
              className="self-stretch shrink-0 compact-response-md"
              style={{
                fontFamily: "'General Sans', system-ui, sans-serif",
                fontWeight: 400,
                fontSize: 12,
                lineHeight: '18px',
                color: TEXT_FG,
                wordBreak: 'break-word',
                paddingTop: 2,
              }}
            >
              {showGenUiFromTools && genUiToolName && (
                <>
                  {!hasAssistantText && (
                    <p
                      style={{
                        margin: '0 0 6px 0',
                        fontSize: 11,
                        lineHeight: '15px',
                        color: MUTED_FG,
                      }}
                    >
                      The assistant shared interactive content that is not shown in compact mode.
                    </p>
                  )}
                  <CompactRichContentPlaceholder
                    component={genUiToolName}
                    loading={isStreaming}
                    onExpand={onExpand}
                  />
                </>
              )}
              {hasAssistantText && (
                <CompactAssistantContent text={assistantText!} onExpand={onExpand} />
              )}
              {isStreaming && <TypingDots />}
            </div>
          )}
        </div>

        {/* Footer — brand chips + active-brand label */}
        <div
          className="flex flex-row items-center self-stretch shrink-0"
          style={{ height: 14 }}
        >
          {visibleBrands.length === 0 ? (
            <div style={{ height: 14 }} />
          ) : (
            <div className="flex items-center" style={{ gap: 6 }}>
              <div className="flex items-center">
                {visibleBrands.map((brand) => (
                  <BrandChip
                    key={brand.key}
                    brand={brand}
                    active={brand.key === activeKey}
                  />
                ))}
              </div>
              {activeBrand && (
                <span
                  style={{
                    fontFamily: "'General Sans', system-ui, sans-serif",
                    fontWeight: 400,
                    fontSize: 8,
                    lineHeight: '13px',
                    color: MUTED_FG,
                    whiteSpace: 'nowrap',
                  }}
                >
                  using {activeBrand.label}...
                </span>
              )}
            </div>
          )}
        </div>
    </div>
  );
};

export default CompactResponsePanel;
