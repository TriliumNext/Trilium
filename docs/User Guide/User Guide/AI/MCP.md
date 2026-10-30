# MCP
[Model Context Protocol](https://en.wikipedia.org/wiki/Model_Context_Protocol) allows external chat applications such as Claude Code to have access to the Trilium database.

## Built-in MCP

v0.103.0 comes with a built-in MCP server that is not active by default. To activate it, go to <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → AI/LLM and toggle the _MCP server_ option.

Once the MCP is active, simply add the MCP server to your AI assistant. The URL to use is displayed in the _Endpoint_ _URL_ information underneath the MCP toggle.

Only the HTTP transport is supported, the `stdio` method is not supported. If that is a blocker, consider using a third-party alternative listed below.

The tools exposed to the MCP are the same tools that are supported by the internal chat (see the _Note access_ section). Notes with the `#excludeFromLlm` label are hidden from both, see <a class="reference-link" href="Privacy.md">Privacy</a>.

### Read-only mode

When the _Read-only mode_ option is enabled in <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI/LLM_, the MCP server only exposes read-only tools. Write operations that go through MCP are disabled, which is useful when an assistant should only read notes.

> [!WARNING]
> This option limits only the tools the MCP server exposes; it does not limit the <a class="reference-link" href="../Advanced%20Usage/ETAPI%20(REST%20API).md">ETAPI (REST API)</a> token used to authenticate. That token still grants read and write access to the REST API, including endpoints such as `POST /etapi/create-note`. Anyone who has it can bypass read-only mode with a direct REST request, so treat it as a credential that can change your notes regardless of this option.

### Approving tool calls

Trilium does not ask for approval of the calls an external assistant makes; that is left to the assistant's own permission settings. To help it decide, each tool tells the assistant whether it only reads your notes, only adds to them (creating a note, cloning it or appending to it), or can overwrite or remove something (editing, renaming, moving or deleting). An assistant that supports these hints can then run reads on their own and ask before changes, the way _Ask before changes_ does in Trilium's chat.

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