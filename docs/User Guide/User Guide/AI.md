# AI
Trilium can connect to a large language model and use it as an assistant that works directly on your notes: ask questions about the note you're reading, have it draft or restructure content, or get it to write scripts and widgets for you.

The integration is off by default and does nothing until you enable it and configure a provider; Trilium ships no model of its own. The provider you pick decides how your notes travel: a cloud API billed per use, a subscription you already pay for, or a model running on your own hardware, in which case nothing leaves the machine. See <a class="reference-link" href="AI/Providers.md">Providers</a> for what each involves, and <a class="reference-link" href="AI/Privacy.md">Privacy</a> for exactly what gets sent.

Once enabled, the assistant is available as:

*   As a dedicated note type, it can read and modify notes through tools, which you can switch off per conversation if you would rather it only saw what you type.
*   A panel in the right sidebar, which acts similarly to the dedicated note type but it also has optional access to the current note.
*   An <a class="reference-link" href="Note%20Types/Text/In-editor%20AI%20assistant.md">In-editor AI assistant</a> which comes with builtin actions that operate over selected text (such as proof-reading, summarizing), as well as <a class="reference-link" href="Note%20Types/Text/In-editor%20AI%20assistant/Custom%20AI%20quick%20actions.md">Custom AI quick actions</a>.

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

Trilium supports four different types of providers:

=== "<span class="tn-icon bx bx-cloud"></span> Cloud"

    Pay-per use with an API key which is billed separately from any subscription you might already have.

    *   <span class="tn-icon tn-brand tn-brand-anthropic"></span> Anthropic Claude
    *   <span class="tn-icon tn-brand tn-brand-openai"></span> OpenAI GPT
    *   <span class="tn-icon tn-brand tn-brand-gemini"></span> Google Gemini
    *   <span class="tn-icon tn-brand tn-brand-deepseek"></span> DeepSeek
    *   <span class="tn-icon tn-brand tn-brand-openrouter"></span> OpenRouter, which reaches the models of most labs with one key

=== "<span class="tn-icon bx bx-coin"></span> Subscription-based"

    Reuses an existing subscription instead of paying per use.

    *   <span class="tn-icon tn-brand tn-brand-claude"></span> [Claude Code](AI/Providers/Subscription-based%20providers.md)
    *   <span class="tn-icon tn-brand tn-brand-github-copilot"></span> [GitHub Copilot](AI/Providers/Subscription-based%20providers.md)
    *   <span class="tn-icon tn-brand tn-brand-antigravity"></span> [Google Antigravity](AI/Providers/Subscription-based%20providers.md)
    *   <span class="tn-icon tn-brand tn-brand-codex"></span> [OpenAI Codex](AI/Providers/Subscription-based%20providers.md)

=== "<span class="tn-icon bx bx-network-chart"></span> Local/self-hosted"

    *   <span class="tn-icon tn-brand tn-brand-ollama"></span> Ollama
    *   <span class="tn-icon tn-brand tn-brand-lmstudio"></span> LM Studio

=== "<span class="tn-icon bx bx-code-curly"></span> Custom endpoints"

    For other providers that are not directly supported by Trilium, either local or hosted (e.g. Groq, Mistral, Together).

> [!TIP]
> For more information about each provider, see <a class="reference-link" href="AI/Providers.md">Providers</a>. See the dedicated <a class="reference-link" href="AI/Privacy.md">Privacy</a> to better understand what data is sent to providers.

## Enabling the AI integration

To enable the AI integration, simply go to <a class="reference-link" href="Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_ and press the toggle in the top-right of the dialog and configure a provider.

## Creating a new chat

There are two different chat interfaces:

*   One in the sidebar.
*   A dedicated note type.

### The sidebar interface

### The dedicated note type

The dedicated chat note is similar to the sidebar interface, but it makes longer conversations more comfortable to read.

Unlike the sidebar, the AI will not be aware of the current note it's in.

### Templates

Chat notes can be set as <a class="reference-link" href="Advanced%20Usage/Templates.md">Templates</a> to make them easily reusable. The entire conversation history is kept, allowing a basic form of specialization for the LLM with the existing chat acting like a system prompt. 

### Model selection

When a provider is configured in <a class="reference-link" href="Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a>, the next step is to select the models that will be available for the chat.

The models are retrieved dynamically from the provider, only when the model selection list is visible. To alter the list of models, simply press the Edit button in the model selection box.

Pricing information is displayed for known models. The pricing information (price per million tokens) is embedded in the application (using a subset of LiteLLM's data) and is updated with new versions of Trilium. Local providers are considered free, whereas custom endpoint providers don't offer any pricing information.

## Features

### Web search

The AI can optionally search the web to find more information about a specific topic. 

Where the search comes from is chosen in the _Web search_ submenu of the <span class="tn-icon bx bx-shield-quarter"></span>_Tools_ menu next to the model selector at the bottom of the chat, whose row shows the source in use:

*   _Disabled_ turns web search off for this chat.
*   _Use the model's built-in search_, the default, lets the model search with its provider's own search. Anthropic, OpenAI, Google Gemini and DeepSeek models have one, as do Claude Code, Google Antigravity and OpenAI Codex. OpenRouter, Ollama, LM Studio and custom endpoints don't, so this choice is disabled for their models. DeepSeek's search is billed per search on your DeepSeek account and works only with DeepSeek's own endpoint, not with a custom base URL.
*   A search provider (Brave Search, Tavily, Exa, Serper, Perplexity or SearXNG) searches through that service instead, whichever model is answering. Search providers are added in the _Search Providers_ section of the AI settings, which _Manage search providers_ at the bottom of the submenu opens. The browser version can't use Brave Search, Exa or Perplexity, whose services refuse requests made from a web page, so they're shown disabled there.

To use SearXNG, enable its JSON output by adding `json` to the search formats in the instance's `settings.yml`. SearXNG turns JSON off by default, and without it every search fails.

```yaml
search:
  formats:
    - html
    - json
```

SearXNG doesn't use API keys, so leave the API key empty. Fill it in only if your instance sits behind a proxy that requires a token; Trilium sends it as a bearer token in the `Authorization` header.

Whether web search is on is kept per chat; the search source is shared by all chats. A choice the current model can't use stays in the menu, disabled; hover the <span class="tn-icon bx bx-info-circle"></span>icon next to it to see why. Claude Code, GitHub Copilot, Google Antigravity and OpenAI Codex run their own tools, so they can't use a search provider.

In the chat, a search run through a search provider shows that provider's logo at the start of its line instead of the <span class="tn-icon bx bx-search"></span>magnifier; hover the logo to see the provider's name.

With a search provider, the model can also read the pages it finds, or a link you give it, as text: Trilium fetches the page itself and hands the model up to its first 20,000 characters. Addresses on your own machine or network are refused. In the browser version most sites don't allow being read this way, so reading a page there usually fails.

### Thinking

Some models reason before they answer. While the model is thinking, its reasoning is shown in full under a spinner; once it is done, it folds into a collapsible _Thought process_ line above the reply.

How much a model thinks is set per chat, in one of two ways depending on the model:

*   Most models have an <span class="tn-icon bx bx-brain"></span>_Extended thinking_ button, next to the <span class="tn-icon bx bx-shield-quarter"></span>_Tools_ button.
*   Models that offer several levels of reasoning (DeepSeek V4, OpenRouter models that reason, OpenAI Codex, Antigravity) have a <span class="tn-icon bx bx-brain"></span>reasoning effort dropdown next to the model selector instead. _None_, where offered, turns thinking off; higher levels give better answers to hard questions, but take longer and cost more.

> [!NOTE]
> The effort dropdown only appears once Trilium knows the model's levels. For a DeepSeek provider set up with an earlier version of Trilium, edit the provider in the model selection box and press _Save_ once.

### Note access (tools)

Tools allow the agentic AI to understand and operate on notes directly within your Trilium instance.

This feature is on by default. To turn it off, press the <span class="tn-icon bx bx-shield-quarter"></span>_Tools_ button next to the model selector at the bottom of the chat and switch off _Note access_. The _Tools_ button is highlighted while note access or web search is on.

Here are a few tools that Trilium provides for the LLM:

*   At note level:
    *   Search for notes
    *   Get the metadata or content of a note.
    *   Edit a note
        *   There are multiple mechanism for the LLM to edit a note: completely by re-writing it, find/replace of a text sequence or append.
        *   When re-writing a note, the LLM can also change its type (for example from a text note to a code note) or the language of a code note, rewriting the content to match.
        *   Whenever the AI makes a change, a [revision](Basic%20Concepts%20and%20Features/Notes/Note%20Revisions.md) is saved to be able to revert any unwanted changes.
    *   Create a new note
        *   Asked for a drawing, the LLM can create an SVG image note, or turn an existing note into one. It can write only SVG images, not other formats such as PNG.
    *   Rename or delete a note.
*   At attribute level:
    *   Get the full list of attributes, or a specific attribute.
    *   Set the value of an attribute, or add another value next to the existing ones (such as a second `#tag`). When setting a value replaces an existing one, the AI is told which value it replaced.
        *   An attribute that runs code, such as `#run`, `#widget` or `~renderNote`, is saved with a `disabled:` prefix (for example `#disabled:widget`), the same way a safe import disables it (see <a class="reference-link" href="Basic%20Concepts%20and%20Features/Active%20content.md">Active content</a>). If the note already had that attribute enabled and the AI sets rather than adds the value, the AI removes the enabled one, so none of it runs until you enable the new value. The AI tells you which note it is on; review the code, then enable it with the toggle next to the active content badge beside the note's title or, for a <a class="reference-link" href="Note%20Types/Render%20Note.md">Render Note</a>, the _Enable render note_ button in the note.
    *   Delete an attribute.
*   At tree level:
    *   Get the direct children of a note.
    *   Get the entire subtree of a note.
    *   Move or clone a note somewhere else.
*   For <a class="reference-link" href="Basic%20Concepts%20and%20Features/Notes/Attachments.md">Attachments</a>:
    *   Get metadata for an attachment.
    *   Get the content of an attachment.
*   Skills (see the dedicated section).

Each tool the AI uses appears in the chat as a single line naming the tool and the note or query it worked on; a renamed note shows its previous title struck through, a deleted note its title struck through, a moved note where it was moved from and to, an attribute the AI read, set, added or deleted as a pill (struck through once deleted), an attachment by its title, note and size, and a web page the AI read as a link. A line folds open only when there is something to read inline: the notes a search found, the pages a web search found, the icons an icon search found, the type, attributes or start of the content of a note the AI read, all the attributes of a note, the text of an attachment or of a web page, the User Guide pages the AI looked up or its table of contents (both open in the help panel), the children or the whole subtree of a note, what the AI wrote into a note it created, rewrote or added to, the changes of an edit, or the reason a tool failed. A search names on its line the part of the tree it is confined to, if any, and also shows how many notes it found and how many of the matches the AI asked for; each note it lists opens with a click. To see exactly what the AI sent to a tool and what it got back, hover the line and press the <span class="tn-icon bx bx-code-alt"></span>button next to it; on touch screens the button is always shown.

When the reply stops moving for a couple of seconds while the AI is still at work, for example while it reads what a tool returned, a _Still working…_ line appears under it until the next part of the reply arrives.

#### Approving tool calls

Before the AI runs a tool, the chat asks whether to allow it. The tool's line is marked with a <span class="tn-icon bx bxs-hand"></span>icon and has _Allow_ and _Deny_ buttons below it. When the call would write to a note, the line opens on the text it would write or the changes of an edit. The reply waits until you answer.

*   To let the call run, press _Allow_.
*   To stop asking about a tool for the rest of the chat, open the menu next to _Allow_ and choose to always allow that tool for this chat. The call runs, and so do the other calls of that tool still waiting and every later one in this chat. Other tools keep asking, and a new chat asks again.
*   To refuse it, press _Deny_. The AI is told that you declined, and its reply carries on without the call, which is marked _denied_.
*   Stopping the reply denies every call that is still waiting.

To make a chat ask about a tool again, open the <span class="tn-icon bx bx-shield-quarter"></span>_Tools_ menu at the bottom of the chat and, under _Allowed in this chat_, press the tool. The submenu is shown once the chat has allowed a tool.

Which calls ask depends on the chat's permission mode, chosen in the <span class="tn-icon bx bx-shield-quarter"></span>_Tools_ menu under _Permissions_:

*   _Always ask_: every call asks, including the ones that only read (searching notes, or reading a note or an attachment).
*   _Ask before changes_: the calls that only read run on their own, and the ones that change your notes (creating, editing, renaming, moving or deleting a note, and setting, adding or deleting an attribute) ask.
*   _Don't ask_: every call runs without asking, changes included.

A new chat starts in the mode you picked last, in any chat, or in _Ask before changes_ until you pick one. Picking _Don't ask_ therefore carries over to the next chat too.

A tool allowed for the chat runs without asking in every mode. So does looking something up in what ships with Trilium (its User Guide, the skill sheets that teach the AI Trilium's search syntax and note types, and the icons), since it reads none of your notes. Searching the web and reading a web page never ask either: turning on web search in the _Tools_ menu is what allows them, whether the model searches on its own or through a search provider.

> [!NOTE]
> The <a class="reference-link" href="AI/Providers/Subscription-based%20providers.md">Subscription-based providers</a> (Claude Code, GitHub Copilot, Google Antigravity and OpenAI Codex) ask like any other provider.

> [!NOTE]
> Most changes you allow can be undone: a deleted note can be restored, and an edit reverted from its revision. Setting an attribute is harder to undo, since attributes have no history.

> [!NOTE]
> Gemini can't use its built-in search while note access is on. While it is, the built-in search choice in the _Tools_ menu is disabled and says why; a search provider works with note access on.

### Attachments

Since Trilium v0.140.0, <a class="reference-link" href="Basic%20Concepts%20and%20Features/Notes/Attachments.md">Attachments</a> allow for multi-modal chat:

*   Raster image (sent as vision input, except for SVGs) with the following supported formats: PNG, JPEG, GIF, WebP.
*   PDFs, sent natively to the provider (supported by Anthropic, OpenAI and Google).
*   SVG images (sent as raw HTML).
*   Text files.

Not every model reads every kind of attachment: DeepSeek reads no PDFs, and images only with its vision models; OpenAI Codex, GitHub Copilot and Google Antigravity read images but no PDFs. For such a model:

*   The attach button offers only the kinds the model reads, and a pasted or dropped file it can't read is not attached.
*   After switching to such a model, an attachment it can't read is marked with a <span class="tn-icon bx bx-error"></span>warning, and the message can't be sent until the attachment is removed or another model is selected.
*   An attachment sent in an earlier message reaches the model as its name only, such as `[attached file: report.pdf]`, so it can tell you it doesn't see the content.

To upload an attachment:

*   Press the dedicated _Attach_ button (paperclip icon) underneath the text box.
*   Paste an image directly from clipboard using Ctrl+V.

Once one or more attachments are uploaded, they will appear directly above the text box:

*   Images have a small thumbnail for easy identifications.
*   Every attachment can be deleted by pressing their corresponding X button.

Clicking an image or a PDF, either its chip above the text box or where it appears in a sent message, opens it in a viewer: an image can be zoomed and panned there, a PDF read page by page. The button next to the viewer's close button opens the original file in a new browser tab. <kbd>Ctrl</kbd>\-clicking instead opens an image in a new browser tab, and a PDF as an attachment in a new Trilium tab.

When an attachment is present, the LLM is instructed to consider the attachment with priority, even if it has access to the current note.

> [!NOTE]
> Currently Trilium doesn't pre-process the attachments (e.g. via <a class="reference-link" href="Advanced%20Usage/Text%20Extraction%20(OCR).md">Text Extraction (OCR)</a>) before sending them to the LLM provider.

### Mentions

Mentions are a way to insert references to notes other than the current note, using the same mechanism as <a class="reference-link" href="Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a>. To refer to another note, simply type @ followed by the name of the note to reference.

This feature is mostly helpful when note tools are enabled, otherwise the LLM will have no way to access the given note.

### Skills

Skills in Trilium are specialized instruction sets that help the AI be more productive by understanding how Trilium.

These skills are not loaded by default to avoid an increased consumption of tokens, but the AI can load them on-demand if _Note tools_ are enabled.

The following skills are built-in:

*   Search syntax: understands the full syntax of <a class="reference-link" href="Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a>.
*   Backend scripting: to be able to write proper <a class="reference-link" href="Scripting/Backend%20scripts.md">Backend scripts</a>.
*   Frontend scripting: to be able to write proper [front-end scripts](Scripting/Frontend%20Basics.md) (basic scripts, widgets, <a class="reference-link" href="Note%20Types/Render%20Note.md">Render Note</a>).
*   Dashboards: to build a <a class="reference-link" href="Collections/Dashboard.md">Dashboard</a> and its widgets, including interactive ones made with a <a class="reference-link" href="Note%20Types/Render%20Note.md">Render Note</a>.

When _Note tools_ are enabled the skills will automatically be made available to the AI, so no user interaction is required.

> [!NOTE]
> Custom skills are currently not supported but they are planned.

### MCP

Trilium comes with a built-in MCP server which allows you to use an external agent such as Claude Code have access to your database. See the dedicated <a class="reference-link" href="AI/MCP.md">MCP</a> page for more details.

## History

### Removal in v0.102.0

Starting with version v0.102.0, AI/LLM integration has been removed from the Trilium Notes core.

While a significant amount of effort went into developing this feature, maintaining and supporting it long-term proved to be unsustainable.

When upgrading to v0.102.0, your Chat notes will be preserved, but instead of the dedicated chat window they will be turned to a normal <a class="reference-link" href="Note%20Types/Code.md">Code</a> note, revealing the underlying JSON of the conversation.

### Reintroduction in v0.103.0

Given the recent advancements of the AI scene, we decided to give the LLM integration another try. v0.103.0 introduces a completely new chat system.

One of the key changes that lead to the reimplementation is that now we are using a library ([Vercel AI](https://github.com/vercel/ai)) to manage the inner mechanism and the differences between LLM providers instead of having to implement it on our own.