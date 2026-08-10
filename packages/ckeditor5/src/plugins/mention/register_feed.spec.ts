import { type ClassicEditor, Essentials, Paragraph } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { registerMentionFeed } from "./register_feed.js";
import type { TriliumMentionFeed } from "./types.js";

describe("registerMentionFeed", () => {
    let editor: ClassicEditor;

    function feeds() {
        return (editor.config.get("mention.feeds") ?? []) as TriliumMentionFeed[];
    }

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph ]);
    });

    it("creates mention.feeds when nothing configured it, then appends to it", () => {
        expect(editor.config.get("mention.feeds")).toBeUndefined();

        registerMentionFeed(editor, { marker: ":", feed: [] });
        registerMentionFeed(editor, { marker: "/", feed: [] });

        expect(feeds().map((feed) => feed.marker)).toEqual([ ":", "/" ]);
    });

    it("preserves feeds the host application configured", async () => {
        editor = await createTestEditor([ Essentials, Paragraph ], {
            mention: { feeds: [ { marker: "@", feed: [] } ] }
        });

        registerMentionFeed(editor, { marker: ":", feed: [] });

        expect(feeds().map((feed) => feed.marker)).toEqual([ "@", ":" ]);
    });

    it("refuses to register a marker twice, since the second feed would be unreachable", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        registerMentionFeed(editor, { marker: ":", feed: [ "first" ] });
        registerMentionFeed(editor, { marker: ":", feed: [ "second" ] });

        expect(feeds()).toHaveLength(1);
        expect(feeds()[0].feed).toEqual([ "first" ]);
        expect(warn).toHaveBeenCalledOnce();
    });
});
