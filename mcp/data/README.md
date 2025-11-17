# MCP Test Data

This directory contains sample data files for testing MCP servers.

## Structure

- `ppt/` - PowerPoint presentations for the PPT MCP server
- `word/` - Word documents for the Word MCP server
- `html/` - HTML files for the Playwright MCP server

## Usage

The MCP servers are automatically configured to use this data directory through the `LIVEMCP_DATA` environment variable. When you run MCP servers, they will look for files in this directory.

Example file paths when using the servers:
- PowerPoint: `/Users/.../mcp-discovery/mcp/data/ppt/build_effective_agents.pptx`
- Word: `/Users/.../mcp-discovery/mcp/data/word/exchange.docx`

## Data Source

This test data comes from the [LiveMCPBench](https://github.com/livemcp/LiveMCPBench) project's annotated data set, which provides sample files for testing MCP server functionality.
