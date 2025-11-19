import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import type { ToolRegistry, DiscoveredTool } from "../types/index.js";

export class VCR {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL,
        args_hash TEXT NOT NULL,
        args_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(tool_name, args_hash)
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_tool_calls_lookup 
      ON tool_calls(tool_name, args_hash)
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL UNIQUE,
        description TEXT,
        input_schema TEXT NOT NULL,
        server_name TEXT,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS successful_tool_patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT NOT NULL,
        expectations_hash TEXT NOT NULL,
        tools_called TEXT NOT NULL,
        num_successes INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(task, expectations_hash, tools_called)
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_successful_patterns_lookup 
      ON successful_tool_patterns(task, expectations_hash)
    `);
  }

  private hashArgs(args: any): string {
    const normalized = JSON.stringify(args, Object.keys(args).sort());
    return createHash("sha256").update(normalized).digest("hex");
  }

  getCachedResult(toolName: string, args: any): any | null {
    const argsHash = this.hashArgs(args);
    
    const row = this.db
      .query<{ result_json: string }, [string, string]>(
        "SELECT result_json FROM tool_calls WHERE tool_name = ? AND args_hash = ?"
      )
      .get(toolName, argsHash);

    if (row) {
      return JSON.parse(row.result_json);
    }

    return null;
  }

  recordResult(toolName: string, args: any, result: any): void {
    const argsHash = this.hashArgs(args);
    const argsJson = JSON.stringify(args);
    const resultJson = JSON.stringify(result);
    const createdAt = Date.now();

    this.db.run(
      `INSERT OR REPLACE INTO tool_calls 
       (tool_name, args_hash, args_json, result_json, created_at) 
       VALUES (?, ?, ?, ?, ?)`,
      toolName,
      argsHash,
      argsJson,
      resultJson,
      createdAt
    );
  }

  saveToolRegistry(tools: DiscoveredTool[]): void {
    // Clear existing tools
    this.db.run("DELETE FROM tools");

    // Insert all tools
    const stmt = this.db.prepare(
      `INSERT INTO tools (tool_name, description, input_schema, server_name, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );

    const updatedAt = Date.now();
    for (const tool of tools) {
      stmt.run(
        tool.name,
        tool.description ?? null,
        JSON.stringify(tool.inputSchema),
        tool.serverId ?? null,
        updatedAt
      );
    }
  }

  loadToolRegistry(): ToolRegistry | null {
    const rows = this.db
      .query<
        {
          tool_name: string;
          description: string | null;
          input_schema: string;
          server_name: string | null;
        },
        []
      >("SELECT tool_name, description, input_schema, server_name FROM tools")
      .all();

    if (rows.length === 0) {
      return null;
    }

    const tools: DiscoveredTool[] = rows.map((row) => ({
      name: row.tool_name,
      description: row.description ?? undefined,
      inputSchema: JSON.parse(row.input_schema),
      serverId: row.server_name ?? "unknown", // Fallback for existing data if any
      invoke: async () => {
        throw new Error(
          `Cannot invoke tool ${row.tool_name} - VCR replay should handle this via cache`
        );
      },
    }));

    const byName = new Map<string, DiscoveredTool>();
    for (const tool of tools) {
      byName.set(tool.name, tool);
    }

    return { tools, byName };
  }

  getStats(): { totalCalls: number; uniqueTools: number; registeredTools: number; successfulPatterns: number } {
    const totalRow = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM tool_calls")
      .get();

    const toolsRow = this.db
      .query<{ count: number }, []>(
        "SELECT COUNT(DISTINCT tool_name) as count FROM tool_calls"
      )
      .get();

    const registeredRow = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM tools")
      .get();

    const patternsRow = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM successful_tool_patterns")
      .get();

    return {
      totalCalls: totalRow?.count ?? 0,
      uniqueTools: toolsRow?.count ?? 0,
      registeredTools: registeredRow?.count ?? 0,
      successfulPatterns: patternsRow?.count ?? 0,
    };
  }

  recordSuccessfulPattern(task: string, expectationsHash: string, toolsCalled: string[]): void {
    const toolsCalledStr = toolsCalled.join(",");
    const now = Date.now();

    // Try to increment existing pattern
    const existing = this.db
      .query<{ id: number; num_successes: number }, [string, string, string]>(
        "SELECT id, num_successes FROM successful_tool_patterns WHERE task = ? AND expectations_hash = ? AND tools_called = ?"
      )
      .get(task, expectationsHash, toolsCalledStr);

    if (existing) {
      this.db.run(
        "UPDATE successful_tool_patterns SET num_successes = ?, updated_at = ? WHERE id = ?",
        existing.num_successes + 1,
        now,
        existing.id
      );
    } else {
      this.db.run(
        `INSERT INTO successful_tool_patterns (task, expectations_hash, tools_called, num_successes, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
        task,
        expectationsHash,
        toolsCalledStr,
        now,
        now
      );
    }
  }

  getMostCommonSuccessfulPattern(task: string, expectationsHash: string): string[] | null {
    const row = this.db
      .query<{ tools_called: string; num_successes: number }, [string, string]>(
        `SELECT tools_called, num_successes FROM successful_tool_patterns 
         WHERE task = ? AND expectations_hash = ?
         ORDER BY num_successes DESC
         LIMIT 1`
      )
      .get(task, expectationsHash);

    if (row) {
      return row.tools_called.split(",");
    }

    return null;
  }

  close(): void {
    this.db.close();
  }
}
