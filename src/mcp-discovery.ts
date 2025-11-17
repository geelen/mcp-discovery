#!/usr/bin/env bun

import { parseArgs } from "util";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadProvidersFile, getProviderConfig, getApiKey } from "./config/loadProviderConfig.js";
import { loadMcpServersFile, filterServersByIds } from "./config/loadMcpServers.js";
import { startServersFromConfig, stopAllServers } from "./mcp/stdioClient.js";
import { allDiscoveryStrategy } from "./strategies/discovery/all.js";
import { createCompletionsAdapter } from "./adapters/completions/index.js";
import { runToolLoop } from "./core/toolLoop.js";
import { runBenchmark } from "./core/benchmark.js";

async function loadUsageFromReadme(): Promise<string> {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const readmePath = join(__dirname, "..", "README.md");
    const readme = await readFile(readmePath, "utf-8");

    const usageSection = readme.match(/## Usage\n\n```\n([\s\S]*?)\n```/);
    if (usageSection && usageSection[1]) {
      return usageSection[1];
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
      n: { type: "string" },
      c: { type: "string" },
      x: { type: "string", multiple: true },
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
  const expectations = (values.x as string[] | undefined) || [];

  const missingArgs: string[] = [];
  if (!strategy) missingArgs.push("<strategy> (positional argument: 'all', 'browse', or 'search')");
  if (!modelSpec) missingArgs.push("-m <provider:model> (e.g., -m groq:llama-3.3-70b-versatile)");
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

  // Parse benchmarking flags
  const runs = Number(values.n ?? 1);
  const concurrency = Number(values.c ?? 1);

  if (isNaN(runs) || runs < 1) {
    console.error(`Error: -n must be a positive integer, got: ${values.n}`);
    process.exit(1);
  }

  if (isNaN(concurrency) || concurrency < 1) {
    console.error(`Error: -c must be a positive integer, got: ${values.c}`);
    process.exit(1);
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const providersPath = join(__dirname, "..", "providers.json");
  const serversPath = join(__dirname, "..", "mcp", "servers.json");

  let providers, providerConfig, apiKey;
  
  try {
    providers = await loadProvidersFile(providersPath);
    providerConfig = getProviderConfig(providers, providerKey);
    apiKey = getApiKey(providerConfig);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Load MCP server configs
  let selectedServers = [];
  if (serversSpec) {
    const serverIds = serversSpec.split(",").map((s) => s.trim());
    let allServers;
    try {
      allServers = await loadMcpServersFile(serversPath);
      selectedServers = filterServersByIds(allServers, serverIds);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  // Branch between single run and benchmark mode
  if (runs === 1) {
    // Single run mode - original behavior
    let mcpClients = [];
    let toolRegistry;

    if (selectedServers.length > 0) {
      console.log(`Starting ${selectedServers.length} MCP server(s)...`);
      mcpClients = await startServersFromConfig(selectedServers);

      console.log("Discovering tools...");
      toolRegistry = await allDiscoveryStrategy(mcpClients);
      console.log(`Discovered ${toolRegistry.tools.length} tools`);
    } else {
      console.log("No MCP servers specified, running without tools");
      toolRegistry = { tools: [], byName: new Map() };
    }

    const adapter = createCompletionsAdapter(providerKey, providerConfig, apiKey);

    console.log("Running inference...");
    const result = await runToolLoop({
      adapter,
      registry: toolRegistry,
      model: modelName,
      userPrompt: prompt,
      logToStderr: true,
    });

    await stopAllServers(mcpClients);

    console.log(JSON.stringify(result, null, 2));

    if ("error" in result) {
      process.exit(1);
    }
  } else {
    // Benchmark mode
    const adapter = createCompletionsAdapter(providerKey, providerConfig, apiKey);

    const exitCode = await runBenchmark({
      runs,
      concurrency,
      adapter,
      model: modelName,
      prompt,
      serverConfigs: selectedServers,
      expectations: expectations.length > 0 ? expectations : undefined,
    });

    process.exit(exitCode);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
