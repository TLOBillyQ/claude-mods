import { describe, expect, test } from "claude-code/testing";

describe("context-bar", () => {
  test("the band shows the /context breakdown and follows each measurement", async ($, on) => {
    // Hooks registered here run after the mod and stub what Claude Code would answer.
    let messages = 20_000;
    const breakdown = () => {
      const used = 3_000 + 12_000 + messages;
      return {
        model: "claude-opus-5-5",
        totalTokens: used,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        percentage: Math.round(used / 2_000),
        isAutoCompactEnabled: true,
        autoCompactThreshold: 155_000,
        categories: [
          { name: "System prompt", tokens: 3_000, color: "promptBorder", kind: "used", isDeferred: false },
          { name: "System tools", tokens: 12_000, color: "inactive", kind: "used", isDeferred: false },
          { name: "MCP tools", tokens: 8_000, color: "cyan_FOR_SUBAGENTS_ONLY", kind: "deferred", isDeferred: true },
          { name: "Messages", tokens: messages, color: "purple_FOR_SUBAGENTS_ONLY", kind: "used", isDeferred: false },
          { name: "Free space", tokens: 200_000 - 45_000 - used, color: "promptBorder", kind: "free", isDeferred: false },
          { name: "Autocompact buffer", tokens: 45_000, color: "inactive", kind: "buffer", isDeferred: false },
        ],
      };
    };
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("session.usage", ($, e) => ({
      value: {
        startedAt: 0,
        rateLimits: [],
        context: { window: 200_000, breakdown: e.breakdown ? breakdown() : undefined },
      },
    }));
    on("session.measure", () => ({ changed: ["context"] }));
    on("command.run", () => ({ text: "" }));
    on("ui.render", ($, e) => $.ui.resolve(e).Box({}));
    on("command.register", () => ({ value: undefined }) as any);

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({
      plugin: "context-bar",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
    } as any);
    expect(await ui.find({ type: "Text", text: /^35k$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /of 200k · compacts at 155k/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: / 18% / })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^messages $/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^tools $/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /mcp tools/ })).toBeUndefined();

    messages = 120_000;
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] } as any);
    expect(await ui.find({ type: "Text", text: /^135k$/ })).toBeDefined();

    await ui.press({ key: "toggle" });
    expect(await ui.find({ type: "Text", text: /^messages $/ })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: / 68% / })).toBeDefined();

    await ui.press({ key: "toggle" });
    expect(await ui.find({ type: "Text", text: /^messages $/ })).toBeDefined();

    expect(await $.command.run({ command: "context-bar", args: "" } as any)).toMatchObject({ text: "Context bar hidden." });
    expect(await ui.find({ type: "Text", text: /^135k$/ })).toBeUndefined();
    expect(await $.command.run({ command: "context-bar", args: "" } as any)).toMatchObject({ text: "Context bar shown." });
    expect(await ui.find({ type: "Text", text: /^135k$/ })).toBeDefined();
    await ui.unmount();
  });
});
