# MCP
[Model Context Protocol](https://en.wikipedia.org/wiki/Model_Context_Protocol) allows external chat applications such as Claude Code to have access to the Trilium database.

## Built-in MCP

v0.103.0 comes with a built-in MCP server that is not active by default. To activate it, go to <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → AI/LLM and toggle the _MCP server_ option.

Once the MCP is active, simply add the MCP server to your AI assistant. The URL to use is displayed in the _Endpoint_ _URL_ information underneath the MCP toggle.

Only the HTTP transport is supported, the `stdio` method is not supported. If that is a blocker, consider using a third-party alternative listed below.

The tools exposed to the MCP are the same tools that are supported by the internal chat (see the _Note access_ section).

### Authentication

To protect your notes from unauthorized access, the MCP server requires authentication. Generally MCP servers need to support OAuth for authentication, but Trilium uses a simpler mechanism using Bearer tokens.

To configure authentication, first create an <a class="reference-link" href="../Advanced%20Usage/ETAPI%20(REST%20API).md">ETAPI (REST API)</a> token by going to <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _ETAPI_. Then follow the instructions in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_, by looking at the _How to connect an assistant_ section under MCP.

## Third-party alternatives

The following are alternatives to Trilium's built-in MCP feature. Since Trilium's AI implementation is still experimental, its tooling might not be as mature as external tools.

*   [perfectra1n/triliumnext-mcp](https://github.com/perfectra1n/triliumnext-mcp)
*   [tan-yong-sheng/triliumnext-mcp](https://github.com/tan-yong-sheng/triliumnext-mcp)
*   [eliassoares/trilium-fastmcp](https://github.com/eliassoares/trilium-fastmcp)

> [!IMPORTANT]
> These solutions are third-party and thus not endorsed or supported directly by the Trilium Notes team. Please address questions and issues on their corresponding repository instead.