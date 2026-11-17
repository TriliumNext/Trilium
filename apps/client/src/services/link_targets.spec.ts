import type { CreateReferenceResponse, NoteReferencesResponse } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import appContext from "../components/app_context";
import { buildNote } from "../test/easy-froca";
import {
    addParameters, createAnchorTargets, createEditorHeadings, findTarget, getLinkTargets,
    getParentTargets, getTargetAncestors, LINK_TARGET_KINDS, type LinkTarget, nestTargets,
    splitTargetParameters
} from "./link_targets";
import server from "./server";

vi.mock("./i18n", () => ({ t: (key: string) => key }));

function createHeading(title: string, level: number): LinkTarget {
    return { kind: "heading", title, level, createLinkPath: () => `root/note?block=${title}` };
}

describe("getLinkTargets", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    function answerReferences(references: NoteReferencesResponse) {
        return vi.spyOn(server, "get").mockResolvedValue(references);
    }

    it("lists the server's targets, giving a reference to one without parameters", async () => {
        const note = buildNote({ title: "Target" });
        const path = `root/${note.noteId}`;
        const get = answerReferences({
            targets: [
                { kind: "heading", title: "Setup", level: 2 },
                { kind: "heading", title: "Linux", level: 3, params: { block: "a b" } },
                { kind: "anchor", title: "x&y", params: { bookmark: "x&y" } },
                { kind: "heading", title: "Usage", level: 2 }
            ]
        });

        const targets = await getLinkTargets(note.noteId, path);
        expect(get).toHaveBeenCalledExactlyOnceWith(
            `notes/${note.noteId}/references`, undefined, false, { silentBadRequest: true }
        );
        expect(targets).toMatchObject([
            { kind: "heading", title: "Setup", level: 2, params: undefined },
            { kind: "heading", title: "Linux", level: 3, params: { block: "a b" } },
            { kind: "anchor", title: "x&y", params: { bookmark: "x&y" } },
            { kind: "heading", title: "Usage", level: 2, params: undefined }
        ]);

        // A target with parameters links to them without asking the server.
        const [ setup, linux, anchor, usage ] = targets;
        const post = vi.spyOn(server, "postWithSilentErrors")
            .mockResolvedValue({ params: { block: "New" } } satisfies CreateReferenceResponse);
        const trigger = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        await linux.createReference?.();
        expect(post).not.toHaveBeenCalled();
        expect(linux.createLinkPath()).toBe(`${path}?block=a%20b`);
        expect(anchor.createLinkPath()).toBe(`${path}?bookmark=x%26y`);

        // A target without them links to the note until the server gives it a reference, once
        // the editors of the note have saved. It is named by its place among its kind.
        expect(setup.createLinkPath()).toBe(path);
        await setup.createReference?.();
        expect(trigger).toHaveBeenCalledExactlyOnceWith("saveNoteChanges", { noteId: note.noteId });
        expect(post).toHaveBeenLastCalledWith(
            `notes/${note.noteId}/references`, { kind: "heading", index: 0, title: "Setup" }
        );
        expect(setup.params).toStrictEqual({ block: "New" });
        expect(setup.createLinkPath()).toBe(`${path}?block=New`);
        await usage.createReference?.();
        expect(post).toHaveBeenLastCalledWith(
            `notes/${note.noteId}/references`, { kind: "heading", index: 2, title: "Usage" }
        );
    });

    it("has nothing for a note that the server cannot read, or when the server fails", async () => {
        const get = vi.spyOn(server, "get");
        const secret = buildNote({ title: "Secret" });
        secret.isProtected = true;
        expect(await getLinkTargets(secret.noteId, `root/${secret.noteId}`)).toStrictEqual([]);
        expect(get).not.toHaveBeenCalled();

        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        onTestFinished(() => consoleError.mockRestore());
        get.mockRejectedValue(new Error("offline"));
        const text = buildNote({ title: "Text" });
        expect(await getLinkTargets(text.noteId, `root/${text.noteId}`)).toStrictEqual([]);
        expect(consoleError).toHaveBeenCalledOnce();
    });
});

describe("the targets of the document in an editor", () => {
    it("links each heading to the block id that the editor gives it", () => {
        const heading = { text: "Intro", level: 2, blockId: "a" };
        const assignBlockId = vi.fn<(heading: object) => string | undefined>(() => "a b");
        const [ intro ] = createEditorHeadings([ heading ], "root/abc", assignBlockId);

        expect(intro).toMatchObject({
            kind: "heading", title: "Intro", level: 2, params: { block: "a" }
        });
        expect(intro.createReference).toBeUndefined();
        expect(assignBlockId).not.toHaveBeenCalled();
        expect(intro.createLinkPath()).toBe("root/abc?block=a%20b");
        expect(assignBlockId).toHaveBeenCalledExactlyOnceWith(heading);
        // Without an editor, the link goes to the note.
        assignBlockId.mockReturnValueOnce(undefined);
        expect(intro.createLinkPath()).toBe("root/abc");
        expect(createEditorHeadings([ { text: "New", level: 3 } ], "root/abc", assignBlockId))
            .toMatchObject([ { params: undefined } ]);
    });

    it("links each anchor through its name", () => {
        const [ top ] = createAnchorTargets([ "a b" ], "root/abc");

        expect(top).toMatchObject({ kind: "anchor", title: "a b", params: { bookmark: "a b" } });
        expect(top.level).toBeUndefined();
        expect(top.createLinkPath()).toBe("root/abc?bookmark=a%20b");
    });
});

describe("nestTargets", () => {
    it("nests each target with a level under the closest one of its kind before it", () => {
        const intro = createHeading("Intro", 2);
        const setup = createHeading("Setup", 3);
        const linux = createHeading("Linux", 5);
        const windows = createHeading("Windows", 4);
        const usage = createHeading("Usage", 2);
        const tree = nestTargets([ intro, setup, linux, windows, usage ]);

        expect([ ...tree ]).toStrictEqual([
            [ null, [ intro, usage ] ], [ intro, [ setup ] ], [ setup, [ linux, windows ] ]
        ]);
        expect(getParentTargets(tree, linux)).toStrictEqual([ setup, intro ]);
        expect(getParentTargets(tree, usage)).toStrictEqual([]);
        expect(nestTargets([]).size).toBe(0);

        // The same nesting, as the targets above each target, in the order of the document.
        expect([ ...getTargetAncestors([ intro, setup, linux, windows, usage ]) ]).toStrictEqual([
            [ intro, [] ], [ setup, [ intro ] ], [ linux, [ intro, setup ] ],
            [ windows, [ intro, setup ] ], [ usage, [] ]
        ]);
    });

    it("keeps a target without a level at the top, and kinds apart from each other", () => {
        const intro = createHeading("Intro", 2);
        const [ top ] = createAnchorTargets([ "top" ], "root/abc");
        const chapter: LinkTarget = { ...createHeading("Chapter", 3), kind: "anchor" };
        const setup = createHeading("Setup", 3);

        expect([ ...nestTargets([ intro, top, chapter, setup ]) ]).toStrictEqual([
            [ null, [ intro, top, chapter ] ], [ intro, [ setup ] ]
        ]);
    });
});

describe("the parameters of a link to a target", () => {
    it("adds them after the ones that the path has, and finds the target they point at", () => {
        expect(addParameters("root/a", { block: "x:y z" })).toBe("root/a?block=x:y%20z");
        expect(addParameters("root/a?block=x", { bookmark: "y&z" }))
            .toBe("root/a?block=x&bookmark=y%26z");
        expect(addParameters("root/a")).toBe("root/a");

        const intro = { ...createHeading("Intro", 2), params: { block: "i" } };
        const both = { ...createHeading("Both", 2), params: { block: "i", bookmark: "b" } };
        const targets = [ createHeading("Bare", 2), intro, both ];
        expect(findTarget(targets, { block: "i" })).toBe(intro);
        expect(findTarget(targets, { bookmark: "b", block: "i" })).toBe(both);
        expect(findTarget(targets, { block: "x" })).toBeUndefined();
        expect(findTarget(targets, {})).toBeUndefined();
    });

    it("takes the parameters that point inside the note out of a path", () => {
        expect(splitTargetParameters("root/a")).toStrictEqual({ path: "root/a", params: {} });
        expect(splitTargetParameters("root/a?viewMode=x%20y"))
            .toStrictEqual({ path: "root/a?viewMode=x%20y", params: {} });
        expect(splitTargetParameters("root/a?block=x:y"))
            .toStrictEqual({ path: "root/a", params: { block: "x:y" } });
        expect(splitTargetParameters("root/a?block=x&viewMode=y&bookmark=a%20b"))
            .toStrictEqual({ path: "root/a?viewMode=y", params: { block: "x", bookmark: "a b" } });
    });
});

describe("LINK_TARGET_KINDS", () => {
    it("names the icon and the title of each kind, and whether a link mirrors the target", () => {
        expect(Object.entries(LINK_TARGET_KINDS).map(([ kind, shown ]) => [
            kind, shown.icon, shown.getTitle(), shown.isTitleMirrored
        ])).toStrictEqual([
            [ "heading", "bx bx-heading", "add_link.link_to_heading", true ],
            [ "anchor", "bx bx-bookmark", "add_link.link_to_anchor", false ]
        ]);
    });
});
