import type { WebSocket } from 'ws';

import { drainInterjections } from '../socket/state';

export interface InterjectionPayload {
  count: number;
  content: string;
}

export function buildInterjectionContent(interjections: Array<{ text: string }>): string {
  const steerText = interjections
    .map((item, index) => `Interjection ${index + 1}: ${item.text}`)
    .join('\n');

  return `[User interjection while you were working]\n${steerText}\n\nUse this guidance in the next step before continuing.`;
}

export function createInterjectionUserMessage(content: string) {
  return {
    id: `interjection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    createdAt: new Date(),
    content: {
      format: 2,
      parts: [{ type: 'text', text: content }],
      content,
    },
  };
}

export function appendInterjectionToMessages(messages: any[], content: string) {
  return [...messages, createInterjectionUserMessage(content)];
}

export function drainInterjectionPayload(ws: WebSocket, requestId: string | undefined): InterjectionPayload | null {
  const interjections = drainInterjections(ws, requestId);
  if (interjections.length === 0) return null;

  return {
    count: interjections.length,
    content: buildInterjectionContent(interjections),
  };
}
