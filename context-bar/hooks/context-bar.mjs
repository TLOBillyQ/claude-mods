// Context Bar: the /context breakdown as a card above the prompt.

import { update } from "claude-code";

const ACCENT = "#d97757";
// A light grey shows on dark and light backgrounds alike; ink reads on it and on every pastel.
const FREE = "#c9ced6";
const INK = "#1f2430";
const LABEL = { "system tools": "tools", "free space": "free" };
// /context's own theme keys are mostly greys (several rows share one) and some do not
// resolve as a background on every surface, so each row gets a fixed colour of its own:
// mid-lightness pastels, readable on either terminal background.
const COLOR = {
  "system prompt": "#5fb3e8",
  "system tools": "#4fc8a8",
  "mcp tools": "#a48be8",
  "custom agents": "#8cc865",
  agents: "#8cc865",
  "memory files": "#e8c25a",
  skills: "#ef8fb5",
  "slash commands": "#ef8fb5",
  messages: "#f08a72",
};
const SPARE = ["#6fd0d8", "#c69be0", "#f2a96b", "#b5d36a", "#e88f9a"];

// Held by the host, so these survive a hot reload of this file.
const snapshot = { plugin: "context-bar", key: "snapshot" };
const collapsed = { plugin: "context-bar", key: "collapsed" };
const hidden = { plugin: "context-bar", key: "hidden" };

// Mid-turn refresh. Module scope is fine here: a hot reload drops these, and
// the host cancels the old environment's timer with it, so at worst the next
// turn writes one extra snapshot.
const POLL_MS = 2_000;
const MIN_DELTA = 1_000;
let poll = null;
let lastWritten = null;

export function register(on) {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.command.register({ name: "context-bar", description: "Show or hide the context bar above the prompt" });
    await takeSnapshot($, true);
    return result;
  });

  on("command.run", { command: "context-bar" }, async ($) => {
    const { value: isHidden = false } = await $.state.get(hidden);
    await $.state.set(hidden, !isHidden);
    return { text: isHidden ? "Context bar shown." : "Context bar hidden." };
  });

  // Fires after each main-thread turn, compaction included: the authoritative
  // write, in case the throttle below suppressed the turn's final delta.
  on("session.measure", async ($, e, next) => {
    const result = await next(e);
    await takeSnapshot($, true);
    return result;
  });

  // Mid-turn refreshes so a long turn's growth shows as it happens: every tool
  // result lands here, and the poll covers growth with no tool call (long
  // answers, queued user messages). Subagent turns raise no turn.start; their
  // tool calls and turn.complete carry an agentId and are left alone.
  on("turn.start", async ($, e, next) => {
    const result = await next(e);
    poll?.cancel();
    poll = $.clock.every(POLL_MS, () => void takeSnapshot($));
    return result;
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId) {
      poll?.cancel();
      poll = null;
    }
    return result;
  });

  on("tool.call", async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId) await takeSnapshot($);
    return result;
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const { value: snap } = await $.state.get(snapshot);
    const { value: isHidden = false } = await $.state.get(hidden);
    if (e.props.hasSurvey || !snap || isHidden) {
      return next(e);
    }
    const { value: isCollapsed = true } = await $.state.get(collapsed);
    const { Box, Text, Button } = $.ui.resolve(e);
    const toggle = Button({
      key: "toggle",
      label: `${isCollapsed ? "▸" : "▾"} context`,
      plain: true,
      onPress: () => update($, collapsed, (v = true) => !v),
    });
    return card(Box, Text, toggle, snap, e.props.bodyColumns, isCollapsed);
  });
}

// Snapshots the breakdown unless nothing the user can see moved: the whole
// percentage point unchanged and under MIN_DELTA new tokens. Never throws —
// a mid-turn usage hiccup must not break the tool call or timer it rides on.
async function takeSnapshot($, force = false) {
  try {
    // `summary` estimates locally: no token-count requests, unlike /context's `full`.
    const { context } = await $.session.usage({ breakdown: "summary" });
    const b = context?.breakdown;
    if (!b?.rawMaxTokens) return;
    if (
      !force &&
      lastWritten &&
      Math.round(b.percentage) === Math.round(lastWritten.percentage) &&
      Math.abs(b.totalTokens - lastWritten.totalTokens) < MIN_DELTA
    ) {
      return;
    }
    lastWritten = { percentage: b.percentage, totalTokens: b.totalTokens };
    await $.state.set(snapshot, {
      model: b.model,
      totalTokens: b.totalTokens,
      maxTokens: b.rawMaxTokens,
      percentage: b.percentage,
      compactAt: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
      rows: b.categories
        .filter((c) => c.kind !== "deferred" && c.tokens > 0)
        .map(({ name, tokens, color, kind }) => ({ name, tokens, color, kind })),
    });
  } catch {
    // See above: stale beats broken.
  }
}

function card(Box, Text, toggle, snap, columns, isCollapsed) {
  const summary = `${short(snap.totalTokens)}`;
  const detail = ` of ${short(snap.maxTokens)}` + (snap.compactAt ? ` · compacts at ${short(snap.compactAt)}` : "") + " ";
  const head = Box({
    flexDirection: "row",
    justifyContent: "space-between",
    children: [
      Box({ flexDirection: "row", children: [Text({ color: ACCENT, children: "◆ " }), toggle] }),
      Box({
        flexDirection: "row",
        children: [
          Text({ bold: true, children: summary }),
          Text({ dimColor: true, children: detail }),
          Text({ backgroundColor: badgeColor(snap.percentage), color: INK, bold: true, children: ` ${snap.percentage}% ` }),
        ],
      }),
    ],
  });
  const children = [head];
  if (!isCollapsed) {
    children.push(Box({ flexDirection: "row", children: bar(Box, Text, snap, Math.max(10, columns - 6)) }));
    if (columns >= 60) children.push(legend(Box, Text, snap));
  }
  return Box({ flexDirection: "column", borderStyle: "round", borderDimColor: true, paddingX: 1, children });
}

// Used rows in their colours, the rest of the window grey, a tick where compaction runs.
// Each segment is a Box `width` cells wide, not a run of characters: the desktop counts
// columns in its code font but draws Text in a proportional one, so runs of spaces or
// shade glyphs come out too short or too long there.
function bar(Box, Text, snap, cells) {
  const used = snap.rows.filter((r) => r.kind === "used");
  const counts = allot(used.map((r) => r.tokens), (snap.totalTokens / snap.maxTokens) * cells, cells);
  const block = (width, backgroundColor, children) => Box({ width, height: 1, flexShrink: 0, backgroundColor, children });
  const parts = used.map((r, i) => block(counts[i], colorOf(r, i)));
  const rest = cells - counts.reduce((s, n) => s + n, 0);
  const tick = snap.compactAt ? Math.round((snap.compactAt / snap.maxTokens) * cells) - (cells - rest) : -1;
  if (tick >= 0 && tick < rest) {
    if (tick > 0) parts.push(block(tick, FREE));
    parts.push(block(1, FREE, Text({ color: INK, bold: true, children: "│" })));
    if (rest - tick > 1) parts.push(block(rest - tick - 1, FREE));
  } else if (rest > 0) {
    parts.push(block(rest, FREE));
  }
  return parts;
}

// Splits about `width` cells among `weights` by largest remainder: one cell each at least, `cells` at most.
function allot(weights, width, cells) {
  const target = Math.min(cells, Math.max(Math.round(width), weights.length));
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const shares = weights.map((w) => (w / total) * target);
  const counts = shares.map((s) => Math.max(1, Math.floor(s)));
  let left = target - counts.reduce((s, n) => s + n, 0);
  for (const [, i] of shares.map((s, i) => [s - Math.floor(s), i]).sort((a, b) => b[0] - a[0])) {
    if (left-- <= 0) break;
    counts[i]++;
  }
  return counts;
}

function legend(Box, Text, snap) {
  const items = snap.rows
    .filter((r) => r.kind !== "buffer")
    .map((r, i) => {
      const name = r.name.toLowerCase();
      const isFree = r.kind === "free";
      return Text({
        children: [
          Text({ color: isFree ? FREE : colorOf(r, i), children: "■ " }),
          Text({ dimColor: isFree, children: `${LABEL[name] ?? name} ` }),
          Text({ bold: !isFree, dimColor: isFree, children: short(r.tokens) }),
          !isFree && Text({ dimColor: true, children: ` ${pct(r.tokens, snap.maxTokens)}` }),
        ].filter(Boolean),
      });
    });
  return Box({ flexDirection: "row", flexWrap: "wrap", columnGap: 3, children: items });
}

// `i` is the row's place among the used rows, which come first, so bar and legend agree.
function colorOf(row, i) {
  return COLOR[row.name.toLowerCase()] ?? SPARE[i % SPARE.length];
}

function badgeColor(percent) {
  if (percent < 50) return "#4fc8a8";
  if (percent < 80) return "#e8c25a";
  return "#f06c6c";
}

function pct(n, of) {
  return `${Math.round((n / of) * 100)}%`;
}

function short(n) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}
