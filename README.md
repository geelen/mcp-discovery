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
  Single run:
    bunx mcp-discovery <strategy> -m <provider:model> [-s <servers>] -p "<prompt>"

  Benchmark mode:
    bunx mcp-discovery <strategy> -m <provider:model> [-s <servers>] -p "<prompt>" -n <runs> [-c <concurrency>]

Arguments:
  <strategy>           Tool discovery strategy (currently: 'all')
                       - all: Include all tools from all servers
                       - minimal: Use VCR cache to find minimal set of tools for task
                       - all-relevant: Filter tools by server ID
                       
                       Suffix with :strict to enable strict tool definition mode
                       Example: all:strict, minimal:strict

  -m <provider:model>  Provider and model specification
                       Format: provider:model
                       Examples: groq:llama-3.1-70b-versatile
                                 openai:gpt-4o-mini

  -s <servers>         [Optional] Comma-separated list of MCP server IDs
                       Available: ppt, playwright, word, chart, trends
                       If not provided, runs without tools

  -p <prompt>          User prompt to send to the LLM

  -n <runs>            [Optional] Number of times to run (default: 1)
                       If > 1, enters benchmark mode with statistics

  -c <concurrency>     [Optional] Number of concurrent workers (default: 1)
                       Each worker maintains its own MCP server pool

  -x <expectation>     [Optional] Expected text in <answer> block (multiple allowed)
                       When provided, pass/fail based on whether all expectations found
                       Text is normalized (case-insensitive, normalized punctuation)

  --help               Show this help message

Modes:
  Single run (n=1):    Outputs progress then complete JSON response

  Benchmark (n>1):     Runs multiple inferences concurrently
                       Shows progress, statistics, and latency metrics
                       Saves per-run logs to temp directory
                       Returns exit code 0 if all pass, 1 if any fail

Providers:
  Configure in providers.json. Currently supported:
  - groq (adapter: completions)
  - openai (adapter: completions, stub)
  - openrouter (adapter: completions, stub)
  - anthropic (adapter: messages, stub)
  - groq-responses (adapter: responses, stub)

Examples:
  # Single run - simple query
  bunx mcp-discovery all \
    -m groq:llama-3.3-70b-versatile \
    -p "What is 2+2?"

  # Single run - query bundled PowerPoint file (relative path)
  bunx mcp-discovery all \
    -m groq:llama-3.3-70b-versatile \
    -s ppt \
    -p "What is the title of data/ppt/build_effective_agents.pptx?"

  # Benchmark - test reliability with 50 runs
  bunx mcp-discovery all \
    -m groq:llama-3.3-70b-versatile \
    -s ppt \
    -p "What is the title of data/ppt/build_effective_agents.pptx?" \
    -n 50 -c 8

  # Benchmark - high concurrency stress test
  bunx mcp-discovery all \
    -m groq:llama-3.1-8b-instant \
    -p "What is 5+5?" \
    -n 100 -c 10

  # Benchmark with expectations (checks for specific text in answer)
  bunx mcp-discovery all \
    -m groq:llama-3.3-70b-versatile \
    -p "What is 2 + 2. Put only the answer between <answer></answer> tags." \
    -n 20 -c 4 \
    -x "4"

  # Extract just the content from single run (filter out progress lines)
  bunx mcp-discovery all \
    -m groq:llama-3.3-70b-versatile \
    -p "Hello" \
    | tail -1 | jq -r '.choices[0].message.content'
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
- `env`: Environment variables (optional)

MCP servers are automatically started with their working directory set to `mcp/`, so relative paths like `data/ppt/file.pptx` work correctly.

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
bun src/mcp-discovery.ts all -m groq:llama-3.3-70b-versatile -p "Test"

# The CLI entrypoint is src/mcp-discovery.ts
# All other source code is in the src/ directory
```

### Project Structure

- `src/mcp-discovery.ts` - CLI entrypoint
- `src/` - Source code modules
- `providers.json` - LLM provider configuration
- `mcp/servers.json` - MCP server configuration

### Development Workflow

1. Make changes to source files
2. Test with `bun src/mcp-discovery.ts`
3. Commit changes with descriptive messages
4. All output goes to stdout

## License

MIT
