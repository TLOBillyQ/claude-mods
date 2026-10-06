export type ContextBarRow = { name: string; tokens: number; color: string; kind: "used" | "free" | "buffer" };

export type ContextBarSnapshot = {
  model: string;
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  compactAt?: number;
  rows: ContextBarRow[];
};

declare module "claude-code" {
  interface PluginState {
    "context-bar": { snapshot: ContextBarSnapshot; collapsed: boolean; hidden: boolean };
  }
}
