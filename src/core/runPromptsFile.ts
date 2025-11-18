import { join, resolve, isAbsolute } from "path";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import type { CompletionsAdapter, ToolRegistry, CompletionsResponse, CompletionsError } from "../types/index.js";
import { runToolLoop, VCRCacheMissError } from "./toolLoop.js";
import type { VCR } from "../mcp/vcr.js";

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

  console.log(`${BLUE}Running ${promptsToRun.length} prompt(s) from ${filePath}${RESET}\n`);

  // Create temp directory for logs
  const tempRoot = await mkdtemp(join(tmpdir(), "mcp-prompts-"));
  const failDir = join(tempRoot, "fail");
  await mkdir(failDir);
  
  console.log(`📁 Logs directory: ${tempRoot}\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalCacheMiss = 0;

  for (const { index, prompt: testPrompt } of promptsToRun) {
    console.log(`${"─".repeat(60)}`);
    console.log(`${BLUE}Prompt ${index}:${RESET} ${testPrompt.prompt.slice(0, 80)}${testPrompt.prompt.length > 80 ? "..." : ""}`);
    console.log(`${BLUE}Servers:${RESET} ${testPrompt.servers.join(", ")}`);
    console.log(`${"─".repeat(60)}\n`);

    // Check if all required servers are loaded
    const missingServers = testPrompt.servers.filter(s => !params.loadedServers.includes(s));
    if (missingServers.length > 0) {
      console.log(`${YELLOW}SKIPPED: Server(s) not loaded: ${missingServers.join(", ")}${RESET}\n`);
      totalSkipped++;
      continue;
    }

    let loopResult;
    try {
      loopResult = await runToolLoop({
        adapter: params.adapter,
        registry: params.registry,
        model: params.model,
        userPrompt: testPrompt.prompt,
        logToStderr: false,
        vcr: params.vcr,
        vcrMode: params.vcrMode,
      });
    } catch (error) {
      if (error instanceof VCRCacheMissError) {
        console.log(`${YELLOW}VCR CACHE MISS: ${error.message}${RESET}\n`);
        totalCacheMiss++;
        continue;
      }
      throw error;
    }

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
      const logPath = join(failDir, `prompt-${index}-error.json`);
      await writeFile(logPath, JSON.stringify(debugLog, null, 2), "utf-8");
      console.log(`${RED}ERROR: API error${RESET}`);
      console.log(`${RED}Log:${RESET} ${logPath}\n`);
      totalFailed++;
      continue;
    }

    const answer = params.adapter.extractAnswer(result);

    if (!answer) {
      const logPath = join(failDir, `prompt-${index}-no-answer.json`);
      await writeFile(logPath, JSON.stringify(debugLog, null, 2), "utf-8");
      console.log(`${RED}FAIL: No <answer> block found${RESET}`);
      console.log(`${RED}Log:${RESET} ${logPath}\n`);
      totalFailed++;
      continue;
    }

    console.log(`${BLUE}Answer:${RESET} ${answer}\n`);

    // Run the expectation callback
    try {
      const passed = testPrompt.expectation(answer);
      if (passed) {
        console.log(`${SUCCESS} ${GREEN}PASS${RESET}\n`);
        totalPassed++;
      } else {
        const logPath = join(failDir, `prompt-${index}-expectation-failed.json`);
        const failLog = [...debugLog, { type: "expectation_result", answer, passed: false }];
        await writeFile(logPath, JSON.stringify(failLog, null, 2), "utf-8");
        console.log(`${BLUE}Answer:${RESET} ${answer}`);
        console.log(`${FAILURE} ${RED}FAIL: Expectation not met${RESET}`);
        console.log(`${RED}Log:${RESET} ${logPath}\n`);
        totalFailed++;
      }
    } catch (error) {
      const logPath = join(failDir, `prompt-${index}-expectation-error.json`);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorLog = [...debugLog, { type: "expectation_error", answer, error: errorMessage }];
      await writeFile(logPath, JSON.stringify(errorLog, null, 2), "utf-8");
      console.log(`${BLUE}Answer:${RESET} ${answer}`);
      console.log(`${FAILURE} ${RED}FAIL: Expectation threw error: ${errorMessage}${RESET}`);
      console.log(`${RED}Log:${RESET} ${logPath}\n`);
      totalFailed++;
    }
  }

  console.log(`${"═".repeat(60)}`);
  console.log(`${BLUE}Summary:${RESET}`);
  console.log(`  ${GREEN}Passed:${RESET} ${totalPassed}`);
  console.log(`  ${RED}Failed:${RESET} ${totalFailed}`);
  console.log(`  ${YELLOW}Skipped:${RESET} ${totalSkipped}`);
  if (totalCacheMiss > 0) {
    console.log(`  ${YELLOW}VCR Cache Miss:${RESET} ${totalCacheMiss}`);
  }
  console.log(`${"═".repeat(60)}\n`);

  return totalFailed > 0 ? 1 : 0;
}
