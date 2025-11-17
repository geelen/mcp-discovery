/**
 * Responses API Adapter (Not Implemented)
 * 
 * This adapter will support the Groq Responses API format, which differs from
 * the standard OpenAI completions API.
 * 
 * TODO: Implement the following:
 * - Response type definitions matching the Responses API spec
 * - Request/response transformation functions
 * - Adapter factory function similar to createCompletionsAdapter
 * - Handle the different message format and tool call structure
 * - Map from our internal types to Responses API types
 */

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not yet implemented`);
    this.name = "NotImplementedError";
  }
}

export function createResponsesAdapter(): never {
  throw new NotImplementedError("Responses adapter");
}
