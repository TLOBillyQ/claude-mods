export type BlastRadiusHeld = {
  command: string;
  risk: string;
  summary: string;
  lines: string[];
  where: "pane" | "band";
  decision: "proceed" | "cancel" | null;
};

declare module "claude-code" {
  interface PluginState {
    "blast-radius": { held: BlastRadiusHeld | null };
  }
}
