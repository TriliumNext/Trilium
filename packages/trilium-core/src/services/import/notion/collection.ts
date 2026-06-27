/**
 * Notion database (collection) handling: turns a database's columns into Trilium attributes.
 *
 * A Notion database is a page whose rows are sibling `.html` files and whose columns are a schema shared by
 * every row. This module reads each row's property table ({@link extractProperties}), reconciles per-column
 * quirks ({@link reconcileDateColumns}), applies a row's own values to its note
 * ({@link applyOwnedProperties} / {@link applyRelationProperties}), and writes the shared schema as
 * inheritable promoted-attribute definitions on the container note ({@link applyDatabaseSchemas}). The
 * structure importer (importer.ts) owns page parsing and the note tree; it calls into here.
 */

import { dayjs } from "@triliumnext/commons";
import type { HTMLElement } from "node-html-parser";

import type BNote from "../../../becca/entities/bnote.js";
import { applyUrlScheme, attachmentReferenceLink, buildPromotedDefinition, saveFileAttachment, toAttributeName } from "../collection_utils.js";
import type { LinkTarget, NotionProperty, ParsedPage } from "./model.js";
import { getNotionId, stripNotionId } from "./notion_id.js";
import { baseName, internalPageId, ownedFolderKey, parentFolderKey, removeExtension, resolveResourcePath } from "./paths.js";

/**
 * Identifies which pages are Notion databases (collections) and ensures each has an empty container note.
 *
 * A Notion database always exports a `<Name> <id>.csv`; its rows are `.html` files in a sibling `<Name>/`
 * folder. Whether the database also has its own `<Name> <id>.html` page decides how its container is found:
 *  - With an own page (its `ownedFolderKey` matches the CSV's), that page's body is the rendered collection
 *    table, not real content — so flag it as a database and clear its body, since a collection note is empty.
 *  - Without one, nothing owns the rows' folder and they'd orphan to the import root — so synthesize an
 *    empty container page named after the database in its place.
 * Either way the database page ends up flagged `ParsedPage.isDatabase` and empty, ready to become a Trilium
 * collection, with its rows nested beneath it.
 */
export function resolveDatabaseContainers(pages: ParsedPage[], csvPaths: string[]) {
    const databaseKeys = new Set(csvPaths.map((csvPath) => ownedFolderKey(csvPath)));
    const owned = new Set(pages.map((page) => ownedFolderKey(page.path)));

    // A database with its own page: its body is the collection table, so drop it and flag the page.
    for (const page of pages) {
        if (databaseKeys.has(ownedFolderKey(page.path))) {
            page.isDatabase = true;
            page.content = "";
        }
    }

    // A database with no own page: synthesize an empty container so its rows don't orphan to the root.
    for (const csvPath of csvPaths) {
        const key = ownedFolderKey(csvPath);
        if (owned.has(key)) {
            continue;
        }
        owned.add(key);
        pages.push({
            id: getNotionId(baseName(csvPath)) ?? "",
            title: stripNotionId(removeExtension(baseName(csvPath))) || "Database",
            path: csvPath,
            content: "",
            linkedPageIds: [],
            properties: [],
            isDatabase: true
        });
    }
}

/**
 * Reads a page's database properties from its Notion properties table. Each column is a
 * `<tr class="property-row property-row-<type>">` whose `<th>` holds the column name (after an icon span,
 * which carries no text) and `<td>` the value. Handled so far:
 *  - `text` / `select` / `status` / `place`: the cell's text → one single-valued property;
 *  - `number`: the cell's text, normalized to a bare number → one single-valued `number` label;
 *  - `auto_increment_id`: a bare integer → a `number` label, a prefixed id (e.g. `TASK-1`) → a `text` label;
 *  - `multi_select`: each `<span class="selected-value">` option → one entry of a multi-valued property;
 *  - `url` / `email` / `phone_number`: the anchor's href → one single-valued url-typed property (email gets `mailto:`, phone `tel:`);
 *  - `date`: the `<time>` value → a `date`/`datetime` label; a range adds a separate `<name> end` column;
 *  - `checkbox`: `checkbox-on`/`checkbox-off` → a `true`/`false` boolean label;
 *  - `formula` / `rollup`: a computed value with no type signal, inferred from the rendered cell shape —
 *    checkbox → boolean, else numeric text → number, else text (a multi-value rollup collapses to one text value);
 *  - `person`: each `<span class="user">` name (its avatar stripped) → an entry of a multi-valued property;
 *  - `created_by` / `last_edited_by`: the single `<span class="user">` name → one single-valued text property;
 *  - `relation`: each linked page's `<a>` href → a multi-valued relation, resolved to a note in the second pass;
 *  - `file`: each `<a>` href → a `role:"file"` attachment on the note (no promoted definition — it's content).
 * Blank names/values are skipped (Notion sometimes emits an empty cell, e.g. an unset multi-select, which
 * should contribute no label). Timestamp rows (created/last-edited) are read separately by the importer.
 */
export function extractProperties(root: HTMLElement): NotionProperty[] {
    const properties: NotionProperty[] = [];
    for (const row of root.querySelectorAll("table.properties tr.property-row")) {
        const name = row.querySelector("th")?.textContent?.trim();
        const cell = row.querySelector("td");
        if (!name || !cell) {
            continue;
        }

        const type = row.getAttribute("class")?.match(/property-row-(\w+)/)?.[1];
        if (type === "text" || type === "select" || type === "status" || type === "place") {
            // `select`/`status`/`place` resolve to plain text: the cell text is the whole value (a status'
            // leading `<div class="status-dot">` carries no text), so they take the free-text single path.
            const value = cell.textContent?.trim();
            if (value) {
                properties.push({ name, value, labelType: "text", multiplicity: "single" });
            }
        } else if (type === "number") {
            const value = toNumberValue(cell.textContent);
            if (value !== undefined) {
                properties.push({ name, value, labelType: "number", multiplicity: "single" });
            }
        } else if (type === "auto_increment_id") {
            // Notion's ID is an integer counter, but a configured prefix turns it into an identifier like
            // "TASK-1"; keep a bare integer as a `number` label and a prefixed id verbatim as `text`.
            const value = cell.textContent?.trim();
            if (value) {
                const labelType = /^\d+$/.test(value) ? "number" : "text";
                properties.push({ name, value, labelType, multiplicity: "single" });
            }
        } else if (type === "multi_select") {
            for (const option of cell.querySelectorAll("span.selected-value")) {
                const value = option.textContent?.trim();
                if (value) {
                    properties.push({ name, value, labelType: "text", multiplicity: "multi" });
                }
            }
        } else if (type === "url" || type === "email" || type === "phone_number") {
            // All three render as `<a class="url-value">`; the href is the canonical value. Email/phone hrefs
            // are bare addresses, so give them a `mailto:`/`tel:` scheme to stay clickable as url labels.
            const href = cell.querySelector("a")?.getAttribute("href")?.trim();
            if (href) {
                properties.push({ name, value: toUrlValue(type, href), labelType: "url", multiplicity: "single" });
            }
        } else if (type === "date") {
            properties.push(...parseDateProperties(name, cell));
        } else if (type === "checkbox") {
            const property = toBooleanProperty(name, cell);
            if (property) {
                properties.push(property);
            }
        } else if (type === "formula" || type === "rollup") {
            properties.push(...extractComputedValue(name, cell));
        } else if (type === "person") {
            // A person column can list several users, so each name is its own multi-valued entry.
            for (const value of extractUserNames(cell)) {
                properties.push({ name, value, labelType: "text", multiplicity: "multi" });
            }
        } else if (type === "created_by" || type === "last_edited_by") {
            // Creator / last-editor metadata is rendered like a person cell but is always a single user.
            const [value] = extractUserNames(cell);
            if (value) {
                properties.push({ name, value, labelType: "text", multiplicity: "single" });
            }
        } else if (type === "relation") {
            // Each linked page is an `<a>` whose href carries the target's Notion id; the second pass resolves
            // it to a note and adds a `~relation` (targets outside the import are dropped there).
            for (const anchor of cell.querySelectorAll("a")) {
                const targetId = internalPageId(anchor.getAttribute("href"));
                if (targetId) {
                    properties.push({ name, value: targetId, multiplicity: "multi", kind: "relation" });
                }
            }
        } else if (type === "file") {
            // Each `<a>` href points at a bundled file; the first pass saves it as a `role:"file"` attachment.
            for (const anchor of cell.querySelectorAll("a")) {
                const href = anchor.getAttribute("href");
                if (href) {
                    properties.push({ name, value: href, multiplicity: "multi", kind: "file" });
                }
            }
        }
    }
    return properties;
}

/**
 * Normalizes a Notion number cell to a bare numeric string Trilium's `number` input accepts. Notion renders
 * the *formatted* value (e.g. `1,200`, `$12.00`, `12%`), so strip everything but digits, a decimal point and a
 * sign; the cleaned value is used only when it parses as a finite number, otherwise the trimmed original is
 * kept so an unexpectedly non-numeric cell still imports rather than vanishing. A blank cell yields nothing.
 */
function toNumberValue(text: string | null | undefined): string | undefined {
    const trimmed = text?.trim();
    if (!trimmed) {
        return undefined;
    }
    const normalized = trimmed.replace(/[^\d.-]/g, "");
    return normalized !== "" && Number.isFinite(Number(normalized)) ? normalized : trimmed;
}

/**
 * Reads the user names from a Notion people cell (`person`, `created_by`, `last_edited_by`). Each user is a
 * `<span class="user">` whose leading avatar (`.user-icon`, e.g. an initial) would otherwise bleed into the
 * name, so it's dropped first. Blank entries are skipped.
 */
function extractUserNames(cell: HTMLElement): string[] {
    const names: string[] = [];
    for (const user of cell.querySelectorAll("span.user")) {
        user.querySelector(".user-icon")?.remove();
        const name = user.textContent?.trim();
        if (name) {
            names.push(name);
        }
    }
    return names;
}

/** Reads a Notion checkbox cell (`<div class="checkbox checkbox-on|off">`) as a `true`/`false` boolean label. */
function toBooleanProperty(name: string, cell: HTMLElement): NotionProperty | undefined {
    const checkbox = cell.querySelector("div.checkbox");
    if (!checkbox) {
        return undefined;
    }
    const value = checkbox.classList.contains("checkbox-on") ? "true" : "false";
    return { name, value, labelType: "boolean", multiplicity: "single" };
}

/**
 * Reads a Notion computed column — a `formula` or a `rollup`. Neither carries a type signal on its row (the
 * class is always `property-row-formula`/`-rollup`), so the Trilium type is inferred from the cell's shape —
 * the only evidence the export gives. A boolean result renders as a checkbox widget (→ a `boolean` label);
 * every other result is plain text, which becomes a `number` label when it's purely numeric and a `text` label
 * otherwise. Notion renders a *date* result as plain text too (e.g. `June 24, 2026`, with no `<time>` wrapper,
 * unlike a native date column), so it lands in the text case — preserved verbatim, not typed as a Trilium
 * date. Every value is a snapshot: Trilium has no formula/rollup engine, so it reflects the export and won't
 * recompute. A multi-value rollup (e.g. "show original" over a multi-relation) collapses to a single text
 * value here, since the multi-value markup hasn't been sampled.
 */
function extractComputedValue(name: string, cell: HTMLElement): NotionProperty[] {
    const boolean = toBooleanProperty(name, cell);
    if (boolean) {
        return [boolean];
    }
    const text = cell.textContent?.trim();
    if (!text) {
        return [];
    }
    const number = numericFormulaValue(text);
    return [number !== undefined
        ? { name, value: number, labelType: "number", multiplicity: "single" }
        : { name, value: text, labelType: "text", multiplicity: "single" }];
}

/**
 * Returns a formula's text result as a bare number, or `undefined` when it isn't numeric. A real number has no
 * letters or date/time separators (so `June 24, 2026` and `06/24/2026` stay text); grouping separators and a
 * currency/percent symbol are stripped before the value is required to be a plain number.
 */
function numericFormulaValue(text: string): string | undefined {
    if (/[\p{L}\/:]/u.test(text)) {
        return undefined;
    }
    const core = text.replace(/[^\d.+-]/g, "");
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(core) ? core : undefined;
}

/** Gives an email/phone href a clickable scheme (`mailto:`/`tel:`); a plain url href is returned as-is. */
function toUrlValue(type: string, href: string): string {
    if (type === "email") {
        return applyUrlScheme(href, "mailto:");
    }
    if (type === "phone_number") {
        return applyUrlScheme(href, "tel:");
    }
    return href;
}

/**
 * Parses a Notion date column. The value is one `<time>`; a date range joins its start and end with an
 * arrow, which becomes two columns: the original (start) and a separate `<name> end` (end).
 */
function parseDateProperties(name: string, cell: HTMLElement): NotionProperty[] {
    const text = cell.querySelector("time")?.textContent;
    if (!text) {
        return [];
    }

    const [start, end] = text.split("→").map((part) => part.trim());
    return [toDateProperty(name, start), toDateProperty(`${name} end`, end)].filter((p): p is NotionProperty => p !== undefined);
}

/**
 * Turns one date string into a property. A clock time is present only when the column's "include time"
 * option is on, which selects a `datetime` label (local `YYYY-MM-DDTHH:mm`) over a plain `date`
 * (`YYYY-MM-DD`) — the formats the promoted date / datetime-local inputs round-trip. dayjs formats in local
 * time, matching the wall-clock of Notion's timezone-less string. (Mixed date/date-time columns are then
 * reconciled to a single type by {@link reconcileDateColumns}.)
 */
function toDateProperty(name: string, text: string | undefined): NotionProperty | undefined {
    if (!text) {
        return undefined;
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
        return undefined;
    }

    const hasTime = /\d{1,2}:\d{2}/.test(text);
    return hasTime
        ? { name, value: dayjs(date).format("YYYY-MM-DD[T]HH:mm"), labelType: "datetime", multiplicity: "single" }
        : { name, value: dayjs(date).format("YYYY-MM-DD"), labelType: "date", multiplicity: "single" };
}

/**
 * Notion's "include time" is toggled per date value, so one date column can mix dates and date-times. A
 * Trilium promoted attribute has a single type, so resolve each date column (scoped to its database, keyed
 * by sanitized name) to `datetime` if *any* of its values carries a time, then normalize every value to
 * that type — a time-less value in a datetime column gets midnight (`T00:00`) so it stays valid for the
 * `datetime-local` input. Mutates the parsed pages in place before notes (and their labels) are created.
 */
export function reconcileDateColumns(pages: ParsedPage[]) {
    const columnsWithTime = new Set<string>();
    for (const page of pages) {
        for (const property of page.properties) {
            if (property.labelType === "datetime") {
                columnsWithTime.add(dateColumnKey(page.path, property.name));
            }
        }
    }

    for (const page of pages) {
        for (const property of page.properties) {
            const isDateColumn = property.labelType === "date" || property.labelType === "datetime";
            if (isDateColumn && columnsWithTime.has(dateColumnKey(page.path, property.name))) {
                property.labelType = "datetime";
                if (!property.value.includes("T")) {
                    property.value = `${property.value}T00:00`;
                }
            }
        }
    }
}

/** Identifies a date column within its database: the row's container folder plus the sanitized column name. */
function dateColumnKey(path: string, name: string): string {
    // A space separates the parts unambiguously: a sanitized attribute name never contains a space, so the
    // text after the last space is always the column name and everything before it is the container folder.
    return `${parentFolderKey(path)} ${toAttributeName(name)}`;
}

/**
 * Applies a page's own property values to its note: file columns become `role:"file"` attachments, every
 * other (non-relation) column becomes a label. Relations are deferred to {@link applyRelationProperties},
 * which runs once every target note exists.
 *
 * Returns HTML to prepend to the note's body: one reference-link paragraph per bundled file, so a file
 * column's files are reachable from the row's content, not only from its attachments list. Empty when the
 * row attaches no bundled file.
 */
export function applyOwnedProperties(note: BNote, page: ParsedPage, resources: Map<string, Uint8Array>): string {
    const fileLinks: string[] = [];
    for (const property of page.properties) {
        if (property.kind === "file") {
            const attachment = saveFileColumn(note, property.value, page.path, resources);
            if (attachment?.attachmentId) {
                fileLinks.push(`<p>${attachmentReferenceLink(note.noteId, attachment.attachmentId, attachment.title)}</p>`);
            }
        } else if (property.kind !== "relation") {
            note.addLabel(toAttributeName(property.name), property.value);
        }
    }
    return fileLinks.join("");
}

/**
 * Adds a page's relation columns as Trilium relations, resolving each target's Notion id to its note via
 * `resolve` and dropping any target that wasn't part of this import.
 */
export function applyRelationProperties(note: BNote, page: ParsedPage, resolve: (notionId: string) => LinkTarget | null) {
    for (const property of page.properties) {
        if (property.kind === "relation") {
            const target = resolve(property.value);
            if (target) {
                note.addRelation(toAttributeName(property.name), target.noteId);
            }
        }
    }
}

/**
 * Saves a File-property reference as a `role:"file"` attachment on `note` and returns it (or `undefined` if
 * the file isn't bundled). `href` is the value of one `<a>` in the file cell; it's resolved against the zip
 * the same way page content is, so only files bundled in the export attach — an external link (or a missing
 * file) is silently skipped.
 */
function saveFileColumn(note: BNote, href: string, pagePath: string, resources: Map<string, Uint8Array>) {
    const resourcePath = resolveResourcePath(pagePath, href);
    const bytes = resources.get(resourcePath);
    if (!bytes) {
        return undefined;
    }
    return saveFileAttachment(note, baseName(resourcePath), bytes);
}

/**
 * A Notion database's columns are a schema shared by every row, so each column becomes a single
 * *inheritable* promoted-attribute definition on the row's container note (the database) — not a copy on
 * each row. Rows carry only the values (added by {@link applyOwnedProperties}) and inherit the definition,
 * so a row with no value shows the field empty, mirroring how a Notion property added from any row appears
 * on all of them.
 *
 * A row's container is its parent note, looked up by the same folder key that drives parenting. Each
 * container's schema is the union of its rows' property columns — a column present on only one row still
 * defines the field for the whole database — keeping the first occurrence's type/multiplicity, and emitted
 * in the database's CSV column order ({@link orderColumns}).
 */
export function applyDatabaseSchemas(pages: ParsedPage[], noteByFolder: Map<string, BNote>, csvColumnsByFolder: Map<string, string[]>) {
    const schemaByFolder = new Map<string, Map<string, NotionProperty>>();

    for (const page of pages) {
        const folderKey = parentFolderKey(page.path);
        if (!noteByFolder.has(folderKey) || page.properties.length === 0) {
            continue;
        }

        let schema = schemaByFolder.get(folderKey);
        if (!schema) {
            schema = new Map();
            schemaByFolder.set(folderKey, schema);
        }
        for (const property of page.properties) {
            if (property.kind === "file") {
                continue; // files become attachments, not promoted definitions
            }
            const labelName = toAttributeName(property.name);
            if (!schema.has(labelName)) {
                schema.set(labelName, property);
            }
        }
    }

    for (const [folderKey, schema] of schemaByFolder) {
        const container = noteByFolder.get(folderKey);
        /* v8 ignore next 3 -- every folderKey here passed the noteByFolder.has guard above */
        if (!container) {
            continue;
        }
        // Assign an increasing position so the columns keep the CSV order in the promoted-attributes UI:
        // it sorts definitions by position, and equal positions don't sort deterministically.
        let position = 0;
        for (const property of orderColumns([...schema.values()], csvColumnsByFolder.get(folderKey))) {
            position += 10;
            // A definition is always a label, but its name is `relation:<x>` for a relation column, `label:<x>` otherwise.
            const definitionName = `${property.kind === "relation" ? "relation" : "label"}:${toAttributeName(property.name)}`;
            container.addAttribute("label", definitionName, buildPromotedDefinition({ alias: property.name, labelType: property.labelType, multiplicity: property.multiplicity }), true, position);
        }
    }
}

/**
 * Orders a database's columns by the CSV export's column order (the authoritative Notion order, including
 * columns empty on every row). Columns absent from the CSV keep their discovery order at the end; a
 * synthesized `<name> end` column (from a date range) is slotted right after its base column.
 */
function orderColumns(properties: NotionProperty[], csvColumns: string[] | undefined): NotionProperty[] {
    if (!csvColumns) {
        return properties;
    }

    const indexByColumn = new Map(csvColumns.map((name, index) => [name, index] as const));
    const sortKey = (property: NotionProperty): [number, number] => {
        const own = indexByColumn.get(toAttributeName(property.name));
        if (own !== undefined) {
            return [own, 0];
        }
        // A synthesized "<name> end" column isn't in the CSV; place it just after its base column.
        if (property.name.endsWith(" end")) {
            const base = indexByColumn.get(toAttributeName(property.name.slice(0, -" end".length)));
            if (base !== undefined) {
                return [base, 1];
            }
        }
        return [Number.MAX_SAFE_INTEGER, 0];
    };

    return properties
        .map((property, index) => ({ property, index, key: sortKey(property) }))
        .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.index - b.index)
        .map((entry) => entry.property);
}

