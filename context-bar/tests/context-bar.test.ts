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
    expect(await ui.find({ type: "Text", text: /^messages $/ })).toBeUndefined();

    await ui.press({ key: "toggle" });
    expect(await ui.find({ type: "Text", text: /^messages $/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^tools $/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /mcp tools/ })).toBeUndefined();

    messages = 120_000;
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] } as any);
    expect(await ui.find({ type: "Text", text: /^135k$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /^messages $/ })).toBeDefined();
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    expect(await ui.find({ type: "Text", text: /^messages $/ })).toBeDefined();

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

  test("the desktop draws the bar as sized blocks, not runs of characters", async ($, on) => {
    // The desktop counts columns in its code font but draws Text in a proportional one,
    // so a bar of spaces came out a third as wide as the card and one of ░ wrapped.
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("ui.render", ($, e) => $.ui.resolve(e).Box({}));
    on("session.usage", () => ({
      value: {
        startedAt: 0,
        rateLimits: [],
        context: {
          window: 200_000,
          breakdown: {
          model: "claude-opus-5-5",
          totalTokens: 35_000,
          maxTokens: 200_000,
          rawMaxTokens: 200_000,
          percentage: 18,
          isAutoCompactEnabled: true,
          autoCompactThreshold: 155_000,
          categories: [
            { name: "System tools", tokens: 15_000, color: "inactive", kind: "used", isDeferred: false },
            { name: "Messages", tokens: 20_000, color: "inactive", kind: "used", isDeferred: false },
            { name: "Free space", tokens: 120_000, color: "promptBorder", kind: "free", isDeferred: false },
            { name: "Autocompact buffer", tokens: 45_000, color: "inactive", kind: "buffer", isDeferred: false },
          ],
          },
        },
      },
    }) as any);
    on("command.register", () => ({ value: undefined }) as any);

    await $.session.start({ surface: "desktop", isInteractive: true, cwd: "/work" } as any);
    const ui = await $.ui.mount({
      plugin: "context-bar",
      surface: "desktop",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
    } as any);
    await ui.press({ key: "toggle" });
    const kids = (el: any): any[] => [el?.props?.children ?? el?.children ?? []].flat(Infinity).filter((c) => c && typeof c === "object");
    const all = (el: any): any[] => [el, ...kids(el).flatMap(all)];
    const tree = all(await ui.drawn());
    const blocks = tree.filter((el) => el.type === "Box" && el.props?.height === 1 && el.props?.backgroundColor);
    expect(blocks.reduce((s, b) => s + b.props.width, 0)).toBe(114);
    expect(await ui.find({ type: "Text", text: /^[ ░]{2,}$/ })).toBeUndefined();
    await ui.unmount();
  });
});
