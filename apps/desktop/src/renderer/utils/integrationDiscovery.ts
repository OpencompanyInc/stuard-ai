/**
 * Deep links and actions when users can't find an integration or toolbox node.
 */

import { getWebsiteBase } from './cloud';

/** Support ticket URL prefilled for an integration request. */
export function getIntegrationRequestUrl(searchQuery?: string): string {
  const q = String(searchQuery || '').trim();
  const params = new URLSearchParams({ category: 'feature_request' });
  params.set('subject', q ? `Integration request: ${q}` : 'Integration request');
  if (q) {
    params.set(
      'message',
      `I'd like to use "${q}" in Stuard workflows.\n\nWhat I need it to do:\n`,
    );
  }
  return `${getWebsiteBase()}/dashboard/support/new?${params.toString()}`;
}

export async function openIntegrationRequest(searchQuery?: string): Promise<void> {
  const url = getIntegrationRequestUrl(searchQuery);
  try {
    await (window as any).desktopAPI?.openExternal?.(url);
  } catch {
    /* noop */
  }
}

/** Opens the Custom Tools hub (user can start the integration builder from there). */
export async function openCustomIntegrationBuilder(): Promise<void> {
  try {
    await (window as any).desktopAPI?.openWorkflows?.({ view: 'tools' });
  } catch {
    /* noop */
  }
}
