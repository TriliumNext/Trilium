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
*   Attachments for multi-modal chat (images, text files, PDFs).
*   Optional MCP to allow external chat tools (e.g. Claude Code) to operate on notes within Trilium.

## Sample use-cases

*   Create any type of <a class="reference-link" href="Scripting/Frontend%20Basics/Custom%20Widgets.md">Custom Widgets</a>.
*   Easily create a <a class="reference-link" href="Note%20Types/Render%20Note.md">Render Note</a>, e.g. _Create for me a render note which allows me to play tic-tac-toe. Make sure to use Preact instead of the legacy jQuery._
*   Create widgets for a <a class="reference-link" href="Collections/Dashboard.md">Dashboard</a>, such as a calculator, a stopwatch, a pomodoro timer.

> [!NOTE]
> Claude Sonnet is known to produce very good frontend or backend scripts with little guidance, as the AI has been instructed in how to produce them.

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

Since v0.104.0, self-hosted LLM providers are supported indirectly. Simply create an Anthropic, ChatGPT, or Gemini provider and select the appropriate base URL.

Model selection for self-hosted providers is not yet supported, but generally the default or the loaded one is used instead.

> [!WARNING]
> When dealing with self-hosted LLM models, depending on the training and the size of the model, the quality of the output may vary. Before [reporting issues](Troubleshooting/Reporting%20issues.md) regarding the quality of the output (e.g. hallucinating tool calls), consider benchmarking the response against a cloud provider (Claude Sonnet is recommended).

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

### Templates

Chat notes can be set as <a class="reference-link" href="Advanced%20Usage/Templates.md">Templates</a> to make them easily reusable. The entire conversation history is kept, allowing a basic form of specialization for the LLM with the existing chat acting like a system prompt. 

## Features

### Web search

The AI can optionally search the web to find more information about a specific topic. 

This feature is on by default but it can easily be disabled by clicking on the model selector at the bottom of the chat and unchecking _Web search_.

> [!NOTE]
> Currently only the search native to the LLM provider is supported. External search providers such as Exa, Tavily & SearXNG are not yet supported.

### Note access (tools)

Tools allow the agentic AI to understand and operate on notes directly within your Trilium instance.

This feature is on by default but it can easily be disabled by clicking on the model selector at the bottom of the chat and unchecking _Note access_.

Here are a few tools that Trilium provides for the LLM:

*   At note level:
    *   Search for notes
    *   Get the metadata or content of a note.
    *   Edit a note
        *   There are multiple mechanism for the LLM to edit a note: completely by re-writing it, find/replace of a text sequence or append.
        *   Whenever the AI makes a change, a [revision](Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md) is saved to be able to revert any unwanted changes.
    *   Create a new note
    *   Rename or delete a note.
*   At attribute level:
    *   Get the full list of attributes, or a specific attribute.
    *   Set the value of an attribute.
    *   Delete an attribute.
*   At tree level:
    *   Get the direct children of a note.
    *   Get the entire subtree of a note.
    *   Move or clone a note somewhere else.
*   For <a class="reference-link" href="Basic%20Concepts%20and%20Features/Notes/Attachments.md">Attachments</a>:
    *   Get metadata for an attachment.
    *   Get the content of an attachment.
*   Skills (see the dedicated section).

> [!WARNING]
> Currently there is **no permission management** implemented for note tools, meaning that the LLM could potentially remove existing notes or clutter the tree with notes. Generally most actions are easily reversible (deleting the notes, restoring deleted notes, reverting modifications to a note), but there are some that are harder to revert (e.g. setting an attribute because there is no attribute history).

> [!NOTE]
> Gemini has a special case in which _Note access_ and _Web search_ can't be both enabled at the same time.

### Attachments

Since Trilium v0.140.0, <a class="reference-link" href="Basic%20Concepts%20and%20Features/Notes/Attachments.md">Attachments</a> allow for multi-modal chat:

*   Raster image (sent as vision input, except for SVGs) with the following supported formats: PNG, JPEG, GIF, WebP.
*   PDFs, sent natively to the provider (supported by Anthropic, OpenAI and Google).
*   SVG images (sent as raw HTML).
*   Text files.

To upload an attachment:

*   Press the dedicated _Attach_ button (paperclip icon) underneath the text box.
*   Paste an image directly from clipboard using <kbd>Ctrl</kbd>+<kbd>V</kbd>.

Once one or more attachments are uploaded, they will appear directly above the text box:

*   Images have a small thumbnail for easy identifications.
*   Every attachment can be deleted by pressing their corresponding X button.

When an attachment is present, the LLM is instructed to consider the attachment with priority, even if it has access to the current note.

> [!NOTE]
> Currently Trilium doesn't pre-process the attachments (e.g. via <a class="reference-link" href="Advanced%20Usage/Text%20Extraction%20(OCR).md">Text Extraction (OCR)</a>) before sending them to the LLM provider.

### Mentions

Mentions are a way to insert references to notes other than the current note, using the same mechanism as <a class="reference-link" href="Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a>. To refer to another note, simply type <kbd>@</kbd> followed by the name of the note to reference.

This feature is mostly helpful when note tools are enabled, otherwise the LLM will have no way to access the given note.

### Skills

Skills in Trilium are specialized instruction sets that help the AI be more productive by understanding how Trilium.

These skills are not loaded by default to avoid an increased consumption of tokens, but the AI can load them on-demand if _Note tools_ are enabled.

The following skills are built-in:

*   Search syntax: understands the full syntax of <a class="reference-link" href="Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a>.
*   Backend scripting: to be able to write proper <a class="reference-link" href="Scripting/Backend%20scripts.md">Backend scripts</a>.
*   Frontend scripting: to be able to write proper [front-end scripts](Scripting/Frontend%20Basics.md) (basic scripts, widgets, <a class="reference-link" href="Note%20Types/Render%20Note.md">Render Note</a>).

When _Note tools_ are enabled the skills will automatically be made available to the AI, so no user interaction is required.

> [!NOTE]
> Custom skills are currently not supported but they are planned.

### MCP

[Model Context Protocol](https://en.wikipedia.org/wiki/Model_Context_Protocol) allows external chat applications such as Claude Code to have access to the Trilium database.

#### Built-in MCP

v0.103.0 comes with a built-in MCP server that is not active by default. To activate it, go to <a class="reference-link" href="Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → AI/LLM and toggle the _MCP server_ option.

Once the MCP is active, simply add the MCP server to your AI assistant. The URL to use is displayed in the _Endpoint_ _URL_ information underneath the MCP toggle.

Important aspects to consider:

*   Only the HTTP transport is supported, the `stdio` method is not supported. If that is a blocker, consider using a third-party alternative listed below.
*   The MCP does not have any authentication.
*   The MCP is currently exposed only on `localhost` to avoid potential security issues, especially given that there is no authentication present.

The tools exposed to the MCP are the same tools that are supported by the internal chat (see the _Note access_ section).

#### Third-party alternatives

The following are alternatives to Trilium's built-in MCP feature. Since Trilium's AI implementation is still experimental, its tooling might not be as mature as external tools.

*   [perfectra1n/triliumnext-mcp](https://github.com/perfectra1n/triliumnext-mcp)
*   [tan-yong-sheng/triliumnext-mcp](https://github.com/tan-yong-sheng/triliumnext-mcp)
*   [eliassoares/trilium-fastmcp](https://github.com/eliassoares/trilium-fastmcp)

> [!IMPORTANT]
> These solutions are third-party and thus not endorsed or supported directly by the Trilium Notes team. Please address questions and issues on their corresponding repository instead.