export interface TestPrompt {
  prompt: string;
  servers: string[];
  expectation: (answer: string) => boolean;
}

export const prompts: TestPrompt[] = [
  {
    prompt: "In data/ppt/build_effective_agents.pptx, what is the index and the title of the first slide that has a non-empty title? Return the answers separated by commas between <answer></answer> tags.",
    servers: ["ppt"],
    expectation: (answer) => answer.includes("1") && answer.includes("What are Agents?")
  },
  {
    prompt: "How many slides total are in data/ppt/build_effective_agents.pptx? Return only the number between <answer></answer> tags.",
    servers: ["ppt"],
    expectation: (answer) => answer.includes("10")
  },
  {
    prompt: "In data/ppt/build_effective_agents.pptx, what is the exact title of slide 4? Return it between <answer></answer> tags.",
    servers: ["ppt"],
    expectation: (answer) => answer.includes("Common Frameworks for Agents")
  },
  {
    prompt: "Navigate to example.com using Playwright and return only the exact text of the main h1 heading between <answer></answer> tags.",
    servers: ["playwright"],
    expectation: (answer) => answer.includes("Example Domain")
  },
  {
    prompt: "Use Playwright to navigate to news.ycombinator.com and return the title of the first story on the front page between <answer></answer> tags.",
    servers: ["playwright"],
    expectation: (answer) => answer.length >= 10 && !answer.toLowerCase().includes("error") && !answer.toLowerCase().includes("failed")
  },
  // {
  //   prompt: "Use the trends server to find the current top trending topic on Hacker News. Return only the rank number and title of the #1 topic between <answer></answer> tags.",
  //   servers: ["trends"],
  //   expectation: (answer) => answer.includes("#1") && answer.length >= 10 && !answer.includes("#2")
  // },
  // {
  //   prompt: "Use the trends server to get today's top technology trends and return how many trending topics are available between <answer></answer> tags.",
  //   servers: ["trends"],
  //   expectation: (answer) => /\d+/.test(answer)
  // },
  // {
  //   prompt: "Use the trends server to find what the #1 trending topic is on Hacker News right now. Then use Playwright to navigate to news.ycombinator.com and verify if that topic appears on the front page. Return yes or no between <answer></answer> tags.",
  //   servers: ["playwright", "trends"],
  //   expectation: (answer) => /\b(yes|no)\b/i.test(answer)
  // },
  {
    prompt: "Read data/ppt/build_effective_agents.pptx and count how many slides there are. Then use Playwright to navigate to example.com and count how many paragraphs are in the body. Return both numbers as 'slides: X, paragraphs: Y' between <answer></answer> tags.",
    servers: ["ppt", "playwright"],
    expectation: (answer) => answer.toLowerCase().includes("slides:") && answer.toLowerCase().includes("paragraphs:") && answer.includes("10")
  },
  {
    prompt: "In data/ppt/build_effective_agents.pptx, find the slide that mentions 'reflection' or 'planning'. Return the slide number and title between <answer></answer> tags.",
    servers: ["ppt"],
    expectation: (answer) => /\d+/.test(answer) && answer.length >= 5
  },
  {
    prompt: "Use Playwright to navigate to httpbin.org/html and extract the main heading (h1) text. Return it between <answer></answer> tags.",
    servers: ["playwright"],
    expectation: (answer) => answer.includes("Herman") && answer.includes("Melville")
  },
  {
    prompt: "Read data/ppt/build_effective_agents.pptx and list all unique slide titles. Count how many unique titles there are and return only that count between <answer></answer> tags.",
    servers: ["ppt"],
    expectation: (answer) => /\d+/.test(answer) && (!answer.includes("0") || !!answer.match(/[1-9]/))
  },
  {
    prompt: "Use Playwright to go to example.org (note: .org not .com) and read the first paragraph. Return it between <answer></answer> tags.",
    servers: ["playwright"],
    expectation: (answer) => answer.length >= 50 && answer.toLowerCase().includes("This domain is for use in documentation examples without needing permission. Avoid use in operations".toLowerCase())
  },
  // {
  //   prompt: "Use trends to find the top 5 trending topics across all platforms, then tell me how many of them are related to technology or AI (return just the number between <answer></answer> tags).",
  //   servers: ["trends"],
  //   expectation: (answer) => /[0-5]/.test(answer)
  // },
  {
    prompt: "In data/ppt/build_effective_agents.pptx, what is the content of the last slide? Return it between <answer></answer> tags.",
    servers: ["ppt"],
    expectation: (answer) => answer.toLowerCase().includes("thank you. questions?")
  }
];
