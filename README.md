# mcp-discovery

LLM-powered inference with local MCP tool discovery and execution.

## Installation

Requires [Bun](https://bun.sh) runtime.

```bash
bunx mcp-discovery
```

No installation needed - `bunx` will download and run the latest version automatically.

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
  bunx mcp-discovery <strategy> -m <provider:model> [-s <server1,server2,...>] -p "<prompt>"

Arguments:
  <strategy>           Tool discovery strategy (currently: 'all')
                       - all: Include all tools from all servers
                       - browse: [Not implemented] Interactive tool browsing
                       - search: [Not implemented] Search-based tool discovery

  -m <provider:model>  Provider and model specification
                       Format: provider:model
                       Examples: groq:llama-3.1-70b-versatile
                                 openai:gpt-4o-mini

  -s <servers>         [Optional] Comma-separated list of MCP server IDs
                       Available: ppt, playwright, word, chart, trends
                       If not provided, runs without tools

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
  # Simple query without tools
  bunx mcp-discovery all \
    -m groq:llama-3.3-70b-versatile \
    -p "What is 2+2?"

  # Query bundled test PowerPoint file
  bunx mcp-discovery all \
    -m groq:llama-3.3-70b-versatile \
    -s ppt \
    -p "What is in the bundled presentation about building agents?"

  # Query bundled Word documents
  bunx mcp-discovery all \
    -m groq:llama-3.3-70b-versatile \
    -s word \
    -p "What information is in the exchange document?"

  # Use multiple MCP servers together
  bunx mcp-discovery all \
    -m groq:llama-3.3-70b-versatile \
    -s ppt,word \
    -p "List all available documents"
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

The `LIVEMCP_DATA` environment variable is automatically set to point to `mcp/data/` which contains sample test files.

### Test Data

Sample data files are included in [mcp/data/](file:///Users/glenmaddern/src/projects/mcp-discovery/mcp/data/) for testing:
- `ppt/` - PowerPoint presentations
- `word/` - Word documents

These files are from the [LiveMCPBench](https://github.com/livemcp/LiveMCPBench) annotated data set.

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

## Contributing

To develop on this project locally:

```bash
# Clone the repository
git clone <repository-url>
cd mcp-discovery

# Install dependencies
bun install

# Run locally during development
bun run mcp-discovery all -m groq:llama-3.3-70b-versatile -p "Test"

# The command runs from mcp-discovery/index.ts
# All source code is in the src/ directory
```

### Project Structure

- `mcp-discovery/index.ts` - CLI entrypoint
- `src/` - Source code modules
- `providers.json` - LLM provider configuration
- `mcp/servers.json` - MCP server configuration

### Development Workflow

1. Make changes to source files
2. Test with `bun run mcp-discovery`
3. Commit changes with descriptive messages
4. All progress messages go to stderr, JSON output to stdout

## License

MIT
