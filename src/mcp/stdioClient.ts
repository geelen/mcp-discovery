import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpClient, McpServerConfig, Json } from "../types/index.js";

export async function spawnMcpClient(serverConfig: McpServerConfig): Promise<McpClient> {
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    env: { ...process.env, ...serverConfig.env },
    stderr: "pipe",
    cwd: serverConfig.cwd,
  });

  const client = new Client(
    {
      name: "mcp-discovery-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  const serverId = serverConfig.id;

  return {
    serverId,

    async listTools() {
      const response = await client.listTools();
      return response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Json,
      }));
    },

    async callTool(name: string, args: Json) {
      const response = await client.callTool({
        name,
        arguments: args as Record<string, unknown>,
      });

      if (response.isError) {
        throw new Error(`Tool error: ${JSON.stringify(response.content)}`);
      }

      return response.content as Json;
    },

    async stop() {
      await client.close();
    },
  };
}

export async function startServersFromConfig(serverConfigs: McpServerConfig[]): Promise<McpClient[]> {
  const mcpClients: McpClient[] = [];

  for (const config of serverConfigs) {
    try {
      const client = await spawnMcpClient(config);
      mcpClients.push(client);
    } catch (error) {
      console.error(`Failed to start MCP server ${config.id}:`, error);
      throw error;
    }
  }

  return mcpClients;
}

export async function stopAllServers(mcpClients: McpClient[]): Promise<void> {
  await Promise.all(mcpClients.map((client) => client.stop()));
}
