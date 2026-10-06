export type AgentsPanelAgent = { name: string; model: string; description: string };

declare module "claude-code" {
  interface PluginState {
    "agents-panel": { agents: AgentsPanelAgent[] };
  }
}
