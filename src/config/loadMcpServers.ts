import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { McpServerConfig } from "../types/index.js";

export async function loadMcpServersFile(path: string): Promise<McpServerConfig[]> {
  const fileContent = await readFile(path, "utf-8");
  const servers = JSON.parse(fileContent);
  
  // Resolve the data directory path relative to the project root
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const dataPath = join(projectRoot, "mcp", "data");
  
  // Inject LIVEMCP_DATA into server environments if not already set
  return servers.map((server: McpServerConfig) => ({
    ...server,
    env: {
      LIVEMCP_DATA: dataPath,
      ...server.env,
    },
  }));
}

export function filterServersByIds(servers: McpServerConfig[], serverIds: string[]): McpServerConfig[] {
  const availableIds = servers.map((s) => s.id);
  const filtered = serverIds.map((id) => {
    const server = servers.find((s) => s.id === id);
    if (!server) {
      throw new Error(
        `MCP server '${id}' not found in mcp/servers.json\n` +
        `       Available servers: ${availableIds.join(", ")}`
      );
    }
    return server;
  });
  return filtered;
}
