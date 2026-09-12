# AI assistant

Ask the host's LLM to rewrite the selection or generate new content, watch the response stream into
a preview inside a non-modal dialog, then commit it with **Replace** or **Insert below**. Trilium's
GPL counterpart of the premium `AIAssistant` feature.

Load the `TriliumAiAssistant` glue plugin; it pulls in `AiAssistantEditing` and `AiAssistantUI`.
The feature disables itself when the host configures no `stream` callback, which is how "no LLM
provider set up" reaches the editor.

## Files

| File | Role |
|---|---|
| `ai_assistant.ts` | Glue plugin; also declares the `ckeditor5` module augmentation, including the `aiAssistant` config key and the command |
| `ai_assistant_config.ts` | The whole host contract — the request/response types, the quick-action shapes, `AiAssistantConfig`. No runtime code |
| `ai_assistant_editing.ts` | The target marker and the `aiAssistant` command. No schema and no data conversion |
| `ai_assistant_ui.ts` | The toolbar entry and its menu, the keystroke, and the run itself: streaming, review, commit |
| `ai_assistant_form.ts` | The dialog's view — prompt, phase switching, the Result/Changes toggle, the preview, the action buttons |
| `theme/ai_assistant.css` | Dialog, menu and preview styling |
| `theme/icons/ai.svg` | The sparkle glyph, shared with the `/` palette |

## The host owns everything provider-shaped

The plugin knows nothing about providers, endpoints, authentication or Markdown. It is handed
callbacks the same way `snippets.definitions` and `syntaxHighlighting.loadHighlightJs` are:

```js
aiAssistant: {
    stream: ( request, onData, signal ) => Promise<AiCompletionUsage | void>,
    diff: ( oldHtml, newHtml ) => string | AiDiffResult,
    quickActions: [ /* groups of predefined instructions */ ],
    menuFooter: [ /* rows for what a run answers to — Trilium hangs the model picker here */ ],
    askIconClass: 'bx bx-message-square-dots',
    sanitizeHtml: html => html   // required
}
```

`stream` is the only one whose absence disables the feature; `diff` merely costs the Changes view,
and `quickActions` merely degrades the toolbar entry from a split button to a plain one.

**`sanitizeHtml` is required and has no fallback** — the plugin throws
`ai-assistant-sanitize-html-required` rather than render unsanitized model output. CKEditor ships
no sanitizer and asks the integrator for one instead (`config.htmlEmbed.sanitizeHtml`, whose
built-in default only warns and passes through); a top-level `config.sanitizeHtml` is rejected by
the editor outright, so it belongs under this namespace. A built-in strip list was deliberately not
written: it would become the real defence the moment a host forgot to configure one, and it reads
as safe in review while missing namespaced `xlink:href`, SVG animation elements and `data:` URIs.
Trilium passes `sanitizeNoteContentHtml`, the same DOMPurify pass note content gets.

## HTML on both ends, with the source alongside

`onData` is called with the **cumulative** response HTML on every tick — the same contract the
premium `AITextAdapter` uses. Re-parsing the growing prefix is what keeps the preview renderable
mid-stream, since the HTML parser auto-closes tags cut off in the middle.

Its second argument, `source`, is what that HTML was rendered *from*, for a host that renders at
all. Trilium's model answers in Markdown, and the source is what enters `history` — so a follow-up
hands the model back its own words rather than our rendering of them.

## Nothing is written until the user commits

There is no schema and no data conversion because the feature stores nothing: it inserts perfectly
ordinary content on commit and is otherwise invisible to the document. Two consequences worth
knowing:

- **The target is a marker, not the selection.** `triliumAiTarget` is added on open with
  `affectsData: false`, so it stays out of the data and the undo stack while surviving focus moving
  into the dialog — and it is remapped as the user keeps editing behind the dialog, so Replace
  still hits what was originally selected. An editing-only `markerToHighlight` tints it.
- **A commit is one `model.change()` and therefore one undo step**, marker removal included. The
  marker is retired inside that change rather than left to the teardown, because teardown hands the
  pinned range back as the selection and would overrule where `insertContent` decided to leave it.

`Insert below` walks out to the outermost block containing the target's end before inserting, so it
lands below the whole selection instead of inside it.

## The review phase

Renders are throttled to `RENDER_THROTTLE_MS` (80 ms) with the last chunk always flushed — the
stream arrives far faster than a re-parse of the whole prefix is worth doing.

The diff is computed once, when the run finishes, never against a partial stream: a half-streamed
response diffs as a sea of deletions. Which view the review opens on is decided in this order:

1. The quick action's own `reviewView`, for actions whose answer replaces its source by definition
   (translation, summary, diagram).
2. `AiDiffResult.isUnchanged` — the review says "nothing to change" outright instead of showing a
   diff with no marks in it, which reads as a diff that failed.
3. `AiDiffResult.rewriteRatio` against `REWRITE_RATIO_THRESHOLD` (0.5). Past half, the response
   itself is the thing worth reading.

A renderer returning a bare string is treated as having rewritten nothing, which is what a plain
word-level diff amounts to.

## The preview is outside the editor's pipeline

Response HTML reaches the preview through `innerHTML`, so it gets the configured sanitizer on the
way in — and then `_enrichPreview` renders what the pipeline would otherwise have done for it:

- **Math**, when `config.math` is present, through the same `renderEquation` the widget uses.
- **Mermaid**, when `MermaidEditing` is loaded and `config.mermaid.lazyLoad` is set, through the
  now-public `renderMermaid`. This is why that function is exported at all — the review has to show
  what committing will produce, not the `language-mermaid` code block it produces it from.

Both are best-effort: a missing plugin or config just leaves the block as it came.

## The menu is rebuilt, not rebound

`updateQuickActions()` and `updateMenuFooter()` replace the lists and invalidate the rendered menus
so they redraw on next open. That is what lets the host add a custom action, or change which model
is ticked, without rebuilding the editor — and why consumers outside this folder (the `/` palette,
the right-click menu) read `AiAssistantUI#quickActions` rather than `config.aiAssistant.quickActions`:
the config only seeded the list, and the content languages behind Translate can be changed from
inside the editor.

Groups render either inlined at the top level or as a submenu (`submenu: true`). An inlined group
loses its heading — CKEditor's nested-menu definition has only buttons and submenus, no group
separators — which suits actions that already read as commands ("Fix typos") and not those that
only make sense under theirs ("Romanian"). The latter is also why `AiQuickAction.commandLabel`
exists: the `/` palette shows actions away from their heading.

## Reaching the feature from outside

| Where | What |
|---|---|
| `src/plugins.ts` | Registered in `TRILIUM_PLUGINS` |
| `src/index.ts` | Exports the plugin and the whole config type surface for the host |
| `src/plugins/mention/slash_commands.ts` | An `Ask AI…` entry plus one `AI: <action>` entry per quick action |
| `apps/client/…/text/toolbar.ts` | The `aiAssistant` entry in the classic, floating and block toolbars |
| `apps/client/src/menus/text_editor_context_menu.ts` | The right-click submenu, built per click from `AiAssistantUI` |
| `apps/client/…/text/ai_assistant_stream.ts` | The transport: the Markdown round trip and `/api/llm-chat/stream` |

`Ctrl+Shift+K` opens the prompt. Neither idiom the feature would have liked was free — `Ctrl+K`
creates a link here as in every other editor, and `Ctrl+J` is Trilium's Jump to note — so it keeps
the `K` that Cursor, Linear and Slack made the key for "ask for something" without taking either.

## Provenance

Trilium's own, written from scratch; there is no upstream to track and no third-party license file
next to it. What it borrows from the premium `AIAssistant` is the *shape* of the integration rather
than any code: the cumulative-HTML streaming contract is `AITextAdapter`'s, the host-supplied
sanitizer follows `htmlEmbed`'s, and `AiQuickAction` is the GPL counterpart of
`AICommandDefinition`.
