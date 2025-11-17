# mcp-discovery

LLM-powered inference with local MCP tool discovery and execution.

## Installation

Requires [Bun](https://bun.sh) runtime.

```bash
bun install
```

## Usage

```
MCP Discovery - LLM inference with local MCP tools

Executes LLM inference calls with automatic tool discovery from MCP servers.
Supports multiple providers and tool discovery strategies.

Requirements:
  - Bun runtime (https://bun.sh)
  - Environment variables for provider (e.g., GROQ_API_KEY)
  - MCP servers configured in mcp/servers.json

Usage:
  bun run.ts <strategy> -m <provider:model> -s <server1,server2,...> -p "<prompt>"

Arguments:
  <strategy>           Tool discovery strategy (currently: 'all')
                       - all: Include all tools from all servers
                       - browse: [Not implemented] Interactive tool browsing
                       - search: [Not implemented] Search-based tool discovery

  -m <provider:model>  Provider and model specification
                       Format: provider:model
                       Examples: groq:llama-3.1-70b-versatile
                                 openai:gpt-4o-mini

  -s <servers>         Comma-separated list of MCP server IDs
                       Available: ppt, playwright, word, chart, trends

  -p <prompt>          User prompt to send to the LLM

  --help               Show this help message

Providers:
  Configure in providers.json. Currently supported:
  - groq (adapter: completions)
  - openai (adapter: completions, stub)
  - openrouter (adapter: completions, stub)
  - anthropic (adapter: messages, stub)
  - groq-responses (adapter: responses, stub)

Examples:
  # Query PowerPoint file with Groq
  bun run.ts all \
    -m groq:llama-3.1-70b-versatile \
    -s ppt \
    -p "What is the title of the first slide of /tmp/demo.ppt"

  # Use multiple MCP servers
  bun run.ts all \
    -m groq:llama-3.1-70b-versatile \
    -s ppt,word,chart \
    -p "Summarize the documents in /tmp"

  # Query with all configured servers
  bun run.ts all \
    -m groq:llama-3.1-70b-versatile \
    -s ppt,playwright,word,chart,trends \
    -p "What is trending in AI this week?"
```

## Configuration

### Providers

Edit [providers.json](file:///Users/glenmaddern/src/projects/mcp-discovery/providers.json) to configure LLM providers. Each provider specifies:
- `adapter`: API type (completions, responses, messages)
- `baseURL`: API endpoint
- `apiKeyEnv`: Environment variable for API key
- `defaultModel`: Default model if none specified
- `stub`: If true, provider is not yet implemented

### MCP Servers

Edit [mcp/servers.json](file:///Users/glenmaddern/src/projects/mcp-discovery/mcp/servers.json) to configure MCP servers. Each server specifies:
- `id`: Unique identifier
- `command`: Executable command
- `args`: Command arguments
- `env`: Environment variables
- `cwd`: Working directory

## Architecture

```
src/
├── types/           Type definitions
├── config/          Configuration loaders
├── adapters/        LLM provider adapters
│   ├── completions/ OpenAI-style completions API
│   ├── responses/   [Stub] Responses API
│   └── messages/    [Stub] Messages API (Anthropic)
├── strategies/      Tool discovery strategies
│   └── discovery/
│       ├── all.ts   Include all tools
│       ├── browse   [Stub] Interactive browsing
│       └── search   [Stub] Search-based discovery
├── mcp/            MCP client implementation
└── core/           Core tool execution loop
```

## License

MIT
