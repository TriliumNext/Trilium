# Compression libraries
The repository ships **three** independent ZIP implementations. This looks like an obvious consolidation target and is not one — each is anchored by a constraint the others cannot satisfy. This page exists so the analysis is not repeated.

| Library | Declared by | Used for |
| --- | --- | --- |
| `jszip` | `packages/commons` | The XLSX container, via `exceljs`; also `renderSpreadsheetToCsvZip` |
| `fflate` | `apps/standalone` | The browser note `ZipProvider` (`lightweight/zip_provider.ts`) |
| `archiver` + `yauzl` | `apps/server` | The Node `ZipProvider` used by server and desktop |

## jszip cannot be removed

`exceljs` — commons' XLSX read/write engine and a genuine runtime dependency — hard-depends on jszip for the XLSX zip container. `pnpm why jszip` resolves it as `jszip → exceljs → @triliumnext/commons`. Any bundle that reads or writes spreadsheets pulls jszip in regardless of what else changes.

`commons/src/lib/spreadsheet/render_to_csv.ts` also uses jszip directly. Switching that one call site to fflate does **not** remove jszip (exceljs still drags it in) and is mildly counterproductive: it would add fflate to the server bundle, where jszip is already present, in a feature that has therefore already paid for jszip.

## fflate is not interchangeable with it either

fflate is the deliberate lighter choice for the browser: roughly 30 KB against jszip's ~95 KB, in a bundle where that matters, with custom CP437 filename handling for the standalone note ZipProvider. Replacing it with jszip would grow the standalone bundle to remove a dependency that cannot be removed anyway.

## A trap if jszip is ever dropped

`packages/commons` is intentionally **browser-pure** — its library `tsconfig` does not include `@types/node`; only the spec `tsconfig` does. jszip's `index.d.ts` carries a `/// <reference types="node" />`, which has been silently supplying the `Buffer` global type to `parse_from_xlsx.ts`.

If jszip ever does leave commons, `bytesToBase64`'s reference to `Buffer` breaks. The fix is to reach it through `globalThis` rather than re-adding `@types/node`, which would undo the browser-purity constraint.