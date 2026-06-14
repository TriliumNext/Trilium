# Reusable components — `apps/client/src/widgets/react/`

Before hand-rolling an `<input>`, `<select>`, `<button>`, or an empty-state `<div>`, check here. The directory has **49** `.tsx` components; this catalogs the high-use ones with exact signatures for the ones you'll reach for most. `ls apps/client/src/widgets/react/*.tsx` for the rest.

## The three rules (CLAUDE.md, enforced)

1. **No Bootstrap utility classes** (`form-control-sm`, `form-select-sm`, `input-group`) on the `Form*` components. They already render `form-control`/`form-select`; a utility-class override silently fights their internals.
2. **No inline `style` for static layout.** The `style` prop is for a genuinely computed/dynamic value only (e.g. `Collapsible` animates `height` from a measured size — Collapsible.tsx:76). Everything static goes in CSS.
3. **Per-component CSS, scoped by a root class via native nesting.** `import "./Foo.css"` at the top (NoItems.tsx:1), and nest the rules under the component's root class — `.no-items { … .tn-icon { … } button { … } }` (NoItems.css:1). No CSS modules in this repo.

## Buttons & actions

| Component | File | Use / key props |
|---|---|---|
| `Button` | Button.tsx:29 | text button. `kind` `"primary" \| "secondary" \| "lowProfile"`, `size` `"normal" \| "small" \| "micro"`, `icon`, `keyboardShortcut`, `onClick` / `triggerCommand`. With no `onClick`/`triggerCommand` it submits the enclosing form (Button.tsx:73). |
| `ActionButton` | ActionButton.tsx:23 | icon-only button with a tooltip (auto-shows the bound shortcut via `triggerCommand`). `titlePosition`, `frame`, `active`. |
| `LinkButton` | LinkButton.tsx | anchor styled as a button. |
| `ButtonGroup` / `SplitButton` / `ButtonOrActionButton` | Button.tsx:87,95,120 | grouped buttons; split dropdown; desktop→`Button`/mobile→`ActionButton`. |

## Form inputs

Pair single inputs with `FormGroup` (label + description + error wiring, auto-`id`).

| Component | File | Use / key props |
|---|---|---|
| `FormTextBox` | FormTextBox.tsx:11 | text/number input. `currentValue`, `onChange(value, validity)`, `onBlur`; clamps to `min`/`max` for `type="number"` (FormTextBox.tsx:18). |
| `FormTextBoxWithUnit` | FormTextBox.tsx:56 | text box with a unit suffix (`unit="px"`). |
| `FormTextArea` | FormTextArea.tsx | multi-line text. |
| `FormSelect<T>` | FormSelect.tsx:33 | combobox over an object array. `values`, `keyProperty`, `titleProperty?`, `currentValue`, `onChange(value)`. `FormSelectWithGroups` for `<optgroup>`s. |
| `FormCheckbox` | FormCheckbox.tsx:21 | `label`, `currentValue: boolean`, `onChange(bool)`, optional `hint` (dotted-underline tooltip). |
| `FormRadioGroup` | FormRadioGroup.tsx | `values: {value,label}[]`, `currentValue`, `onChange`. |
| `FormToggle` | FormToggle.tsx | switch-style boolean toggle. |
| `Slider` | Slider.tsx:10 | range input. `value`, `onChange(number)`, `min`/`max`/`step`. |
| `FormFileUpload` / `FormDropdownList` / `FormList` / `FormText` | FormList.tsx, etc. | file picker / dropdown list / list / static help text. |
| `FormGroup` | FormGroup.tsx:20 | wraps **one** child input with a `label`, `description`, and `error`; auto-assigns a unique `id` and forwards it to the child (FormGroup.tsx:21-22). `FormMultiGroup` for several children (no auto-id). |

## Layout, feedback & display

| Component | File | Use |
|---|---|---|
| `Modal` | Modal.tsx:94 | dialogs — see [dialogs.md](dialogs.md). |
| `Dropdown` | Dropdown.tsx | menu/popover dropdown. |
| `NoItems` | NoItems.tsx:15 | empty/too-many/error placeholder. `icon`, `text`, optional `children` (e.g. a retry `Button`). Use this, not a bare styled `<div>`. |
| `Icon` | Icon.tsx:9 | boxicons span (`icon="bx bx-search"`), always adds `tn-icon`. |
| `LoadingSpinner` | LoadingSpinner.tsx | spinner. |
| `Card` / `Badge` / `Admonition` / `Alert` / `InfoBar` | Card.tsx, Badge.tsx, … | card container / pill / callout / alert / dismissible info bar. |
| `Collapsible` | Collapsible.tsx:16 | expandable section, `title` + `initiallyExpanded?`; `ExternallyControlledCollapsible` for controlled `expanded`/`setExpanded`. |
| `KeyboardShortcut` | KeyboardShortcut.tsx | renders a shortcut as `<kbd>`s. |
| `PropertySheet` / `ResponsiveContainer` / `Column` / `FluidWrapper` | PropertySheet.tsx, … | settings layout / responsive wrappers / grid column. |

## Note-aware components

| Component | File | Use |
|---|---|---|
| `NoteLink` | NoteLink.tsx | clickable link to a note (icon + title, resolves a notePath). |
| `NoteAutocomplete` | NoteAutocomplete.tsx | note picker / search-as-you-type. |
| `NoteList` | NoteList.tsx | renders a list of notes. |
| `NotePropertyMenu` | NotePropertyMenu.tsx | per-note property menu. |

## Good / bad

**Bad** — hand-rolled markup, Bootstrap sizing utility, inline static style:
```tsx
<div style={{ textAlign: "center", color: "gray" }}>
    <input class="form-control form-control-sm" value={q} onInput={…} />
    {results.length === 0 && <p>No results</p>}
</div>
```

**Good** — reusable components, CSS in a sibling file:
```tsx
import "./my_panel.css";                      // rules nested under .my-panel
// …
<div className="my-panel">
    <FormGroup name="q" label={t("search.query")}>
        <FormTextBox currentValue={q} onChange={setQ} />
    </FormGroup>
    {results.length === 0 && <NoItems icon="bx bx-search" text={t("search.no_results")} />}
</div>
```

---

**Testing components:** the **writing-unit-tests** skill (client-components reference) shows rendering with raw `preact` `render()` into happy-dom and asserting on structure/classes — don't assert on translated strings.
