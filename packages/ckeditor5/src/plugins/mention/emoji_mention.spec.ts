import {
    type ClassicEditor,
    EmojiPicker,
    EmojiRepository,
    Essentials,
    _getModelData as getModelData,
    keyCodes,
    MentionEditing,
    type MentionFeedObjectItem,
    Paragraph,
    _setModelData as setModelData
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TriliumEmojiMention from "./emoji_mention.js";
import TriliumMentionUI from "./trilium_mention_ui.js";
import type { TriliumMentionFeed } from "./types.js";

/** Longer than the mention UI's 100 ms feed debounce. */
const AFTER_DEBOUNCE = 160;

/**
 * A stand-in for the CDN emoji database, in the shape `EmojiRepository` parses. Kept to a handful of
 * entries so the spec exercises our glue rather than the 400 kB production definitions.
 */
const DEFINITIONS = [
    { annotation: "grinning face", emoji: "😀", group: 0, order: 1, version: 1, shortcodes: [ "grinning" ] },
    { annotation: "grinning face with big eyes", emoji: "😃", group: 0, order: 2, version: 1, shortcodes: [ "smiley" ] },
    { annotation: "waving hand", emoji: "👋", group: 1, order: 3, version: 1, shortcodes: [ "wave" ],
        skins: [ { emoji: "👋🏽", tone: 3, version: 1 } ] }
];

describe("TriliumEmojiMention", () => {
    let editor: ClassicEditor;
    let definitionsUrl: string;

    async function createEditor(withPicker = false, emojiConfig: Record<string, unknown> = {}) {
        const plugins = [ Essentials, Paragraph, MentionEditing, TriliumMentionUI, TriliumEmojiMention ];

        editor = await createTestEditor(withPicker ? [ ...plugins, EmojiPicker ] : plugins, {
            // `definitionsUrl` must survive every override, or the repository silently falls back to
            // the real CDN and the spec starts asserting against the production emoji database.
            emoji: { ...emojiConfig, definitionsUrl }
        });

        await editor.plugins.get(EmojiRepository).isReady();
        setModelData(editor.model, "<paragraph>[]</paragraph>");
    }

    /** The `:` feed the plugin registered, as the mention UI sees it. */
    function emojiFeed(): TriliumMentionFeed {
        const feeds = (editor.config.get("mention.feeds") ?? []) as TriliumMentionFeed[];
        const feed = feeds.find((candidate) => candidate.marker === ":");

        if (!feed) {
            throw new Error("the plugin did not register a `:` feed");
        }

        return feed;
    }

    async function query(text: string): Promise<MentionFeedObjectItem[]> {
        const feed = emojiFeed().feed;

        if (typeof feed !== "function") {
            throw new Error("the `:` feed should be a callback");
        }

        return await feed.call(editor, text) as MentionFeedObjectItem[];
    }

    function type(text: string) {
        editor.model.change((writer) => {
            editor.model.insertContent(writer.createText(text), editor.model.document.selection.getFirstPosition());
        });
    }

    function pressKey(keyCode: number) {
        editor.editing.view.document.fire("keydown", {
            keyCode,
            preventDefault: () => {},
            stopPropagation: () => {},
            domTarget: editor.editing.view.getDomRoot()
        });
    }

    async function settle() {
        await new Promise((resolve) => setTimeout(resolve, AFTER_DEBOUNCE));
    }

    beforeEach(async () => {
        definitionsUrl = URL.createObjectURL(new Blob([ JSON.stringify(DEFINITIONS) ], { type: "application/json" }));
        await createEditor();
    });

    afterEach(() => {
        URL.revokeObjectURL(definitionsUrl);
    });

    it("registers itself and a `:` feed that needs two characters before opening", () => {
        expect(TriliumEmojiMention.pluginName).toBe("TriliumEmojiMention");
        expect(TriliumEmojiMention.requires).toContain(EmojiRepository);
        expect(emojiFeed().minimumCharacters).toBe(2);
    });

    describe("querying", () => {
        it("returns matching emoji as `:annotation:` items carrying the character as their text", async () => {
            expect(await query("grinning")).toEqual([
                { id: ":grinning face:", text: "😀" },
                { id: ":grinning face with big eyes:", text: "😃" }
            ]);
        });

        it("returns nothing before the repository has loaded", async () => {
            const repository = editor.plugins.get(EmojiRepository);
            const wasReady = repository.isRepositoryReady;
            repository.isRepositoryReady = false;

            expect(await query("grinning")).toEqual([]);

            repository.isRepositoryReady = wasReady;
        });

        it("honours the configured skin tone, falling back to the default variant", async () => {
            await createEditor(false, { skinTone: "medium" });

            const items = await query("waving");
            expect(items[0].text).toBe("👋🏽");

            // "grinning face" has no toned variant, so the default is used.
            expect((await query("grinning face"))[0].text).toBe("😀");
        });
    });

    describe("insertion", () => {
        it("inserts the emoji as plain text, not as a mention or a reference link", async () => {
            type(":grin");
            await settle();

            pressKey(keyCodes.enter);

            const data = getModelData(editor.model, { withoutSelection: true });
            expect(data).toBe("<paragraph>😀</paragraph>");
            // The bug this plugin exists to fix: upstream's handler was orphaned by the `mention`
            // command swap, so picking an emoji inserted a `#undefined` reference link instead.
            expect(data).not.toContain("undefined");
        });
    });

    describe("with the emoji picker loaded", () => {
        beforeEach(async () => {
            await createEditor(true);
        });

        it("gives the last slot to a hand-off entry, keeping the list at the dropdown limit", async () => {
            await createEditor(true, { dropdownLimit: 2 });

            const items = await query("grinning");
            expect(items).toHaveLength(2);
            expect(items[0].text).toBe("😀");
            expect(items[1].id).toContain("show_all");
        });

        it("hands the query over to the picker instead of inserting anything", async () => {
            const picker = editor.plugins.get(EmojiPicker);
            const showUI = vi.spyOn(picker, "showUI").mockImplementation(() => {});

            const items = await query("grinning");
            expect(items[items.length - 1].id).toContain("show_all");

            type(":grinning");
            await settle();

            // The first item is pre-selected, so arrow down onto the hand-off entry at the end.
            for (let i = 0; i < items.length - 1; i++) {
                pressKey(keyCodes.arrowdown);
            }
            pressKey(keyCodes.enter);

            expect(showUI).toHaveBeenCalledExactlyOnceWith("grinning");
            expect(getModelData(editor.model, { withoutSelection: true })).toBe("<paragraph></paragraph>");
        });
    });

    describe("row rendering", () => {
        function render(item: MentionFeedObjectItem): HTMLElement {
            const renderer = emojiFeed().itemRenderer;

            if (!renderer) {
                throw new Error("the `:` feed should provide an itemRenderer");
            }

            return renderer(item) as HTMLElement;
        }

        it("labels an emoji row with the character and its shortcode", () => {
            const row = render({ id: ":grinning face:", text: "😀" });

            expect(row.querySelector(".ck-button__label")?.textContent).toBe("😀 :grinning face:");
        });

        it("labels the hand-off row with its own caption", async () => {
            await createEditor(true);
            const items = await query("grinning");
            const row = render(items[items.length - 1]);

            expect(row.querySelector(".ck-button__label")?.textContent).toBe("Show all emoji...");
        });
    });
});
