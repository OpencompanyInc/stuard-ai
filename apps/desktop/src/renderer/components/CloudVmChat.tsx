import React, { useMemo } from 'react';
import { VmChat, type VmChatMessageRendererProps } from '@stuardai/vm-chat';
import MessageBubble from './chat/shared/messages/MessageBubble/MessageBubble';
import { ModelProviderLogo } from './ModelProviderLogo';
import { useModelRegistry } from '../hooks/useModelRegistry';
import { cloudClient } from '../hooks/useCloudEngine';
import { createDesktopVmChatPlatform } from '../adapters/vmChatDesktopPlatform';

function DesktopMessageRenderer(props: VmChatMessageRendererProps) {
  return (
    <MessageBubble
      role={props.role}
      text={props.text}
      reasoning={props.reasoning}
      reasoningDuration={props.reasoningDuration}
      toolCalls={props.toolCalls as Parameters<typeof MessageBubble>[0]['toolCalls']}
      streamChunks={props.streamChunks as Parameters<typeof MessageBubble>[0]['streamChunks']}
      attachments={props.attachments as Parameters<typeof MessageBubble>[0]['attachments']}
      isStreaming={props.isStreaming}
      onSubmitToolOutput={props.onSubmitToolOutput}
      onGenUIResponse={props.onGenUIResponse}
    />
  );
}

export function CloudVmChat({
  engine,
  className,
  variant = 'default',
}: {
  engine: { status?: string; instance_name?: string };
  className?: string;
  variant?: 'default' | 'workspace';
}) {
  const { models, modelById } = useModelRegistry();
  const platform = useMemo(() => createDesktopVmChatPlatform(cloudClient), []);

  return (
    <VmChat
      engine={engine}
      platform={platform}
      MessageRenderer={DesktopMessageRenderer}
      ModelLogo={ModelProviderLogo}
      models={models}
      modelById={modelById}
      className={className}
      variant={variant}
    />
  );
}
