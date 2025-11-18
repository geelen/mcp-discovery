import { join, resolve, isAbsolute } from "path";
import { mkdtemp, mkdir, writeFile, copyFile } from "fs/promises";
import { tmpdir } from "os";
import { createHash } from "crypto";
import type { CompletionsAdapter, ToolRegistry, CompletionsResponse, CompletionsError } from "../types/index.js";
import { runToolLoop, VCRCacheMissError } from "./toolLoop.js";
import type { VCR } from "../mcp/vcr.js";
import { minimalDiscoveryStrategy } from "../strategies/discovery/minimal.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";
const SUCCESS = `${GREEN}✓${RESET}`;
const FAILURE = `${RED}✗${RESET}`;

interface TestPrompt {
  prompt: string;
  servers: string[];
  expectation: (answer: string) => boolean;
}

export async function runPromptsFile(params: {
  adapter: CompletionsAdapter;
  registry: ToolRegistry;
  model: string;
  promptsFileSpec: string;
  cwd: string;
  loadedServers: string[];
  vcr?: VCR;
  vcrMode?: "record" | "replay";
  runs?: number;
  concurrency?: number;
  strategy?: "all" | "minimal";
}): Promise<number> {
  // Parse the file spec (e.g., "mcp/prompts.ts:0")
  const colonIndex = params.promptsFileSpec.lastIndexOf(":");
  let filePath = params.promptsFileSpec;
  let promptIndex: number | null = null;

  if (colonIndex > 0 && /^\d+$/.test(params.promptsFileSpec.slice(colonIndex + 1))) {
    filePath = params.promptsFileSpec.slice(0, colonIndex);
    promptIndex = parseInt(params.promptsFileSpec.slice(colonIndex + 1), 10);
  }

  // Resolve the file path
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(params.cwd, filePath);

  // Load the prompts file
  let promptsModule: { prompts: TestPrompt[] };
  try {
    promptsModule = await import(absolutePath);
  } catch (error) {
    console.error(`${RED}Error loading prompts file:${RESET} ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (!promptsModule.prompts || !Array.isArray(promptsModule.prompts)) {
    console.error(`${RED}Error:${RESET} Prompts file must export a 'prompts' array`);
    return 1;
  }

  const prompts = promptsModule.prompts;

  // Determine which prompts to run
  const promptsToRun: Array<{ index: number; prompt: TestPrompt }> =
    promptIndex !== null
      ? prompts[promptIndex]
        ? [{ index: promptIndex, prompt: prompts[promptIndex] }]
        : []
      : prompts.map((prompt, index) => ({ index, prompt }));

  if (promptsToRun.length === 0) {
    if (promptIndex !== null) {
      console.error(`${RED}Error:${RESET} Prompt index ${promptIndex} not found in file (file has ${prompts.length} prompts)`);
    } else {
      console.error(`${RED}Error:${RESET} No prompts found in file`);
    }
    return 1;
  }

  const runs = params.runs ?? 1;
  const concurrency = params.concurrency ?? 1;

  if (runs > 1) {
    console.log(`${BLUE}Running ${promptsToRun.length} prompt(s) from ${filePath}${RESET}`);
    console.log(`${BLUE}Benchmark mode: ${runs} runs per prompt, concurrency ${concurrency}${RESET}\n`);
  } else {
    console.log(`${BLUE}Running ${promptsToRun.length} prompt(s) from ${filePath}${RESET}\n`);
  }

  // Create temp directory for logs
  const tempRoot = await mkdtemp(join(tmpdir(), "mcp-prompts-"));
  const failDir = join(tempRoot, "fail");
  await mkdir(failDir);

  // Copy prompts file to logs directory
  await copyFile(absolutePath, join(tempRoot, "prompts.ts"));
  
  console.log(`📁 Logs directory: ${tempRoot}\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalCacheMiss = 0;
  let totalRuns = 0;

  for (const { index, prompt: testPrompt } of promptsToRun) {
    console.log(`${"─".repeat(60)}`);
    console.log(`${BLUE}Prompt ${index}:${RESET} ${testPrompt.prompt.slice(0, 80)}${testPrompt.prompt.length > 80 ? "..." : ""}`);
    console.log(`${BLUE}Servers:${RESET} ${testPrompt.servers.join(", ")}`);
    if (runs > 1) {
      console.log(`${BLUE}Runs:${RESET} ${runs} (concurrency: ${concurrency})`);
    }

    // Check if all required servers are loaded (skip for minimal strategy)
    if (params.strategy !== "minimal") {
      const missingServers = testPrompt.servers.filter(s => !params.loadedServers.includes(s));
      if (missingServers.length > 0) {
        console.log(`${BLUE}Tools:${RESET} ${params.registry.tools.length}`);
        console.log(`${"─".repeat(60)}\n`);
        console.log(`${YELLOW}SKIPPED: Server(s) not loaded: ${missingServers.join(", ")}${RESET}\n`);
        totalSkipped++;
        continue;
      }
    }

    // For minimal strategy, create a filtered registry per prompt
    let activeRegistry = params.registry;
    if (params.strategy === "minimal" && params.vcr) {
      try {
        activeRegistry = await minimalDiscoveryStrategy({
          vcr: params.vcr,
          fullRegistry: params.registry,
          task: testPrompt.prompt,
          expectation: testPrompt.expectation,
        });
        console.log(`${BLUE}Tools:${RESET} ${activeRegistry.tools.length} (${activeRegistry.tools.map(t => t.name).join(", ")})`);
      } catch (error) {
        console.log(`${"─".repeat(60)}\n`);
        console.log(`${RED}ERROR: ${error instanceof Error ? error.message : String(error)}${RESET}\n`);
        totalSkipped++;
        continue;
      }
    } else {
      console.log(`${BLUE}Tools:${RESET} ${params.registry.tools.length}`);
    }
    
    console.log(`${"─".repeat(60)}\n`);

    // Run the prompt multiple times if in benchmark mode
    const runResults: { passed: boolean; durationMs: number }[] = [];
    let promptPassed = 0;
    let promptFailed = 0;
    let promptCacheMiss = 0;
    let completed = 0;

    // Create a worker function that processes a single run
    const processRun = async (idx: number) => {
        const startTime = performance.now();

        let loopResult;
        try {
          loopResult = await runToolLoop({
            adapter: params.adapter,
            registry: activeRegistry,
            model: params.model,
            userPrompt: testPrompt.prompt,
            logToStderr: false,
            vcr: params.vcr,
            vcrMode: params.vcrMode,
          });
        } catch (error) {
          if (error instanceof VCRCacheMissError) {
            if (runs === 1) {
              console.log(`${YELLOW}VCR CACHE MISS: ${error.message}${RESET}\n`);
            }
            promptCacheMiss++;
            totalCacheMiss++;
            
            // Update progress
            completed++;
            if (runs > 1) {
              const progress = `${completed}/${runs}`;
              const stats = `${promptPassed} ✓, ${promptFailed} ✗`;
              process.stderr.write(`\r${BLUE}Progress:${RESET} ${progress} (${stats})                    `);
            }
            return;
          }
          throw error;
        }

        const durationMs = performance.now() - startTime;
        const result = loopResult.finalResult;
        const hasError = "error" in result;

        // Create debug log with full history
        const debugLog = [];
        for (let i = 0; i < loopResult.responses.length; i++) {
          debugLog.push({
            step: i,
            type: "llm_request",
            data: loopResult.requests[i],
          });
          debugLog.push({
            step: i,
            type: "llm_response",
            data: loopResult.responses[i],
          });
        }
        debugLog.push({
          step: loopResult.responses.length,
          type: "final_result",
          data: result,
        });

        if (hasError) {
          const logPath = join(failDir, `prompt-${index}-run-${idx}-error.json`);
          await writeFile(logPath, JSON.stringify(debugLog, null, 2), "utf-8");
          if (runs === 1) {
            console.log(`${RED}ERROR: API error${RESET}`);
            console.log(`${RED}Log:${RESET} ${logPath}\n`);
          }
          promptFailed++;
          runResults.push({ passed: false, durationMs });
          
          // Update progress
          completed++;
          if (runs > 1) {
            const progress = `${completed}/${runs}`;
            const stats = `${promptPassed} ✓, ${promptFailed} ✗`;
            process.stderr.write(`\r${BLUE}Progress:${RESET} ${progress} (${stats})                    `);
          }
          return;
        }

        const answer = params.adapter.extractAnswer(result);

        if (!answer) {
          const logPath = join(failDir, `prompt-${index}-run-${idx}-no-answer.json`);
          await writeFile(logPath, JSON.stringify(debugLog, null, 2), "utf-8");
          if (runs === 1) {
            console.log(`${RED}FAIL: No <answer> block found${RESET}`);
            console.log(`${RED}Log:${RESET} ${logPath}\n`);
          }
          promptFailed++;
          runResults.push({ passed: false, durationMs });
          
          // Update progress
          completed++;
          if (runs > 1) {
            const progress = `${completed}/${runs}`;
            const stats = `${promptPassed} ✓, ${promptFailed} ✗`;
            process.stderr.write(`\r${BLUE}Progress:${RESET} ${progress} (${stats})                    `);
          }
          return;
        }

        if (runs === 1) {
          console.log(`${BLUE}Answer:${RESET} ${answer}\n`);
        }

        // Run the expectation callback
        try {
          const passed = testPrompt.expectation(answer);
          if (passed) {
            if (runs === 1) {
              console.log(`${SUCCESS} ${GREEN}PASS${RESET}\n`);
            }
            promptPassed++;
            runResults.push({ passed: true, durationMs });

            // Record successful tool pattern in VCR (only in record mode, not in minimal strategy)
            if (params.vcr && params.vcrMode === "record" && params.strategy !== "minimal") {
              const expectationsHash = createHash("sha256")
                .update(testPrompt.expectation.toString())
                .digest("hex")
                .slice(0, 16);
              
              // Extract tool names from assistant messages with tool calls
              const toolsCalled: string[] = [];
              for (const msg of loopResult.messages) {
                if (msg.role === "assistant" && msg.tool_calls) {
                  for (const toolCall of msg.tool_calls) {
                    toolsCalled.push(toolCall.function.name);
                  }
                }
              }
              
              if (toolsCalled.length > 0) {
                params.vcr.recordSuccessfulPattern(testPrompt.prompt, expectationsHash, toolsCalled);
              }
            }
          } else {
            const logPath = join(failDir, `prompt-${index}-run-${idx}-expectation-failed.json`);
            const failLog = [...debugLog, { type: "expectation_result", answer, passed: false }];
            await writeFile(logPath, JSON.stringify(failLog, null, 2), "utf-8");
            if (runs === 1) {
              console.log(`${BLUE}Answer:${RESET} ${answer}`);
              console.log(`${FAILURE} ${RED}FAIL: Expectation not met${RESET}`);
              console.log(`${RED}Log:${RESET} ${logPath}\n`);
            }
            promptFailed++;
            runResults.push({ passed: false, durationMs });
          }
        } catch (error) {
          const logPath = join(failDir, `prompt-${index}-run-${idx}-expectation-error.json`);
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorLog = [...debugLog, { type: "expectation_error", answer, error: errorMessage }];
          await writeFile(logPath, JSON.stringify(errorLog, null, 2), "utf-8");
          if (runs === 1) {
            console.log(`${BLUE}Answer:${RESET} ${answer}`);
            console.log(`${FAILURE} ${RED}FAIL: Expectation threw error: ${errorMessage}${RESET}`);
            console.log(`${RED}Log:${RESET} ${logPath}\n`);
          }
          promptFailed++;
          runResults.push({ passed: false, durationMs });
        }

        totalRuns++;
        
        // Update progress
        completed++;
        if (runs > 1) {
          const progress = `${completed}/${runs}`;
          const stats = `${promptPassed} ✓, ${promptFailed} ✗`;
          process.stderr.write(`\r${BLUE}Progress:${RESET} ${progress} (${stats})                    `);
      }
    };

    // Execute runs with a worker pool to maintain constant concurrency
    const workers: Promise<void>[] = [];
    let nextRunIdx = 0;

    // Worker function that processes runs from the queue
    const worker = async () => {
      while (nextRunIdx < runs) {
        const idx = nextRunIdx++;
        await processRun(idx);
      }
    };

    // Start the worker pool
    for (let i = 0; i < Math.min(concurrency, runs); i++) {
      workers.push(worker());
    }

    // Wait for all workers to complete
    await Promise.all(workers);

    // Display results for this prompt
    if (runs > 1) {
      // Clear progress line
      process.stderr.write(`\r${" ".repeat(80)}\r`);
      
      const durations = runResults.map(r => r.durationMs);
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const sortedDurations = [...durations].sort((a, b) => a - b);
      const p50 = sortedDurations[Math.floor(sortedDurations.length * 0.5)];
      const p95 = sortedDurations[Math.floor(sortedDurations.length * 0.95)];

      console.log(`${BLUE}Results:${RESET}`);
      console.log(`  ${GREEN}Passed:${RESET} ${promptPassed}/${runs}`);
      console.log(`  ${RED}Failed:${RESET} ${promptFailed}/${runs}`);
      if (promptCacheMiss > 0) {
        console.log(`  ${YELLOW}Cache Miss:${RESET} ${promptCacheMiss}/${runs}`);
      }
      console.log(`${BLUE}Timing:${RESET}`);
      console.log(`  Avg: ${avgDuration.toFixed(0)}ms`);
      console.log(`  p50: ${p50.toFixed(0)}ms`);
      console.log(`  p95: ${p95.toFixed(0)}ms\n`);
    }

    totalPassed += promptPassed;
    totalFailed += promptFailed;
  }

  console.log(`${"═".repeat(60)}`);
  console.log(`${BLUE}Summary:${RESET}`);
  if (runs > 1) {
    console.log(`  ${BLUE}Total Runs:${RESET} ${totalRuns}`);
  }
  console.log(`  ${GREEN}Passed:${RESET} ${totalPassed}`);
  console.log(`  ${RED}Failed:${RESET} ${totalFailed}`);
  console.log(`  ${YELLOW}Skipped:${RESET} ${totalSkipped}`);
  if (totalCacheMiss > 0) {
    console.log(`  ${YELLOW}VCR Cache Miss:${RESET} ${totalCacheMiss}`);
  }
  console.log(`${"═".repeat(60)}\n`);

  return totalFailed > 0 ? 1 : 0;
}
