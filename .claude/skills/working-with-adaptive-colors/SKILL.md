---
name: working-with-adaptive-colors
description: >-
  Use when changing, debugging or reviewing the theme-adaptive colors of text notes: font color, highlight (font background color) and table or cell border and background colors, which are shown in a shade that suits the light or dark theme. Covers the storage contract (each color saved again as `--tn-color`, `--tn-background` or `--tn-border-color`), the `AdaptiveColors` CKEditor plugin (`packages/ckeditor5/src/plugins/adaptive_colors.ts`) and its font color dropdown tiles, the shared stylesheet `packages/ckeditor5/src/theme/adaptive_colors.css` with its `lch(from …)` rules and the 16 theme-overridable `--adaptive-*` limits, the dark-mode switches of the app and the share theme, print, the text editor palette (`color_palette.ts`), every other reader and writer (sanitizer, Markdown `==highlight==` import and export, the Highlights list), making a new surface adapt, a color that is unreadable or wrong in one theme, retuning a limit, and measuring contrast. Includes measure.mjs, which measures the adapted shades and the WCAG contrast in headless Chromium; don't write a new contrast probe.
---

# Working with adaptive colors

A color applied in a text note is saved twice: as the CSS property itself and as a `--tn-*`
variable with the same value. Stylesheets read the variable and show a shade that suits the theme:
the hue stays, the CIELAB lightness moves into a range per role and theme, and the chroma is capped.
Everything without those stylesheets (HTML export, other apps, old browsers) shows the property, so
the color as picked.

```html
<span style="color:#e64d4d;--tn-color:#e64d4d;">red text</span>
<span style="background-color:#e5e64d;--tn-background:#e5e64d;">highlight</span>
<table style="border:2px solid #4d99e6;--tn-border-color:#4d99e6;background-color:#e5e64d;--tn-background:#e5e64d;">
```

The adaptation happens only in CSS, at display time. A theme switch or a new limit therefore moves
every color in every note at once, and the note keeps the color the user chose.

## Where things are

| What | File | Identifier |
| --- | --- | --- |
| Writing and dropping the variables | `packages/ckeditor5/src/plugins/adaptive_colors.ts` | `AdaptiveColors`: `convertTextColor`, `addVariable`, `dropVariablesOnLoad`, `addVariablesToDropdownTiles`, `VARIABLES`, `DROPDOWN_VARIABLES` |
| Registration | `packages/ckeditor5/src/plugins.ts` | `TRILIUM_PLUGINS` |
| The rules and the limits | `packages/ckeditor5/src/theme/adaptive_colors.css` | 16 `--adaptive-*` limits, private `--_adaptive-*` light ranges, four rules |
| App dark switch, dropdown tile face | `apps/client/src/stylesheets/adaptive-colors.css` (imported by `style.css`) | `body.dark-theme`, `.ck-color-grid__tile:is([style*="--tn-color"], [style*="--tn-background"])` |
| Share dark switch | `packages/share-theme/src/content/adaptive_colors.css` (imported by `index.ts`) | `html.theme-dark`, the share-only `--adaptive-table-border-dark-min-lightness` |
| Loading in the app and in print | `apps/client/src/index.ts`, `apps/client/src/print.css` | `import`/`@import` of the shared file |
| Dark class | `apps/client/src/services/theme.ts`, `packages/share-theme/src/page/theme_switch.ts` | `updateColorSchemeClasses()` from `--theme-style`; `theme-dark` |
| Palette | `apps/client/src/widgets/type_widgets/text/color_palette.ts` | `buildFontColorConfig()`, `buildTableColorConfig()`, `GREYS`, `HUE_LABELS` |
| Hues | `apps/client/src/widgets/react/ColorPicker.tsx` | `DEFAULT_COLOR_PALETTE`, shared with note colors and other pickers |
| Selection ring of a tile (Next theme) | `apps/client/src/stylesheets/theme-next/notes/text.css` | `.ck-color-grid__tile.ck-on::after` |
| Import sanitizer | `packages/trilium-core/src/services/sanitizer.ts` | `allowedStyles["*"]`, `tableBorderStyles` |
| Markdown highlight | `packages/commons/src/lib/marked_extensions.ts` | `HIGHLIGHT_BACKGROUND`, `HIGHLIGHT_STYLE` |
| Markdown export | `packages/trilium-core/src/services/export/markdown.ts` | `isPlainDefaultHighlight()`, `DEFAULT_HIGHLIGHT_BACKGROUNDS` |
| Highlights sidebar | `apps/client/src/widgets/sidebar/HighlightsList.tsx` | `HighlightItem` |
| User Guide | `docs/User Guide/User Guide/Theme development/Reference.md`, `Note Types/Text/General formatting.md`, `Note Types/Text/Tables.md` | "Adaptive text and table colors" (limits and defaults); "Font color and background color" |

## The contract

- **The model holds the color as picked.** The variables exist only in the editing and data views
  and in the saved HTML. Nothing in the model knows about adaptation.
- **The variable repeats the property's value verbatim.** No normalization happens, so the two can
  never disagree.
- **Any element whose inline style contains a variable adapts**, anywhere on the page: the rules use
  `[style*="--tn-…"]` selectors. That is how a new surface opts in. App chrome follows the theme
  through its own variables and must not use these.
- **Adapt in CSS only.** An earlier design stored `light-dark()` pairs computed when the color was
  applied. It froze the shades of the theme active at that moment and needed a fallback rule, a
  value hidden in a CSS comment in the model and its own sanitizer forms. Don't bring back stored
  pairs, model comments or limits read at startup.

## The editor side

All in `AdaptiveColors`:

- **Text and highlight.** `convertTextColor()` replaces CKEditor's downcast of `fontColor` and
  `fontBackgroundColor` (`converterPriority: "high"`) with a span whose style is
  `property:value;--tn-…:value`. The span keeps CKEditor's attribute-element priority 7, so a color
  and a highlight on the same text merge into one span.
- **Tables and cells.** `addVariable()` adds a downcast listener next to CKEditor's conversion of
  `tableBorderColor`, `tableBackgroundColor`, `tableCellBorderColor` and
  `tableCellBackgroundColor`. It tests the consumable without consuming it, sets the variable on the
  `<table>` inside the widget's `<figure>` (or on the cell), and removes it with the color. A border
  whose sides differ has an object value and gets no variable.
- **Loading.** `dropVariablesOnLoad()` consumes the three variables on every element at `"highest"`
  priority, so General HTML Support cannot keep a stale one. CKEditor's own converter reads the
  color back, and the next save writes the variable again. A note saved before the variables existed
  therefore adapts after its next edit.
- **Dropdown tiles.** `addVariablesToDropdownTiles()` wraps `editor.ui.componentFactory.create()`,
  since the factory has no hook for the dropdowns it creates. On every opening of `fontColor` or
  `fontBackgroundColor` it sets `--tn-color` or `--tn-background` on the tiles of the palette and of
  the document colors, which CKEditor rebuilds on each opening. Its `change:isOpen` listener is
  registered after CKEditor's own, so the grids exist when it runs. Tiles of a dropdown opened
  before it renders have no element, hence `tile.element?.`.
- **Saving** stores the HTML as the editor produced it. The sanitizer runs on imports and the web
  clipper, not on editor saves.

## The stylesheet

| Selector | Property | Role |
| --- | --- | --- |
| `[style*="--tn-color"]` | `color` | `text` |
| `[style*="--tn-background"]` | `background-color` | `background` |
| `:is(table, td, th)[style*="--tn-border-color"]` | `border-color` | `table-border` |
| `:is(table, td, th)[style*="--tn-background"]` | `background-color` | `table-background` |

The table background rule wins over the text background rule by specificity. Each rule has this
shape, with `MIN`, `MAX` and `CHROMA` read from the role's `--_adaptive-<role>-min|max|chroma`:

```css
color: lch(from var(--tn-color)
    calc(min(1, c / 1.5) * clamp(MIN, l, MAX)
        + (1 - min(1, c / 1.5)) * (MIN + l / 100 * (MAX - MIN)))
    min(c, CHROMA) h) !important;
```

- **A hue** (chroma 1.5 or more) has its lightness clamped into the range.
- **A grey** (chroma below 1.5) has its lightness spread over the range, so black, dim grey, light
  grey and white stay four distinct shades in order. Between chroma 0 and 1.5 the two blend, so a
  near-grey from the color picker does not jump.
- **`!important`** beats the inline color. A browser without relative color syntax drops the whole
  declaration, so the inline color shows: the fallback costs no rule.

### Scheme and limits

- The light ranges sit on `:root` as twelve private `--_adaptive-*` properties, so a page with no
  dark class gets light shades rather than an undefined variable.
- Each page repoints them at the dark limits under its own selector: `body.dark-theme` in the app,
  `html.theme-dark` on share pages. Print and PDF export import only the shared file and get no
  dark class, so they always use the light shades, which suit paper.
- The 16 public limits, `--adaptive-<role>-<light|dark>-<limit>`, sit in `:where(:root)`. Its zero
  specificity lets a theme's `:root` win whatever the load order. The role is `text`, `background`,
  `table-border` or `table-background`; the limit is `min-lightness`, `max-lightness` or
  `max-chroma`. Each half has one moving lightness limit; the other end is fixed at 0 or 100. The
  defaults are in the CSS and in the Reference page of the User Guide, which documents them for
  theme authors.
- The share theme raises `--adaptive-table-border-dark-min-lightness` to 52 on `:root`, for the
  `#333333` dark page it had when the value was chosen. Since ef7d03c457 the share dark page is
  `#242424`, like the app's, where the shared 47 already measures 3.09:1. The override is likely
  obsolete; measure before removing it.

## Where colors adapt

| Surface | Result |
| --- | --- |
| Text notes, editable and read-only; share pages | Adapted |
| Print and PDF export | Light shades |
| HTML zip export (`apps/server/src/services/export/zip/factory.ts`), other apps | The color as picked; the variable is inert |
| Markdown export | A plain palette-yellow (or old `hsl(60, 75%, 60%)`) highlight becomes `==…==`, ignoring `--tn-*`; other colors stay inline HTML with their variable |
| Markdown import of `==text==` | `HIGHLIGHT_STYLE`, the palette yellow with its variable, so it adapts at once |
| Other imports, pasted HTML | The color as picked until the note is saved from the editor |
| Highlights sidebar | Adapted: `HighlightItem` sets both variables next to the colors |
| Font color and background color dropdowns | Each tile shows a bold "Ab" (a `::before`, so its accessible name stays the color label): adapted text on a transparent tile for font colors (`--icon-button-hover-background` on hover, except the selected tile), `--main-text-color` on the adapted background for background colors. The check icon is hidden, and the tiles are 30px (`--ck-color-grid-tile-size` on `.ck-color-ui-dropdown` in `ckeditor-theme.css`). In the Next theme the selection ring keeps the original color, except black and white, whose ring uses `--main-text-color`, and font-color tiles lose the black and white frame |
| Table and cell property pickers, the mobile color menu (`color_menu.tsx`) | The color as picked |
| Default table borders | Not adaptive: `--text-note-table-border-color` in `style.css`, the text color mixed 25% with transparent; a border set on the table or cell wins |

## Recipes

### Make another surface adapt

Set the variable next to the color, with the same value:

```tsx
style={{ color, "--tn-color": color }}
```

For a swatch that shows a background color, `--tn-background` adapts its `background-color`
directly. For a swatch that shows a text color, the text rule adapts `color`, and the swatch shows
it as text (the dropdown tiles' "Ab") or as a fill (`background-color: currentColor !important`).
Anything that must keep the original reads the variable, as the selection ring does.

### Change a default limit

1. Try the value first: `node .claude/skills/working-with-adaptive-colors/measure.mjs --set
   --adaptive-text-dark-min-lightness=78` (repeat `--set` for several), on both `--page app` and
   `--page share`.
2. Change it in `packages/ckeditor5/src/theme/adaptive_colors.css`.
3. Update the defaults table in `Theme development/Reference.md` and regenerate the help (the
   `writing-documentation` skill).
4. Put the before and after ratios in the commit body.

### Add a property or a role

Every place a new variable must reach:

- `AdaptiveColors`: the converter, `VARIABLES` (so loading drops it), and `DROPDOWN_VARIABLES` if a
  CKEditor color dropdown offers it.
- The sanitizer's `allowedStyles`, with the color regexes, on the elements that carry it.
- The shared stylesheet: a rule, four limits in `:where(:root)`, the light range in `:root`.
- Both dark switches, app and share.
- `ROLES` in `measure.mjs`; the Reference page; specs for the plugin and the sanitizer.

Name a new variable so that no existing one is a prefix of it, and it is not a prefix of an existing
one: `[style*="--tn-background"]` would also match `--tn-background-image`.

### Change the palette

Edit `color_palette.ts` (its spec checks the order, the labels, four columns, and that the Markdown
highlight is the palette's yellow). `DEFAULT_COLOR_PALETTE` is shared with note colors and other
pickers, so a hue change reaches beyond the editor. Run `measure.mjs` and check the User Guide's
General formatting page.

### A color is wrong in one theme

1. In DevTools, check that the element's inline style carries the variable. Without it the note
   predates the variables or the color came from an import: saving from the editor adds it.
2. Check the dark class: `body.dark-theme` in the app, `html.theme-dark` on a share page.
3. If the color is gone entirely, a `var()` in the rule failed at computed-value time (see Traps).
4. Measure the color: `measure.mjs --colors "#123456,hsl(0, 75%, 60%)"`.

## Measuring

`measure.mjs` loads the shared stylesheet and one page's dark switch into headless Chromium (the
`playwright` package at the repo root), applies every palette color in every role, and reads the
computed color back as sRGB through a canvas: the computed value is an `lch(…)` string, and the
canvas clips it to sRGB as the screen does. The palette comes from `color_palette.ts` and
`ColorPicker.tsx`, and the page colors from the theme files, so the script follows the source.

```bash
node .claude/skills/working-with-adaptive-colors/measure.mjs                # app page
node .claude/skills/working-with-adaptive-colors/measure.mjs --page share   # share page
node .claude/skills/working-with-adaptive-colors/measure.mjs --json         # raw shades
```

It prints the shade of each color per role and scheme, then four checks per scheme, each with the
lowest pair: palette text on the page (4.5), the theme's text on each highlight (4.5), table borders
on the page (3) and any palette text on any highlight (4.5).

Baseline on 2026-11-08, app page, after the light text maximum moved from 40 to 45:

| Check | Light (`#ffffff`) | Dark (`#242424`) |
| --- | --- | --- |
| Text on the page | 5.01 | 7.23 |
| Theme text on a highlight | 15.78 | 5.60 |
| Table border on the page | 3.06 | 3.09 |
| Any text on any highlight | 3.77 | 4.19 |

The last row misses 4.5 for the extreme pairs (turquoise on red in light, red on turquoise in
dark). Browsers clip an out-of-gamut color channel by channel, which moves its lightness, so a
lightness limit alone is not a contrast guarantee there. Raising the dark text minimum to 78 only
reaches 4.43, because the turquoise highlight also clips lighter; the background maximum would have
to move with it. Not tuned yet.

## Testing

| Spec | Covers | Run from the package |
| --- | --- | --- |
| `packages/ckeditor5/src/plugins/adaptive_colors.spec.ts` | Model keeps the color; save writes the variables; load drops them; removal; tables and cells; General HTML Support; dropdown tiles | `packages/ckeditor5` (browser mode) |
| `apps/client/src/widgets/type_widgets/text/color_palette.spec.ts` | Palette order, labels, columns, Markdown yellow, table swatches | `apps/client` |
| `packages/trilium-core/src/services/sanitizer.spec.ts` | Variables kept, colors only, `--tn-border-color` on tables | `apps/server` and `apps/standalone` |
| `packages/trilium-core/src/services/export/markdown.spec.ts` | Yellow to `==…==` with or without its variable; other colors keep it | `apps/server` and `apps/standalone` |

```bash
cd packages/ckeditor5 && ../../node_modules/.bin/vitest run src/plugins/adaptive_colors
cd apps/client && ../../node_modules/.bin/vitest run color_palette
cd apps/server && ../../node_modules/.bin/vitest run sanitizer.spec export/markdown.spec
cd apps/standalone && ../../node_modules/.bin/vitest run sanitizer.spec export/markdown.spec
```

No automated test covers the CSS; `measure.mjs` is the check. The `packages/ckeditor5` coverage gate
has almost no margin, so every branch in the plugin needs a spec (see `ckeditor5-testing`).

## Traps

- **A failed `var()` unsets the color.** A declaration whose variable is invalid at computed-value
  time does not fall back to the inline color: it computes to `unset`, and the text loses its color.
  Every limit must be a plain number: "no cap" is `150`, since `none` is invalid inside `min()`. A
  `--tn-*` value that is not a color breaks the same way, which is why the editor writes only colors
  and the sanitizer lets only colors through.
- **Specificity of the limits.** A limit declared in a plain `:root` in a shared file beats a theme
  that loads earlier; keep defaults in `:where(:root)`.
- **`[style*=…]` is a substring match** on the whole style attribute (see the naming rule above).
- **Gamut clipping** puts measured contrast below what the lightness limits suggest; measure, don't
  compute.
- **Share pages in development** take their CSS from the client's Vite server (fb8518b549); there is
  no share-theme build to rerun.
- **Old notes** keep the color as picked until their next save from the editor. This is an accepted
  consequence of the design; no migration rewrites them.
