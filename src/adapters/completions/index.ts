import type { CompletionsAdapter, ProviderConfig } from "../../types/index.js";
import { createOpenAiLikeAdapter } from "./openaiLike.js";

export function createCompletionsAdapter(
  providerKey: string,
  providerConfig: ProviderConfig,
  apiKey: string
): CompletionsAdapter {
  if (providerConfig.stub) {
    throw new Error(`Provider '${providerKey}' is not yet implemented (stub)`);
  }

  if (providerConfig.adapter !== "completions") {
    throw new Error(
      `Provider '${providerKey}' uses '${providerConfig.adapter}' adapter, not 'completions'`
    );
  }

  switch (providerKey) {
    case "groq":
    case "openai":
    case "openrouter":
      return createOpenAiLikeAdapter(providerConfig.baseURL, apiKey);

    default:
      throw new Error(`Unknown provider: ${providerKey}`);
  }
}
