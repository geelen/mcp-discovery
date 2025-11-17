# MCP Test Data

This directory contains sample data files for testing MCP servers.

## Structure

- `ppt/` - PowerPoint presentations for the PPT MCP server
- `word/` - Word documents for the Word MCP server

## Usage

MCP servers run with their working directory set to the `mcp/` directory, so you can use relative paths to access test data.

Example file paths:
- PowerPoint: `data/ppt/build_effective_agents.pptx`
- Word: `data/word/exchange.docx`

Absolute paths also work if needed.

## Data Source

This test data comes from the [LiveMCPBench](https://github.com/livemcp/LiveMCPBench) project's annotated data set.
