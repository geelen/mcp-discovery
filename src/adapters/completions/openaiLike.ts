import type {
  CompletionsAdapter,
  CompletionsRequest,
  CompletionsResponse,
  CompletionsError,
  Message,
  ToolSchema,
} from "../../types/index.js";

type OpenAiMessage = {
  role: string;
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

type OpenAiTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
};

export function createOpenAiLikeAdapter(baseURL: string, apiKey: string): CompletionsAdapter {
  return {
    async complete(request: CompletionsRequest): Promise<CompletionsResponse | CompletionsError> {
      const openaiMessages: OpenAiMessage[] = request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        tool_call_id: msg.tool_call_id,
        name: msg.name,
        tool_calls: msg.tool_calls,
      }));

      const openaiTools: OpenAiTool[] | undefined = request.tools?.map((tool) => ({
        type: "function",
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));

      const requestBody = {
        model: request.model,
        messages: openaiMessages,
        ...(openaiTools && openaiTools.length > 0 && { tools: openaiTools }),
        ...(request.tool_choice && { tool_choice: request.tool_choice }),
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.max_tokens !== undefined && { max_tokens: request.max_tokens }),
      };

      try {
        const response = await fetch(`${baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const responseJson = await response.json();

        if (!response.ok) {
          return {
            error: {
              message: responseJson.error?.message || "Unknown error",
              type: responseJson.error?.type || "api_error",
              code: responseJson.error?.code,
            },
          };
        }

        const choice = responseJson.choices?.[0];
        if (!choice) {
          return {
            error: {
              message: "No choices in response",
              type: "invalid_response",
            },
          };
        }

        const assistantMessage: Message = {
          role: "assistant",
          content: choice.message.content || null,
          tool_calls: choice.message.tool_calls,
        };

        return {
          message: assistantMessage,
          finishReason: choice.finish_reason,
          usage: responseJson.usage,
          raw: responseJson,
        };
      } catch (error) {
        return {
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: "network_error",
          },
        };
      }
    },
  };
}
