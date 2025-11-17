import type { CompletionsAdapter, ToolRegistry, CompletionsResponse, CompletionsError } from "../types/index.js";
import { runToolLoop } from "./toolLoop.js";
import { checkExpectations } from "../util/expectations.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";
const SUCCESS = `${GREEN}✓${RESET}`;
const FAILURE = `${RED}✗${RESET}`;

export async function runSingleInference(params: {
  adapter: CompletionsAdapter;
  registry: ToolRegistry;
  model: string;
  prompt: string;
  expectations?: string[];
}): Promise<number> {
  console.log(`${BLUE}Running inference...${RESET}\n`);

  const result = await runToolLoop({
    adapter: params.adapter,
    registry: params.registry,
    model: params.model,
    userPrompt: params.prompt,
    logToStderr: true,
  });

  console.log("═".repeat(60));
  console.log(`${BLUE}Response:${RESET}\n`);
  console.log(JSON.stringify(result, null, 2));
  console.log("\n" + "═".repeat(60));

  const hasError = "error" in result;

  if (hasError) {
    console.log(`\n${RED}ERROR${RESET}\n`);
    console.log(`${RED}FAIL${RESET} - API error\n`);
    return 1;
  }

  const answer = params.adapter.extractAnswer(result);

  if (answer) {
    console.log(`\n${BLUE}Answer Block:${RESET}`);
    console.log(answer + "\n");
  } else {
    if (params.expectations && params.expectations.length > 0) {
      console.log(`\n${YELLOW}Warning: No <answer> block found in response${RESET}\n`);
    }
  }

  if (params.expectations && params.expectations.length > 0) {
    if (!answer) {
      console.log(`${RED}FAIL${RESET} - No answer block found\n`);
      return 1;
    }

    const { allFound, checks } = checkExpectations(answer, params.expectations);

    console.log(`${BLUE}Expectations:${RESET}\n`);
    for (const check of checks) {
      const status = check.found ? SUCCESS : FAILURE;
      console.log(`  ${status} "${check.expectation}"`);
    }

    console.log();
    if (allFound) {
      console.log(`${GREEN}PASS${RESET} - All expectations found\n`);
      return 0;
    } else {
      console.log(`${RED}FAIL${RESET} - Some expectations missing\n`);
      return 1;
    }
  } else {
    console.log(`${GREEN}PASS${RESET} - Inference completed\n`);
    return 0;
  }
}
