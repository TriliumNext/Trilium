# Reference
## Detecting mobile vs. desktop

The mobile layout is different than the one on the desktop. Use `body.mobile` and `body.desktop` to differentiate between them.

```css
body.mobile #root-widget {
	/* Do something on mobile */
}

body.desktop #root-widget {
	/* Do something on desktop */
}
```

Do note that there is also a “tablet mode” in the mobile layout. For that particular case media queries are required:

```css
@media (max-width: 991px) {

    #launcher-pane {

        /* Do something on mobile layout */

    }

}



@media (min-width: 992px) {

    #launcher-pane {

        /* Do something on mobile tablet + desktop layout */

    }

}
```

## Detecting horizontal vs. vertical layout

The user can select between vertical layout (the classical one, where the launcher bar is on the left) and a horizontal layout (where the launcher bar is on the top and tabs are full-width).

Different styles can be applied by using classes at `body` level:

```
body.layout-vertical #left-pane {
	/* Do something */
}

body.layout-horizontal #center-pane {
	/* Do something else */	
}
```

The two different layouts use different containers (but they are present in the DOM regardless of the user's choice), for example `#horizontal-main-container` and `#vertical-main-container` can be used to customize the background of the content section.

## Detecting platform (Windows, macOS) or Electron

It is possible to add particular styles that only apply to a given platform by using the classes in `body`:

| Windows | macOS |
| --- | --- |
| `<br>body.platform-win32 {<br> background: red;<br>}<br>` | `<br>body.platform-darwin {<br> background: red;<br>}<br>` |

It is also possible to only apply a style if running under Electron (desktop application):

```
body.electron {
	background: blue;
}
```

### Native title bar

It's possible to detect if the user has selected the native title bar or the custom title bar by querying against `body`:

```
body.electron.native-titlebar {
	/* Do something */
}

body.electron:not(.native-titlebar) {
	/* Do something else */
}
```

### Native window buttons

When running under Electron with native title bar off, a feature was introduced to use the platform-specific window buttons such as the semaphore on macOS.

See [Native title bar buttons by eliandoran · Pull Request #702 · TriliumNext/Notes](https://github.com/TriliumNext/Notes/pull/702) for the original implementation of this feature, including screenshots.

#### On Windows

The colors of the native window button area can be adjusted using a RGB hex color:

```
body {
	--native-titlebar-foreground: #ffffff;
	--native-titlebar-background: #ff0000;
}
```

It is also possible to use transparency at the cost of reduced hover colors using a RGBA hex color:

```
body {
	--native-titlebar-background: #ff0000aa;
}
```

Note that the value is read when the window is initialized and then it is refreshed only when the user changes their light/dark mode preference.

#### On macOS

On macOS the semaphore window buttons are enabled by default when the native title bar is disabled. The offset of the buttons can be adjusted using:

```css
body {
    --native-titlebar-darwin-x-offset: 12;
    --native-titlebar-darwin-y-offset: 14 !important;
}
```

### Background/transparency effects on Windows (Mica)

Windows 11 offers a special background/transparency effect called Mica, which can be enabled by themes by setting the `--background-material` variable at `body` level:

```css
body.electron.platform-win32 {
	--background-material: tabbed; 
}
```

The value can be either `tabbed` (especially useful for the horizontal layout) or `mica` (ideal for the vertical layout).

Do note that the Mica effect is applied at `body` level and the theme needs to make the entire hierarchy (semi-)transparent in order for it to be visible. Use the TrilumNext theme as an inspiration.

## Note icons, tab workspace accent color

Theme capabilities are small adjustments done through CSS variables that can affect the layout or the visual aspect of the application.

In the tab bar, to display the icons of notes instead of the icon of the workspace:

```css
:root {
	--tab-note-icons: true;
}
```

When a workspace is hoisted for a given tab, it is possible to get the background color of that workspace, for example to apply a small strip on the tab instead of the whole background color:

```css
.note-tab .note-tab-wrapper {
    --tab-background-color: initial !important;
}

.note-tab .note-tab-wrapper::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background-color: var(--workspace-tab-background-color);
}
```

## Custom fonts

The recommended way of using customized fonts is to import a font directly in Trilium. See <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Themes/Personalizing%20the%20font.md">Personalizing the font</a> for information on how to do so.

Alternatively, for a theme providing its own font, [Custom resource providers](../Advanced%20Usage/Custom%20Resource%20Providers.md) can be used: Import a font into Trilium and assign it `#customResourceProvider=fonts/myfont.ttf` and then import the font in CSS via `/custom/fonts/myfont.ttf`. Use `../../../custom/fonts/myfont.ttf` if you run your Trilium server on a different path than `/`.

## Dark and light themes

A light theme needs to have the following CSS:

```css
:root {
	--theme-style: light;
}
```

if the theme is dark, then `--theme-style` needs to be `dark`.

If the theme is auto (e.g. supports both light or dark based on `prefers-color-scheme`) it must also declare (in addition to setting `--theme-style` to either `light` or `dark`):

```css
:root {

    --theme-style-auto: true;

}
```

This will affect the behavior of the Electron application by informing the operating system of the color preference (e.g. background effects will appear correct on Windows).

## Adaptive text and table colors

Colors applied in a text note, from the font color and background color buttons (see <a class="reference-link" href="../Note%20Types/Text/General%20formatting.md">General formatting</a>) or from the table and cell properties (see <a class="reference-link" href="../Note%20Types/Text/Tables.md">Tables</a>), are shown in a shade that suits the theme: the hue stays, while the lightness and the saturation are kept within limits. A theme can change these limits, for example if its page background is much darker or lighter than the one of the built-in themes:

```css
:root {
    --adaptive-text-light-max-lightness: 35;
    --adaptive-text-dark-min-lightness: 80;
}
```

Each variable is named `--adaptive-<role>-<light|dark>-<limit>`:

*   The role is `text` (font color), `background` (font background color), `table-border` or `table-background` (tables and cells).
*   `light` or `dark` is the kind of theme the limit applies to, as declared by `--theme-style`.
*   The limit is `min-lightness` or `max-lightness` (the CIELAB lightness, from 0 for black to 100 for white), or `max-chroma` (how saturated the color can be; `150` sets no practical limit). Each value must be a plain number, otherwise the colors lose their adaptation.

The defaults are:

| Role | Light themes | Dark themes |
| --- | --- | --- |
| `text` | `max-lightness: 40`, `max-chroma: 150` | `min-lightness: 75`, `max-chroma: 55` |
| `background` | `min-lightness: 90`, `max-chroma: 20` | `max-lightness: 30`, `max-chroma: 30` |
| `table-border` | `max-lightness: 60`, `max-chroma: 150` | `min-lightness: 47`, `max-chroma: 150` |
| `table-background` | `min-lightness: 90`, `max-chroma: 20` | `max-lightness: 30`, `max-chroma: 30` |

The limits apply while a note is displayed, so a change to them affects every note at once. The note itself keeps each color as it was picked, in its `color`, `background-color` or `border-color` style, and a second time in a `--tn-color`, `--tn-background` or `--tn-border-color` variable, which the adaptation reads.