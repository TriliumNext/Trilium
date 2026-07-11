# macOS DMG background

`background.png` / `background@2x.png` (and the `-dev` nightly pair) are the Finder-window background
of the mounted `.dmg` — the *drag the app into Applications* screen. Wired into the `@electron-forge/maker-dmg`
config in `electron-forge/forge.config.ts` (`background` + `contents` + `window`).

Generated from `background.html`; don't edit the PNGs by hand. Change the HTML and regenerate:

```bash
pnpm --filter desktop generate-dmg-background
```

Runs on any OS (headless Chromium via the repo's `@playwright/test`) — **but the DMG itself can only be
built and visually verified on macOS** (`appdmg` is `os: [darwin]` and isn't installed elsewhere). The
`contents` icon coordinates in `forge.config.ts` are a best effort matched to the artwork; fine-tune
them on a real macOS build.

`preview.png` (stable) and `preview-dev.png` (nightly) are faithful mocks of the assembled Finder window:
the real app icon (`icon.icns` / `icon-dev.icns`) and the real macOS Applications-folder icon composited at
the same `contents` coordinates the DMG uses, under a reconstructed Finder title bar, with the captions
Finder draws. On macOS the icons are rendered from their `.icns` via `sips` (pixel-perfect); off macOS it
falls back to the flat logo and a drawn folder so the script still runs anywhere. They are **reference
only** — appdmg never uses them (it only reads `background.png`/`@2x`). Kept reproducible from source so
they aren't mystery images; regenerate with `pnpm --filter desktop generate-dmg-preview`.

## How it differs from the Windows splash

- **Static, not animated.** A DMG background is a Finder window background image — it can't animate.
- **PNG + `@2x` for Retina.** appdmg auto-packages `background.png` and `background@2x.png` into a
  multi-resolution TIFF. Finder *is* Retina-aware (unlike Squirrel's loading window), so it renders crisp.
- **One image per channel, not per theme.** Like the splash, the background is baked and doesn't follow
  Finder's light/dark mode. Crucially, **setting a background picture forces Finder to render the window in
  light mode**, so the icon captions are drawn in **black in both light and dark system themes** — not the
  white-on-dark you might expect in Dark mode. And the caption colour is Finder's alone: the DMG format has
  no label-colour field (the `icvp` icon-view plist appdmg/ds-store write exposes only icon size, positions,
  window size, and background), and appdmg can't ship separate dark/light backgrounds (only tools like
  DropDMG can). That black caption colour is why the surface is **light** (see *Design*) — the captions read
  on their own, with no per-label trick needed.

## Design

- **Light surface, reused verbatim from the in-app setup screen** (`apps/client/src/setup.css`, light
  theme): soft indigo/purple/blue radial glows over the near-white left-pane base (`#f2f2f2`). The light
  surface keeps Finder's forced-black captions legible on their own. The same gradient is used for both
  channels. The drag arrow is a muted neutral grey, kept quiet so it doesn't compete with the icons.
- **No wordmark banner.** The Finder title bar (volume name + icon) and the app icon already carry the
  brand, so a baked wordmark would just triplicate it — the surface stays clean with only the icons,
  arrow, and captions Finder draws.
- The icons sit directly on the surface (no tiles/plates), app on the left and `/Applications` alias on the
  right, with the drag arrow between them. Their **centers** must line up with the `contents` coordinates
  in `forge.config.ts`, which use a **top-left** origin, y increasing downward, with `(x, y)` the icon
  center — Finder's `.DS_Store` `Iloc` convention (confirmed by appdmg's own example, where `y: 344` sits
  near the *bottom* of the window). So the `contents` y is measured from the top, not `windowHeight - y`.
  `contents` uses **y = 182**, centering the icon + caption pair vertically now that no banner sits above
  them; Finder draws the captions at **~y = 262**.
- **Nightly badge.** The only baked text: a `Nightly` badge on the nightly background (`background-dev.png`),
  centered under the app icon just below where Finder draws the app caption (~y = 282). Stable ships no
  baked text at all, so there is no localized instruction line — the arrow conveys the action.

## Output contract

- 640 × 400 pt window; `background.png` is 640 × 400, `background@2x.png` is 1280 × 800.
- `iconSize` 128; app icon centered at (180, 182), Applications at (460, 182) in **top-left** coords —
  keep in sync with the `contents` in the maker config (and the nightly badge position in `background.html`).
