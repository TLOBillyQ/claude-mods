// Blast Radius: hold a risky Bash command, show what it would change, and wait for a decision.

const PANE = "blast-radius";
const MAX_LINES = 40;

// What the pane draws. Held by the host, so the drawing survives a hot reload of this file.
const held = { plugin: "blast-radius", key: "held" };

// The decision the waiting tool.call reads. A module variable, because a hook's
// own dispatch doesn't see $.state writes made after it started.
let pending = null;

export function register(on) {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const command = String(e.command ?? "");
    const risk = classify(command);
    if (risk === null) return next(e); // everything else runs as normal

    const report = await measure($, risk, await $.session.cwd());
    const ticket = (pending = { decision: null });
    await $.state.set(held, { command, risk: risk.label, ...report, where: "pane", decision: null });
    const isPlaced = await $.ui
      .open({ id: PANE, title: "Blast Radius", focus: true, closeOnEscape: true })
      .then(async () => (await $.ui.panes()).some((p) => p.id === PANE && p.isPlaced))
      .catch(() => false);
    if (!isPlaced) {
      // Too narrow for a pane: draw the same report above the prompt.
      await $.ui.close({ id: PANE }).catch(() => {});
      await $.state.set(held, { command, risk: risk.label, ...report, where: "band", decision: null });
    }

    while (ticket.decision === null && !next.signal?.aborted) {
      await $.process.run(["sleep", "0.25"]); // time inside $ calls doesn't count against the hook's time limit
    }
    const { decision } = ticket;
    if (pending === ticket) pending = null;
    await $.state.set(held, null);
    await $.ui.close({ id: PANE }).catch(() => {});

    if (decision === "proceed") return next(e); // let it run
    if (decision === null) return { deny: "Blast Radius held this command and the user interrupted." };
    return { deny: `Blast Radius held this command: the user pressed Cancel. It would have: ${report.summary}.` };
  });

  on("ui.close", { requestId: PANE }, ($, e, next) => {
    if (e.origin === "person") decide("cancel"); // closing the pane by hand counts as Cancel
    return next(e);
  });

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { value } = await $.state.get(held);
    if (!value) return next(e);
    return drawReport($, e, value, false);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const { value } = await $.state.get(held);
    if (e.props.hasSurvey || !value || value.where !== "band") return next(e);
    return drawReport($, e, value, true);
  });
}

function decide(decision) {
  if (pending && pending.decision === null) pending.decision = decision;
}

function drawReport($, e, value, isBand) {
  const { Box, Text, Button } = $.ui.resolve(e);
  const children = [
    Text({ color: "yellow", bold: true, children: `⚠ ${value.risk}` }),
    Text({ children: `$ ${value.command}`, wrap: "truncate-end" }),
    Text({ bold: true, children: `It would ${value.summary}` }),
    ...value.lines.map((line) => Text({ dimColor: true, children: `  ${line}`, wrap: "truncate-end" })),
    Box({
      flexDirection: "row",
      gap: 2,
      marginTop: 1,
      children: [
        Button({ key: "proceed", label: "Proceed", hotkey: "1", onPress: () => decide("proceed") }),
        Button({ key: "cancel", label: "Cancel", hotkey: "2", onPress: () => decide("cancel") }),
      ],
    }),
  ];
  return Box(
    isBand
      ? { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 1, children }
      : { flexDirection: "column", paddingX: 1, children },
  );
}

// ---------- classifying ----------

export function classify(command) {
  for (const segment of segments(command)) {
    const argv = words(segment);
    const [cmd, ...args] = stripPrefix(argv);
    if (!cmd) continue;
    const flags = args.filter((a) => a.startsWith("-"));
    const operands = args.filter((a) => !a.startsWith("-"));
    const has = (short, long) =>
      flags.some((f) => f === long || (!f.startsWith("--") && short && f.slice(1).includes(short)));

    if (cmd === "rm" && has("r", "--recursive") && operands.length) {
      return { kind: "rm", label: "Recursive delete", targets: operands };
    }
    if (cmd === "git") {
      const [sub, ...rest] = operands;
      if (sub === "reset" && args.includes("--hard")) return { kind: "reset", label: "git reset --hard" };
      if (sub === "clean") {
        const cleanFlags = flags.filter((f) => f !== "-f" && f !== "--force").map((f) => f.replace("f", ""));
        return { kind: "clean", label: "git clean", flags: cleanFlags.filter((f) => f !== "-"), paths: rest };
      }
      if (sub === "push" && flags.some((f) => /^(-f|--force|--force-with-lease.*|--force-if-includes)$/.test(f))) {
        return { kind: "push", label: "Force push", remote: rest[0], branch: rest[1] };
      }
      if (sub === "push" && rest.some((r) => r.startsWith("+"))) {
        return { kind: "push", label: "Force push", remote: rest[0], branch: rest[1]?.slice(1) };
      }
    }
    if (isMigration(cmd, args)) return { kind: "migrate", label: "Database migration", argv: [cmd, ...args] };
  }
  return null;
}

function isMigration(cmd, args) {
  const line = [cmd, ...args].join(" ");
  return (
    /manage\.py\s+migrate\b/.test(line) ||
    /\b(rails|rake)\s+db:(migrate|rollback|reset|drop)/.test(line) ||
    /\bprisma\s+(migrate\s+(deploy|reset|dev)|db\s+push)/.test(line) ||
    /\balembic\s+(upgrade|downgrade)\b/.test(line) ||
    /\b(knex|sequelize)\b.*\bmigrate\b/.test(line) ||
    /\bflyway\s+(migrate|clean)\b/.test(line)
  );
}

function segments(command) {
  return command.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);
}

function stripPrefix(argv) {
  let i = 0;
  while (i < argv.length && (/^\w+=/.test(argv[i]) || ["sudo", "command", "time", "nice"].includes(argv[i]))) i++;
  return argv.slice(i);
}

function words(segment) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// ---------- measuring (dry runs only) ----------

async function measure($, risk, cwd) {
  const run = async (argv) => {
    try {
      return await $.process.run(argv, { cwd, timeoutMs: 15_000 });
    } catch {
      return { exitCode: -1, stdout: "", stderr: "" };
    }
  };
  const nonEmpty = (text) => text.split("\n").filter((l) => l.trim());
  const cap = (lines) =>
    lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… and ${lines.length - MAX_LINES} more`] : lines;

  switch (risk.kind) {
    case "rm": {
      const files = [];
      let kb = 0;
      for (const target of risk.targets) {
        const found = await run(["find", target, "-type", "f"]);
        files.push(...nonEmpty(found.stdout));
        const du = await run(["du", "-sk", target]);
        kb += parseInt(du.stdout, 10) || 0;
      }
      if (!files.length) return { summary: `delete ${risk.targets.join(", ")} (nothing found there)`, lines: [] };
      return { summary: `delete ${files.length} file${files.length === 1 ? "" : "s"} (${size(kb)})`, lines: cap(files) };
    }
    case "reset": {
      const status = await run(["git", "status", "--porcelain"]);
      const tracked = nonEmpty(status.stdout).filter((l) => !l.startsWith("??"));
      if (!tracked.length) return { summary: "discard nothing: no uncommitted changes to tracked files", lines: [] };
      return { summary: `discard uncommitted changes in ${tracked.length} file${tracked.length === 1 ? "" : "s"}`, lines: cap(tracked) };
    }
    case "clean": {
      const dry = await run(["git", "clean", "-n", ...risk.flags, ...(risk.paths.length ? ["--", ...risk.paths] : [])]);
      const lines = nonEmpty(dry.stdout).map((l) => l.replace(/^Would remove /, ""));
      return { summary: lines.length ? `remove ${lines.length} untracked path${lines.length === 1 ? "" : "s"}` : "remove nothing", lines: cap(lines) };
    }
    case "push": {
      const upstream = risk.remote && risk.branch ? `${risk.remote}/${risk.branch.split(":").pop()}` : "@{u}";
      const lost = await run(["git", "log", "--oneline", `HEAD..${upstream}`]);
      if (lost.exitCode !== 0) return { summary: `overwrite ${upstream} (could not compare: ${lost.stderr.trim() || "no upstream"})`, lines: [] };
      const lines = nonEmpty(lost.stdout);
      return { summary: lines.length ? `drop ${lines.length} commit${lines.length === 1 ? "" : "s"} from ${upstream}` : `overwrite ${upstream} (no commits lost)`, lines: cap(lines) };
    }
    case "migrate": {
      if (/manage\.py/.test(risk.argv.join(" "))) {
        const python = risk.argv.find((a) => /python/.test(a)) ?? "python";
        const plan = await run([python, "manage.py", "showmigrations", "--plan"]);
        const pending = nonEmpty(plan.stdout).filter((l) => l.includes("[ ]")).map((l) => l.replace("[ ]", "").trim());
        return { summary: pending.length ? `apply ${pending.length} migration${pending.length === 1 ? "" : "s"}` : "apply or roll back migrations", lines: cap(pending) };
      }
      return { summary: "change the database schema (no dry run available for this tool)", lines: [] };
    }
  }
  return { summary: "run a risky command", lines: [] };
}

function size(kb) {
  if (kb >= 1024 * 1024) return `${+(kb / 1024 / 1024).toFixed(1)} GB`;
  if (kb >= 1024) return `${+(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}
