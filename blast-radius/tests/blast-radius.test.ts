import { describe, expect, test } from "claude-code/testing";
import { classify } from "../hooks/blast-radius.mjs";

const ok = (stdout = "") => ({ value: { exitCode: 0, stdout, stderr: "" } });

function stubs(on: any, ran: string[][]) {
  on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
  on("session.cwd", () => ({ value: "/work" }));
  on("process.run", async ($: any, e: any) => {
    ran.push([...e.argv]);
    if (e.argv[0] === "sleep") {
      if (ran.filter((a) => a[0] === "sleep").length > 400) return { deny: "the wait never ended" };
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (e.argv[0] === "find") return ok("build/a.js\nbuild/b.js\nbuild/c.css\n");
    if (e.argv[0] === "du") return ok("1130\tbuild\n");
    return ok();
  });
  on("tool.call", () => ({ result: "ran" }));
  on("ui.render", () => null);
  on("ui.close", () => ({ value: undefined }));
  on("ui.panes", () => ({ value: [{ id: "blast-radius", title: "Blast Radius", isShown: true, isFocused: true, isPlaced: true }] }));
  let opened: () => void;
  const isOpen = new Promise<void>((resolve) => (opened = resolve));
  on("ui.open", () => (opened(), { value: undefined }));
  return isOpen;
}

describe("classify", () => {
  test("flags risky commands and lets the rest through", () => {
    expect(classify("rm -rf build")?.kind).toBe("rm");
    expect(classify("cd app && rm -r dist tmp")?.targets).toEqual(["dist", "tmp"]);
    expect(classify("git reset --hard HEAD~1")?.kind).toBe("reset");
    expect(classify("git clean -fdx")?.flags).toEqual(["-dx"]);
    expect(classify("git push --force origin main")?.kind).toBe("push");
    expect(classify("python manage.py migrate")?.kind).toBe("migrate");
    expect(classify("rm file.txt")).toBeNull();
    expect(classify("git status")).toBeNull();
    expect(classify("ls -rf")).toBeNull();
  });
});

describe("blast-radius", () => {
  test("Cancel refuses the command with what it would have done", async ($, on) => {
    const ran: string[][] = [];
    const isOpen = stubs(on, ran);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);

    const call = $.tool.call({ tool: "Bash", command: "rm -rf build" } as any);
    await isOpen;
    const ui = await $.ui.mount({
      plugin: "blast-radius",
      surface: "terminal",
      component: "Pane",
      requestId: "blast-radius",
      props: { title: "Blast Radius", isFocused: true, bodyColumns: 80, placement: "dock" },
    } as any);
    expect(await ui.find({ type: "Text", text: /delete 3 files \(1\.1 MB\)/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /build\/c\.css/ })).toBeDefined();

    await ui.press({ key: "cancel" });
    const result: any = await call;
    expect(result.deny).toContain("the user pressed Cancel");
    expect(result.deny).toContain("delete 3 files");
    expect(ran.some((argv) => argv[0] === "rm")).toBe(false);
    await ui.unmount();
  });

  test("Proceed runs the command as written", async ($, on) => {
    const isOpen = stubs(on, []);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);

    const call = $.tool.call({ tool: "Bash", command: "git reset --hard" } as any);
    await isOpen;
    const ui = await $.ui.mount({
      plugin: "blast-radius",
      surface: "terminal",
      component: "Pane",
      requestId: "blast-radius",
      props: { title: "Blast Radius", isFocused: true, bodyColumns: 80, placement: "dock" },
    } as any);
    expect(await ui.find({ type: "Text", text: /git reset --hard/ })).toBeDefined();
    await ui.press({ key: "proceed" });
    const result: any = await call;
    expect(result.deny).toBeUndefined();
    expect(result.result).toBe("ran");
    await ui.unmount();
  });

  test("safe commands pass straight through", async ($, on) => {
    stubs(on, []);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    const result: any = await $.tool.call({ tool: "Bash", command: "ls -la" } as any);
    expect(result.result).toBe("ran");
  });
});
