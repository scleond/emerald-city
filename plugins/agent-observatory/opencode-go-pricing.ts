export interface OpenCodeGoRate { model: string; input: number; cachedRead: number; output: number; contextLimit?: number; highContext?: Omit<OpenCodeGoRate, "model" | "contextLimit" | "highContext"> }
export const OPENCODE_GO_PRICING_VERSION = "2026-08-23";
export const OPENCODE_GO_SOURCE_DATE = "2026-08-23";
export const OPENCODE_GO_PRICING: readonly OpenCodeGoRate[] = [
  { model: "grok-4.5", input: 2, cachedRead: .3, output: 6 }, { model: "gpt-5.6-luna", input: .2, cachedRead: .02, output: 1.2, contextLimit: 272_000, highContext: { input: .4, cachedRead: .04, output: 1.8 } },
  { model: "glm-5.3", input: 1.4, cachedRead: .26, output: 4.4 }, { model: "glm-5.2", input: 1.4, cachedRead: .26, output: 4.4 }, { model: "glm-5.1", input: 1.4, cachedRead: .26, output: 4.4 },
  { model: "kimi-k3", input: 3, cachedRead: .3, output: 15 }, { model: "kimi-k2.7-code", input: .95, cachedRead: .19, output: 4 }, { model: "kimi-k2.6", input: .95, cachedRead: .16, output: 4 },
  { model: "mimo-v2.5", input: .14, cachedRead: .0028, output: .28 }, { model: "mimo-v2.5-pro", input: .435, cachedRead: .003625, output: .87 }, { model: "minimax-m3", input: .3, cachedRead: .06, output: 1.2 }, { model: "minimax-m2.7", input: .3, cachedRead: .06, output: 1.2 },
  { model: "muse-spark-1.2-contributor", input: .1, cachedRead: .002, output: .2 }, { model: "qwen3.8-max", input: 2, cachedRead: .25, output: 6 }, { model: "qwen3.7-max", input: 2.5, cachedRead: .5, output: 7.5 },
  { model: "qwen3.7-plus", input: .4, cachedRead: .04, output: 1.6, contextLimit: 256_000, highContext: { input: 1.2, cachedRead: .12, output: 4.8 } }, { model: "qwen3.6-plus", input: .5, cachedRead: .05, output: 3, contextLimit: 256_000, highContext: { input: 2, cachedRead: .2, output: 6 } },
  { model: "deepseek-v4-pro", input: .66, cachedRead: .022, output: 1.98 }, { model: "deepseek-v4-flash", input: .22, cachedRead: .007, output: .66 }, { model: "deepseek-v4-flash-vision-exp", input: .22, cachedRead: .007, output: .66 }, { model: "hy3", input: .14, cachedRead: .035, output: .58 }, { model: "ox-alpha-free", input: 0, cachedRead: 0, output: 0 },
];
export function estimateOpenCodeGoCost(input: { provider?: string | null; model?: string | null; inputTokens?: number | null; cachedInputTokens?: number | null; outputTokens?: number | null; contextUsedTokens?: number | null }): number | null {
  if (input.provider !== "opencode-go" || !input.model) return null;
  const base = OPENCODE_GO_PRICING.find((rate) => rate.model === input.model!.toLowerCase().replace(/^opencode-go\//, ""));
  if (!base) return null;
  const rate = base.highContext && (input.contextUsedTokens ?? 0) > base.contextLimit! ? { ...base, ...base.highContext } : base;
  const total = Math.max(0, input.inputTokens ?? 0); const cached = Math.min(total, Math.max(0, input.cachedInputTokens ?? 0));
  return (total - cached) * rate.input / 1_000_000 + cached * rate.cachedRead / 1_000_000 + Math.max(0, input.outputTokens ?? 0) * rate.output / 1_000_000;
}
