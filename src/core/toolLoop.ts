import type {
  CompletionsAdapter,
  ToolRegistry,
  Message,
  ToolSchema,
  CompletionsError,
  CompletionsResponse,
} from "../types/index.js";

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
    },
  }));
}

export type ToolLoopResult = {
  finalResult: CompletionsResponse | CompletionsError;
  messages: Message[];
  responses: (CompletionsResponse | CompletionsError)[];
};

export async function runToolLoop(params: {
  adapter: CompletionsAdapter;
  registry: ToolRegistry;
  model: string;
  userPrompt: string;
  maxIterations?: number;
  temperature?: number;
  logToStderr?: boolean;
  onStep?: (response: CompletionsResponse, iteration: number) => void;
}): Promise<ToolLoopResult> {
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
  const toolSchemas = convertToolsToSchemas(params.registry);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await params.adapter.complete({
      model: params.model,
      messages,
      tools: toolSchemas.length > 0 ? toolSchemas : undefined,
      tool_choice: toolSchemas.length > 0 ? "auto" : undefined,
      temperature,
    });

    responses.push(response);

    if (isCompletionsError(response)) {
      return { finalResult: response, messages, responses };
    }

    const choice = response.choices?.[0];
    if (!choice) {
      return { finalResult: response, messages, responses };
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return { finalResult: response, messages, responses };
    }

    if (onStep) {
      onStep(response, iteration);
    }

    if (logToStderr) {
      console.log(JSON.stringify(response));
    }

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
        const result = await tool.invoke(args);

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
  }

  const maxIterationsError: CompletionsError = {
    error: {
      message: `Maximum iterations (${maxIterations}) reached`,
      type: "max_iterations_exceeded",
    },
  };
  
  return { finalResult: maxIterationsError, messages, responses };
}
