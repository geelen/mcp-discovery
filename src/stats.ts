#!/usr/bin/env bun
import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";

// ANSI Colors
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};

const log = (color: keyof typeof colors, text: string) => `${colors[color]}${text}${colors.reset}`;

interface PromptStats {
  text: string;
  totalRuns: number;
  failures: Map<string, number>;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("Usage: ./src/stats.ts <path-to-logs-dir>");
    process.exit(1);
  }

  const logDir = args[0];
  
  // stats map: key is either prompt index (if metadata exists) or prompt text
  const stats = new Map<string | number, PromptStats>();
  let useMetadata = false;

  // Try to read _metadata.json
  try {
      const metadataPath = join(logDir, "_metadata.json");
      const metadataContent = await readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(metadataContent);
      
      useMetadata = true;
      const totalRuns = metadata.config?.runs || 0;
      
      if (Array.isArray(metadata.prompts)) {
          for (const p of metadata.prompts) {
              stats.set(p.index, {
                  text: p.prompt,
                  totalRuns: totalRuns,
                  failures: new Map()
              });
          }
      }
      console.log(log("gray", `Loaded metadata: ${metadata.prompts.length} prompts, ${totalRuns} runs each.`));
  } catch (e) {
      // Metadata missing or invalid, ignore
  }
  
  let files: string[] = [];
  try {
      // Check if the directory itself contains json files or has a fail/ subdirectory
      const dirStats = await stat(logDir);
      if (!dirStats.isDirectory()) {
          console.error(`Error: ${logDir} is not a directory`);
          process.exit(1);
      }

      // Try fail/ subdirectory first as it seems to be the convention
      const failDir = join(logDir, "fail");
      let useFailDir = false;
      try {
          const failStats = await stat(failDir);
          if (failStats.isDirectory()) {
              useFailDir = true;
          }
      } catch {}

      const targetDir = useFailDir ? failDir : logDir;
      const entries = await readdir(targetDir);
      files = entries
        .filter(f => f.endsWith(".json"))
        .map(f => join(targetDir, f));
        
  } catch (e) {
      console.error(`Error reading directory ${logDir}:`, e);
      process.exit(1);
  }

  if (files.length === 0 && !useMetadata) {
      console.log("No log files found.");
      return;
  }

  let totalFiles = 0;

  for (const file of files) {
      try {
          const filename = basename(file);
          
          // content read is deferred until we know if we need it for prompt extraction
          const content = await readFile(file, "utf-8");
          const entries = JSON.parse(content);
          if (!Array.isArray(entries) || entries.length === 0) continue;

          totalFiles++;

          // Identify which prompt this is
          let key: string | number | undefined;
          
          if (useMetadata) {
              // Try to extract prompt index from filename: prompt-12-run-34...
              const match = filename.match(/prompt-(\d+)-run-/);
              if (match) {
                  const index = parseInt(match[1], 10);
                  if (stats.has(index)) {
                      key = index;
                  }
              }
          }
          
          if (key === undefined) {
              // Fallback to extracting from content
              // Extract Prompt
              const promptEntry = entries.find(e => e.type === "llm_request");
              let promptText = "Unknown Prompt";
              
              if (promptEntry && promptEntry.data?.messages) {
                  const userMessage = promptEntry.data.messages.find((m: any) => m.role === "user");
                  if (userMessage?.content) {
                      promptText = userMessage.content;
                  }
              }
              key = promptText;
          }

          // Initialize stats entry if needed (for non-metadata case)
          if (!stats.has(key)) {
              stats.set(key, {
                  text: typeof key === 'string' ? key : `Prompt ${key}`,
                  totalRuns: 0, // Unknown
                  failures: new Map()
              });
          }
          
          const promptStats = stats.get(key)!;

          // Analyze Failure
          // We look at the last entry for the result
          const lastEntry = entries[entries.length - 1];
          let failureType = "Unknown Failure";
          
          // Check for network/parsing errors in llm_response or final_result
          const errorEntry = entries.find(e => e.data?.error);
          if (errorEntry) {
             failureType = `Error: ${errorEntry.data.error.message || JSON.stringify(errorEntry.data.error)}`;
          } else if (lastEntry.type === "expectation_result") {
               if (lastEntry.answer) {
                   failureType = `Returned: ${lastEntry.answer.trim()}`;
               } else {
                   failureType = "Missing Answer Block";
               }
          } else if (lastEntry.type === "final_result") {
               if (lastEntry.data?.error) {
                   failureType = `Error: ${lastEntry.data.error.message}`;
               } else if (lastEntry.data?.choices?.[0]) {
                   const choice = lastEntry.data.choices[0];
                   if (choice.finish_reason === "length") {
                       failureType = "Max Tokens Reached";
                   } else {
                       // Check content for answer block
                       const content = choice.message?.content || "";
                       const match = content.match(/<answer>(.*?)<\/answer>/s);
                       if (match) {
                           const answer = match[1].trim();
                           failureType = answer ? `Returned: ${answer}` : "Returned: (empty)";
                       } else {
                           failureType = "Missing Answer Block";
                       }
                   }
               } else {
                   failureType = "Unknown Final Result";
               }
          } else {
               // Check if there's a tool error that caused a halt?
               failureType = `Ended with ${lastEntry.type}`;
          }

          promptStats.failures.set(failureType, (promptStats.failures.get(failureType) || 0) + 1);

      } catch (e) {
          // console.error(`Failed to parse ${file}:`, e);
      }
  }

  console.log(log("gray", `Analyzed ${totalFiles} log files.`));

  // Report
  // Sort by key (if indices, numeric sort; else, alphabetical?)
  const sortedKeys = [...stats.keys()].sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b));
  });

  for (const key of sortedKeys) {
      const { text, totalRuns, failures } = stats.get(key)!;
      
      // Calculate success
      const totalFailures = [...failures.values()].reduce((a, b) => a + b, 0);
      const successCount = Math.max(0, totalRuns - totalFailures);
      const successRate = totalRuns > 0 ? Math.round((successCount / totalRuns) * 100) : 0;

      console.log("\n" + log("cyan", "Prompt" + (typeof key === 'number' ? ` ${key}:` : ":")));
      const lines = text.split('\n');
      console.log(log("bold", lines[0] + (lines.length > 1 ? "..." : "")));
      
      if (totalRuns > 0) {
          const color: keyof typeof colors = successRate === 100 ? "green" : (successRate > 80 ? "yellow" : "red");
          console.log(log("gray", `Success Rate: `) + log(color, `${successRate}%`) + log("gray", ` (${successCount}/${totalRuns})`));
      }
      
      console.log(log("gray", "-".repeat(40)));
      
      // Sort failures by count descending
      const sortedFailures = [...failures.entries()].sort((a, b) => b[1] - a[1]);
      
      if (sortedFailures.length === 0) {
           if (totalRuns > 0) {
               console.log(log("green", "  No failures recorded."));
           } else {
               console.log(log("gray", "  No logs found."));
           }
      }
      
      for (const [failure, count] of sortedFailures) {
          const countStr = count.toString().padEnd(4);
          let color: keyof typeof colors = "magenta";
          
          if (failure.startsWith("Error")) color = "red";
          else if (failure.startsWith("Returned")) color = "yellow";
          else if (failure === "Missing Answer Block") color = "blue";
          
          const cleanFailure = failure.replace(/\n/g, "\\n").substring(0, 200) + (failure.length > 200 ? "..." : "");
          
          console.log(`${log(color, countStr)} ${cleanFailure}`);
      }
  }
}

main();
