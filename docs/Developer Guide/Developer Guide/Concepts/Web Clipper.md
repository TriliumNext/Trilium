# Web Clipper
The Web Clipper is present in the monorepo in `apps/web-clipper`. It's based on [WXT](https://wxt.dev/guide/introduction.html), a framework for building web extensions that allows very easy development and publishing.

## Manifest version

Originally the Web Clipper supported only Manifest v2, which made the extension incompatible with Google Chrome. [#8494](https://github.com/TriliumNext/Trilium/pull/8494) introduces Manifest v3 support for Google Chrome, alongside with Manifest v2 for Firefox.

Although Firefox does support Manifest v3, we are still using Manifest v2 for it because WXT dev mode doesn't work for the Firefox / Manifest v3 combination and there were some mentions about Manifest v3 not being well supported on Firefox Mobile (and we plan to have support for it).

## Development

WXT allows easy development of the plugin, with full TypeScript support and live reload. To enter dev mode:

*   Run `pnpm --filter web-clipper dev` to enter dev mode for Chrome (with manifest v3).
*   Run `pnpm --filter web-clipper dev:firefox` to enter dev mode for Firefox (with manifest v2).

This will open a separate browser instance in which the extension is automatically injected.

> [!NOTE]
> On NixOS, the same development commands work just fine. Just make sure the browser is available in the system path:
> 
> ```sh
> nix-shell -p chromium
> ```

## Default port

The default port is:

*   `37742` if in development mode. This makes it possible to use `pnpm desktop:start` to spin up a desktop instance to use the Clipper with.
*   `37840` in production, the default Trilium port.

## Building

*   Run `build` (Chrome) or `build:firefox` to generate the output files, which will be in `.output/[browser]`.
*   Run `zip` or `zip:firefox` to generate the ZIP files.

## CI

`.github/workflows/web-clipper.yml` handles the building of the web clipper. Whenever the web clipper is modified, it generates the ZIPs and uploads them as artifacts.

There is currently no automatic publishing to the app stores.