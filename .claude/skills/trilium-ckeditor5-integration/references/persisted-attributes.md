# Persisting a `data-trilium-*` attribute (model → view → data → markdown → share)

When a plugin stores state in the saved note content, that state has to survive the whole pipeline. Two real plugins are the canonical worked examples, and they make **opposite** markdown decisions:

| Plugin | Model attr | Data attr | Scope | Markdown | File |
|---|---|---|---|---|---|
| `CollapsibleListItems` | `listCollapsed` | `data-trilium-collapsed` | list item | **DROPPED** on export | `plugins/collapsible_list_items.ts` |
| `TodoListMultistateEditing` | `taskState` | `data-trilium-task-state` | block | **KEPT** through export+import | `plugins/todo_list_multistate/todo_list_multistate_editing.ts` |

This is **explicit conversion**, not GeneralHtmlSupport. GHS (`config.ts:178-179`, `htmlSupport.allow` from the `allowedHtmlTags` option) is the separate path for arbitrary *user-pasted* HTML, not for a feature you author.

## Step 1 — schema

Allow the attribute on the model node (`collapsible_list_items.ts:25`):

```ts
editor.model.schema.extend("$block", { allowAttributes: LIST_COLLAPSED_ATTRIBUTE });
```

`todo_list_multistate_editing.ts:41` does the same for `TASK_STATE_ATTRIBUTE`.

## Step 2 — conversion BOTH directions (asymmetric = the classic bug)

### List-item-scoped state → `ListEditing.registerDowncastStrategy`

Lists are flat in the model (sibling blocks with `listIndent`/`listItemId`), so item-level attributes use the list plugin's downcast strategy, which writes onto the rendered `<li>`. `collapsible_list_items.ts:29-47`:

```ts
editor.plugins.get(ListEditing).registerDowncastStrategy({
    scope: "item",
    attributeName: LIST_COLLAPSED_ATTRIBUTE,
    setAttributeOnDowncast(writer, value, element) {
        if (value) {
            writer.setAttribute(COLLAPSED_DATA_ATTRIBUTE, "true", element);   // data-trilium-collapsed
        } else {
            writer.removeAttribute(COLLAPSED_DATA_ATTRIBUTE, element);
        }
    }
});

editor.conversion.for("upcast").attributeToAttribute({
    view: { name: "li", key: COLLAPSED_DATA_ATTRIBUTE },
    model: {
        key: LIST_COLLAPSED_ATTRIBUTE,
        value: (viewElement) => viewElement.getAttribute(COLLAPSED_DATA_ATTRIBUTE) === "true" ? true : null
    }
});
```

`todo_list_multistate_editing.ts:59-94` is the richer version: its `registerDowncastStrategy` (`scope:"item"`) writes `data-trilium-task-state` only for non-anchor states, and its `options.dataPipeline` check keeps an editing-only `tn-unknown-task-state` class OUT of the saved data — note the **data vs editing pipeline split**: classes/markers you only want in the editing view must be gated on `!options?.dataPipeline`.

### Block-level state → `attributeToAttribute` both ways

For a plain block attribute (not list-scoped), register `attributeToAttribute` for downcast and upcast symmetrically. The upcast value-normalizer (`todo_list_multistate_editing.ts:86-92`) returns `null` for empty/anchor values so junk doesn't become a model attribute.

> **Rule:** every downcast needs a matching upcast or the value silently vanishes on the next load. If you write the downcast, write the upcast in the same commit.

## Step 3 — DECIDE the markdown behaviour, then test it

Markdown round-trip is **not** automatic and **not** guaranteed — it's a per-feature choice made in `packages/trilium-core/src/services/{export,import}/markdown.ts`.

### KEEP (task-state) — export reads the data attr

`export/markdown.ts:258-268` (inside the list-item replacement rule):

```ts
} else if (parent.classList.contains("todo-list")) {
    const state = (node as HTMLElement).getAttribute("data-trilium-task-state");
    const stateMarker = state
        ? currentTaskStates.find((s) => s.name === state)?.markdownSymbol
        : undefined;
    if (stateMarker) {
        prefix = `- [${stateMarker}] `;
    } else {
        const isChecked = node.querySelector("input[type=checkbox]:checked");
        prefix = (isChecked ? "- [x] " : "- [ ] ");
    }
}
```

Tests: export `export/markdown.spec.ts:357` ("exports todo list multistate markers from data-trilium-task-state"); import `import/markdown.spec.ts:302` ("imports todo list multistate markers as data-trilium-task-state").

### DROP (collapsed) — no markdown syntax, children survive as bullets

There is no markdown for "collapsed", so the attribute is dropped on export while the nested `<li>`s round-trip as ordinary bullets. The decision is documented and locked by a test — `export/markdown.spec.ts:448`:

```ts
it("drops data-trilium-collapsed but keeps the collapsed item's children as bullets", () => {
    // Collapsing is editor-only UI state … Markdown has no syntax for it — so the attribute
    // is dropped on export while the nested structure still round-trips as ordinary bullets.
    const html = /* <ul><li data-trilium-collapsed="true">Parent<ul><li>Child</li></ul></li>… */;
    const expected = `*   Parent\n    *   Child\n*   Sibling`;
    expect(markdownExportService.toMarkdown(html)).toBe(expected);
});
```

Even when dropped on markdown export, the attribute must still survive the **HTML import/clone** path: `import/single.spec.ts:82` ("safe import preserves data-trilium-collapsed on list items") asserts the data attribute isn't stripped by the HTML sanitizer on import.

**Whichever you choose, add both an export test (`export/markdown.spec.ts`) and an import test (`import/markdown.spec.ts` or `import/single.spec.ts`).** If your attribute also renders outside the editor, extend `markdown_renderer.ts`/`.spec.ts` in `@triliumnext/commons` too. Coverage of these core specs goes through the server suite — see the **analyzing-coverage** and **writing-unit-tests** skills.

## Step 4 — editing-only visuals scoped to the editing view

Any hide/show or decorative behaviour must be **CSS scoped to the editing view**, imported at the top of the plugin (`collapsible_list_items.ts:1`):

```ts
import "../theme/collapsible_list_items.css";
```

Because the hide is CSS in the editing pipeline only, the saved data still contains the full (hidden) subtree, so **read-only rendering and the share-theme stay fully expanded** — share-theme needs no change. The spec proves it: in the editor the nested `<ul>` computes `display: none` (`collapsible_list_items.spec.ts:50-52`), but `editor.getData()` still contains the children and `data-trilium-collapsed="true"` (`:54`).

For visual state that depends on the *value* of the attribute (task-state icons), the CSS can target the data attribute directly — `packages/trilium-core/src/services/task_states.ts:181` (the core copy, **not** the `apps/client/.../services/task_states.ts` one `config.ts` imports) generates `[data-trilium-task-state="<name>"] { … }` rules, which is what makes the icons appear in read-only and shared notes too.

## Step 5 — test the model↔data round-trip in the plugin spec

The browser spec asserts the full loop (`collapsible_list_items.spec.ts`):
- toggle command → model attribute set (`:42`) → `editor.getData()` contains `data-trilium-collapsed="true"` (`:54`);
- `editor.setData('<ul><li data-trilium-collapsed="true">…')` → upcast produces the model attribute (`:63-79`);
- loading a collapsed subtree does **not** auto-expand (children arrive with the parent), and junk persisted state with nothing to collapse is normalized away (`:81-86`).

Harness reminders (see SKILL.md): `licenseKey: "GPL"` is mandatory; lists are flat in the model fixtures; import `_setModelData as setModelData` from `"ckeditor5"`; run with `pnpm --filter ckeditor5 test src/plugins/<x>.spec.ts`.
