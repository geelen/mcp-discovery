# MCP Test Data

This directory contains sample data files for testing MCP servers.

## Structure

- `ppt/` - PowerPoint presentations for the PPT MCP server
- `word/` - Word documents for the Word MCP server

## Usage

The MCP servers are automatically configured to run from the `mcp/` directory, so you can use relative paths to access the test data.

Example file paths when using the servers:
- PowerPoint: `data/ppt/build_effective_agents.pptx`
- Word: `data/word/exchange.docx`
- Absolute paths also work: `/full/path/to/mcp-discovery/mcp/data/ppt/build_effective_agents.pptx`

## Data Source

This test data comes from the [LiveMCPBench](https://github.com/livemcp/LiveMCPBench) project's annotated data set, which provides sample files for testing MCP server functionality.
