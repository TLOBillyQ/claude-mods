// Agents Panel: the project's .claude/agents as a side panel, each with a run button.

import { atom, read, update } from "claude-code";
import type { Register } from "claude-code";

import type { AgentsPanelAgent } from "../types";

const PANE = "agents-panel";
const DIR = ".claude/agents";
const DOTS = ["blue", "cyan", "yellow", "red", "magenta", "green"];

const agents = atom({ plugin: "agents-panel", key: "agents" } as const, [] as AgentsPanelAgent[]);

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "agents-panel",
      description: "Show or hide the project's agents in a side panel",
    });
    return next(e);
  });

  on("command.run", { command: "agents-panel" }, async ($) => {
    const panes = await $.ui.panes();
    if (panes.some((p) => p.id === PANE)) {
      await $.ui.close({ id: PANE });
      return { text: "Agents panel hidden." };
    }
    await load($);
    await $.ui.open({ id: PANE, title: "Agents" });
    return { text: "Agents panel open." };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e);
    const list = await read($, agents);

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row">
          <Text color="red">◆ </Text>
          <Text bold>Agents</Text>
          <Text dimColor> in this project  ·  {list.length} defined</Text>
        </Box>
        <Text dimColor>{DIR}</Text>
        {list.length === 0 && <Text dimColor>No agent files found.</Text>}
        {list.map((a, i) => (
          <Box key={a.name} flexDirection="column" marginTop={1}>
            <Box flexDirection="row">
              <Text color={DOTS[i % DOTS.length]}>● </Text>
              <Text bold>{a.name}</Text>
              <Text dimColor> {a.model}</Text>
              <Box flexGrow={1} />
              <Button
                key={`run-${a.name}`}
                label="▶ run"
                dimColor
                onPress={() => run($, a)}
              />
            </Box>
            <Text dimColor wrap="truncate-end">{a.description}</Text>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>click ▶ run to start one · /agents-panel to hide</Text>
        </Box>
      </Box>
    );
  });
};

async function load($) {
  const entries = await $.fs.list(DIR).catch(() => []);
  const found: AgentsPanelAgent[] = [];
  for (const f of entries.filter((f) => f.kind === "file" && f.name.endsWith(".md"))) {
    const text = await $.fs.read(`${DIR}/${f.name}`).catch(() => "");
    const meta = frontmatter(text);
    found.push({
      name: meta.name || f.name.replace(/\.md$/, ""),
      model: meta.model || "inherit",
      description: meta.description || "",
    });
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  await update($, agents, () => found);
}

export function frontmatter(text: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const meta: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return meta;
}

async function run($, a: AgentsPanelAgent) {
  try {
    await $.agent.spawn({
      subagentType: a.name,
      description: a.name,
      prompt: "Run your default task on this project.",
    });
    $.ui.toast(`${a.name}: started`);
  } catch (err) {
    $.ui.toast(`${a.name}: ${err instanceof Error ? err.message : "could not start"}`);
  }
}
