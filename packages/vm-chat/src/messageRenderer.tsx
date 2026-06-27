import React, { useCallback } from 'react';
import { PortableMessageBubble } from '@stuardai/chat-ui/ui';
import { AskUserPrompt } from '@stuardai/chat-ui/AskUserPrompt';
import type { Message as ChatMessage, ToolCall } from '@stuardai/chat-ui/types';
import type { VmChatMessageRendererProps } from './types';

export type VmInteractiveToolContext = {
  askUserPrompts?: Array<{ id: string; args: unknown; status: 'pending' | 'completed' }>;
  onAskUserRespond?: (id: string, result: unknown) => void;
  onGenUIRespond?: (id: string, result: unknown) => void;
};

export function buildVmInteractiveToolRenderer(
  ctx: VmInteractiveToolContext,
  renderInteractiveTool?: (tool: ToolCall, key: string) => React.ReactNode | null,
): (tool: ToolCall, key: string) => React.ReactNode | null {
  return (tool: ToolCall, key: string) => {
    if (tool.tool === 'ask_user') {
      const tracked = ctx.askUserPrompts?.find((p) => p.id === tool.id);
      const isPending = tool.status !== 'completed' && tool.status !== 'error'
        && (!tracked || tracked.status === 'pending');
      if (!isPending || !ctx.onAskUserRespond) return null;
      return (
        <AskUserPrompt
          key={key}
          prompt={{ id: tool.id, args: tool.args }}
          onRespond={ctx.onAskUserRespond}
        />
      );
    }

    if (renderInteractiveTool) {
      const custom = renderInteractiveTool(tool, key);
      if (custom) return custom;
    }

    if (tool.status !== 'completed' && tool.status !== 'error' && ctx.onGenUIRespond) {
      return (
        <AskUserPrompt
          key={key}
          prompt={{ id: tool.id, args: tool.args }}
          onRespond={ctx.onGenUIRespond}
        />
      );
    }

    return null;
  };
}

export function createPortableVmMessageRenderer(options: {
  renderInteractiveTool?: (tool: ToolCall, key: string) => React.ReactNode | null;
  getInteractiveContext?: () => VmInteractiveToolContext;
}): React.ComponentType<VmChatMessageRendererProps> {
  return function PortableVmMessageRenderer(props: VmChatMessageRendererProps) {
    const ctx = options.getInteractiveContext?.() ?? {};
    const interactiveToolRenderer = useCallback(
      (tool: ToolCall, key: string) =>
        buildVmInteractiveToolRenderer(ctx, options.renderInteractiveTool)(tool, key),
      [ctx.askUserPrompts, ctx.onAskUserRespond, ctx.onGenUIRespond, options.renderInteractiveTool],
    );

    const message: Pick<ChatMessage, 'id' | 'role' | 'text' | 'reasoning' | 'reasoningDuration' | 'toolCalls' | 'streamChunks'> = {
      id: props.isStreaming ? 'streaming' : `msg-${props.role}`,
      role: props.role,
      text: props.text,
      reasoning: props.reasoning,
      reasoningDuration: props.reasoningDuration,
      toolCalls: props.toolCalls as ToolCall[] | undefined,
      streamChunks: props.streamChunks as ChatMessage['streamChunks'],
    };

    return (
      <PortableMessageBubble
        message={message}
        isStreaming={props.isStreaming}
        interactiveToolRenderer={interactiveToolRenderer}
      />
    );
  };
}
