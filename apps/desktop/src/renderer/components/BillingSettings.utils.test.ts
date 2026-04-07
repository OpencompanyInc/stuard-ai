import { describe, expect, it } from "vitest";
import {
  getUsageSourceCategory,
  getUsageSourceLabel,
  normalizeUsageLogEntry,
} from "./BillingSettings.utils";

describe("BillingSettings log normalization", () => {
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
});
