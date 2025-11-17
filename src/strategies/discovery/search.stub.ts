/**
 * Search Tool Discovery Strategy (Not Implemented)
 * 
 * This strategy will use semantic search or keyword matching to find
 * relevant tools based on the user's prompt.
 * 
 * TODO: Implement the following:
 * - Analyze user prompt to extract intent/keywords
 * - Rank tools by relevance to prompt using:
 *   - Keyword matching in tool names and descriptions
 *   - Semantic similarity (optional, requires embeddings)
 * - Filter tools based on relevance threshold
 * - Return ToolRegistry with only relevant tools
 * - Consider tool dependencies (if tool A requires tool B)
 * - Log which tools were selected and why
 */

import type { ToolDiscoveryStrategy } from "../../types/index.js";

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not yet implemented`);
    this.name = "NotImplementedError";
  }
}

export const searchDiscoveryStrategy: ToolDiscoveryStrategy = async () => {
  throw new NotImplementedError("Search discovery strategy");
};
