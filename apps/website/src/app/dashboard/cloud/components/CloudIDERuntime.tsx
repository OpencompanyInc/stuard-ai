'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import { CloudRuntimeWorkspace } from '@stuardai/cloud-runtime-ui';
import type { CloudRuntimeView } from '@stuardai/cloud-runtime-ui/shell';
import { readFile, getServeUrl, getPreviewUrl } from '@/lib/cloudApi';
import { CloudIDEChat } from './CloudIDEChat';
import { CloudIDETerminal } from './CloudIDETerminal';

export function CloudIDERuntime({
  engine,
  onRefresh,
  pauseLoading,
  deleteLoading,
  onPause,
  onDelete,
  explorer,
  terminal,
  views,
}: {
  engine: any;
  onRefresh: () => void | Promise<void>;
  pauseLoading?: boolean;
  deleteLoading?: boolean;
  onPause: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  explorer: React.ReactNode;
  terminal: React.ReactNode;
  views: Omit<Record<CloudRuntimeView, React.ReactNode>, 'chat'>;
}) {
  const fileFetcher = useCallback(async (path: string) => {
    const res = await readFile(path);
    if (!res.ok || res.content == null) return null;
    return {
      content: res.content,
      encoding: (res.encoding === 'base64' ? 'base64' : 'utf-8') as 'utf-8' | 'base64',
      size: res.size || 0,
    };
  }, []);

  // Reused serve-session token so HTML preview / relative assets resolve
  // without minting a new session per file. Matches desktop's viewSessionRef.
  const viewSessionRef = useRef<{ sid: string; expiresAt: number } | null>(null);
  const serveUrlBuilder = useCallback(
    (path: string) => getServeUrl(path, viewSessionRef),
    [],
  );
  const previewUrlBuilder = useCallback((port: number) => getPreviewUrl(port), []);

  const viewMap = useMemo(
    () => ({
      ...views,
      chat: <CloudIDEChat engine={engine} />,
    }),
    [views, engine],
  );

  return (
    <div className="cloud-engine-dashboard cloud-ide h-full min-h-0">
      <CloudRuntimeWorkspace
        engine={engine}
        pauseLoading={pauseLoading || deleteLoading}
        onPause={onPause}
        onRefresh={onRefresh}
        onDelete={onDelete}
        explorer={explorer}
        terminal={terminal}
        views={viewMap}
        fileFetcher={fileFetcher}
        serveUrlBuilder={serveUrlBuilder}
        previewUrlBuilder={previewUrlBuilder}
        activityBarVariant="desktop"
      />
    </div>
  );
}
