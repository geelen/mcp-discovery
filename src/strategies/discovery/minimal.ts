import type { ToolRegistry, DiscoveredTool } from "../../types/index.js";
import type { VCR } from "../../mcp/vcr.js";
import { createHash } from "crypto";

export interface MinimalStrategyParams {
  vcr: VCR;
  fullRegistry: ToolRegistry;
  task: string;
  expectation: (answer: string) => boolean;
  strict?: boolean;
}

export async function minimalDiscoveryStrategy(params: MinimalStrategyParams): Promise<ToolRegistry> {
  const expectationsHash = createHash("sha256")
    .update(params.expectation.toString())
    .digest("hex")
    .slice(0, 16);

  const toolNames = params.vcr.getMostCommonSuccessfulPattern(params.task, expectationsHash);

  if (!toolNames) {
    throw new Error(
      `Minimal strategy: No successful pattern found for task. ` +
      `Task must be run with --record first to build up successful patterns.`
    );
  }

  // Filter the full registry to only include the tools from the pattern
  const minimalTools: DiscoveredTool[] = [];
  for (const toolName of toolNames) {
    const tool = params.fullRegistry.byName.get(toolName);
    if (tool) {
      if (params.strict) {
        minimalTools.push({ ...tool, strict: true });
      } else {
        minimalTools.push(tool);
      }
    } else {
      console.warn(`Warning: Tool ${toolName} from successful pattern not found in registry`);
    }
  }

  const byName = new Map<string, DiscoveredTool>();
  for (const tool of minimalTools) {
    byName.set(tool.name, tool);
  }

  return {
    tools: minimalTools,
    byName,
  };
}
