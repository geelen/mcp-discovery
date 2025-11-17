import type { McpServerConfig, McpClient, ToolRegistry } from "../types/index.js";
import { startServersFromConfig, stopAllServers } from "./stdioClient.js";
import { allDiscoveryStrategy } from "../strategies/discovery/all.js";

export type ServerPool = {
  id: number;
  clients: McpClient[];
  registry: ToolRegistry;
};

export async function createServerPool(
  id: number,
  serverConfigs: McpServerConfig[]
): Promise<ServerPool> {
  const clients = await startServersFromConfig(serverConfigs);
  const registry = await allDiscoveryStrategy(clients);
  
  return {
    id,
    clients,
    registry,
  };
}

export async function destroyServerPool(pool: ServerPool): Promise<void> {
  await stopAllServers(pool.clients);
}

export async function createServerPools(
  serverConfigs: McpServerConfig[],
  count: number
): Promise<ServerPool[]> {
  const pools = await Promise.all(
    Array.from({ length: count }, (_, i) => createServerPool(i, serverConfigs))
  );
  return pools;
}

export async function destroyServerPools(pools: ServerPool[]): Promise<void> {
  await Promise.all(pools.map((pool) => destroyServerPool(pool)));
}
