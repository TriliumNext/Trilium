# AI
> [!WARNING]
> This feature is currently marked as experimental. While it is functional, we do expect that the user interface might change or we might add or remove some features related to it.

## History

### Removal in v0.102.0

Starting with version v0.102.0, AI/LLM integration has been removed from the Trilium Notes core.

While a significant amount of effort went into developing this feature, maintaining and supporting it long-term proved to be unsustainable.

When upgrading to v0.102.0, your Chat notes will be preserved, but instead of the dedicated chat window they will be turned to a normal <a class="reference-link" href="Note%20Types/Code.md">Code</a> note, revealing the underlying JSON of the conversation.

### Reintroduction in v0.103.0

Given the recent advancements of the AI scene, we decided to give the LLM integration another try. v0.103.0 introduces a completely new chat system.

One of the key changes that lead to the reimplementation is that now we are using a library ([Vercel AI](https://github.com/vercel/ai)) to manage the inner mechanism and the differences between LLM providers instead of having to implement it on our own.

## Feature highlights

*   Chat-based interface with live streaming of the messages.
*   Provides the AI context with the note currently being looked at.
*   Tools to alter note content, create new notes, etc.
*   Statistics regarding context window use and pricing per message.
*   Optional MCP to allow external chat tools (e.g. Claude Code) to operate on notes within Trilium.

## LLM Providers

### Cloud providers

Currently, only three cloud providers are supported:

*   [Anthropic](https://platform.claude.com/settings/workspaces/default/keys)
*   OpenAI
*   Gemini

For all the providers, an API key is needed. Note that this is charged separately from the subscription you might already have (e.g. Claude Pro). If that might be a problem, consider using the MCP server and connecting it to your agent (e.g. Claude Code).

> [!NOTE]
> We don't plan to support all cloud providers, even if the library we are using would theoretically support them. Before opening a PR adding support for a different cloud provider, make sure to discuss it over GitHub discussions.

### Self-hosted providers

You might have noticed that there are no self-hosted solutions supported by the AI integration. The reasoning is that currently the self-hosted alternatives require additional integrations (for example a web search tool) or provide low-quality results (e.g. hallucinating tool calls) that would otherwise degrade the experience of the chat.

> [!NOTE]
> We do plan to support self-hosted AI solutions in future versions.

## Enabling the AI integration

Because it is an experimental feature, enabling the AI integration is a two-step process:

1.  Go to <a class="reference-link" href="Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Advanced_ and check _AI / LLM Chat_ in the _Experimental Options_ section.
2.  Go to <a class="reference-link" href="Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_ and configure a new provider.

## Creating a new chat

There are two different chat interfaces:

*   One in the sidebar.
*   A dedicated note type.

### The sidebar interface

Once the AI integration is activated, a _Chat_ entry will appear in the <a class="reference-link" href="Basic%20Concepts%20and%20Features/UI%20Elements/Right%20Sidebar.md">Right Sidebar</a>.

*   Unlike the dedicated note type, the side bar has optional access to the current note, making it easy to ask for information or modifications to a note without having to search for the note first.
    *   To toggle whether the current note is visible to the AI, simply click on the file icon at the bottom of the chat interface.
*   On the top-right of the sidebar there are three buttons:
    *   Create a new conversation.
    *   Go to a previous conversation
    *   Save the current conversation as a dedicated note in the <a class="reference-link" href="Advanced%20Usage/Advanced%20Showcases/Day%20Notes.md">Day Notes</a>, which turns it into a dedicated chat note.

> [!NOTE]
> The sidebar chats are stored in the <a class="reference-link" href="Advanced%20Usage/Hidden%20Notes.md">Hidden Notes</a> and can be seen in the _AI Chat History_ section.

### The dedicated note type

The dedicated chat note is similar to the sidebar interface, but it makes longer conversations more comfortable to read.

Unlike the sidebar, the AI will not be aware of the current note it's in.

## Web search

The AI can optionally search the web to find more information about a specific topic. 

This feature is on by default but it can easily be disabled by clicking on the model selector at the bottom of the chat and unchecking _Web search_.

## Tools

Tools allow the agentic AI to understand and operate on notes directly within your Trilium instance.

This feature is on by default but it can easily be disabled by clicking on the model selector at the bottom of the chat and unchecking _Note access_.

## Alternative solutions (MCP)

Given the recent advancements of the AI scene, MCP has grown to be more powerful and facilitates easier integrations with various application.

As such, there are third-party solutions that integrate an MCP server that can be used with Trilium:

*   [tan-yong-sheng/triliumnext-mcp](https://github.com/tan-yong-sheng/triliumnext-mcp)
*   [perfectra1n/triliumnext-mcp](https://github.com/perfectra1n/triliumnext-mcp)
*   [eliassoares/trilium-fastmcp](https://github.com/eliassoares/trilium-fastmcp)

> [!IMPORTANT]
> These solutions are third-party and thus not endorsed or supported directly by the Trilium Notes team. Please address questions and issues on their corresponding repository instead.