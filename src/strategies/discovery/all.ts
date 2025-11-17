import type { ToolDiscoveryStrategy, ToolRegistry, DiscoveredTool, McpClient } from "../../types/index.js";

export const allDiscoveryStrategy: ToolDiscoveryStrategy = async (mcpClients: McpClient[]): Promise<ToolRegistry> => {
  const discoveredTools: DiscoveredTool[] = [];

  for (const client of mcpClients) {
    const toolsList = await client.listTools();

    for (const tool of toolsList) {
      const fullyQualifiedName = `${client.serverId}.${tool.name}`;

      discoveredTools.push({
        name: fullyQualifiedName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        serverId: client.serverId,
        invoke: async (args) => {
          return await client.callTool(tool.name, args);
        },
      });
    }
  }

  const byName = new Map(discoveredTools.map((tool) => [tool.name, tool]));

  return {
    tools: discoveredTools,
    byName,
  };
};
