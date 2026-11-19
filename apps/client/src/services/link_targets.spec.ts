import type { CreateReferenceResponse, NoteReferencesResponse } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import appContext from "../components/app_context";
import { buildNote } from "../test/easy-froca";
import froca from "./froca";
import linkService from "./link";
import {
    addParameters, createAnchorTargets, createEditorHeadings, createEditorTarget,
    createLinkedTarget, createSavedHeadingTarget, findMarkedIndex, findTarget,
    getAttachmentLinkTargets, getLinkTargets, getMarkedHeadings, getNoTargetsText,
    getParentTargets, getTargetAncestors, isTextHeadingId, LINK_TARGET_KINDS, type LinkTarget,
    nestTargets, splitTargetParameters, StaleListingError, takeLinkTarget, toLandingTarget
} from "./link_targets";
import type { ViewScope } from "./navigation_state";
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

        const { targets, isTocPending } = await getLinkTargets(note.noteId, path);
        expect(get).toHaveBeenCalledExactlyOnceWith(
            `notes/${note.noteId}/references`, undefined, false, { silentBadRequest: true }
        );
        expect(isTocPending).toBe(false);
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

    it("saves the note before listing, and refuses a pick from a stale listing", async () => {
        const note = buildNote({ title: "Stale" });
        const get = answerReferences({
            targets: [ { kind: "heading", title: "Status", level: 2 } ], blobId: "listed"
        });
        const trigger = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        const { targets: [ status ] } = await getLinkTargets(note.noteId, `root/${note.noteId}`);
        expect(trigger).toHaveBeenCalledExactlyOnceWith("saveNoteChanges", { noteId: note.noteId });
        expect(trigger.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[0]);

        const post = vi.spyOn(server, "postWithSilentErrors")
            .mockRejectedValueOnce(JSON.stringify({ reason: "listing", message: "Changed" }));
        await expect(status.createReference?.()).rejects.toBeInstanceOf(StaleListingError);
        expect(post).toHaveBeenCalledExactlyOnceWith(`notes/${note.noteId}/references`,
            { kind: "heading", index: 0, title: "Status", blobId: "listed" });
        expect(status.params).toBeUndefined();

        post.mockRejectedValueOnce(JSON.stringify({ message: "Not found" }));
        await expect(status.createReference?.()).rejects.not.toBeInstanceOf(StaleListingError);
    });

    it("has nothing for a note that the server cannot read, or when the server fails", async () => {
        const get = vi.spyOn(server, "get");
        const secret = buildNote({ title: "Secret" });
        secret.isProtected = true;
        const none = { targets: [], isTocPending: false };
        expect(await getLinkTargets(secret.noteId, `root/${secret.noteId}`)).toStrictEqual(none);
        expect(await getAttachmentLinkTargets(secret.noteId, "att", `root/${secret.noteId}`))
            .toStrictEqual(none);
        expect(get).not.toHaveBeenCalled();

        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        onTestFinished(() => consoleError.mockRestore());
        get.mockRejectedValue(new Error("offline"));
        const text = buildNote({ title: "Text" });
        expect(await getLinkTargets(text.noteId, `root/${text.noteId}`)).toStrictEqual(none);
        expect(await getAttachmentLinkTargets(text.noteId, "att", `root/${text.noteId}`))
            .toStrictEqual(none);
        expect(consoleError).toHaveBeenCalledTimes(2);
    });

    it("reports a table of contents that the viewer has yet to build, and never builds it", async () => {
        const note = buildNote({ title: "Paper.pdf" });
        const get = answerReferences({ targets: [], blobId: "blob", pendingToc: { format: "pdf" } });
        vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);

        expect(await getLinkTargets(note.noteId, `root/${note.noteId}`))
            .toStrictEqual({ targets: [], isTocPending: true });
        expect(get).toHaveBeenCalledOnce();
        expect(getNoTargetsText(true)).toBe("add_link.open_file_for_targets");
        expect(getNoTargetsText(false)).toBe("add_link.no_link_targets");
    });

    it("remembers the titles of the headings it lists, for the labels of links to them", async () => {
        const note = buildNote({ title: "Paper.pdf" });
        note.blobId = "blob1";
        const path = `root/${note.noteId}`;
        answerReferences({
            targets: [
                { kind: "heading", title: "Methods", level: 1, params: { page: "3", heading: "abc" } },
                { kind: "anchor", title: "top", params: { bookmark: "top" } }
            ],
            blobId: "blob1"
        });
        vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);

        const { targets: [ methods ] } = await getLinkTargets(note.noteId, path);

        expect(methods.createLinkPath()).toBe(`${path}?page=3&heading=abc`);
        expect(linkService.getReferenceLinkTitleSync(`#${path}?page=3&heading=abc`))
            .toBe("Paper.pdf - Methods");
    });

    it("lists the targets of an attachment, which link after its parameters", async () => {
        const note = buildNote({ title: "Owner" });
        const linkPath = `root/${note.noteId}?viewMode=attachments&attachmentId=att1`;
        const get = answerReferences({
            targets: [ { kind: "heading", title: "Appendix", level: 1, params: { page: "9", heading: "h1" } } ],
            blobId: "attBlob"
        });

        const { targets: [ appendix ], isTocPending } =
            await getAttachmentLinkTargets(note.noteId, "att1", linkPath);

        expect(get).toHaveBeenCalledExactlyOnceWith("attachments/att1/references", undefined, false,
            { silentBadRequest: true, silentNotFound: true });
        expect(isTocPending).toBe(false);
        expect(appendix).toMatchObject({ kind: "heading", title: "Appendix", level: 1 });
        expect(appendix.createReference).toBeUndefined();
        expect(appendix.createLinkPath()).toBe(`${linkPath}&page=9&heading=h1`);

        answerReferences({ targets: [], pendingToc: { format: "pdf" } });
        expect((await getAttachmentLinkTargets(note.noteId, "att1", linkPath)).isTocPending).toBe(true);
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

describe("the targets of one heading", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("posts a heading of one version by its locator, and refuses a stale one", async () => {
        const trigger = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        const post = vi.spyOn(server, "postWithSilentErrors")
            .mockResolvedValue({ params: { block: "New" } } satisfies CreateReferenceResponse);
        const byLine = createSavedHeadingTarget("abc", "root/abc", {
            line: 5, title: "Install", blobId: "shown"
        });

        expect(byLine).toMatchObject({ kind: "heading", title: "Install" });
        expect(byLine.params).toBeUndefined();
        expect(byLine.createLinkPath()).toBe("root/abc");
        await byLine.createReference?.();
        expect(trigger).toHaveBeenCalledExactlyOnceWith("saveNoteChanges", { noteId: "abc" });
        expect(trigger.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
        expect(post).toHaveBeenCalledExactlyOnceWith("notes/abc/references", {
            kind: "heading", line: 5, title: "Install", blobId: "shown"
        });
        expect(byLine.createLinkPath()).toBe("root/abc?block=New");

        const byIndex = createSavedHeadingTarget("abc", "root/abc", {
            index: 1, title: "Install", blobId: "shown"
        });
        post.mockRejectedValueOnce(JSON.stringify({ reason: "listing", message: "Changed" }));
        await expect(byIndex.createReference?.()).rejects.toBeInstanceOf(StaleListingError);
        expect(post).toHaveBeenLastCalledWith("notes/abc/references", {
            kind: "heading", index: 1, title: "Install", blobId: "shown"
        });
        expect(byIndex.params).toBeUndefined();

        // @ts-expect-error A heading is named by its index or its line, not both.
        createSavedHeadingTarget("abc", "root/abc", { index: 1, line: 5, title: "A", blobId: "b" });
        // @ts-expect-error A heading needs a locator.
        createSavedHeadingTarget("abc", "root/abc", { title: "A", blobId: "b" });
        // @ts-expect-error A heading of one version needs that version.
        createSavedHeadingTarget("abc", "root/abc", { index: 1, title: "A" });
    });

    it("links a target that the saved note holds, without a request", async () => {
        const post = vi.spyOn(server, "postWithSilentErrors");
        const target = createLinkedTarget("root/abc", "Intro", { block: "a b" });

        expect(target).toMatchObject({ kind: "heading", title: "Intro", params: { block: "a b" } });
        expect(target.createReference).toBeUndefined();
        expect(target.createLinkPath()).toBe("root/abc?block=a%20b");
        expect(post).not.toHaveBeenCalled();
    });

    it("confirms an editor's id in the note as the server holds it after the save", async () => {
        const trigger = vi.spyOn(appContext, "triggerEvent").mockResolvedValue(undefined);
        const read = vi.spyOn(server, "getWithSilentErrors")
            .mockResolvedValue({
                blobId: "saved", content: `<h2 data-trilium-block-id="a">A</h2>`
            });
        const getBlob = vi.spyOn(froca, "getBlob");
        const assignId = vi.fn<() => string | null>(() => "a");
        const target = createEditorTarget({
            noteId: "abc", notePath: "root/abc", title: "Intro", level: 2,
            assignId, isSaved: isTextHeadingId
        });

        expect(target).toMatchObject({ kind: "heading", title: "Intro", level: 2 });
        expect(assignId).not.toHaveBeenCalled();
        await target.createReference?.();
        expect(assignId).toHaveBeenCalledTimes(1);
        expect(assignId.mock.invocationCallOrder[0])
            .toBeLessThan(trigger.mock.invocationCallOrder[0]);
        expect(trigger).toHaveBeenCalledExactlyOnceWith("saveNoteChanges", { noteId: "abc" });
        expect(read).toHaveBeenCalledExactlyOnceWith("notes/abc/blob");
        expect(trigger.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]);
        expect(getBlob).not.toHaveBeenCalled();
        expect(target.createLinkPath()).toBe("root/abc?block=a");

        // An id that the live note lacks, which the heading had before, is not copied.
        const lacking = createEditorTarget({
            noteId: "abc", notePath: "root/abc", title: "Intro", level: 2,
            assignId: () => "gone", isSaved: isTextHeadingId
        });
        await expect(lacking.createReference?.()).rejects.toThrow();
        expect(lacking.params).toBeUndefined();
        read.mockResolvedValueOnce({ blobId: "saved", content: null });
        await expect(target.createReference?.()).rejects.toThrow();

        const detached = createEditorTarget({
            noteId: "abc", notePath: "root/abc", title: "Intro", level: 2,
            assignId: () => null, isSaved: isTextHeadingId
        });
        await expect(detached.createReference?.()).rejects.toThrow();
        expect(read).toHaveBeenCalledTimes(3);
    });

    it("reads the marked headings from the server, never from a cache", async () => {
        const marked = { blobId: "b", headings: [], markedContent: "", markToken: "Tok" };
        const read = vi.spyOn(server, "getWithSilentErrors").mockResolvedValue(marked);

        expect(await getMarkedHeadings("abc")).toBe(marked);
        expect(read).toHaveBeenCalledExactlyOnceWith("notes/abc/references/marked");
    });

    it("finds a heading of a text note by the id that resolves to it", () => {
        const content = `<p data-trilium-block-id="p">P</p><h3 data-trilium-block-id="h">H</h3>`
            + `<h2 data-trilium-block-id="p">Late</h2>`;

        expect(isTextHeadingId(content, "h")).toBe(true);
        expect(isTextHeadingId(content, "p")).toBe(false);
        expect(isTextHeadingId(content, "missing")).toBe(false);
    });
});

describe("findMarkedIndex", () => {
    const mark = (index: number | string, token = "Tok") =>
        `data-trilium-heading-index="${token}.${index}"`;

    /** The headings of `html` as a page shows them: a `<div>` whose `innerHTML` is the content. */
    function render(html: string) {
        const page = document.createElement("div");
        page.innerHTML = html;
        return Array.from(page.querySelectorAll("h1,h2,h3,h4,h5,h6"))
            .filter((heading) => !heading.closest(".include-note"));
    }

    function marked(markedContent: string) {
        return { blobId: "b", headings: [], markedContent, markToken: "Tok" };
    }

    it("gives the position of the mark on the heading at the same place", () => {
        const shown = render(`<h2>A</h2><section class="include-note"><h2>X</h2></section>`
            + `<h3>B</h3><h2>A</h2>`);
        const listing = marked(`<h2 ${mark(0)}>A</h2><section class="include-note"></section>`
            + `<h3 ${mark(1)}>B</h3><h2 ${mark(2)}>A</h2>`);

        expect(shown.map((heading) => findMarkedIndex(listing, shown, heading)))
            .toStrictEqual([ 0, 1, 2 ]);
        expect(findMarkedIndex(listing, shown, document.createElement("h2"))).toBeNull();
    });

    it("answers nothing when the parses disagree, or the mark is not of this listing", () => {
        const shown = render("<h2>A</h2><h3>B</h3>");
        const [ first, second ] = shown;

        expect(findMarkedIndex(marked(`<h2 ${mark(0)}>A</h2>`), shown, first)).toBeNull();
        expect(findMarkedIndex(marked(`<h2 ${mark(0)}>A</h2><h4 ${mark(1)}>B</h4>`), shown, first))
            .toBeNull();
        const cases = [
            `<h3>B</h3>`, `<h3 ${mark(1, "Other")}>B</h3>`, `<h3 ${mark("1.5")}>B</h3>`,
            `<h3 ${mark("99999999999999999999")}>B</h3>`, `<h3 ${mark("01")}>B</h3>`,
            `<h3 data-trilium-heading-index="1">B</h3>`
        ];
        for (const secondHeading of cases) {
            expect(findMarkedIndex(marked(`<h2 ${mark(0)}>A</h2>${secondHeading}`), shown, second))
                .toBeNull();
        }

        // An empty heading that the server skipped keeps a stored in-range value.
        const withSkipped = render("<h2></h2><h2>A</h2>");
        const skipped = marked(`<h2 data-trilium-heading-index="0"></h2><h2 ${mark(0)}>A</h2>`);
        expect(findMarkedIndex(skipped, withSkipped, withSkipped[0])).toBeNull();
        expect(findMarkedIndex(skipped, withSkipped, withSkipped[1])).toBe(0);
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

    it("takes the ones asked for out of a view scope once, with the page parsed", () => {
        const viewScope: ViewScope = {
            heading: "h1", page: "12", bookmark: "Intro", attachmentId: "a1"
        };
        expect(takeLinkTarget(viewScope, [ "page", "annotation", "heading" ]))
            .toStrictEqual({ page: 12, annotation: undefined, heading: "h1" });
        expect(viewScope).toStrictEqual({
            heading: undefined, page: undefined, annotation: undefined, bookmark: "Intro",
            attachmentId: "a1"
        });
        expect(takeLinkTarget(viewScope, [ "heading" ])).toBeUndefined();

        // A page that is not one leads nowhere, and is taken all the same.
        for (const page of [ "0", "x" ]) {
            const scope: ViewScope = { page };
            expect(takeLinkTarget(scope, [ "page" ])).toStrictEqual({ page: undefined });
            expect(scope.page).toBeUndefined();
        }

        const empty: ViewScope = { block: "b1" };
        expect(takeLinkTarget(empty, [ "heading", "bookmark" ])).toBeUndefined();
        expect(empty).toStrictEqual({ block: "b1" });
        expect(takeLinkTarget(undefined, [ "heading" ])).toBeUndefined();
    });

    it("parses the page of the parameters of a heading the same way", () => {
        expect(toLandingTarget({ page: "5", heading: "h1" }))
            .toStrictEqual({ page: 5, heading: "h1" });
        expect(toLandingTarget({ heading: "h1" })).toStrictEqual({ heading: "h1" });
        expect(toLandingTarget({ page: "0", annotation: "12R" }))
            .toStrictEqual({ page: undefined, annotation: "12R" });
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
