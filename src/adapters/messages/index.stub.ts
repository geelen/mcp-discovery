/**
 * Messages API Adapter (Not Implemented)
 * 
 * This adapter will support the Anthropic Messages API format.
 * 
 * TODO: Implement the following:
 * - Message type definitions matching Anthropic's Messages API
 * - System message handling (separate from messages array)
 * - Tool use and tool result block handling
 * - Request/response transformation functions
 * - Adapter factory function for Anthropic provider
 * - Handle stop_reason mapping to finishReason
 * - Convert tool_use blocks to our tool_calls format
 * - Convert our tool results to tool_result blocks
 */

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not yet implemented`);
    this.name = "NotImplementedError";
  }
}

export function createMessagesAdapter(): never {
  throw new NotImplementedError("Messages adapter");
}
