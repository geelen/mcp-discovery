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

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("Usage: ./src/stats.ts <path-to-logs-dir>");
    process.exit(1);
  }

  const logDir = args[0];
  
  let files: string[] = [];
  try {
      // Check if the directory itself contains json files or has a fail/ subdirectory
      const stats = await stat(logDir);
      if (!stats.isDirectory()) {
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

  if (files.length === 0) {
      console.log("No log files found.");
      return;
  }

  // Group by Prompt
  // Map<PromptText, Map<FailureType, Count>>
  const stats = new Map<string, Map<string, number>>();
  
  let totalFiles = 0;

  for (const file of files) {
      try {
          const content = await readFile(file, "utf-8");
          const entries = JSON.parse(content);
          if (!Array.isArray(entries) || entries.length === 0) continue;

          totalFiles++;

          // Extract Prompt
          // Usually the first entry is llm_request with the prompt
          const promptEntry = entries.find(e => e.type === "llm_request");
          let promptText = "Unknown Prompt";
          
          if (promptEntry && promptEntry.data?.messages) {
              const userMessage = promptEntry.data.messages.find((m: any) => m.role === "user");
              if (userMessage?.content) {
                  promptText = userMessage.content;
              }
          }

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
               // But usually that would produce a final_result or errorEntry
               failureType = `Ended with ${lastEntry.type}`;
          }

          // Store stats
          if (!stats.has(promptText)) {
              stats.set(promptText, new Map());
          }
          const promptStats = stats.get(promptText)!;
          promptStats.set(failureType, (promptStats.get(failureType) || 0) + 1);

      } catch (e) {
          // console.error(`Failed to parse ${file}:`, e);
      }
  }

  console.log(log("gray", `Analyzed ${totalFiles} log files.`));

  // Report
  for (const [prompt, failures] of stats.entries()) {
      console.log("\n" + log("cyan", "Prompt:"));
      // Print first line of prompt or truncated
      const lines = prompt.split('\n');
      console.log(log("bold", lines[0] + (lines.length > 1 ? "..." : "")));
      
      console.log(log("gray", "-".repeat(40)));
      
      // Sort failures by count descending
      const sortedFailures = [...failures.entries()].sort((a, b) => b[1] - a[1]);
      
      for (const [failure, count] of sortedFailures) {
          const countStr = count.toString().padEnd(4);
          let color: keyof typeof colors = "magenta";
          
          if (failure.startsWith("Error")) color = "red";
          else if (failure.startsWith("Returned")) color = "yellow";
          else if (failure === "Missing Answer Block") color = "blue";
          
          // If the failure text is very long (e.g. long wrong answer), truncate it?
          // The user wants to see "B" or "C", usually short. But maybe it's long text.
          // We'll let it wrap for now.
          
          // Replace newlines in failure text to keep list clean
          const cleanFailure = failure.replace(/\n/g, "\\n").substring(0, 200) + (failure.length > 200 ? "..." : "");
          
          console.log(`${log(color, countStr)} ${cleanFailure}`);
      }
  }
}

main();
