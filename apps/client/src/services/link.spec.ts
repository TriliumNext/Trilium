import { beforeEach, describe, expect, it, vi } from "vitest";

import $ from "jquery";

// `link.ts` references the bare global `logError` (normally installed by ws.ts, which setup.ts mocks).
(globalThis as any).logError = (globalThis as any).logError ?? (() => {});

// We re-mock ws.js here (instead of relying on the global setup stub) so we can supply the named
// `logError` export that tree.ts (reached via createLink's note-path resolution) calls. We keep the
// froca-relevant surface (subscribeToMessages / waitForMaxKnownEntityChangeId) intact.
vi.mock("./ws.js", () => {
    const noop = () => {};
    return {
        default: {
            subscribeToMessages: noop,
            waitForMaxKnownEntityChangeId: async () => {},
            logError: noop
        },
        subscribeToMessages: noop,
        logError: noop
    };
});

// Mocks for the heavy / side-effecting collaborators. These avoid pulling in CKEditor / CodeMirror
// (via note_context) and let us assert on the navigation commands link.ts dispatches.
const triggerCommand = vi.fn();
const openTabWithNoteWithHoisting = vi.fn();
vi.mock("../components/app_context.js", () => ({
    default: {
        triggerCommand: (...args: unknown[]) => triggerCommand(...args),
        tabManager: {
            openTabWithNoteWithHoisting: (...args: unknown[]) => openTabWithNoteWithHoisting(...args)
        }
    }
}));

const openInCurrentNoteContext = vi.fn();
vi.mock("../components/note_context.js", () => ({
    openInCurrentNoteContext: (...args: unknown[]) => openInCurrentNoteContext(...args)
}));

const openContextMenu = vi.fn();
vi.mock("../menus/link_context_menu.js", () => ({
    default: {
        openContextMenu: (...args: unknown[]) => openContextMenu(...args)
    }
}));

const showError = vi.fn();
vi.mock("./toast.js", () => ({
    showError: (...args: unknown[]) => showError(...args)
}));

vi.mock("./i18n.js", () => ({
    t: (key: string) => key
}));

import { buildNote } from "../test/easy-froca";
import froca from "./froca.js";
import treeService from "./tree.js";
import linkService, {
    calculateHash,
    goToLinkExt,
    parseNavigationStateFromUrl
} from "./link.js";
import utils from "./utils.js";

beforeEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronApi;
});

describe("parseNavigationStateFromUrl", () => {
    it("parses plain searchString", () => {
        const output = parseNavigationStateFromUrl("http://localhost:8080/#?searchString=hello");
        expect(output).toMatchObject({ searchString: "hello" });
    });

    it("parses searchString with hash", () => {
        const output = parseNavigationStateFromUrl("https://github.com/orgs/TriliumNext/discussions/1526#discussioncomment-12656660");
        expect(output).toStrictEqual({});
    });

    it("parses notePath", () => {
        const output = parseNavigationStateFromUrl(`#root/WWaBNf3SSA1b/mQ2tIzLVFKHL`);
        expect(output).toMatchObject({ notePath: "root/WWaBNf3SSA1b/mQ2tIzLVFKHL", noteId: "mQ2tIzLVFKHL" });
    });

    it("parses notePath with spaces", () => {
        const output = parseNavigationStateFromUrl(`  #root/WWaBNf3SSA1b/mQ2tIzLVFKHL`);
        expect(output).toMatchObject({ notePath: "root/WWaBNf3SSA1b/mQ2tIzLVFKHL", noteId: "mQ2tIzLVFKHL" });
    });

    it("parses notePath with extraWindow", () => {
        const output = parseNavigationStateFromUrl(`127.0.0.1:8080/?extraWindow=1#root/QZGqKB7wVZF8?ntxId=0XPvXG`);
        expect(output).toMatchObject({ notePath: "root/QZGqKB7wVZF8", noteId: "QZGqKB7wVZF8" });
    });

    it("ignores external URL with internal hash anchor", () => {
        const output = parseNavigationStateFromUrl(`https://en.wikipedia.org/wiki/Bearded_Collie#Health`);
        expect(output).toMatchObject({});
    });

    it("ignores malformed but hash-containing external URL", () => {
        const output = parseNavigationStateFromUrl("https://abc.com/#drop?searchString=firefox");
        expect(output).toStrictEqual({});
    });

    it("ignores non-hash internal path", () => {
        const output = parseNavigationStateFromUrl("/root/abc123");
        expect(output).toStrictEqual({});
    });

    it("returns empty object for undefined / no-hash input", () => {
        expect(parseNavigationStateFromUrl(undefined)).toStrictEqual({});
        expect(parseNavigationStateFromUrl("no-hash-here")).toStrictEqual({});
    });

    it("parses all recognised hash params and warns on unknown ones", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const output = parseNavigationStateFromUrl(
            "#root/aaaaaaaaaaaa?ntxId=n1&hoistedNoteId=h1&viewMode=source&attachmentId=att1&bookmark=bm1&popup=1&foo=bar"
        );
        expect(output).toMatchObject({
            notePath: "root/aaaaaaaaaaaa",
            ntxId: "n1",
            hoistedNoteId: "h1",
            openInPopup: true
        });
        expect((output as any).viewScope).toMatchObject({
            viewMode: "source",
            attachmentId: "att1",
            bookmark: "bm1"
        });
        expect(warn).toHaveBeenCalledWith("Unrecognized hash parameter 'foo'.");
        warn.mockRestore();
    });

    it("returns empty object when the note path does not match the id pattern", () => {
        // hash present at index 0, but the path is too short to be a valid note id
        expect(parseNavigationStateFromUrl("#ab")).toStrictEqual({});
    });
});

describe("calculateHash", () => {
    it("returns an empty string when there is no note path and no params", () => {
        expect(calculateHash({} as any)).toBe("");
    });

    it("builds a hash from the note path only", () => {
        expect(calculateHash({ notePath: "root/abc" } as any)).toBe("#root/abc");
    });

    it("appends all relevant params and skips root hoisted note and default view mode", () => {
        const hash = calculateHash({
            notePath: "root/abc",
            ntxId: "n1",
            hoistedNoteId: "h1",
            viewScope: { viewMode: "source", attachmentId: "att 1" }
        } as any);
        expect(hash).toBe("#root/abc?ntxId=n1&hoistedNoteId=h1&viewMode=source&attachmentId=att%201");
    });

    it("omits params that are at their defaults", () => {
        const hash = calculateHash({
            notePath: "root/abc",
            hoistedNoteId: "root",
            viewScope: { viewMode: "default" }
        } as any);
        expect(hash).toBe("#root/abc");
    });

    it("produces only the param string when note path is empty", () => {
        expect(calculateHash({ ntxId: "n1" } as any)).toBe("#?ntxId=n1");
    });
});

describe("getNotePathFromUrl", () => {
    it("extracts the note path from a hash url and returns null otherwise", () => {
        expect(linkService.getNotePathFromUrl("https://x.test/#root/abc_123")).toBe("root/abc_123");
        expect(linkService.getNotePathFromUrl("https://x.test/no-hash")).toBeNull();
    });
});

describe("createLink", () => {
    it("returns a [missing note] span when the note path is empty", async () => {
        const $el = await linkService.createLink("   ");
        expect($el.is("span")).toBe(true);
        expect($el.text()).toBe("[missing note]");
    });

    it("renders an anchor with the resolved title, prefixing bare paths with root/", async () => {
        const note = buildNote({ title: "My note" });
        const $el = await linkService.createLink(note.noteId);
        const $a = $el.find("a");
        expect($a.attr("href")).toBe(`#root/${note.noteId}`);
        expect($a.text()).toBe("My note");
        // default options: tooltip enabled, not a reference link
        expect($a.hasClass("no-tooltip-preview")).toBe(false);
        expect($a.hasClass("reference-link")).toBe(false);
    });

    it("honours showTooltip=false, referenceLink and showNoteIcon", async () => {
        const note = buildNote({ title: "Icon note", "#iconClass": "bx bx-star" });
        const $el = await linkService.createLink(`root/${note.noteId}`, {
            showTooltip: false,
            referenceLink: true,
            showNoteIcon: true
        });
        const $a = $el.find("a");
        expect($a.hasClass("no-tooltip-preview")).toBe(true);
        expect($a.hasClass("reference-link")).toBe(true);
        // an icon span is prepended
        expect($el.children("span.bx").length).toBeGreaterThan(0);
    });

    it("uses an explicit title without consulting the tree", async () => {
        const note = buildNote({ title: "Real title" });
        const $el = await linkService.createLink(`root/${note.noteId}`, { title: "Override" });
        expect($el.find("a").text()).toBe("Override");
    });

    it("appends a .note-link-suffix span right after the link when titleSuffix is set", async () => {
        const note = buildNote({ title: "Base" });
        const $el = await linkService.createLink(`root/${note.noteId}`, { titleSuffix: "— dropped" });
        const $suffix = $el.children("span.note-link-suffix");
        expect($suffix.length).toBe(1);
        expect($suffix.text()).toBe("— dropped");
        expect($suffix.prev().is("a")).toBe(true);
    });

    it("auto-converts image notes to an <img> element with an unversioned src", async () => {
        const note = buildNote({ title: "Pic", type: "image" });
        const $el = await linkService.createLink(`root/${note.noteId}`, { autoConvertToImage: true, title: "Pic" });
        expect($el.is("img")).toBe(true);
        expect($el.attr("alt")).toBe("Pic");
        // This markup is persisted into note content (e.g. dropped from the tree into the
        // editor). A pinned `?v=` would be cached as immutable and go stale when the image
        // changes; unversioned URLs revalidate via ETag instead.
        expect($el.attr("src")).toBe(`api/images/${note.noteId}/Pic`);
    });

    it("returns a [missing note] span when no note id can be resolved", async () => {
        // a trailing empty path segment yields an empty noteId
        const $el = await linkService.createLink("/");
        expect($el.text()).toBe("[missing note]");
    });

    it("renders the note path breadcrumb when showNotePath is set for a nested note", async () => {
        // Build a real tree rooted at "root" so tree resolution can walk the parents.
        const root = buildNote({
            id: "root",
            title: "Root",
            children: [{ title: "Parent", children: [{ title: "Child" }] }]
        });
        const parentId = root.children[0];
        const parent = froca.getNoteFromCache(parentId)!;
        const childId = parent.children[0];
        const $el = await linkService.createLink(`root/${parentId}/${childId}`, { showNotePath: true });
        // a <small> breadcrumb should be appended alongside the anchor
        expect($el.find("small").length).toBe(1);
        expect($el.find("a").length).toBeGreaterThanOrEqual(1);
    });

    it("renders the home breadcrumb when showNotePath is set for the root note", async () => {
        buildNote({ id: "root", title: "Root" });
        const $el = await linkService.createLink("root", { showNotePath: true });
        expect($el.find("a").length).toBe(1);
        // root path => single ⌂ segment => a <small> with the home glyph
        expect($el.find("small").length).toBe(1);
    });

    it("resolves an attachment title when viewing attachments", async () => {
        const note = buildNote({ title: "Has attachment" });
        froca.getAttachment = vi.fn(async () => ({ title: "Attachment title" }) as any);
        const $el = await linkService.createLink(`root/${note.noteId}`, {
            viewScope: { viewMode: "attachments", attachmentId: "att-1" }
        });
        expect($el.find("a").text()).toBe("Attachment title");
        expect(froca.getAttachment).toHaveBeenCalledWith("att-1");
    });

    it("falls back to [missing attachment] when the attachment is absent", async () => {
        const note = buildNote({ title: "No attachment" });
        froca.getAttachment = vi.fn(async () => null as any);
        const $el = await linkService.createLink(`root/${note.noteId}`, {
            viewScope: { viewMode: "attachments", attachmentId: "att-missing" }
        });
        expect($el.find("a").text()).toBe("[missing attachment]");
    });

    it("uses a source-mode icon when showing the icon for a source view", async () => {
        const note = buildNote({ title: "Source view" });
        const $el = await linkService.createLink(`root/${note.noteId}`, {
            showNoteIcon: true,
            viewScope: { viewMode: "source" }
        });
        expect($el.find("span.bx.bx-code-curly").length).toBe(1);
    });

    it("uses an attachments-mode icon when showing the icon for an attachments view", async () => {
        const note = buildNote({ title: "Attachments view" });
        froca.getAttachment = vi.fn(async () => ({ title: "Att" }) as any);
        const $el = await linkService.createLink(`root/${note.noteId}`, {
            showNoteIcon: true,
            viewScope: { viewMode: "attachments", attachmentId: "att-x" }
        });
        expect($el.find("span.bx.bx-file").length).toBe(1);
    });

    it("renders no icon for a view mode without a dedicated icon", async () => {
        const note = buildNote({ title: "Help view" });
        const $el = await linkService.createLink(`root/${note.noteId}`, {
            showNoteIcon: true,
            title: "Help view",
            viewScope: { viewMode: "contextual-help" }
        });
        // contextual-help has no icon mapping => no icon span prepended
        expect($el.children("span.bx").length).toBe(0);
    });

    it("does not auto-convert image notes when not viewing in default mode", async () => {
        const note = buildNote({ title: "Pic2", type: "image" });
        const $el = await linkService.createLink(`root/${note.noteId}`, {
            autoConvertToImage: true,
            title: "Pic2",
            viewScope: { viewMode: "source" }
        });
        expect($el.is("img")).toBe(false);
    });

    it("auto-converts image notes with an empty title", async () => {
        const note = buildNote({ title: "", type: "canvas" });
        const $el = await linkService.createLink(`root/${note.noteId}`, {
            autoConvertToImage: true,
            title: ""
        });
        expect($el.is("img")).toBe(true);
        expect($el.attr("alt")).toBe("");
        expect($el.attr("src")).toBe(`api/images/${note.noteId}/`);
    });

    it("falls back to an empty breadcrumb when the note path cannot be resolved", async () => {
        const note = buildNote({ title: "Unresolvable" });
        const spy = vi.spyOn(treeService, "resolveNotePathToSegments").mockResolvedValue(null);
        const $el = await linkService.createLink(`root/${note.noteId}`, { showNotePath: true });
        // resolve returned null => empty segments => getNotePathTitleComponents("") still yields a stub
        expect($el.find("a").length).toBe(1);
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it("does not render an icon span when the note has no icon", async () => {
        const note = buildNote({ title: "No icon" });
        // Force getIcon to return a falsy value so the icon branch is skipped.
        note.getIcon = (() => "") as typeof note.getIcon;
        const $el = await linkService.createLink(`root/${note.noteId}`, { showNoteIcon: true });
        expect($el.children("span.bx").length).toBe(0);
        expect($el.find("a").length).toBe(1);
    });

    it("does not auto-convert non-image notes to an <img>", async () => {
        const note = buildNote({ title: "Plain", type: "text" });
        const $el = await linkService.createLink(`root/${note.noteId}`, { autoConvertToImage: true });
        expect($el.is("img")).toBe(false);
        expect($el.find("a").length).toBe(1);
    });
});

describe("goToLinkExt", () => {
    function leftClick(extra: Record<string, unknown> = {}) {
        return { type: "click", which: 1, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra } as any;
    }

    it("returns true immediately for data: links without navigating", () => {
        expect(goToLinkExt(null, "data:text/plain;base64,AAAA")).toBe(true);
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("opens an internal note path in the current context on a plain left click", () => {
        const result = goToLinkExt(leftClick(), "#root/aaaaaaaaaaaa");
        expect(result).toBe(true);
        expect(openInCurrentNoteContext).toHaveBeenCalled();
    });

    it("opens in a popup when the url requests it", () => {
        goToLinkExt(leftClick(), "#root/aaaaaaaaaaaa?popup=1");
        expect(triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "root/aaaaaaaaaaaa" });
    });

    it("opens in a new window on shift+left-click", () => {
        goToLinkExt(leftClick({ shiftKey: true }), "#root/aaaaaaaaaaaa");
        expect(triggerCommand).toHaveBeenCalledWith("openInWindow", expect.objectContaining({ notePath: "root/aaaaaaaaaaaa" }));
    });

    it("opens in a new tab on a middle click", () => {
        const evt = { type: "auxclick", which: 2, preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
        goToLinkExt(evt, "#root/aaaaaaaaaaaa");
        expect(openTabWithNoteWithHoisting).toHaveBeenCalled();
    });

    it("activates the new tab on ctrl+shift+left-click", () => {
        const evt = leftClick();
        const spy = vi.spyOn(utils, "isCtrlKey").mockReturnValue(true);
        goToLinkExt({ ...evt, shiftKey: true }, "#root/aaaaaaaaaaaa");
        expect(openTabWithNoteWithHoisting).toHaveBeenCalledWith(
            "root/aaaaaaaaaaaa",
            expect.objectContaining({ activate: true })
        );
        spy.mockRestore();
    });

    it("opens http(s) external links in a new browser window when clicked outside CKEditor", () => {
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        goToLinkExt(leftClick(), "https://example.com");
        expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank");
        openSpy.mockRestore();
    });

    it("opens api/ links in a new browser window", () => {
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        goToLinkExt(leftClick(), "api/something");
        expect(openSpy).toHaveBeenCalledWith("api/something", "_blank");
        openSpy.mockRestore();
    });

    it("dispatches an allowed custom protocol via electron shell.openExternal", () => {
        const openExternal = vi.fn();
        (window as any).electronApi = { shell: { openExternal, openFileUrl: vi.fn() } };
        goToLinkExt(leftClick(), "mailto:test@example.com");
        expect(openExternal).toHaveBeenCalledWith("mailto:test@example.com");
    });

    it("routes file: links through openFileUrl and reports failures", async () => {
        const openFileUrl = vi.fn(async () => "boom");
        (window as any).electronApi = { shell: { openExternal: vi.fn(), openFileUrl } };
        goToLinkExt(leftClick(), "file:///C:/x.txt");
        expect(openFileUrl).toHaveBeenCalledWith("file:///C:/x.txt");
        // allow the rejected/returned-error promise chain to settle
        await new Promise((r) => setTimeout(r, 0));
        expect(showError).toHaveBeenCalled();
    });

    it("reports an error when openFileUrl rejects", async () => {
        const openFileUrl = vi.fn(async () => { throw new Error("nope"); });
        (window as any).electronApi = { shell: { openExternal: vi.fn(), openFileUrl } };
        goToLinkExt(leftClick(), "file:///C:/y.txt");
        await new Promise((r) => setTimeout(r, 0));
        expect(showError).toHaveBeenCalled();
    });

    it("does not report an error when openFileUrl succeeds", async () => {
        const openFileUrl = vi.fn(async () => "");
        (window as any).electronApi = { shell: { openExternal: vi.fn(), openFileUrl } };
        goToLinkExt(leftClick(), "file:///C:/ok.txt");
        await new Promise((r) => setTimeout(r, 0));
        expect(openFileUrl).toHaveBeenCalledWith("file:///C:/ok.txt");
        expect(showError).not.toHaveBeenCalled();
    });

    it("falls back to window.open for custom protocols when not running under electron", () => {
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        goToLinkExt(leftClick(), "mailto:x@example.com");
        expect(openSpy).toHaveBeenCalledWith("mailto:x@example.com", "_blank");
        openSpy.mockRestore();
    });

    it("scrolls to an in-page anchor for non-root hash links", () => {
        const target = document.createElement("p");
        target.id = "fn1";
        const content = document.createElement("div");
        content.className = "ck-content";
        content.appendChild(target);
        document.body.appendChild(content);
        target.scrollIntoView = vi.fn();

        const $link = $("<a id='ref'>").attr("href", "#fn1");
        content.appendChild($link[0]);

        const handled = goToLinkExt(leftClick(), "#fn1", $link);
        expect(handled).toBe(true);
        expect(target.scrollIntoView).toHaveBeenCalled();
        document.body.removeChild(content);
    });

    it("does nothing for an unhandled external link without a protocol match", () => {
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        // not http, not api/, not an allowed protocol -> no navigation
        goToLinkExt(leftClick(), "weirdscheme:foo", null);
        expect(openSpy).not.toHaveBeenCalled();
        openSpy.mockRestore();
    });

    it("does not open in-editor links on a plain left click", () => {
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        const $editor = $("<div contenteditable='true'>");
        const $link = $("<a>").attr("href", "https://example.com");
        $editor.append($link);
        goToLinkExt(leftClick(), "https://example.com", $link);
        // inside a contenteditable, a plain left click should not open the link
        expect(openSpy).not.toHaveBeenCalled();
        openSpy.mockRestore();
    });

    it("does nothing when there is neither a note path nor an href", () => {
        const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
        expect(goToLinkExt(leftClick(), undefined)).toBe(true);
        expect(openSpy).not.toHaveBeenCalled();
        expect(openInCurrentNoteContext).not.toHaveBeenCalled();
        openSpy.mockRestore();
    });

    it("does not navigate to an internal note on a non-left, non-middle click", () => {
        const evt = { type: "click", which: 3, preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
        goToLinkExt(evt, "#root/aaaaaaaaaaaa");
        expect(openInCurrentNoteContext).not.toHaveBeenCalled();
        expect(openTabWithNoteWithHoisting).not.toHaveBeenCalled();
        expect(triggerCommand).not.toHaveBeenCalled();
    });

    it("does not handle a non-root hash anchor that does not resolve to an element", () => {
        const $link = $("<a>").attr("href", "#missing-anchor");
        // no .ck-content ancestor containing #missing-anchor => handleAnchor returns false
        const result = goToLinkExt(leftClick(), "#missing-anchor", $link);
        expect(result).toBe(true);
    });

    it("reports a string (non-Error) failure from openFileUrl rejection", async () => {
        const openFileUrl = vi.fn(async () => { throw "raw string failure"; });
        (window as any).electronApi = { shell: { openExternal: vi.fn(), openFileUrl } };
        goToLinkExt(leftClick(), "file:///C:/z.txt");
        await new Promise((r) => setTimeout(r, 0));
        expect(showError).toHaveBeenCalled();
    });
});

describe("getReferenceLinkTitle / getReferenceLinkTitleSync", () => {
    it("getReferenceLinkTitle returns [missing note] when there is no note id", async () => {
        expect(await linkService.getReferenceLinkTitle("https://example.com")).toBe("[missing note]");
    });

    it("getReferenceLinkTitle returns [missing note] when the note is not found", async () => {
        const orig = froca.getNote;
        froca.getNote = vi.fn(async () => null) as typeof froca.getNote;
        expect(await linkService.getReferenceLinkTitle("#root/aaaaaaaaaaaa")).toBe("[missing note]");
        froca.getNote = orig;
    });

    it("getReferenceLinkTitle returns the note title", async () => {
        const note = buildNote({ title: "Referenced" });
        expect(await linkService.getReferenceLinkTitle(`#root/${note.noteId}`)).toBe("Referenced");
    });

    it("getReferenceLinkTitle resolves attachment titles", async () => {
        const note = buildNote({ title: "WithAtt" });
        note.getAttachmentById = vi.fn(async () => ({ title: "Att" }) as any);
        const title = await linkService.getReferenceLinkTitle(`#root/${note.noteId}?viewMode=attachments&attachmentId=a1`);
        expect(title).toBe("Att");
    });

    it("getReferenceLinkTitle returns [missing attachment] when attachment not found", async () => {
        const note = buildNote({ title: "WithAtt2" });
        note.getAttachmentById = vi.fn(async () => null as any);
        const title = await linkService.getReferenceLinkTitle(`#root/${note.noteId}?viewMode=attachments&attachmentId=a2`);
        expect(title).toBe("[missing attachment]");
    });

    it("getReferenceLinkTitleSync covers missing note, attachments and bookmark variants", () => {
        expect(linkService.getReferenceLinkTitleSync("https://example.com")).toBe("[missing note]");

        const note = buildNote({ title: "SyncNote" });
        // plain title
        expect(linkService.getReferenceLinkTitleSync(`#root/${note.noteId}`)).toBe("SyncNote");

        // bookmark suffix
        expect(linkService.getReferenceLinkTitleSync(`#root/${note.noteId}?bookmark=Heading`)).toBe("SyncNote - Heading");

        // attachments without loaded attachments => loading placeholder
        const note2 = buildNote({ title: "SyncNote2" });
        (note2 as any).attachments = undefined;
        expect(linkService.getReferenceLinkTitleSync(`#root/${note2.noteId}?viewMode=attachments&attachmentId=a1`)).toBe("[loading title...]");

        // attachments loaded but not matching
        (note2 as any).attachments = [{ attachmentId: "other", title: "Other" }];
        expect(linkService.getReferenceLinkTitleSync(`#root/${note2.noteId}?viewMode=attachments&attachmentId=a1`)).toBe("[missing attachment]");

        // attachments loaded and matching
        (note2 as any).attachments = [{ attachmentId: "a1", title: "Matched" }];
        expect(linkService.getReferenceLinkTitleSync(`#root/${note2.noteId}?viewMode=attachments&attachmentId=a1`)).toBe("Matched");
    });

    it("getReferenceLinkTitleSync returns [missing note] when the note is not in cache", () => {
        const orig = froca.getNoteFromCache;
        froca.getNoteFromCache = vi.fn(() => null) as unknown as typeof froca.getNoteFromCache;
        expect(linkService.getReferenceLinkTitleSync("#root/aaaaaaaaaaaa")).toBe("[missing note]");
        froca.getNoteFromCache = orig;
    });
});

describe("loadReferenceLinkTitle", () => {
    it("warns and bails when there is no href", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const $el = $("<span>");
        await linkService.loadReferenceLinkTitle($el);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("warns when the href has no note id", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const $el = $("<a>").attr("href", "https://example.com");
        await linkService.loadReferenceLinkTitle($el);
        expect(warn).toHaveBeenCalledWith("Missing note ID.");
        warn.mockRestore();
    });

    it("sets text, color class, bookmark and icon for a resolved note", async () => {
        const note = buildNote({ title: "Loaded", "#color": "red", "#iconClass": "bx bx-star" });
        const $a = $("<a>").attr("href", `#root/${note.noteId}?bookmark=Sec`);
        const $el = $("<span>").append($a);
        await linkService.loadReferenceLinkTitle($el, `#root/${note.noteId}?bookmark=Sec`);
        // the title becomes the note title, and the bookmark small is appended
        expect($el.text()).toContain("Loaded");
        expect($el.find("small").length).toBe(1);
        // the bookmark <small> carries the bookmark glyph and the bookmark text
        expect($el.find("small span.bx.bx-bookmark").length).toBe(1);
        expect($el.find("small").text()).toContain("Sec");
        // the color class produced by note.getColorClass() is applied to $el (source line 431)
        const colorClass = note.getColorClass();
        expect(colorClass).not.toBe("");
        expect($el.hasClass(colorClass)).toBe(true);
        // an icon span is prepended (source lines 444-449); getIcon() yields the iconClass labels
        const $iconSpan = $el.children("span").first();
        expect($iconSpan.length).toBe(1);
        expect($iconSpan.hasClass("bx-star")).toBe(true);
    });

    it("uses the element's own href and finds the inner anchor when none is passed", async () => {
        const note = buildNote({ title: "Inner" });
        const $a = $("<a>").attr("href", `#root/${note.noteId}`);
        const $el = $("<span>").append($a);
        await linkService.loadReferenceLinkTitle($el);
        expect($el.text()).toContain("Inner");
    });

    it("renders the title without color class / icon when the note is not found", async () => {
        const orig = froca.getNote;
        // First lookup (for color/icon) returns null; getReferenceLinkTitle also returns missing note.
        froca.getNote = vi.fn(async () => null) as typeof froca.getNote;
        const $a = $("<a>").attr("href", "#root/aaaaaaaaaaaa");
        const $el = $("<span>").append($a);
        await linkService.loadReferenceLinkTitle($el, "#root/aaaaaaaaaaaa");
        expect($el.text()).toBe("[missing note]");
        // no color class span and no prepended icon since the note was absent
        expect($el.find("small").length).toBe(0);
        froca.getNote = orig;
    });

    it("does not prepend an icon when the resolved note has no icon", async () => {
        const note = buildNote({ title: "NoIconRef" });
        note.getIcon = (() => "") as typeof note.getIcon;
        const $a = $("<a>").attr("href", `#root/${note.noteId}`);
        const $el = $("<span>").append($a);
        await linkService.loadReferenceLinkTitle($el, `#root/${note.noteId}`);
        expect($el.text()).toContain("NoIconRef");
        expect($el.children("span").length).toBe(0);
    });
});

describe("module-level click handlers", () => {
    it("prevents default paste on middle mouse button down on an anchor", () => {
        const $a = $("<a href='#root/aaaaaaaaaaaa'>link</a>");
        $("body").append($a);
        const preventDefault = vi.fn();
        $a.trigger($.Event("mousedown", { which: 2, preventDefault }));
        expect(preventDefault).toHaveBeenCalled();
        $a.remove();
    });

    it("invokes the delegated goToLink handler on a click", () => {
        const $a = $("<a href='#root/aaaaaaaaaaaa'>link</a>");
        $("body").append($a);
        $a.trigger($.Event("click", { which: 1 }));
        // goToLink -> goToLinkExt should attempt to open the note in the current context
        expect(openInCurrentNoteContext).toHaveBeenCalled();
        $a.remove();
    });

    it("leaves navigation to content that handles its own clicks (no-link-navigation)", () => {
        // A media player inside a collection card: the card is itself a link (it wires its own click straight
        // to goToLink), so pressing play in the player must not also open the note.
        const $card = $("<div class='block-link' data-href='#root/aaaaaaaaaaaa'></div>");
        $card.append("<div class='no-link-navigation'><button class='play'></button></div>");
        $("body").append($card);

        const clickOn = (el: HTMLElement | undefined) =>
            linkService.goToLink($.Event("click", { which: 1, target: el }) as unknown as JQuery.ClickEvent);

        clickOn($card.find(".play")[0]);
        expect(openInCurrentNoteContext).not.toHaveBeenCalled();

        // A click on the card outside that content still navigates.
        clickOn($card[0]);
        expect(openInCurrentNoteContext).toHaveBeenCalled();
        $card.remove();
    });

    it("opens the link context menu on contextmenu of an internal link", () => {
        const $a = $("<a href='#root/aaaaaaaaaaaa'>link</a>");
        $("body").append($a);
        $a.trigger($.Event("contextmenu", { button: 2 }));
        expect(openContextMenu).toHaveBeenCalled();
        $a.remove();
    });

    it("skips the context menu when the link opts out via data-no-context-menu", () => {
        const $a = $("<a href='#root/aaaaaaaaaaaa' data-no-context-menu='1'>link</a>");
        $("body").append($a);
        $a.trigger($.Event("contextmenu", { button: 2 }));
        expect(openContextMenu).not.toHaveBeenCalled();
        $a.remove();
    });

    it("does nothing on context menu when the link has no resolvable note path", () => {
        const $a = $("<a href='https://example.com'>ext</a>");
        $("body").append($a);
        $a.trigger($.Event("contextmenu", { button: 2 }));
        expect(openContextMenu).not.toHaveBeenCalled();
        $a.remove();
    });

    it("opens a popup on ctrl+right-click of an internal link", () => {
        const spy = vi.spyOn(utils, "isCtrlKey").mockReturnValue(true);
        const $a = $("<a href='#root/aaaaaaaaaaaa'>link</a>");
        $("body").append($a);
        $a.trigger($.Event("contextmenu", { button: 2 }));
        expect(triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "root/aaaaaaaaaaaa" });
        spy.mockRestore();
        $a.remove();
    });

    it("falls back to data-href when an anchor has no href (click handler)", () => {
        const $a = $("<a data-href='#root/aaaaaaaaaaaa'>link</a>");
        $("body").append($a);
        $a.trigger($.Event("click", { which: 1 }));
        expect(openInCurrentNoteContext).toHaveBeenCalled();
        $a.remove();
    });

    it("falls back to data-href when an anchor has no href (context menu handler)", () => {
        const $a = $("<a data-href='#root/aaaaaaaaaaaa'>link</a>");
        $("body").append($a);
        $a.trigger($.Event("contextmenu", { button: 2 }));
        expect(openContextMenu).toHaveBeenCalled();
        $a.remove();
    });

    it("does not prevent default on a left mouse button down", () => {
        const $a = $("<a href='#root/aaaaaaaaaaaa'>link</a>");
        $("body").append($a);
        const preventDefault = vi.fn();
        $a.trigger($.Event("mousedown", { which: 1, preventDefault }));
        expect(preventDefault).not.toHaveBeenCalled();
        $a.remove();
    });
});
