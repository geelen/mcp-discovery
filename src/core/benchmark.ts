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
  console.log(RESET);
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const [provider, modelName] = config.model.split(":");
  const safeModel = modelName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const safeProvider = provider.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const logDirName = `mcp_discovery_${timestamp}_${safeProvider}_${safeModel}_all_${config.runs}_${config.concurrency}`;
  const tempRoot = join(tmpdir(), logDirName);
  
  const successDir = join(tempRoot, "success");
  const failDir = join(tempRoot, "fail");
  
  await mkdir(successDir, { recursive: true });
  await mkdir(failDir, { recursive: true });
  
  // Generate metadata file
  const metadata = {
    timestamp: now.toISOString(),
    config: {
      model: config.model,
      strategy: "all",
      runs: config.runs,
      concurrency: config.concurrency,
      cliPrompt: config.prompt,
      expectations: config.expectations || [],
    },
    prompts: [
      {
        prompt: config.prompt,
        servers: config.serverConfigs.map(s => s.id),
        expectation: `(answer: string) => {
      const expectations = ${JSON.stringify(config.expectations || [])};
      if (expectations.length === 0) return true;
      
      const normalize = (text: string) => text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212\\uFE58\\uFE63\\uFF0D]/g, "-")
        .replace(/[\\u2018\\u2019\\u201A\\u201B]/g, "'")
        .replace(/[\\u201C\\u201D\\u201E\\u201F]/g, '"')
        .replace(/\\s+/g, " ")
        .trim();
        
      const normalizedAnswer = normalize(answer);
      return expectations.every(exp => normalizedAnswer.includes(normalize(exp)));
    }`
      }
    ]
  };
  
  await writeFile(join(tempRoot, "_metadata.json"), JSON.stringify(metadata, null, 2));

  console.log(`📁 Logs directory: ${tempRoot}\n`);

  console.log(`${BLUE}Running ${config.runs} inference(s) with concurrency ${config.concurrency}...${RESET}\n`);

  if (config.expectations && config.expectations.length > 0) {
    console.log(`${BLUE}Expectations:${RESET} ${config.expectations.join(", ")}\n`);
  }

  const pools = await createServerPools(config.serverConfigs, config.concurrency);
  console.log(`Started ${pools.length} server pool(s), discovered ${pools[0]?.registry.tools.length ?? 0} tools\n`);

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

      const start = Date.now();
      let pass = false;
      let resultData: any = null;
      let errorData: any = null;

      try {
        const loopResult = await runToolLoop({
          adapter: config.adapter,
          registry: pool.registry,
          model: config.model,
          userPrompt: config.prompt,
          logToStderr: false,
        });

        const result = loopResult.finalResult;

        if ("error" in result) {
          errorData = result;
          pass = false;
        } else {
          resultData = result;
          
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
        errorData = { error: String(error) };
        pass = false;
      }

      const durationMs = Date.now() - start;

      // Write to success or fail directory
      const targetDir = pass ? successDir : failDir;
      const runDir = join(targetDir, `run-${String(runId).padStart(3, "0")}`);
      await mkdir(runDir, { recursive: true });

      if (errorData) {
        await writeFile(join(runDir, "error.json"), JSON.stringify(errorData, null, 2));
      } else if (resultData) {
        await writeFile(join(runDir, "response.json"), JSON.stringify(resultData, null, 2));
      }

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

      // Print failed runs immediately
      if (!pass) {
        console.log(`${FAILURE} ${runDir}`);
      }

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
      if (process.stdout.isTTY) {
        process.stdout.write(
          `\r${completed}/${config.runs} | ${SUCCESS}${passCount} ${FAILURE}${failCount}${RESET}`
        );
      } else {
        if (completed % 10 === 0 || completed === config.runs) {
          console.log(`Progress: ${completed}/${config.runs} | pass: ${passCount} fail: ${failCount}${RESET}`);
        }
      }
    }
  }

  await Promise.all(workers);

  // Clear progress line and reset colors
  if (process.stdout.isTTY) {
    process.stdout.write(`\r\x1b[K${RESET}`);
  }

  await destroyServerPools(pools);

  // Compress success logs
  if (passCount > 0) {
    try {
      const tarFile = join(tempRoot, "success.tar.gz");
      const tarProc = Bun.spawn(
        ["tar", "-czf", tarFile, "-C", tempRoot, "success"],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      await tarProc.exited;

      await Bun.spawn(["rm", "-rf", successDir], {
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
    } catch (error) {
      console.log(`${YELLOW}Warning: Failed to compress success logs${RESET}`);
    }
  }

  // Calculate stats
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const p50 = percentile(sortedDurations, 0.5);
  const p95 = percentile(sortedDurations, 0.95);
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;

  // Print summary
  console.log("\n" + "═".repeat(60));
  console.log(`\n📊 Results:\n`);
  console.log(`   Total runs:    ${config.runs}`);
  console.log(`   ${SUCCESS} Passes:      ${GREEN}${passCount}${RESET}`);
  console.log(`   ${FAILURE} Failures:    ${RED}${failCount}${RESET}`);
  console.log(`   Pass rate:     ${((passCount / config.runs) * 100).toFixed(1)}%${RESET}`);
  console.log(`\n⏱  Latency:${RESET}`);
  console.log(`   Mean:          ${mean.toFixed(0)}ms${RESET}`);
  console.log(`   P50:           ${p50.toFixed(0)}ms${RESET}`);
  console.log(`   P95:           ${p95.toFixed(0)}ms${RESET}`);
  
  console.log(`\n📁 Logs:`);
  if (passCount > 0) {
    console.log(`   ${GREEN}✓${RESET} Success logs: ${join(tempRoot, "success.tar.gz")}`);
  }
  if (failCount > 0) {
    console.log(`   ${RED}✗${RESET} Failed logs:  ${failDir}`);
  }
  
  console.log("\n" + "═".repeat(60) + "\n" + RESET);

  return failCount === 0 ? 0 : 1;
}
