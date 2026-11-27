import { beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../../../becca/becca.js";
import BAttribute from "../../../becca/entities/battribute.js";
import { buildNote } from "../../../test/becca_easy_mocking.js";
import { getScriptBundle } from "../../script.js";
import ws from "../../ws.js";
import {
    collectChannel,
    diffAttributes,
    findScriptChannels,
    formatReviewText,
    getBackendBundle,
    getFrontendBundle,
    getScriptChannel,
    markControlCharacters
} from "./script_channels.js";

vi.mock("../../sql.js", () => ({
    default: { transactional: (cb: () => unknown) => cb(), execute: () => {}, replace: () => {} }
}));

const BACKEND = "application/javascript;env=backend";
const FRONTEND = "application/javascript;env=frontend";

beforeEach(() => {
    becca.reset();
    vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});
    buildNote({
        id: "root",
        title: "root",
        children: [
            {
                id: "channel", title: "Pager", type: "code", mime: BACKEND,
                content: "return api.channelSettings.topic;",
                "#notificationChannel": "", "#topic": "alerts", "~configWidget": "widget",
                children: [ { id: "helper", title: "helper", type: "code", mime: BACKEND,
                    content: "module.exports = 1;" } ]
            },
            { id: "widget", title: "Widget", type: "code", mime: FRONTEND,
                content: "return null;" },
            {
                id: "parent", title: "Parent", "#color": "",
                children: [ { id: "inherits", title: "Inherits", type: "code", mime: BACKEND,
                    content: "return 1;" } ]
            },
            { id: "template", title: "Template", "#notificationChannel": "" },
            { id: "templated", title: "Templated", type: "code", mime: BACKEND,
                content: "return 1;", "~template": "template" },
            { id: "disabled", title: "Disabled", type: "code", mime: BACKEND, content: "return 1;",
                "#disabled:notificationChannel": "" },
            { id: "textNote", title: "Text", content: "<p>hi</p>", "#notificationChannel": "" }
        ]
    });
    new BAttribute({
        attributeId: "inheritedLabel", noteId: "parent", type: "label", name: "notificationChannel",
        value: "", isInheritable: true
    });
});

function collect(noteId: string) {
    const channel = getScriptChannel(noteId);
    const collected = channel ? collectChannel(channel) : null;
    if (!collected) {
        throw new Error(`No channel ${noteId}.`);
    }
    return collected;
}

describe("script channels", () => {
    it("finds a script note that owns the label, and none that inherits it", () => {
        expect(findScriptChannels().map(({ channelId, runsOn }) => [ channelId, runsOn ]))
            .toEqual([ [ "channel", "backend" ] ]);
        expect(getScriptChannel("inherits")).toBeNull();
        expect(getScriptChannel("templated")).toBeNull();
        expect(getScriptChannel("disabled")).toBeNull();
        expect(getScriptChannel("textNote")).toBeNull();
    });

    it("changes its revision with a renamed child or an owned label, not an inherited one", () => {
        const first = collect("channel");
        expect(first.record.configWidget?.noteId).toBe("widget");

        new BAttribute({
            attributeId: "parentLabel", noteId: "root", type: "label", name: "topic",
            value: "elsewhere", isInheritable: true
        });
        expect(collect("channel").revision).toBe(first.revision);

        becca.getNoteOrThrow("helper").title = "renamed";
        const renamed = collect("channel");
        expect(renamed.revision).not.toBe(first.revision);
        expect(renamed.restRevision).not.toBe(first.restRevision);

        new BAttribute({ attributeId: "iconLabel", noteId: "channel", type: "label",
            name: "iconClass", value: "bx bx-bell" });
        const withIcon = collect("channel");
        expect(withIcon.revision).not.toBe(renamed.revision);
        expect(withIcon.restRevision).toBe(renamed.restRevision);
        expect(diffAttributes(renamed.ownedAttributes, withIcon.ownedAttributes)).toEqual([
            { change: "added", type: "label", name: "iconClass", value: "bx bx-bell" }
        ]);
    });

    it("builds the bundles of a run from the record, as other scripts are built", () => {
        const collected = collect("channel");
        expect(getBackendBundle(collected).script)
            .toBe(getScriptBundle(becca.getNoteOrThrow("channel"), true, "backend")?.script);
        expect(getFrontendBundle(collected, "configWidget")).toMatchObject({
            noteId: "widget", allNoteIds: [ "widget" ]
        });
        expect(getFrontendBundle(collected, "configWidget")?.script).toContain("return null;");
    });

    it("writes the record as text, invisible and bidi characters as code points", () => {
        becca.getNoteOrThrow("helper").title = `help\u{202E}er`;
        const text = formatReviewText(collect("channel").record);
        expect(text).toContain("Note channel \"Pager\", code, application/javascript;env=backend");
        expect(text).toContain("#topic=\"alerts\"");
        expect(text).toContain("~configWidget=\"widget\"");
        expect(text).toContain("return api.channelSettings.topic;");
        expect(text).toContain("=== ~configWidget ===");
        expect(text).toContain("help[U+202E]er");
        expect(markControlCharacters("a\u{200B}b\nc\td\u{E0041}"))
            .toBe("a[U+200B]b\nc\td[U+E0041]");
    });

    it("lists the owned attributes that changed, were added or removed", () => {
        expect(diffAttributes([
            { type: "label", name: "topic", value: "a", isInheritable: false },
            { type: "label", name: "old", value: "x", isInheritable: false }
        ], [
            { type: "label", name: "topic", value: "b\u{202E}", isInheritable: false },
            { type: "relation", name: "configWidget", value: "w", isInheritable: false }
        ])).toEqual([
            { change: "changed", type: "label", name: "topic", value: "b[U+202E]",
                previousValue: "a" },
            { change: "added", type: "relation", name: "configWidget", value: "w" },
            { change: "removed", type: "label", name: "old", previousValue: "x" }
        ]);
    });
});
