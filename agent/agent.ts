import { defineAgent } from "eve";
export default defineAgent({
  model: process.env.RESEARCH_MODEL || "openai/gpt-6-luna-fast",
  reasoning: "high",
  defaultTools: false,
  limits: { maxInputTokensPerSession: 80000, maxOutputTokensPerSession: 12000, maxTokenCostUsdPerSession: 1, sessionTimeoutMs: 120000 },
});
