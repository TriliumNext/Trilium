import { Essentials, Paragraph } from "ckeditor5";
import { describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { registerHostedMentionFeed } from "./register_feed.js";

describe("registerHostedMentionFeed", () => {
    const list = () => ({ show() {}, hide() {}, handleKeyDown: () => false, element: null });

    it("creates mention.hostedFeeds when nothing configured it, then appends to it", async () => {
        const editor = await createTestEditor([ Essentials, Paragraph ]);
        expect(editor.config.get("mention.hostedFeeds")).toBeUndefined();

        registerHostedMentionFeed(editor, { marker: ":", list });
        registerHostedMentionFeed(editor, { marker: "/", list });

        expect(editor.config.get("mention.hostedFeeds")?.map((feed) => feed.marker)).toEqual([ ":", "/" ]);
    });

    it("keeps the feeds the host configured, and refuses a marker one of them holds", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const editor = await createTestEditor([ Essentials, Paragraph ], {
            mention: { hostedFeeds: [ { marker: "#", list } ] }
        });

        registerHostedMentionFeed(editor, { marker: "/", list });
        registerHostedMentionFeed(editor, { marker: "#", list });

        expect(editor.config.get("mention.hostedFeeds")?.map((feed) => feed.marker)).toEqual([ "#", "/" ]);
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });
});
