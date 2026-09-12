# Privacy
Trilium sends nothing to an AI provider until you send a message. Enabling the integration, adding a provider or opening a chat transmits nothing on its own, the one exception is that listing a provider's models sends your API key to that provider, so the list can be fetched.

Once you send a message or run the <a class="reference-link" href="../Note%20Types/Text/In-editor%20AI%20assistant.md">In-editor AI assistant</a>, what leaves your machine depends on the provider you chose and on which context options are enabled.

## Where your notes go

| Provider type | Destination |
| --- | --- |
| Cloud providers | The provider's servers (Anthropic, OpenAI, Google, DeepSeek) |
| Subscription-based | The provider's servers, via Claude Code running locally |
| Local / self-hosted | Nothing leaves the machine running the model |
| Custom endpoint | Wherever you pointed it — which may be your own hardware or a hosted service |

This is the reason the provider list is grouped this way, and why Trilium pre-selects nothing: the choice of where your notes travel is made explicitly, by you, before anything is sent.

> [!NOTE]
> The <a class="reference-link" href="../Note%20Types/Text/In-editor%20AI%20assistant.md">In-editor AI assistant</a> has a model selection of its own, so it maybe answered by a different provider than the one in the chat. The row at the bottom of the assistant's menu always names the one being used.

## What is actually sent

*   **Always, with every message**
    *   The conversation itself: your messages and the assistant's replies, including earlier turns
    *   Trilium's system prompt describing how to format answers and use tools.
*   **The current note, only when note context is enabled.**
    *   In the sidebar chat this is the file icon at the bottom; the dedicated chat note type never sends a current note.
    *   What travels is a metadata block: the note's ID, title, type, creation and modification dates, its parent IDs, the titles of up to 20 children, up to 20 attributes, and a preview of the content.
    *   Notes above a size threshold send a size hint instead of the text, and the model must call a tool to read further.
*   **Any note the model asks for, when note access is enabled.**
    *   Tools let the model search your tree and read notes, attributes and attachments beyond the current one.
    *   It decides what to fetch; there is no per-note permission system, so the reachable scope is your whole tree.
*   **Attachments and mentions**, when you add them: images, PDFs and text files are sent to the provider, and an `@` mention makes that note fetchable.
*   **Your search query**, when web search is enabled, the model's search terms reach the provider's own search infrastructure.

## The in-editor AI assistant

A run of the <a class="reference-link" href="../Note%20Types/Text/In-editor%20AI%20assistant.md">In-editor AI assistant</a> sends a different set than a chat message. For quick actions, it sends it the moment you pick an action, there is no send button to reconsider at. For the free-form _Ask AI_, there is a dedicated send button and model selector.

*   **The passage you selected**, or the paragraph the cursor is in when you pick a quick action without selecting anything.
*   **Up to 1500 characters of the note on each side of that passage**, as plain text. The assistant is told this is context only and must not be rewritten, but it is sent regardless of whether you selected it: a run on a single sentence still transmits the paragraphs around it.
*   **Where the note sits**: its title and the titles of its parents, as a breadcrumb.
*   **Trilium's writing-assistant instructions**, which describe the formatting it may produce.
*   **Earlier turns of the same exchange**, once you follow up on a response.

No note metadata block is sent, web search is never enabled, and the assistant has no note tools so it can read nothing beyond the text listed above.

## Protected notes

While your [protected session](../Basic%20Concepts%20and%20Features/Notes/Protected%20Notes.md) is locked, protected notes send neither title nor content. **While it is unlocked they are treated like any other note,** a note the model reads through a tool is sent to the provider in full. If you keep sensitive material in protected notes, be aware that unlocking them removes that boundary for the duration of the session.

The same applies to the <a class="reference-link" href="../Note%20Types/Text/In-editor%20AI%20assistant.md">In-editor AI assistant</a>: it works on whatever is open in the editor, so running it inside an unlocked protected note sends that note's text like any other.

## What you control

*   **Which provider**: the single decision that determines whether anything leaves your machine at all.
*   **Note access**: turn tools off from the model selector at the bottom of the chat, and the model can read nothing beyond what you type.
*   **The current note:** the file icon in the sidebar chat.
*   **Web search:** also in the model selector.
*   **The editor assistant**: it has no per-run toggles. What you control is whether you run it, what you select before you do and which model answers.

With note access and note context both off, the provider receives only the words you typed.

## Keeping everything local

Adding an Ollama or LM Studio provider keeps every message on the machine running the model, and Trilium marks their models as free because no metered API is involved. The trade-off is quality and hardware: a small local model may fail at tool calls that a cloud model handles, so a local setup that misbehaves is worth benchmarking against a cloud provider before reporting it as a bug.

## Telemetry & security

Trilium itself collects no telemetry from the AI integration.

Your API key is stored in your database, sent only to the provider it belongs to, and is write-only through the options API so that a malevolent <a class="reference-link" href="../Scripting.md">Scripting</a> cannot access it. If you have backend or SQL console access enabled, a malevolent script **could potentially exfiltrate your API keys**.

The built-in MCP server is off by default. When enabled, every request must carry an ETAPI token, which grants the same full read and write access to your notes as the REST API; treat one like a password. On desktop it is reachable only from `localhost` unless you turn on <a class="reference-link" href="../Installation%20%26%20Setup/Desktop%20Installation/Network%20Access.md">Network Access</a>.