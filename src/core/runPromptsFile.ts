import { join, resolve, isAbsolute } from "path";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import type { CompletionsAdapter, ToolRegistry, CompletionsResponse, CompletionsError } from "../types/index.js";
import { runToolLoop } from "./toolLoop.js";

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

  for (const { index, prompt: testPrompt } of promptsToRun) {
    console.log(`${"─".repeat(60)}`);
    console.log(`${BLUE}Prompt ${index}:${RESET} ${testPrompt.prompt.slice(0, 80)}${testPrompt.prompt.length > 80 ? "..." : ""}`);
    console.log(`${BLUE}Servers:${RESET} ${testPrompt.servers.join(", ")}`);
    console.log(`${"─".repeat(60)}\n`);

    const result = await runToolLoop({
      adapter: params.adapter,
      registry: params.registry,
      model: params.model,
      userPrompt: testPrompt.prompt,
      logToStderr: false,
    });

    const hasError = "error" in result;

    if (hasError) {
      const logPath = join(failDir, `prompt-${index}-error.json`);
      await writeFile(logPath, JSON.stringify(result, null, 2), "utf-8");
      console.log(`${RED}ERROR: API error${RESET}`);
      console.log(`${RED}Log:${RESET} ${logPath}\n`);
      totalFailed++;
      continue;
    }

    const answer = params.adapter.extractAnswer(result);

    if (!answer) {
      const logPath = join(failDir, `prompt-${index}-no-answer.json`);
      await writeFile(logPath, JSON.stringify(result, null, 2), "utf-8");
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
        await writeFile(logPath, JSON.stringify({ result, answer, passed: false }, null, 2), "utf-8");
        console.log(`${BLUE}Answer:${RESET} ${answer}`);
        console.log(`${FAILURE} ${RED}FAIL: Expectation not met${RESET}`);
        console.log(`${RED}Log:${RESET} ${logPath}\n`);
        totalFailed++;
      }
    } catch (error) {
      const logPath = join(failDir, `prompt-${index}-expectation-error.json`);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await writeFile(logPath, JSON.stringify({ result, answer, error: errorMessage }, null, 2), "utf-8");
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
  console.log(`${"═".repeat(60)}\n`);

  return totalFailed > 0 ? 1 : 0;
}
