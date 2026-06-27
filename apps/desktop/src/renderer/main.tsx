import React from "react";
import ReactDOM from "react-dom/client";
import { PostHogProvider } from "posthog-js/react";
import { initPostHog, posthog } from "./lib/posthog";
import { OnboardingProvider } from "./components/onboarding";
import App from "./App";
import "./styles.css";

// Initialize PostHog for beta builds (no-op in production)
initPostHog();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PostHogProvider client={posthog}>
      <OnboardingProvider>
        <App />
      </OnboardingProvider>
    </PostHogProvider>
  </React.StrictMode>
);
