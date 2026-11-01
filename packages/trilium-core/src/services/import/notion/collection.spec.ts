import { parse } from "node-html-parser";
import { describe, expect, it } from "vitest";

import { getContext } from "../../context.js";
import noteService from "../../notes.js";
import { applyDatabaseSchemas, extractProperties } from "./collection.js";
import type { NotionProperty, ParsedPage } from "./model.js";

/** One `<tr class="property-row property-row-<type>">`; the `<th>` opens with the icon span Notion emits. */
const row = (type: string, name: string, cell: string) =>
    `<tr class="property-row property-row-${type}"><th><span class="icon"></span>${name}</th>${cell}</tr>`;

/** Reads the given property rows out of the properties table Notion renders on a database row's page. */
const propertiesOf = (...rows: string[]) =>
    extractProperties(parse(`<div><table class="properties"><tbody>${rows.join("")}</tbody></table></div>`));

describe("extractProperties", () => {
    it("skips a row with a blank column name or no value cell", () => {
        expect(propertiesOf(
            `<tr class="property-row property-row-text"><th> </th><td>Value</td></tr>`,
            `<tr class="property-row property-row-text"><th>Name</th></tr>`
        )).toEqual([]);
    });

    it("contributes nothing for a blank or unusable cell, whatever the column type", () => {
        // Notion emits an empty cell for every unset value, and a formula/relation/file cell can hold markup
        // that carries no importable value at all (an external link, an href-less anchor, an avatar-only user).
        expect(propertiesOf(
            row("number", "Number", "<td>   </td>"),
            row("auto_increment_id", "ID", "<td></td>"),
            row("multi_select", "Tags", `<td><span class="selected-value"> </span></td>`),
            row("url", "URL", `<td><a class="url-value">no href</a></td>`),
            row("checkbox", "Done", "<td>not a checkbox</td>"),
            row("created_by", "Created by", `<td><span class="user"><span class="user-icon">A</span></span></td>`),
            row("relation", "Related", `<td><a href="https://example.com/">External</a></td>`),
            row("file", "Files", "<td><a>no href</a></td>"),
            row("date", "Due", "<td>June 1, 2026</td>"),
            row("formula", "Computed", "<td>   </td>")
        )).toEqual([]);
    });

    it("types a url/email/phone cell from its anchor's href, stripping an email/phone scheme", () => {
        expect(propertiesOf(
            row("url", "Site", `<td><a class="url-value" href="https://triliumnotes.org">Site</a></td>`),
            row("email", "Email", `<td><a class="url-value" href="mailto:contact@acme.com">Email</a></td>`),
            row("phone_number", "Phone", `<td><a class="url-value" href="12345">Phone</a></td>`)
        )).toEqual([
            { name: "Site", value: "https://triliumnotes.org", labelType: "url", multiplicity: "single" },
            // The typed email/phone inputs hold the bare address, so a scheme on the href is dropped
            // and a bare href is kept as it is.
            { name: "Email", value: "contact@acme.com", labelType: "email", multiplicity: "single" },
            { name: "Phone", value: "12345", labelType: "phone", multiplicity: "single" }
        ]);
    });

    it("normalizes a formatted number cell and keeps a non-numeric one verbatim", () => {
        expect(propertiesOf(
            row("number", "Price", "<td>$1,200.50</td>"),
            row("number", "Range", "<td>1-2</td>"),
            row("number", "Missing", "<td>n/a</td>")
        )).toEqual([
            { name: "Price", value: "1200.50", labelType: "number", multiplicity: "single" },
            // Neither cleans up to a finite number, so the trimmed original is kept rather than dropped.
            { name: "Range", value: "1-2", labelType: "number", multiplicity: "single" },
            { name: "Missing", value: "n/a", labelType: "number", multiplicity: "single" }
        ]);
    });

    it("types a computed (formula / rollup) cell from its rendered shape", () => {
        expect(propertiesOf(
            row("formula", "Flag", `<td><div class="checkbox checkbox-on"></div></td>`),
            row("rollup", "Total", "<td>42</td>"),
            row("formula", "Version", "<td>1-2-3</td>"),
            row("formula", "When", "<td>June 24, 2026</td>")
        )).toEqual([
            { name: "Flag", value: "true", labelType: "boolean", multiplicity: "single" },
            { name: "Total", value: "42", labelType: "number", multiplicity: "single" },
            // Neither a version string nor a rendered date is a number, so both stay text.
            { name: "Version", value: "1-2-3", labelType: "text", multiplicity: "single" },
            { name: "When", value: "June 24, 2026", labelType: "text", multiplicity: "single" }
        ]);
    });

    it("drops a date cell whose <time> value can't be parsed", () => {
        expect(propertiesOf(row("date", "Start", "<td><time>whenever</time></td>"))).toEqual([]);
    });

    it("reads each user of a people cell, dropping one whose name is only an avatar", () => {
        const cell = `<td><span class="user"><span class="user-icon">E</span>Elian</span><span class="user"><span class="user-icon">A</span></span></td>`;
        expect(propertiesOf(row("person", "Assignee", cell))).toEqual([
            { name: "Assignee", value: "Elian", labelType: "text", multiplicity: "multi" }
        ]);
    });
});

describe("applyDatabaseSchemas — column order", () => {
    const property = (name: string): NotionProperty => ({ name, value: "x", labelType: "text", multiplicity: "single" });

    /** Applies one database folder's schema to a fresh container note and returns its definitions, in position order. */
    function definitionNames(properties: NotionProperty[], csvColumns?: string[]): string[] {
        return getContext().init(() => {
            const { note: container } = noteService.createNewNote({ parentNoteId: "root", title: "DB", content: "", type: "book", mime: "" });
            const page: ParsedPage = { id: "row", title: "Row", path: "DB/Row.html", content: "", linkedPageIds: [], properties };
            applyDatabaseSchemas([page], new Map([["DB", container]]), csvColumns ? new Map([["DB", csvColumns]]) : new Map());
            return [...container.getOwnedAttributes()]
                .sort((a, b) => a.position - b.position)
                .map((attribute) => attribute.name);
        });
    }

    it("follows the CSV column order, slotting a synthesized \"<name> end\" after its base column", () => {
        expect(definitionNames(
            [property("Extra"), property("Due end"), property("Status"), property("Also extra"), property("Due"), property("Ghost end")],
            ["status", "due"]
        )).toEqual([
            "label:status",
            "label:due",
            "label:dueEnd",
            // Columns the CSV doesn't list (including a "<name> end" whose base is missing too) keep their
            // discovery order at the end.
            "label:extra",
            "label:alsoExtra",
            "label:ghostEnd"
        ]);
    });

    it("keeps the discovery order when the database has no CSV column list", () => {
        expect(definitionNames([property("Second"), property("First")])).toEqual(["label:second", "label:first"]);
    });
});
