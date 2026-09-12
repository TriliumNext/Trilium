# reveal.js themes (vendored)

Theme sources for the presentation collection view, vendored from
[reveal.js](https://github.com/hakimel/reveal.js) **6.0.1** (`css/theme/`), MIT licensed — see
`LICENSE`.

Not yet wired up: `../themes.ts` still imports the prebuilt `reveal.js/theme/*.css?raw`.

## Why these are vendored

The prebuilt themes ship their fonts inline. Upstream builds them with Vite in library mode, where
`build.assetsInlineLimit` is ignored and every asset becomes a base64 `data:` URI, so `black.css`
and `white.css` are 564 KB each — 427 KB of that is four Source Sans Pro `.woff` faces. The themes
that use Google Fonts instead keep an `@import url('https://fonts.googleapis.com/…')` at the top of
the built CSS, which fetches at render time. Six of the ten themes the picker offers do that, and
Trilium runs offline.

Compiled from these sources, a theme is about 5 KB (1.4 KB gzipped).

## What changed from upstream

Two things, both about fonts.

Every `@import url(…)` that pulled in a font is deleted — one or two lines per theme. That covers
the local `.woff` sheets Vite inlined and the Google Fonts URLs.

Each remaining stack then gained a real fallback. A theme still names its own family first, which
costs nothing and applies where the reader happens to have it installed, but behind it now sits a
system stack from `template/_system-fonts.scss` rather than a bare `sans-serif`. So `black` reads
in the platform UI face instead of Helvetica, and `simple` and `night` headings land on Impact
rather than on whatever the browser picks for a generic sans.

`serif.scss` and `dracula.scss` are untouched and byte-identical to upstream: both were already on
system stacks.

## Re-syncing after a reveal.js upgrade

Diff `node_modules/reveal.js/css/theme` against this directory. Every hunk should be a deleted
`@import url(…)` from the list below, a `$main-font` / `$heading-font` value carrying a
`#{fonts.$…}` stack, or the `@use 'template/system-fonts' as fonts;` line those need. Anything else
is a real upstream change to carry over.

```
@import url('./fonts/source-sans-pro/source-sans-pro.css');          black, black-contrast, white, white-contrast
@import url('./fonts/league-gothic/league-gothic.css');              beige, league, moon, solarized
@import url('https://fonts.googleapis.com/css?family=Lato:…');       beige, league, moon, solarized, simple
@import url('https://fonts.googleapis.com/css?family=Ubuntu:…');     blood
@import url('https://fonts.googleapis.com/css?family=Quicksand:…');  sky
@import url('https://fonts.googleapis.com/css?family=Open+Sans:…');  night, sky
@import url('https://fonts.googleapis.com/css?family=Montserrat:…'); night
@import url('https://fonts.googleapis.com/css?family=News+Cycle:…'); simple
```

## Layout

`template/settings.scss` declares the variables a theme overrides, `template/theme.scss` emits the
rules from them, and `template/mixins.scss` holds `light-bg-text-color`. A theme file is 40 to 90
lines: a `@use 'template/settings' with (…)` block of overrides, then `@use 'template/theme'`.

`template/_system-fonts.scss` is the one file here upstream does not have. It holds `$sans` and
`$condensed`, and nine themes plus `settings.scss` read their fallbacks from it.

`black-contrast` and `white-contrast` are the higher-contrast variants of `black` and `white`,
differing from them only in a pure black background and pure black text on light slides. All
fourteen are in the picker; `themes.ts` lists them and `BUILTIN_ATTRIBUTES` repeats the ids for
`presentation:theme`, with a spec holding the two in step.
