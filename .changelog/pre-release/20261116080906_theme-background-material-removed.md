---
type: breaking
---

For theme developers: the `--background-material` CSS variable no longer has an effect. Trilium now chooses the Mica or vibrancy backdrop itself, from the layout, and applies it only to the Next themes and to custom themes based on them with `#appThemeBase`. The `setBackgroundMaterial()` and `setVibrancy()` methods of `window.electronApi.window` were removed.