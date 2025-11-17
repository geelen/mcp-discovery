import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createWriteStream } from "fs";
import type { CompletionsAdapter, McpServerConfig, ProviderConfig } from "../types/index.js";
import { createServerPools, destroyServerPools, type ServerPool } from "../mcp/pools.js";
import { runToolLoop } from "./toolLoop.js";
import { checkExpectations } from "../util/expectations.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";
const SUCCESS = `${GREEN}✓${RESET}`;
const FAILURE = `${RED}✗${RESET}`;

type BenchmarkConfig = {
  runs: number;
  concurrency: number;
  adapter: CompletionsAdapter;
  model: string;
  prompt: string;
  serverConfigs: McpServerConfig[];
  expectations?: string[];
};

type RunResult = {
  runId: number;
  workerId: number;
  pass: boolean;
  durationMs: number;
};

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, index)];
}

export async function runBenchmark(config: BenchmarkConfig): Promise<number> {
  const tempRoot = await mkdtemp(join(tmpdir(), "mcp-discovery-"));
  console.error(`\n📁 Logs directory: ${tempRoot}\n`);

  console.error(`${BLUE}Running ${config.runs} inference(s) with concurrency ${config.concurrency}...${RESET}\n`);

  if (config.expectations && config.expectations.length > 0) {
    console.error(`${BLUE}Expectations:${RESET} ${config.expectations.join(", ")}\n`);
  }

  const pools = await createServerPools(config.serverConfigs, config.concurrency);
  console.error(`Started ${pools.length} server pool(s), discovered ${pools[0]?.registry.tools.length ?? 0} tools\n`);

  const results: RunResult[] = [];
  const durations: number[] = [];
  let passCount = 0;
  let failCount = 0;

  const nextRun = { value: 0 };
  function getNextRunId(): number | null {
    if (nextRun.value < config.runs) {
      return ++nextRun.value;
    }
    return null;
  }

  // Create worker for each pool
  const workers = pools.map((pool) => createWorker(pool));

  async function createWorker(pool: ServerPool) {
    while (true) {
      const runId = getNextRunId();
      if (runId === null) break;

      const runDir = join(tempRoot, `run-${String(runId).padStart(3, "0")}`);
      await mkdir(runDir, { recursive: true });

      const start = Date.now();
      let pass = false;

      try {
        const stepsFile = createWriteStream(join(runDir, "steps.ndjson"));
        
        const result = await runToolLoop({
          adapter: config.adapter,
          registry: pool.registry,
          model: config.model,
          userPrompt: config.prompt,
          logToStderr: false,
          onStep: (resp) => {
            stepsFile.write(JSON.stringify(resp) + "\n");
          },
        });

        stepsFile.end();

        if ("error" in result) {
          await writeFile(join(runDir, "error.json"), JSON.stringify(result, null, 2));
          pass = false;
        } else {
          await writeFile(join(runDir, "response.json"), JSON.stringify(result, null, 2));
          
          if (config.expectations && config.expectations.length > 0) {
            const answer = config.adapter.extractAnswer(result);
            if (!answer) {
              pass = false;
            } else {
              const { allFound } = checkExpectations(answer, config.expectations);
              pass = allFound;
            }
          } else {
            pass = true;
          }
        }
      } catch (error) {
        await writeFile(
          join(runDir, "error.json"),
          JSON.stringify({ error: String(error) }, null, 2)
        );
        pass = false;
      }

      const durationMs = Date.now() - start;

      // Write metadata
      await writeFile(
        join(runDir, "meta.json"),
        JSON.stringify(
          {
            runId,
            workerId: pool.id,
            model: config.model,
            durationMs,
            pass,
          },
          null,
          2
        )
      );

      durations.push(durationMs);
      if (pass) passCount++;
      else failCount++;

      results.push({
        runId,
        workerId: pool.id,
        pass,
        durationMs,
      });

      // Update progress
      const completed = passCount + failCount;
      if (process.stderr.isTTY) {
        process.stderr.write(
          `\r${completed}/${config.runs} | ${SUCCESS}${passCount} ${FAILURE}${failCount}`
        );
      } else {
        if (completed % 10 === 0 || completed === config.runs) {
          console.error(`Progress: ${completed}/${config.runs} | pass: ${passCount} fail: ${failCount}`);
        }
      }
    }
  }

  await Promise.all(workers);

  // Clear progress line
  if (process.stderr.isTTY) {
    process.stderr.write("\r\x1b[K");
  }

  await destroyServerPools(pools);

  // Calculate stats
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const p50 = percentile(sortedDurations, 0.5);
  const p95 = percentile(sortedDurations, 0.95);
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;

  // Print summary
  console.error("\n" + "═".repeat(60));
  console.error(`\n📊 Results:\n`);
  console.error(`   Total runs:    ${config.runs}`);
  console.error(`   ${SUCCESS} Passes:      ${GREEN}${passCount}${RESET}`);
  console.error(`   ${FAILURE} Failures:    ${RED}${failCount}${RESET}`);
  console.error(`   Pass rate:     ${((passCount / config.runs) * 100).toFixed(1)}%${RESET}`);
  console.error(`\n⏱  Latency:${RESET}`);
  console.error(`   Mean:          ${mean.toFixed(0)}ms${RESET}`);
  console.error(`   P50:           ${p50.toFixed(0)}ms${RESET}`);
  console.error(`   P95:           ${p95.toFixed(0)}ms${RESET}`);
  console.error(`\n📁 Logs: ${tempRoot}${RESET}`);
  console.error("\n" + "═".repeat(60) + "\n" + RESET);

  return failCount === 0 ? 0 : 1;
}
