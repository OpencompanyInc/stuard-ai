import { describe, expect, it } from "vitest";
import { escapeCurrencyDollars, prepareMarkdownForDisplay } from "./text";

describe("text markdown preprocessing", () => {
  it("escapes standalone currency amounts", () => {
    expect(escapeCurrencyDollars("The total is $19.99 today.")).toBe(
      "The total is \\$19.99 today."
    );
  });

  it("preserves inline math that starts with numbers", () => {
    expect(
      escapeCurrencyDollars("Density is $1235.29 \\text{ kg/m}^3$.")
    ).toBe("Density is $1235.29 \\text{ kg/m}^3$.");
  });

  it("escapes price ranges instead of treating them as math", () => {
    expect(escapeCurrencyDollars("Tickets cost $5-$10.")).toBe(
      "Tickets cost \\$5-\\$10."
    );
  });

  it("converts latex delimiters while keeping currency literal", () => {
    expect(
      prepareMarkdownForDisplay(
        "Use \\(1235.29 \\text{ kg/m}^3\\) and compare it to $19.99."
      )
    ).toBe("Use $1235.29 \\text{ kg/m}^3$ and compare it to \\$19.99.");
  });
});
