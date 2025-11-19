import type { ToolRegistry, DiscoveredTool } from "../../types/index.js";

export interface AllRelevantStrategyParams {
  fullRegistry: ToolRegistry;
  servers: string[];
  strict?: boolean;
}

export async function allRelevantDiscoveryStrategy(params: AllRelevantStrategyParams): Promise<ToolRegistry> {
  const { fullRegistry, servers } = params;
  
  let relevantTools = fullRegistry.tools.filter(tool => 
    servers.includes(tool.serverId)
  );

  if (params.strict) {
    relevantTools = relevantTools.map(tool => ({ ...tool, strict: true }));
  }

  const byName = new Map(relevantTools.map((tool) => [tool.name, tool]));

  return {
    tools: relevantTools,
    byName,
  };
}
