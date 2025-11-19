export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type Message = {
  role: MessageRole;
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
};

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Json;
    strict?: boolean;
  };
};

export type DiscoveredTool = {
  name: string;
  description?: string;
  inputSchema: Json;
  serverId: string;
  invoke: (args: Json) => Promise<Json>;
  strict?: boolean;
};

export type ToolRegistry = {
  tools: DiscoveredTool[];
  byName: Map<string, DiscoveredTool>;
};

export type ProviderConfig = {
  adapter: "completions" | "responses" | "messages";
  baseURL: string;
  apiKeyEnv: string;
  defaultModel?: string;
  stub?: boolean;
};

export type ProvidersFile = Record<string, ProviderConfig>;

export type CompletionsRequest = {
  model: string;
  messages: Message[];
  tools?: ToolSchema[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
};

export type CompletionsResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: Message;
    finish_reason: string;
    logprobs?: unknown;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type CompletionsError = {
  error: {
    message: string;
    type: string;
    code?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type CompletionsAdapter = {
  complete: (request: CompletionsRequest) => Promise<CompletionsResponse | CompletionsError>;
  extractAnswer: (response: CompletionsResponse | CompletionsError) => string;
};

export type McpServerConfig = {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpClient = {
  serverId: string;
  listTools: () => Promise<Array<{ name: string; description?: string; inputSchema: Json }>>;
  callTool: (name: string, args: Json) => Promise<Json>;
  stop: () => Promise<void>;
};

export type ToolDiscoveryStrategy = (mcpClients: McpClient[]) => Promise<ToolRegistry>;
