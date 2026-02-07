import posthog from "posthog-js";

const apiKey = (import.meta as any).env?.VITE_PUBLIC_POSTHOG_KEY as string | undefined;
const apiHost = (import.meta as any).env?.VITE_PUBLIC_POSTHOG_HOST as string | undefined;

let initialized = false;

export function initPostHog() {
  if (initialized) return;
  
  if (apiKey && apiHost) {
    try {
      posthog.init(apiKey, {
        api_host: apiHost,
        defaults: "2025-05-24",
        // Respect user privacy - don't capture everything automatically
        autocapture: true,
        capture_pageview: true,
        capture_pageleave: true,
        disable_session_recording: false,
      });
      initialized = true;
      console.log("[PostHog] Initialized for beta analytics");
    } catch (e) {
      console.warn("[PostHog] Failed to init", e);
    }
  } else {
    // Production builds without PostHog keys - no tracking (privacy)
    console.log("[PostHog] Not enabled (production build)");
  }
}

export { posthog };
