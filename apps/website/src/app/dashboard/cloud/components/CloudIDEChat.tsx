'use client';

import React, { useCallback, useMemo } from 'react';
import { VmChat } from '@stuardai/vm-chat';
import { useModelRegistry } from '@/hooks/useModelRegistry';
import { createWebVmChatPlatform } from '@/lib/vmChatWebPlatform';
import { ChatUiBlock } from './ChatUiBlock';
import type { ToolCall } from '@stuardai/chat-ui/types';

export function CloudIDEChat({ engine }: { engine: { status?: string; instance_name?: string } }) {
  const { models, modelById } = useModelRegistry();
  const platform = useMemo(() => createWebVmChatPlatform(), []);

  const renderInteractiveTool = useCallback(
    (tool: { id: string; tool: string; status?: string; args?: unknown }, key: string): React.ReactNode | null => {
      if (tool.tool === 'chat_ui') {
        return <ChatUiBlock key={key} tool={tool as ToolCall} />;
      }
      return null;
    },
    [],
  );

  return (
    <VmChat
      engine={engine}
      platform={platform}
      renderInteractiveTool={renderInteractiveTool}
      models={models}
      modelById={modelById}
      className="h-full"
      variant="workspace"
    />
  );
}
