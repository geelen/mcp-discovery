import type { ToolRegistry, DiscoveredTool } from "../../types/index.js";

export interface AllRelevantStrategyParams {
  fullRegistry: ToolRegistry;
  servers: string[];
}

export async function allRelevantDiscoveryStrategy(params: AllRelevantStrategyParams): Promise<ToolRegistry> {
  const { fullRegistry, servers } = params;
  
  const relevantTools = fullRegistry.tools.filter(tool => 
    servers.includes(tool.serverId)
  );

  const byName = new Map(relevantTools.map((tool) => [tool.name, tool]));

  return {
    tools: relevantTools,
    byName,
  };
}
