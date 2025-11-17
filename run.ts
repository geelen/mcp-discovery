#!/usr/bin/env bun

import { parseArgs } from "util";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadProvidersFile, getProviderConfig, getApiKey } from "./src/config/loadProviderConfig.js";
import { loadMcpServersFile, filterServersByIds } from "./src/config/loadMcpServers.js";
import { startServersFromConfig, stopAllServers } from "./src/mcp/stdioClient.js";
import { allDiscoveryStrategy } from "./src/strategies/discovery/all.js";
import { createCompletionsAdapter } from "./src/adapters/completions/index.js";
import { runToolLoop } from "./src/core/toolLoop.js";

async function loadUsageFromReadme(): Promise<string> {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const readmePath = join(__dirname, "README.md");
    const readme = await readFile(readmePath, "utf-8");

    const match = readme.match(/```\n([\s\S]*?)\n```/);
    if (match && match[1]) {
      return match[1];
    }

    return "Error: Could not parse usage from README.md";
  } catch (error) {
    return "Error: Could not read README.md";
  }
}

async function printHelp(): Promise<void> {
  const usage = await loadUsageFromReadme();
  console.log(`\n${usage}\n`);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      m: { type: "string" },
      s: { type: "string" },
      p: { type: "string" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    await printHelp();
    process.exit(0);
  }

  const strategy = positionals[0];
  const modelSpec = values.m as string | undefined;
  const serversSpec = values.s as string | undefined;
  const prompt = values.p as string | undefined;

  const missingArgs: string[] = [];
  if (!strategy) missingArgs.push("<strategy> (positional argument: 'all', 'browse', or 'search')");
  if (!modelSpec) missingArgs.push("-m <provider:model> (e.g., -m groq:llama-3.3-70b-versatile)");
  if (!serversSpec) missingArgs.push("-s <servers> (e.g., -s ppt,word,chart)");
  if (!prompt) missingArgs.push("-p <prompt> (e.g., -p \"What is the title?\")");

  if (missingArgs.length > 0) {
    console.error("Error: Missing required arguments:\n");
    for (const arg of missingArgs) {
      console.error(`  • ${arg}`);
    }
    console.error("\nRun with --help for usage information\n");
    process.exit(1);
  }

  if (strategy !== "all") {
    console.error(`Error: Strategy '${strategy}' is not yet implemented.`);
    console.error(`       Only 'all' is currently supported.\n`);
    process.exit(1);
  }

  const [providerKey, modelName] = modelSpec.split(":", 2);
  if (!providerKey || !modelName) {
    console.error(`Error: Invalid model specification '${modelSpec}'`);
    console.error(`       Model must be in format 'provider:model'`);
    console.error(`       Example: groq:llama-3.3-70b-versatile\n`);
    process.exit(1);
  }

  const serverIds = serversSpec.split(",").map((s) => s.trim());

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const providersPath = join(__dirname, "providers.json");
  const serversPath = join(__dirname, "mcp", "servers.json");

  let providers, providerConfig, apiKey, allServers, selectedServers;
  
  try {
    providers = await loadProvidersFile(providersPath);
    providerConfig = getProviderConfig(providers, providerKey);
    apiKey = getApiKey(providerConfig);

    allServers = await loadMcpServersFile(serversPath);
    selectedServers = filterServersByIds(allServers, serverIds);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log(`Starting ${selectedServers.length} MCP server(s)...`);
  const mcpClients = await startServersFromConfig(selectedServers);

  console.log("Discovering tools...");
  const toolRegistry = await allDiscoveryStrategy(mcpClients);
  console.log(`Discovered ${toolRegistry.tools.length} tools\n`);

  const adapter = createCompletionsAdapter(providerKey, providerConfig, apiKey);

  console.log("Running tool loop...\n");
  const result = await runToolLoop({
    adapter,
    registry: toolRegistry,
    model: modelName,
    userPrompt: prompt,
  });

  await stopAllServers(mcpClients);

  if ("error" in result) {
    console.error("\nError:", JSON.stringify(result.error, null, 2));
    process.exit(1);
  }

  console.log("\nFinal response:");
  console.log(result.message.content || "(no content)");
  console.log();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
