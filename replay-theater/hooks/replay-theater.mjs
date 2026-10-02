// Replay Theater: record every Edit and Write in a turn, then step through them one diff at a time.

const PANE = "replay-theater";
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);
const CONTEXT = 2;
const MAX_DIFF_LINES = 400;

// Held by the host, so the last replay survives a hot reload of this file.
const replay = { plugin: "replay-theater", key: "replay" };
const at = { plugin: "replay-theater", key: "at" };
const isHinted = { plugin: "replay-theater", key: "isHinted" };

// The current turn's steps, before the turn completes.
let pending = [];

export function register(on) {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({ name: "replay", description: "Step through the last turn's file edits" });
    return r;
  });

  on("turn.start", async ($, e, next) => {
    if (!e.agentId) {
      pending = [];
      await $.state.set(isHinted, false);
    }
    return next(e);
  });

  on("tool.call", async ($, e, next) => {
    if (!EDIT_TOOLS.has(e.tool)) return next(e);
    const steps = await stepsFor($, e); // read before the edit lands
    const r = await next(e); // the edit runs untouched
    if (!r?.deny && !r?.isError) pending.push(...steps);
    return r;
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (!e.agentId && pending.length) {
      // one replay per turn
      await $.state.set(replay, pending);
      await $.state.set(at, 0);
      await $.state.set(isHinted, true);
      pending = [];
    }
    return r;
  });

  on("command.run", { command: "replay" }, async ($) => ({
    text: (await openReplay($)) ? "Replaying" : "No edits in the last turn",
  }));

  on("ui.press", { plugin: "replay-theater" }, async ($, e, next) => {
    const { value: steps = [] } = await $.state.get(replay);
    const { value: i = 0 } = await $.state.get(at);
    if (e.element === "replay") await openReplay($);
    else if (e.element === "prev") await $.state.set(at, Math.max(0, i - 1));
    else if (e.element === "next") await $.state.set(at, Math.min(steps.length - 1, i + 1));
    else if (e.element === "close") await $.ui.close({ id: PANE });
    else if (e.element.startsWith("step:")) await $.state.set(at, Number(e.element.slice(5)));
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const { value: hinted = false } = await $.state.get(isHinted);
    const { value: steps = [] } = await $.state.get(replay);
    if (e.props.hasSurvey || e.props.isWorking || !hinted || !steps.length) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    const files = new Set(steps.map((s) => s.file)).size;
    return Box({
      flexDirection: "row",
      paddingX: 1,
      children: [
        Text({ color: "magenta", children: "↻ " }),
        Text({ children: `${plural(steps.length, "edit")} across ${plural(files, "file")} last turn  ` }),
        Button({ key: "replay", label: "Replay", hotkey: "r", plain: true, onPress: () => {} }),
        Text({ dimColor: true, children: "  or /replay" }),
      ],
    });
  });

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { value: steps = [] } = await $.state.get(replay);
    const { value: i = 0 } = await $.state.get(at);
    if (!steps.length) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    const step = steps[Math.min(i, steps.length - 1)];
    const strip = steps.map((s, n) =>
      Button({ key: `step:${n}`, label: ` ${n + 1} `, plain: true, dimColor: n !== i, onPress: () => {} }),
    );
    return Box({
      flexDirection: "column",
      paddingX: 1,
      children: [
        Box({ flexDirection: "row", gap: 1, children: strip }),
        Text({ bold: true, color: "magenta", children: `${step.tool}  ${step.file}`, wrap: "truncate-start" }),
        Text({ dimColor: true, children: `step ${i + 1} of ${steps.length}` }),
        Box({ flexDirection: "column", marginY: 1, children: step.lines.map((l) => line(Text, l)) }),
        Box({
          flexDirection: "row",
          gap: 2,
          children: [
            Button({ key: "prev", label: "Prev", hotkey: "p", onPress: () => {} }),
            Button({ key: "next", label: "Next", hotkey: "n", onPress: () => {} }),
            Button({ key: "close", label: "Close", hotkey: "c", onPress: () => {} }),
          ],
        }),
      ],
    });
  });
}

async function openReplay($) {
  const { value: steps = [] } = await $.state.get(replay);
  if (!steps.length) return false;
  await $.state.set(at, 0);
  await $.state.set(isHinted, false);
  await $.ui.open({ id: PANE, title: "Replay Theater", focus: true, closeOnEscape: true });
  return true;
}

function line(Text, { op, text }) {
  const color = op === "+" ? "green" : op === "-" ? "red" : undefined;
  return Text({ color, dimColor: op === " " || op === "…", children: `${op} ${text}`, wrap: "truncate-end" });
}

// ---------- recording ----------

async function stepsFor($, e) {
  const file = String(e.file_path ?? "");
  if (e.tool === "Write") {
    const before = await $.fs.read(file).catch(() => "");
    return [{ file, tool: before ? "Write" : "Create", lines: diff(before, String(e.content ?? "")) }];
  }
  const edits = e.tool === "MultiEdit" ? (e.edits ?? []) : [e];
  return edits.map((edit) => ({
    file,
    tool: "Edit",
    lines: diff(String(edit.old_string ?? ""), String(edit.new_string ?? "")),
  }));
}

// ---------- diffing ----------

export function diff(before, after) {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops = [
    ...a.slice(0, start).map((text) => ({ op: " ", text })),
    ...middle(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((text) => ({ op: " ", text })),
  ];
  return trim(ops);
}

function middle(a, b) {
  if (a.length * b.length > MAX_DIFF_LINES * MAX_DIFF_LINES) {
    return [...a.map((text) => ({ op: "-", text })), ...b.map((text) => ({ op: "+", text }))];
  }
  // Longest common subsequence, then walk it.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ op: " ", text: a[i++] });
      j++;
    } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      out.push({ op: "-", text: a[i++] });
    } else {
      out.push({ op: "+", text: b[j++] });
    }
  }
  return out;
}

// Keep CONTEXT unchanged lines around each change; fold the rest into "…".
function trim(ops) {
  const near = ops.map((o, n) =>
    ops.slice(Math.max(0, n - CONTEXT), n + CONTEXT + 1).some((x) => x.op !== " "),
  );
  const out = [];
  ops.forEach((o, n) => {
    if (near[n]) out.push(o);
    else if (out[out.length - 1]?.op !== "…") out.push({ op: "…", text: "" });
  });
  return out.length > MAX_DIFF_LINES ? [...out.slice(0, MAX_DIFF_LINES), { op: "…", text: `${out.length - MAX_DIFF_LINES} more lines` }] : out;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
