import {
    type ClassicEditor,
    type Editor,
    EmojiPicker,
    EmojiRepository,
    Essentials,
    _getModelData as getModelData,
    MentionEditing,
    Paragraph,
    _setModelData as setModelData
} from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import TriliumEmojiMention, { type EmojiSuggestion } from "./emoji_mention.js";
import TriliumMentionUI from "./trilium_mention_ui.js";
import type { MentionHostedFeed, MentionHostedList } from "./types.js";

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

/** The query the stub list last showed the emoji for, or `null` while it is hidden. */
let shownQuery: string | null = null;

/**
 * A host's list for `emoji.list`, as the client's behaves for these tests: it lists the emoji for the
 * query as it is shown, opens on the first, moves on ArrowDown and commits on Enter.
 */
function createStubList(editor: Editor): MentionHostedList {
    let commit: ((item: EmojiSuggestion) => void) | null = null;
    let entries: EmojiSuggestion[] = [];
    let index = 0;

    return {
        show(state) {
            shownQuery = state.query;
            commit = state.commit;
            entries = editor.plugins.get(TriliumEmojiMention).search(state.query);
            index = 0;
        },
        hide() {
            shownQuery = null;
            commit = null;
            entries = [];
        },
        handleKeyDown(event) {
            if (event.key === "ArrowDown") {
                index = (index + 1) % entries.length;
                return true;
            }
            const entry = entries[index];
            if (event.key !== "Enter" || !commit || !entry) {
                return false;
            }
            commit(entry);
            return true;
        },
        element: null
    };
}

describe("TriliumEmojiMention", () => {
    let editor: ClassicEditor;
    let definitionsUrl: string;

    async function createEditor(withPicker = false, emojiConfig: Record<string, unknown> = {}) {
        const plugins = [ Essentials, Paragraph, MentionEditing, TriliumMentionUI, TriliumEmojiMention ];

        editor = await createTestEditor(withPicker ? [ ...plugins, EmojiPicker ] : plugins, {
            // `definitionsUrl` must survive every override, or the repository silently falls back to
            // the real CDN and the spec starts asserting against the production emoji database.
            emoji: { list: createStubList, ...emojiConfig, definitionsUrl }
        });

        await editor.plugins.get(EmojiRepository).isReady();
        setModelData(editor.model, "<paragraph>[]</paragraph>");
    }

    /** The `:` feed the plugin registered, as the mention UI sees it. */
    function emojiFeed(): MentionHostedFeed | undefined {
        return editor.config.get("mention.hostedFeeds")?.find((candidate) => candidate.marker === ":");
    }

    function query(text: string): EmojiSuggestion[] {
        return editor.plugins.get(TriliumEmojiMention).search(text);
    }

    function type(text: string) {
        editor.model.change((writer) => {
            editor.model.insertContent(writer.createText(text), editor.model.document.selection.getFirstPosition());
        });
    }

    function pressKey(key: "ArrowDown" | "Enter") {
        editor.editing.view.document.fire("keydown", {
            keyCode: 0,
            domEvent: new KeyboardEvent("keydown", { key }),
            preventDefault: () => {},
            stopPropagation: () => {},
            domTarget: editor.editing.view.getDomRoot()
        });
    }

    async function settle() {
        await new Promise((resolve) => setTimeout(resolve, AFTER_DEBOUNCE));
    }

    beforeEach(async () => {
        shownQuery = null;
        definitionsUrl = URL.createObjectURL(new Blob([ JSON.stringify(DEFINITIONS) ], { type: "application/json" }));
        await createEditor();
    });

    afterEach(() => {
        URL.revokeObjectURL(definitionsUrl);
    });

    it("registers itself and a `:` feed in the host's list, which needs two characters before opening", async () => {
        expect(TriliumEmojiMention.pluginName).toBe("TriliumEmojiMention");
        expect(TriliumEmojiMention.requires).toContain(EmojiRepository);
        expect(emojiFeed()?.minimumCharacters).toBe(2);
        expect(emojiFeed()?.list).toBe(createStubList);

        type(":g");
        await settle();
        expect(shownQuery).toBeNull();

        type("r");
        await settle();
        expect(shownQuery).toBe("gr");
    });

    it("registers no feed for a host that gives it no list", async () => {
        editor = await createTestEditor([ Essentials, Paragraph, MentionEditing, TriliumMentionUI, TriliumEmojiMention ], {
            emoji: { definitionsUrl }
        });
        expect(emojiFeed()).toBeUndefined();
    });

    describe("searching", () => {
        it("lists matching emoji under their `:annotation:`, carrying the character as their text", () => {
            expect(query("grinning")).toEqual([
                { id: ":grinning face:", title: ":grinning face:", text: "😀" },
                { id: ":grinning face with big eyes:", title: ":grinning face with big eyes:", text: "😃" }
            ]);
        });

        it("lists nothing before the repository has loaded", () => {
            const repository = editor.plugins.get(EmojiRepository);
            const wasReady = repository.isRepositoryReady;
            repository.isRepositoryReady = false;

            expect(query("grinning")).toEqual([]);

            repository.isRepositoryReady = wasReady;
        });

        it("honours the configured skin tone, falling back to the default variant", async () => {
            await createEditor(false, { skinTone: "medium" });

            expect(query("waving")[0].text).toBe("👋🏽");
            // "grinning face" has no toned variant, so the default is used.
            expect(query("grinning face")[0].text).toBe("😀");
        });

        it("lists at most the dropdown limit", async () => {
            await createEditor(false, { dropdownLimit: 1 });

            expect(query("grinning").map((emoji) => emoji.text)).toEqual([ "😀" ]);
        });
    });

    describe("insertion", () => {
        it("inserts the emoji as plain text, not as a mention or a reference link", async () => {
            type(":grin");
            await settle();

            pressKey("Enter");

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

        it("gives the last slot to an entry opening the picker, keeping the list at the dropdown limit", async () => {
            await createEditor(true, { dropdownLimit: 2 });

            const items = query("grinning");
            expect(items).toHaveLength(2);
            expect(items[0].text).toBe("😀");
            expect(items[1]).toEqual({
                id: expect.stringContaining("show_all"), title: "Show all emoji...", text: "grinning", opensPicker: true,
                icon: expect.stringContaining("<svg")
            });
        });

        it("hands the query over to the picker instead of inserting anything", async () => {
            const picker = editor.plugins.get(EmojiPicker);
            const showUI = vi.spyOn(picker, "showUI").mockImplementation(() => {});

            type(":grinning");
            await settle();

            // The list opens on the first entry, so arrow down onto the picker's entry at the end.
            for (let i = 0; i < query("grinning").length - 1; i++) {
                pressKey("ArrowDown");
            }
            pressKey("Enter");

            expect(showUI).toHaveBeenCalledExactlyOnceWith("grinning");
            expect(getModelData(editor.model, { withoutSelection: true })).toBe("<paragraph></paragraph>");
        });
    });
});
