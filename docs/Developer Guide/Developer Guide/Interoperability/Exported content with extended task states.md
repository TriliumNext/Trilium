# Exported content with extended task states
If you're a developer working with HTML or Markdown content exported from Trilium, here are the details on how task states are stored.

## HTML notes

Trilium stores the task state identifier in the `data-trilium-task-state` attribute on the `<li>` element of the to-do list. The task state's title is also included to provide a fallback, human-readable tooltip (shown even when no custom checkbox is rendered).

```html
<ul class="todo-list">

  <li data-trilium-task-state="urgent" title="Urgent priority">
    <label class="todo-list__label">
      <input type="checkbox" disabled="disabled">
      	<span class="todo-list__label__description">
      		Replace the timing belt
      	</span>
    </label>
  </li>
  
</ul>
```

The checkbox glyph, color and other details are not present in the HTML markup. They are resolved at render time from the task state definition under "Task States" in Trilium's hidden subtree.

The default task states use the following identifiers:

| Title | Identifier | Counts as completed |
| --- | --- | --- |
| None | none | No |
| Doing | doing | No |
| Done | done | Yes |
| Maybe | maybe | No |
| Cancelled | cancelled | No |

## Markdown notes

Exported Markdown notes simply carry the Markdown symbol corresponding to the task state inside the checkbox body, just as it appears in the editor.

```html
- [ ] None
- [/] Doing
- [X] Done
- [?] Maybe
- [-] Cancelled
```