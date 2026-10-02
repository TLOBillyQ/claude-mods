import { describe, expect, test } from "claude-code/testing";
import { diff } from "../hooks/replay-theater.mjs";

describe("diff", () => {
  test("marks changed lines and folds far context", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "d", "E", "f", "g", "h"].join("\n");
    expect(diff(before, after)).toEqual([
      { op: "…", text: "" },
      { op: " ", text: "c" },
      { op: " ", text: "d" },
      { op: "-", text: "e" },
      { op: "+", text: "E" },
      { op: " ", text: "f" },
      { op: " ", text: "g" },
      { op: "…", text: "" },
    ]);
    expect(diff("", "new")).toEqual([{ op: "+", text: "new" }]);
  });
});

describe("replay-theater", () => {
  test("records a turn's edits and steps through them", async ($, on) => {
    const opened: string[] = [];
    on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
    on("command.register", ($: any, e: any) => ({ value: { command: e.name } }));
    on("fs.read", ($: any, e: any) => ({ value: "old line\n" }));
    on("tool.call", () => ({ result: "ok" }));
    on("turn.start", ($: any, e: any) => ({ turnId: e.turnId }));
    on("turn.complete", () => ({ text: "" }));
    on("ui.open", ($: any, e: any) => (opened.push(e.id), { value: undefined }));
    on("ui.close", () => ({ value: undefined }));
    on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
    on("ui.press", ($: any, e: any) => ({ element: e.element }));

    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    await $.turn.start({ turnId: "t1" } as any);
    await $.tool.call({ tool: "Edit", file_path: "/work/greet.js", old_string: "hello", new_string: "hi" } as any);
    await $.tool.call({ tool: "Bash", command: "ls" } as any);
    await $.tool.call({ tool: "Edit", file_path: "/work/greet.js", old_string: "name", new_string: "who" } as any);
    await $.tool.call({ tool: "Write", file_path: "/work/notes.md", content: "new line\n" } as any);
    await $.turn.complete({ reason: "answer", answer: "ok", durationMs: 1 } as any);

    const band = await $.ui.mount({
      plugin: "replay-theater",
      surface: "terminal",
      component: "AbovePrompt",
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
    } as any);
    expect(await band.find({ type: "Text", text: /3 edits across 2 files last turn/ })).toBeDefined();
    await band.press({ key: "replay" });
    expect(opened).toEqual(["replay-theater"]);
    expect(await band.find({ type: "Text", text: /last turn/ })).toBeUndefined();
    await band.unmount();

    const pane = await $.ui.mount({
      plugin: "replay-theater",
      surface: "terminal",
      component: "Pane",
      requestId: "replay-theater",
      props: { title: "Replay Theater", isFocused: true, bodyColumns: 80, placement: "dock" },
    } as any);
    expect(await pane.find({ type: "Text", text: /step 1 of 3/ })).toBeDefined();
    expect(await pane.find({ type: "Text", text: /^- hello$/ })).toBeDefined();
    expect(await pane.find({ type: "Text", text: /^\+ hi$/ })).toBeDefined();

    await pane.press({ key: "next" });
    await pane.press({ key: "next" });
    expect(await pane.find({ type: "Text", text: /step 3 of 3/ })).toBeDefined();
    expect(await pane.find({ type: "Text", text: /notes\.md/ })).toBeDefined();
    expect(await pane.find({ type: "Text", text: /^- old line$/ })).toBeDefined();
    expect(await pane.find({ type: "Text", text: /^\+ new line$/ })).toBeDefined();

    await pane.press({ key: "prev" });
    expect(await pane.find({ type: "Text", text: /step 2 of 3/ })).toBeDefined();
    await pane.unmount();
  });

  test("/replay with no edits says so", async ($, on) => {
    on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
    on("command.register", ($: any, e: any) => ({ value: { command: e.name } }));
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const { text } = await $.command.run({ command: "replay" } as any);
    expect(text).toContain("No edits");
  });
});
