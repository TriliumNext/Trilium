import type { HeadingReferenceResponse, NoteReferencesResponse } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import appContext from "../components/app_context";
import { buildNote } from "../test/easy-froca";
import {
    addParameter, createEditorHeadings, getAnchorLinkPath, getHeadingAncestors, getLinkTargets,
    getParentHeadings, type LinkHeading, nestHeadings, NO_LINK_TARGETS, splitBlockParameter
} from "./link_targets";
import server from "./server";

function createHeading(title: string, level: number): LinkHeading {
    return { title, level, createLinkPath: () => `root/note?block=${title}` };
}

describe("getLinkTargets", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    function answerReferences(references: NoteReferencesResponse) {
        return vi.spyOn(server, "get").mockResolvedValue(references);
    }

    it("lists the headings and sorted anchors the server reads for a text note", async () => {
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        const get = answerReferences({
            headings: [ { level: 2, text: "Setup" }, { level: 3, text: "Linux", blockId: "a b" } ],
            anchors: [ "zeta", "alpha" ],
            isWritable: true
        });

        const targets = await getLinkTargets(note.noteId, path);
        expect(get).toHaveBeenCalledExactlyOnceWith(
            `notes/${note.noteId}/references`, undefined, false, { silentBadRequest: true }
        );
        expect(targets.anchors).toStrictEqual([ "alpha", "zeta" ]);
        expect(targets.headings).toMatchObject([
            { title: "Setup", level: 2, blockId: undefined },
            { title: "Linux", level: 3, blockId: "a b" }
        ]);

        // A heading with a block id links to it without asking the server.
        const [ setup, linux ] = targets.headings;
        const post = vi.spyOn(server, "postWithSilentErrors")
            .mockResolvedValue({ blockId: "New" } satisfies HeadingReferenceResponse);
        const trigger = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        await linux.createReference?.();
        expect(post).not.toHaveBeenCalled();
        expect(linux.createLinkPath()).toBe(`${path}?block=a%20b`);

        // A heading without one links to the note until the server gives it one, once the
        // editors of the note have saved.
        expect(setup.createLinkPath()).toBe(path);
        await setup.createReference?.();
        expect(trigger).toHaveBeenCalledExactlyOnceWith("saveNoteChanges", { noteId: note.noteId });
        expect(post).toHaveBeenCalledExactlyOnceWith(
            `notes/${note.noteId}/references/heading`, { index: 0, text: "Setup" }
        );
        expect(setup.blockId).toBe("New");
        expect(setup.createLinkPath()).toBe(`${path}?block=New`);
    });

    it("lists only headings with a block id for a note whose content cannot change", async () => {
        const note = buildNote({ title: "Help" });
        answerReferences({
            headings: [ { level: 2, text: "Kept", blockId: "K" }, { level: 2, text: "Left out" } ],
            anchors: [],
            isWritable: false
        });

        const { headings } = await getLinkTargets(note.noteId, `root/${note.noteId}`);
        expect(headings.map((heading) => heading.title)).toStrictEqual([ "Kept" ]);
    });

    it("has nothing for a note without text, and for one that the server cannot read", async () => {
        const get = vi.spyOn(server, "get");
        const code = buildNote({ title: "Code", type: "code" });
        const secret = buildNote({ title: "Secret" });
        secret.isProtected = true;
        for (const note of [ code, secret ]) {
            expect(await getLinkTargets(note.noteId, `root/${note.noteId}`)).toBe(NO_LINK_TARGETS);
        }
        expect(get).not.toHaveBeenCalled();

        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        onTestFinished(() => consoleError.mockRestore());
        get.mockRejectedValue(new Error("offline"));
        const text = buildNote({ title: "Text" });
        expect(await getLinkTargets(text.noteId, `root/${text.noteId}`)).toBe(NO_LINK_TARGETS);
        expect(consoleError).toHaveBeenCalledOnce();
    });
});

describe("createEditorHeadings", () => {
    it("links each heading to the block id that the editor gives it", () => {
        const heading = { text: "Intro", level: 2, blockId: "a" };
        const assignBlockId = vi.fn<(heading: object) => string | undefined>(() => "a b");
        const [ intro ] = createEditorHeadings([ heading ], "root/abc", assignBlockId);

        expect(intro).toMatchObject({ title: "Intro", level: 2, blockId: "a" });
        expect(intro.createReference).toBeUndefined();
        expect(assignBlockId).not.toHaveBeenCalled();
        expect(intro.createLinkPath()).toBe("root/abc?block=a%20b");
        expect(assignBlockId).toHaveBeenCalledExactlyOnceWith(heading);
        // Without an editor, the link goes to the note.
        assignBlockId.mockReturnValueOnce(undefined);
        expect(intro.createLinkPath()).toBe("root/abc");
    });
});

describe("nestHeadings", () => {
    it("nests each heading under the closest heading before it with a lower level", () => {
        const intro = createHeading("Intro", 2);
        const setup = createHeading("Setup", 3);
        const linux = createHeading("Linux", 5);
        const windows = createHeading("Windows", 4);
        const usage = createHeading("Usage", 2);
        const tree = nestHeadings([ intro, setup, linux, windows, usage ]);

        expect([ ...tree ]).toStrictEqual([
            [ null, [ intro, usage ] ], [ intro, [ setup ] ], [ setup, [ linux, windows ] ]
        ]);
        expect(getParentHeadings(tree, linux)).toStrictEqual([ setup, intro ]);
        expect(getParentHeadings(tree, usage)).toStrictEqual([]);
        expect(nestHeadings([]).size).toBe(0);

        // The same nesting, as the headings above each heading, in the order of the document.
        expect([ ...getHeadingAncestors([ intro, setup, linux, windows, usage ]) ]).toStrictEqual([
            [ intro, [] ], [ setup, [ intro ] ], [ linux, [ intro, setup ] ],
            [ windows, [ intro, setup ] ], [ usage, [] ]
        ]);
    });
});

describe("the parameters of a note path", () => {
    it("adds a parameter after the ones the path has, and takes the block parameter out", () => {
        expect(addParameter("root/a", "block", "x")).toBe("root/a?block=x");
        expect(addParameter("root/a?block=x", "bookmark", "y")).toBe("root/a?block=x&bookmark=y");
        expect(getAnchorLinkPath("root/a", "a b&c")).toBe("root/a?bookmark=a%20b%26c");

        expect(splitBlockParameter("root/a")).toStrictEqual({ path: "root/a", block: null });
        expect(splitBlockParameter("root/a?block=x:y"))
            .toStrictEqual({ path: "root/a", block: "x:y" });
        expect(splitBlockParameter("root/a?block=x&bookmark=y"))
            .toStrictEqual({ path: "root/a?bookmark=y", block: "x" });
    });
});
