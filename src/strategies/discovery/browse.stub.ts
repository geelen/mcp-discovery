/**
 * Browse Tool Discovery Strategy (Not Implemented)
 * 
 * This strategy will allow interactive browsing and selection of tools
 * before making LLM calls.
 * 
 * TODO: Implement the following:
 * - Interactive CLI for browsing available tools from all servers
 * - Tool search and filtering by name, description, server
 * - Multi-select interface for choosing which tools to include
 * - Display tool schemas and descriptions
 * - Save/load tool selection presets
 * - Return ToolRegistry with only selected tools
 */

import type { ToolDiscoveryStrategy } from "../../types/index.js";

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not yet implemented`);
    this.name = "NotImplementedError";
  }
}

export const browseDiscoveryStrategy: ToolDiscoveryStrategy = async () => {
  throw new NotImplementedError("Browse discovery strategy");
};
