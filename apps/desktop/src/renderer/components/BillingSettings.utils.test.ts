import { describe, expect, it } from "vitest";
import {
  aggregateComputeBillingEvents,
  buildCreditsApiPath,
  getUsageSourceCategory,
  getUsageSourceLabel,
  normalizeComputeBillingLogEntry,
  normalizeUsageLogEntry,
} from "./BillingSettings.utils";

describe("BillingSettings log normalization", () => {
  it("builds credits API paths with billing period filters", () => {
    const path = buildCreditsApiPath("/v1/credits/logs", {
      limit: 20,
      offset: 40,
      since: "2026-04-01T00:00:00.000Z",
    });

    const url = new URL(path, "http://localhost");
    expect(url.pathname).toBe("/v1/credits/logs");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("offset")).toBe("40");
    expect(url.searchParams.get("since")).toBe("2026-04-01T00:00:00.000Z");
  });

  it("omits invalid billing period filters from credits API paths", () => {
    const path = buildCreditsApiPath("/v1/credits/usage", {
      since: "not-a-date",
    });

    const url = new URL(path, "http://localhost");
    expect(url.pathname).toBe("/v1/credits/usage");
    expect(url.search).toBe("");
  });

  it("normalizes the snake_case log payload returned by the credits logs API", () => {
    const log = normalizeUsageLogEntry({
      id: "log_1",
      model: "openai/gpt-4o-mini",
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
      credit_cost: 1.25,
      cost_usd: 0.0543,
      conversation_id: "conv_1",
      created_at: "2026-04-07T12:00:00.000Z",
    });

    expect(log.sourceType).toBe("inference");
    expect(log.credits).toBe(1.25);
    expect(log.costUsd).toBe(0.0543);
    expect(log.totalTokens).toBe(20);
    expect(log.conversationId).toBe("conv_1");
    expect(log.createdAt).toBe("2026-04-07T12:00:00.000Z");
  });

  it("prefers raw metadata when source information exists there", () => {
    const log = normalizeUsageLogEntry({
      id: "log_2",
      model: "openai/gpt-4.1",
      credit_cost: 3,
      raw: {
        sourceType: "subagent",
        subagentKind: "browser",
        chatName: "Research sprint",
      },
      created_at: "2026-04-07T12:01:00.000Z",
    });

    expect(log.sourceType).toBe("subagent");
    expect(log.subagentKind).toBe("browser");
    expect(log.chatName).toBe("Research sprint");
    expect(getUsageSourceLabel(log.sourceType, log.subagentKind)).toBe(
      "Subagent"
    );
    expect(getUsageSourceCategory(log.sourceType, log.subagentKind)).toBe(
      "subagent"
    );
  });

  it("prefers source_label from raw when available", () => {
    const log = normalizeUsageLogEntry({
      id: "log_src",
      model: "google/gemini-3.1-pro-preview",
      credit_cost: 5,
      raw: {
        sourceType: "inference",
        source_label: "Workflow: Study",
      },
      created_at: "2026-04-10T12:00:00.000Z",
    });

    expect(log.sourceLabel).toBe("Workflow: Study");
    expect(getUsageSourceLabel(log.sourceType, log.subagentKind, log.sourceLabel)).toBe(
      "Workflow: Study"
    );
  });

  it("falls back to sourceType label when source_label is absent", () => {
    const log = normalizeUsageLogEntry({
      id: "log_no_src",
      model: "openai/gpt-4o-mini",
      credit_cost: 1,
      created_at: "2026-04-10T12:01:00.000Z",
    });

    expect(log.sourceLabel).toBeNull();
    expect(getUsageSourceLabel(log.sourceType, log.subagentKind, log.sourceLabel)).toBe(
      "Chat"
    );
  });

  it("classifies messaging sources without relying on raw charAt access", () => {
    const log = normalizeUsageLogEntry({
      id: "log_3",
      model: "messaging:whatsapp",
      credit_cost: 0.5,
      created_at: "2026-04-07T12:02:00.000Z",
    });

    expect(log.sourceType).toBe("messaging:whatsapp");
    expect(getUsageSourceLabel(log.sourceType)).toBe("WhatsApp Agent");
    expect(getUsageSourceCategory(log.sourceType)).toBe("messaging");
  });

  it("normalizes VM compute billing rows for usage logs", () => {
    const log = normalizeComputeBillingLogEntry({
      id: "compute_1",
      event_type: "compute",
      credits_deducted: "2.25",
      details: { machineType: "e2-standard-4", hourlyUsd: 0.067 },
      billing_hour: "2026-05-01T12:00:00.000Z",
    });

    expect(log.sourceType).toBe("compute");
    expect(log.sourceLabel).toBe("VM Runtime");
    expect(log.model).toBe("compute:e2-standard-4");
    expect(log.credits).toBe(2.25);
    expect(getUsageSourceCategory(log.sourceType)).toBe("compute");
  });

  it("aggregates compute and storage billing rows into dashboard categories", () => {
    const rows = aggregateComputeBillingEvents([
      { event_type: "compute", credits_deducted: 2, details: { hourlyUsd: 0.06 } },
      { event_type: "hot_storage", credits_deducted: 0.5, details: { hourlyUsd: 0.01 } },
      { event_type: "cold_storage", credits_deducted: 0.25, details: { hourlyUsd: 0.005 } },
    ]);

    expect(rows).toEqual([
      { category: "compute", credits: 2, costUsd: 0.06, count: 1 },
      { category: "storage", credits: 0.75, costUsd: 0.015, count: 2 },
    ]);
  });
});
