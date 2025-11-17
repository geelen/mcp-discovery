import { readFile } from "fs/promises";
import type { McpServerConfig } from "../types/index.js";

export async function loadMcpServersFile(path: string): Promise<McpServerConfig[]> {
  const fileContent = await readFile(path, "utf-8");
  return JSON.parse(fileContent);
}

export function filterServersByIds(servers: McpServerConfig[], serverIds: string[]): McpServerConfig[] {
  const filtered = serverIds.map((id) => {
    const server = servers.find((s) => s.id === id);
    if (!server) {
      throw new Error(`MCP server '${id}' not found in servers.json`);
    }
    return server;
  });
  return filtered;
}
