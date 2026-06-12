import { OptionNames } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FAttribute from "../entities/fattribute";
import FNote from "../entities/fnote";
import froca from "../services/froca";
import noteAttributeCache from "../services/note_attribute_cache";
import options from "../services/options";
import { buildNote } from "../test/easy-froca";
import { fakeNoteContext, flush, makeLoadResults, renderComponent, renderHook, resetFroca } from "../test/render";
import SharedInfo, { useShareInfo } from "./shared_info";

// --- Helpers --------------------------------------------------------------------------------------

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

/** Builds `_share` as the parent of a note so `note.hasAncestor("_share")` is satisfied. */
function buildSharedNote(childDef: Parameters<typeof buildNote>[0]): FNote {
    buildNote({ id: "_share", title: "Shared Notes", children: [ childDef ] });
    const child = froca.notes[childDef.id ?? ""];
    if (!child) {
        throw new Error("expected the child note to be built");
    }
    return child;
}

let savedElectronApi: PropertyDescriptor | undefined;

beforeEach(() => {
    setOptions({});
    resetFroca();
    vi.clearAllMocks();
    savedElectronApi = Object.getOwnPropertyDescriptor(window, "electronApi");
    delete (window as unknown as Record<string, unknown>).electronApi;
});

afterEach(() => {
    if (savedElectronApi) {
        Object.defineProperty(window, "electronApi", savedElectronApi);
    } else {
        delete (window as unknown as Record<string, unknown>).electronApi;
    }
});

// --- useShareInfo hook ----------------------------------------------------------------------------

describe("useShareInfo", () => {
    it("returns no link for a null note", async () => {
        const harness = renderHook(() => useShareInfo(null));
        await flush();
        expect(harness.result.current.link).toBeUndefined();
        expect(harness.result.current.linkHref).toBeUndefined();
    });

    it("returns no link when the note is not under _share", async () => {
        const note = buildNote({ id: "loose", title: "Loose" });
        const harness = renderHook(() => useShareInfo(note));
        await flush();
        expect(harness.result.current.link).toBeUndefined();
        expect(harness.result.current.linkHref).toBeUndefined();
    });

    it("returns no link for the _share root itself", async () => {
        const root = buildNote({ id: "_share", title: "Shared Notes" });
        const harness = renderHook(() => useShareInfo(root));
        await flush();
        expect(harness.result.current.link).toBeUndefined();
    });

    it("builds a location-based link using the note id when no shareAlias/shareRoot", async () => {
        const note = buildSharedNote({ id: "sharedA", title: "A" });
        const harness = renderHook(() => useShareInfo(note));
        await flush();
        const href = harness.result.current.linkHref;
        expect(href).toContain("share/sharedA");
        expect(href?.startsWith(location.protocol)).toBe(true);
        expect(harness.result.current.link).toContain(`<a href="${href}"`);
        expect(harness.result.current.link).toContain("class=\"external tn-link\"");
    });

    it("uses the shareAlias when present", async () => {
        const note = buildSharedNote({ id: "sharedB", title: "B", "#shareAlias": "my-alias" });
        const harness = renderHook(() => useShareInfo(note));
        await flush();
        expect(harness.result.current.linkHref).toContain("share/my-alias");
        expect(harness.result.current.linkHref).not.toContain("sharedB");
    });

    it("uses an empty share id for a shareRoot note", async () => {
        const note = buildSharedNote({ id: "sharedRoot", title: "Root", "#shareRoot": "true" });
        const harness = renderHook(() => useShareInfo(note));
        await flush();
        expect(harness.result.current.linkHref?.endsWith("share/")).toBe(true);
    });

    it("builds a syncServerHost-based URL when the option is set", async () => {
        setOptions({ syncServerHost: "https://example.com" });
        const note = buildSharedNote({ id: "sharedC", title: "C" });
        const harness = renderHook(() => useShareInfo(note));
        await flush();
        expect(harness.result.current.linkHref).toBe("https://example.com/share/sharedC");
        // On a server (no electronApi) sharing is treated as external/public.
        expect(harness.result.current.isSharedExternally).toBe(true);
    });

    it("reports isSharedExternally=false on electron without a sync server", async () => {
        (window as unknown as Record<string, unknown>).electronApi = {};
        const note = buildSharedNote({ id: "sharedD", title: "D" });
        const harness = renderHook(() => useShareInfo(note));
        await flush();
        expect(harness.result.current.isSharedExternally).toBe(false);
    });

    it("reports isSharedExternally=true on electron when a sync server is configured", async () => {
        (window as unknown as Record<string, unknown>).electronApi = {};
        setOptions({ syncServerHost: "https://sync.example" });
        const note = buildSharedNote({ id: "sharedE", title: "E" });
        const harness = renderHook(() => useShareInfo(note));
        await flush();
        expect(harness.result.current.isSharedExternally).toBe(true);
    });

    it("refreshes when an affecting _share attribute row arrives", async () => {
        const note = buildSharedNote({ id: "sharedF", title: "F" });
        const harness = renderHook(() => useShareInfo(note));
        await flush();
        expect(harness.result.current.linkHref).toContain("share/sharedF");

        // Mutate the SAME cached note so a re-run of refresh() observes a new alias, then fire an
        // affecting attribute row whose name starts with "_share" (the first event branch).
        const aliasAttr = new FAttribute(froca, {
            attributeId: "aliasAttr1",
            noteId: "sharedF",
            type: "label",
            name: "shareAlias",
            value: "after-event",
            position: 10,
            isInheritable: false
        });
        froca.attributes.aliasAttr1 = aliasAttr;
        note.attributes.push("aliasAttr1");
        noteAttributeCache.attributes.sharedF = [ ...(noteAttributeCache.attributes.sharedF ?? []), aliasAttr ];

        harness.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                attributeRows: [ { type: "label", name: "_shareThing", value: "v", noteId: "sharedF", isDeleted: false } ]
            })
        });
        await flush();
        expect(harness.result.current.linkHref).toContain("share/after-event");
    });

    it("refreshes when a matching branch row arrives", async () => {
        const note = buildSharedNote({ id: "sharedG", title: "G" });
        const harness = renderHook(() => useShareInfo(note));
        await flush();
        expect(harness.result.current.linkHref).toContain("share/sharedG");

        harness.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ branchRows: [ { noteId: "sharedG" } ] })
        });
        await flush();
        expect(harness.result.current.linkHref).toContain("share/sharedG");
    });

    it("ignores entitiesReloaded events that neither affect nor match the note", async () => {
        const note = buildSharedNote({ id: "sharedH", title: "H" });
        const harness = renderHook(() => useShareInfo(note));
        await flush();
        const before = harness.result.current.linkHref;

        harness.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                attributeRows: [ { type: "label", name: "title", value: "x", noteId: "other", isDeleted: false } ],
                branchRows: [ { noteId: "unrelated" } ]
            })
        });
        await flush();
        expect(harness.result.current.linkHref).toBe(before);
    });

    it("strips a trailing slash from location.host", async () => {
        const original = Object.getOwnPropertyDescriptor(window, "location");
        Object.defineProperty(window, "location", {
            configurable: true,
            value: { host: "example.org/", protocol: "http:", pathname: "/" }
        });
        try {
            const note = buildSharedNote({ id: "sharedI", title: "I" });
            const harness = renderHook(() => useShareInfo(note));
            await flush();
            expect(harness.result.current.linkHref).toBe("http://example.org/share/sharedI");
        } finally {
            if (original) Object.defineProperty(window, "location", original);
        }
    });
});

// --- SharedInfo component -------------------------------------------------------------------------

describe("SharedInfo component", () => {
    it("renders hidden (display:none) and only the help button when the note is not shared", async () => {
        const note = buildNote({ id: "plain", title: "Plain" });
        const { container } = renderComponent(<SharedInfo />, { noteContext: fakeNoteContext({ note, notePath: `root/${note.noteId}` }) });
        await flush();
        const bar = container.querySelector(".shared-info-widget");
        expect(bar).toBeTruthy();
        expect((bar as HTMLElement).style.display).toBe("none");
        // No link span rendered, only the help button.
        expect(container.querySelector("a.tn-link")).toBeNull();
        expect(container.querySelector("button.bx-help-circle")).toBeTruthy();
    });

    it("renders the share link when the note is shared", async () => {
        const note = buildSharedNote({ id: "sharedComp", title: "Shared" });
        const { container } = renderComponent(<SharedInfo />, { noteContext: fakeNoteContext({ note, notePath: `root/${note.noteId}` }) });
        await flush();
        const bar = container.querySelector(".shared-info-widget") as HTMLElement;
        // A non-hidden bar means useShareInfo produced a link for the shared note.
        expect(bar.style.display).not.toBe("none");
        // The RawHtml span (link message) is rendered alongside the help button.
        expect(container.querySelector(".shared-info-widget > span")).toBeTruthy();
        expect(container.querySelector("button.bx-help-circle")).toBeTruthy();
    });

    it("renders the locally-shared variant on electron without a sync server", async () => {
        (window as unknown as Record<string, unknown>).electronApi = {};
        const note = buildSharedNote({ id: "sharedLocal", title: "Local" });
        const { container } = renderComponent(<SharedInfo />, { noteContext: fakeNoteContext({ note, notePath: `root/${note.noteId}` }) });
        await flush();
        const bar = container.querySelector(".shared-info-widget") as HTMLElement;
        expect(bar.style.display).not.toBe("none");
        expect(container.querySelector(".shared-info-widget > span")).toBeTruthy();
    });
});
