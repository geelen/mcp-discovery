import { Database } from "bun:sqlite";
import { createHash } from "crypto";

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

  getStats(): { totalCalls: number; uniqueTools: number } {
    const totalRow = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM tool_calls")
      .get();

    const toolsRow = this.db
      .query<{ count: number }, []>(
        "SELECT COUNT(DISTINCT tool_name) as count FROM tool_calls"
      )
      .get();

    return {
      totalCalls: totalRow?.count ?? 0,
      uniqueTools: toolsRow?.count ?? 0,
    };
  }

  close(): void {
    this.db.close();
  }
}
