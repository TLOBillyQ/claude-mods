export type ReplayLine = { op: " " | "-" | "+" | "…"; text: string };
export type ReplayStep = { file: string; tool: string; lines: ReplayLine[] };

declare module "claude-code" {
  interface PluginState {
    "replay-theater": {
      replay: ReplayStep[];
      at: number;
      isHinted: boolean;
    };
  }
}
