import { describe, expect, test } from "claude-code/testing";

describe("agents-panel", () => {
  test("lists the project's agents and runs one", async ($, on) => {
    const spawned: any[] = [];
    on("session.start", ($, e) => ({ cwd: e.cwd }));
    on("command.register", () => ({ value: { command: "agents-panel" } }) as any);
    on("ui.panes", () => ({ value: [] }) as any);
    on("ui.open", () => ({ value: { isPlaced: true } }) as any);
    on("fs.list", () => ({ value: [{ name: "docs-writer.md", kind: "file", size: 1, mtimeMs: 0, isLink: false }] }) as any);
    on("fs.read", () => ({ value: "---\nname: docs-writer\nmodel: haiku\ndescription: Keeps docs in sync.\n---\nbody" }) as any);
    on("ui.toast", () => ({ value: undefined }) as any);
    on("agent.spawn", ($, e) => {
      spawned.push(e);
      return { model: "haiku" } as any;
    });

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    await $.command.run({ command: "agents-panel", args: "" } as any);
    const ui = await $.ui.mount({
      plugin: "agents-panel",
      surface: "terminal",
      component: "Pane",
      requestId: "agents-panel",
      props: {},
    } as any);
    expect(await ui.find({ type: "Text", text: /docs-writer/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /Keeps docs in sync/ })).toBeDefined();
    await ui.press({ key: "run-docs-writer" });
    await new Promise((r) => setTimeout(r, 20));
    expect(spawned[0]?.subagent_type).toBe("docs-writer");
    await ui.unmount();
  });
});
