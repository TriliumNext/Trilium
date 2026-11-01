---
name: in-app-help
description: Use when touching Trilium's in-app help (the `_help` subtree) — regenerating it after a docs change, changing how pages, links, images or attachments are produced or served, wiring a new platform to it, or debugging "help page is blank / images are broken / search finds nothing". Covers the markdown-to-artifacts pipeline, the four packaging paths that each need their own asset copy, and the verification recipe that catches the failures status codes hide.
---

# Trilium's in-app help

The User Guide is authored as notes, exported **once** as markdown, and turned into two committed artifacts that every platform reads.

```
docs/User Guide/**.md          authored source, exported by edit-docs (the only export)
  └─ edit-docs
       ├─ apps/server/src/assets/help/help_meta.json     the note tree
       └─ apps/server/src/assets/help/help_content.json  each page rendered, keyed by note ID
docs/User Guide/**.png|gif|dat images and attachments, committed only here
```

Both JSON files are **generated**. Never hand-edit them — run `pnpm edit-docs:edit-docs` and let the export rewrite them. If you need to regenerate without the Electron app (e.g. after changing a generator), call `buildHelpMeta` / `buildHelpBundle` directly against `docs/User Guide/!!!meta.json`; they are pure functions taking injected readers.

Help pages are **virtual notes** — becca-only, never persisted or synced, read-only through an inheritable `readOnly` label on the `_help` root. See `packages/trilium-core/src/services/virtual_notes.ts`.

## The pieces

| Concern | Where |
|---|---|
| Tree generation | `apps/edit-docs/src/help_meta_generator.ts` |
| Content generation, link + asset rewriting | `apps/edit-docs/src/help_bundle_generator.ts` |
| Injection into becca | `packages/trilium-core/src/becca/becca_loader.ts` |
| Provider contract, `{{helpAssets}}` substitution | `packages/trilium-core/src/services/in_app_help.ts` |
| Blob POJO for virtual notes | `packages/trilium-core/src/services/blob.ts` |
| Content search over virtual notes | `.../search/expressions/note_content_fulltext.ts` |
| Assistant search | `packages/trilium-core/src/services/llm/tools/help_tools.ts` |
| End-to-end guard | `apps/server/spec/in_app_help.spec.ts` |

`HelpMetaItem.source` is the page's markdown file; `dir` is set for folder notes, which have no file and are linked by directory. Links become `#root/_help_<noteId>`; assets become `{{helpAssets}}/<path from the export root>`, substituted per platform by `getHelpAssetBase()`.

## Assets need a copy step per packaging path

Images live **only** in `docs/User Guide/`. Four paths ship them, and missing one breaks only that one:

- **server** — `getHelpAssetDir()` in `routes/assets.ts` (reads `docs/User Guide` when `isDev`); `apps/server/scripts/build.ts` copies for the package
- **desktop** — runs the server, but its build copies `apps/server/src/assets`, which is *not* where these live, so `apps/desktop/scripts/build.ts` needs its own copy
- **standalone** — `copyHelpAssetsPlugin` in `apps/standalone/vite.config.mts`, which must have **both** a `configureServer` middleware (dev) and a `closeBundle` copy (build)
- **mobile** — inherits the standalone dist via `webDir`; every megabyte here lands in the APK/IPA

## A 200 does not mean it works

Both dev servers answer unknown paths under their asset prefixes with `index.html`. A missing route returns **200 `text/html`**, so `curl -w "%{http_code}"` and any status-only assertion pass while every image is broken. This has bitten twice.

Always check the content type:

```bash
curl -s -D - -o /dev/null "http://localhost:8080/assets/v<version>/help/<path>" | grep -i content-type
```

Sweep every asset the bundle references — `<port>` is 8080 for `server:start`, 5173 for `standalone:start`:

```bash
node -e "const b=require('./apps/server/src/assets/help/help_content.json');
  const u=[...new Set([...Object.values(b).join('').matchAll(/\{\{helpAssets\}\}\/([^\"]*)/g)].map(m=>m[1]))];
  require('fs').writeFileSync(process.env.TEMP+'/asseturls.txt', u.join('\n')); console.log(u.length)"

while IFS= read -r u; do
  ct=$(curl -s -D - -o /dev/null "http://localhost:8080/assets/v0.104.1/help/$u" | grep -i "^content-type" | tr -d '\r')
  case "$ct" in *image/*|*octet-stream*) ;; *) echo "BAD $ct <- $u";; esac
done < "$TEMP/asseturls.txt"
```

For a build, resolve the same URLs against the output tree instead:

```bash
node -e "const fs=require('fs'),p=require('path');
  const b=require('./apps/server/src/assets/help/help_content.json');
  const u=[...new Set([...Object.values(b).join('').matchAll(/\{\{helpAssets\}\}\/([^\"]*)/g)].map(m=>m[1]))];
  const root='apps/standalone/dist/server-assets/help';
  console.log('missing:', u.filter(x=>!fs.existsSync(p.join(root, decodeURIComponent(x)))).length)"
```

Getting the copy *destination depth* wrong is easy and silent: the export root `docs/User Guide` itself contains a `User Guide/` directory, and asset paths are relative to that root — so the copy target is `…/help`, not `…/help/User Guide`.

## Debugging a broken help page

- **Blank page, no error** — the provider has no content: standalone's fetch failed (check the worker console) or `getHelpContent()` returned `{}`
- **Error instead of a page** — the blob path: virtual notes have no `blobs` row, so `getBlobPojo` must take its virtual branch
- **Broken images** — a copy step or a dev middleware is missing; run the sweep above rather than trusting a status code
- **Dead cross-links** — links that didn't resolve stay as authored `.md` paths; the client spec `apps/client/src/services/in_app_help.spec.ts` checks every link in the markdown
- **Search finds nothing** — two separate paths: the user-facing search matches virtual notes only via the pass in `note_content_fulltext.ts`, and only when the query includes hidden notes; the assistant's `search_help` builds its own index from `note.getContent()`

## Tests to run

```bash
pnpm --filter edit-docs test --run                       # generators
pnpm --filter server test --run spec/in_app_help.spec.ts # shipped artifacts, end to end
pnpm --filter client test --run src/services/in_app_help.spec.ts
pnpm --filter standalone test --run src/lightweight/in_app_help_provider.spec.ts
```
