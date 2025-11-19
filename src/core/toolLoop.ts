import type {
  CompletionsAdapter,
  ToolRegistry,
  Message,
  ToolSchema,
  CompletionsError,
  CompletionsResponse,
} from "../types/index.js";
import type { VCR } from "../mcp/vcr.js";

function isCompletionsError(response: CompletionsResponse | CompletionsError): response is CompletionsError {
  return "error" in response;
}

function convertToolsToSchemas(registry: ToolRegistry): ToolSchema[] {
  return registry.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: tool.strict,
    },
  }));
}

export type ToolLoopResult = {
  finalResult: CompletionsResponse | CompletionsError;
  messages: Message[];
  responses: (CompletionsResponse | CompletionsError)[];
  requests: any[];
};

export class VCRCacheMissError extends Error {
  constructor(toolName: string, args: any) {
    super(`VCR cache miss in replay mode: ${toolName}(${JSON.stringify(args)})`);
    this.name = "VCRCacheMissError";
  }
}

export async function runToolLoop(params: {
  adapter: CompletionsAdapter;
  registry: ToolRegistry;
  model: string;
  userPrompt: string;
  maxIterations?: number;
  temperature?: number;
  logToStderr?: boolean;
  onStep?: (response: CompletionsResponse, iteration: number) => void;
  vcr?: VCR;
  vcrMode?: "record" | "replay";
}): Promise<ToolLoopResult> {
  const DEBUG_TIMING = process.env.DEBUG_TIMING === "1";
  const startTotal = performance.now();
  
  const maxIterations = params.maxIterations ?? 10;
  const temperature = params.temperature ?? 0.2;
  const logToStderr = params.logToStderr ?? false;
  const onStep = params.onStep;

  const messages: Message[] = [
    {
      role: "user",
      content: params.userPrompt,
    },
  ];

  const responses: (CompletionsResponse | CompletionsError)[] = [];
  const requests: any[] = [];
  const toolSchemas = convertToolsToSchemas(params.registry);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const requestParams = {
      model: params.model,
      messages,
      tools: toolSchemas.length > 0 ? toolSchemas : undefined,
      tool_choice: toolSchemas.length > 0 ? "auto" : undefined,
      temperature,
    };

    requests.push(requestParams);

    const llmStart = performance.now();
    const response = await params.adapter.complete(requestParams);
    const llmTime = performance.now() - llmStart;
    if (DEBUG_TIMING) console.error(`[TIMING] LLM call ${iteration}: ${llmTime.toFixed(0)}ms`);

    responses.push(response);

    if (isCompletionsError(response)) {
      return { finalResult: response, messages, responses, requests };
    }

    const choice = response.choices?.[0];
    if (!choice) {
      return { finalResult: response, messages, responses, requests };
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return { finalResult: response, messages, responses, requests };
    }

    if (onStep) {
      onStep(response, iteration);
    }

    if (logToStderr) {
      console.log(JSON.stringify(response));
    }

    const toolStart = performance.now();
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const tool = params.registry.byName.get(toolName);

      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
        });
        continue;
      }

      try {
        const argsString = toolCall.function.arguments;
        const args = argsString ? JSON.parse(argsString) : {};
        
        let result: any;

        // Check VCR cache first (in both record and replay modes)
        if (params.vcr && params.vcrMode) {
          const vcrStart = performance.now();
          const cachedResult = params.vcr.getCachedResult(toolName, args);
          const vcrTime = performance.now() - vcrStart;
          if (DEBUG_TIMING) console.error(`[TIMING]   VCR lookup ${toolName}: ${vcrTime.toFixed(0)}ms`);
          
          if (cachedResult !== null) {
            // Cache hit - use cached result
            result = cachedResult;
          } else if (params.vcrMode === "replay") {
            // Cache miss in replay mode - fail
            throw new VCRCacheMissError(toolName, args);
          } else {
            // Cache miss in record mode - invoke real tool and cache result
            result = await tool.invoke(args);
            params.vcr.recordResult(toolName, args, result);
          }
        } else {
          // No VCR - invoke tool normally
          result = await tool.invoke(args);
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify(result),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify({ error: errorMessage }),
        });
      }
    }
    const toolTime = performance.now() - toolStart;
    if (DEBUG_TIMING && toolCalls.length > 0) console.error(`[TIMING]   All tools (${toolCalls.length}): ${toolTime.toFixed(0)}ms`);
  }

  const totalTime = performance.now() - startTotal;
  if (DEBUG_TIMING) console.error(`[TIMING] Total runToolLoop: ${totalTime.toFixed(0)}ms\n`);

  const maxIterationsError: CompletionsError = {
    error: {
      message: `Maximum iterations (${maxIterations}) reached`,
      type: "max_iterations_exceeded",
    },
  };
  
  return { finalResult: maxIterationsError, messages, responses, requests };
}
