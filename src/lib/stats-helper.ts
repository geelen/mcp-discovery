import { readFile } from "fs/promises";

// ANSI Colors
export const colors = {
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

export const log = (color: keyof typeof colors, text: string) => `${colors[color]}${text}${colors.reset}`;

export interface PromptStats {
  text: string;
  totalRuns: number;
  failures: Map<string, number>;
}

export function analyzeFailure(entries: any[]): string {
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
  return failureType;
}

export function printPromptStats(key: string | number | undefined, stats: PromptStats) {
  // Calculate success
  const totalFailures = [...stats.failures.values()].reduce((a, b) => a + b, 0);
  const successCount = Math.max(0, stats.totalRuns - totalFailures);
  const successRate = stats.totalRuns > 0 ? Math.round((successCount / stats.totalRuns) * 100) : 0;

  const label = typeof key === 'number' 
    ? `Prompt ${key}:` 
    : (key ? `Prompt:` : "Prompt Stats:");
    
  console.log("\n" + log("cyan", label));
  
  const lines = stats.text.split('\n');
  console.log(log("bold", lines[0] + (lines.length > 1 ? "..." : "")));
  
  if (stats.totalRuns > 0) {
      const color: keyof typeof colors = successRate === 100 ? "green" : (successRate > 80 ? "yellow" : "red");
      console.log(log("gray", `Success Rate: `) + log(color, `${successRate}%`) + log("gray", ` (${successCount}/${stats.totalRuns})`));
  }
  
  console.log(log("gray", "-".repeat(40)));
  
  // Sort failures by count descending
  const sortedFailures = [...stats.failures.entries()].sort((a, b) => b[1] - a[1]);
  
  if (sortedFailures.length === 0) {
       if (stats.totalRuns > 0) {
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
