import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import { ReactWrappedWidget } from "../widgets/basic_widget.js";
import bundleService, { Bundle, executeBundle, executeBundleWithoutErrorHandling, WidgetsByParent } from "./bundle";
import server from "./server.js";
import * as toast from "./toast";
import ws from "./ws.js";

// `bundle.ts` references a bare global `logError(...)` in its catch branches (normally set on
// `window` by ws.ts, which is globally mocked here). Provide it so the catch paths don't throw.
beforeAll(() => {
    (window as any).logError = vi.fn();
    (ws as any).waitForMaxKnownEntityChangeId = vi.fn(async () => {});
});

describe("Script bundle", () => {
    it("dayjs is available", async () => {
        const script = /* js */`return api.dayjs().format("YYYY-MM-DD");`;
        const bundle = getBundle(script);
        const result = await executeBundle(bundle, null, $());
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("dayjs is-same-or-before plugin exists", async () => {
        const script = /* js */`return api.dayjs("2023-10-01").isSameOrBefore(api.dayjs("2023-10-02"));`;
        const bundle = getBundle(script);
        const result = await executeBundle(bundle, null, $());
        expect(result).toBe(true);
    });
});

describe("executeBundle / executeBundleWithoutErrorHandling", () => {
    it("executeBundleWithoutErrorHandling propagates script errors", async () => {
        const id = buildNote({ title: "Throwing note" }).noteId;
        const bundle: Bundle = {
            script: `throw new Error("boom");`,
            html: "",
            noteId: id,
            allNoteIds: [id]
        };
        await expect(executeBundleWithoutErrorHandling(bundle, null)).rejects.toThrow("boom");
    });

    it("executeBundle swallows errors and reports them via showErrorForScriptNote + logError", async () => {
        const id = buildNote({ title: "Throwing note" }).noteId;
        const spy = vi.spyOn(toast, "showErrorForScriptNote").mockResolvedValue(undefined);
        const bundle: Bundle = {
            script: `throw new Error("kaboom");`,
            html: "",
            noteId: id,
            allNoteIds: [id]
        };
        const result = await executeBundle(bundle, null);
        expect(result).toBeUndefined();
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls[0][0]).toBe(id);
        expect((window as any).logError).toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe("getAndExecuteBundle (default export)", () => {
    it("posts to script/bundle and executes the returned bundle", async () => {
        const id = buildNote({ title: "Posted note" }).noteId;
        const bundle: Bundle = {
            script: `return 41 + 1;`,
            html: "",
            noteId: id,
            allNoteIds: [id]
        };
        const postSpy = vi.fn(async () => bundle);
        server.post = postSpy as unknown as typeof server.post;

        const result = await bundleService.getAndExecuteBundle(id);
        expect(postSpy).toHaveBeenCalledWith(`script/bundle/${id}`, { script: null, params: null });
        expect(result).toBe(42);
    });
});

describe("executeStartupBundles (default export)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (window as any).logError = vi.fn();
    });

    it("requests non-mobile startup scripts and executes each bundle", async () => {
        const id = buildNote({ title: "Startup note" }).noteId;
        // The script runs inside the eval'd bundle body, so a write to `window` is an observable
        // side effect proving the bundle was actually executed (not merely fetched).
        delete (window as any).__startupRan;
        const bundles: Bundle[] = [{
            script: `window.__startupRan = true;`,
            html: "",
            noteId: id,
            allNoteIds: [id]
        }];
        const getSpy = vi.fn(async () => bundles);
        server.get = getSpy as unknown as typeof server.get;
        const utils = (await import("./utils.js")).default;
        vi.spyOn(utils, "isMobile").mockReturnValue(false);

        await bundleService.executeStartupBundles();
        expect(getSpy).toHaveBeenCalledWith("script/startup");
        // The for-loop that calls executeBundle(bundle) actually ran the seeded script.
        expect((window as any).__startupRan).toBe(true);
        delete (window as any).__startupRan;
    });

    it("requests mobile startup scripts when on mobile", async () => {
        const getSpy = vi.fn(async () => [] as Bundle[]);
        server.get = getSpy as unknown as typeof server.get;
        const utils = (await import("./utils.js")).default;
        vi.spyOn(utils, "isMobile").mockReturnValue(true);

        await bundleService.executeStartupBundles();
        expect(getSpy).toHaveBeenCalledWith("script/startup?mobile=true");
    });
});

describe("WidgetsByParent", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(toast, "showErrorForScriptNote").mockResolvedValue(undefined);
        errorSpy.mockClear();
    });

    function legacyWidget(noteId: string, parentWidget?: string) {
        return { _noteId: noteId, parentWidget } as any;
    }

    it("add() registers a legacy widget under its parentWidget", () => {
        const w = new WidgetsByParent();
        w.add(legacyWidget("note-legacy", "left-pane"));
        expect(errorSpy).not.toHaveBeenCalled();
        expect(w.getLegacyWidgets("left-pane")).toHaveLength(1);
        expect(w.getLegacyWidgets("right-pane")).toEqual([]);
    });

    it("add() instantiates legacy widgets provided as a class (prototype)", () => {
        const w = new WidgetsByParent();
        class MyWidget {
            _noteId = "note-class";
        }
        // The class carries a static `parentWidget` so add() registers it, and it has a `.prototype`
        // so getLegacyWidgets() instantiates it (rather than using the instance directly).
        (MyWidget as any).parentWidget = "center-pane";
        w.add(MyWidget as any);
        const widgets = w.getLegacyWidgets("center-pane");
        expect(widgets).toHaveLength(1);
        expect(widgets[0]).toBeInstanceOf(MyWidget);
    });

    it("add() registers a preact widget under its parent", () => {
        const w = new WidgetsByParent();
        const preactWidget = {
            _noteId: "note-preact",
            type: "preact-widget",
            parent: "right-pane",
            render: () => null,
            position: 25
        } as any;
        w.add(preactWidget);
        expect(errorSpy).not.toHaveBeenCalled();
        expect(w.getPreactWidgets("right-pane")).toHaveLength(1);
        expect(w.getPreactWidgets("left-pane")).toEqual([]);
    });

    it("add() reports an error for a legacy widget without a parentWidget", () => {
        const w = new WidgetsByParent();
        w.add(legacyWidget("note-orphan"));
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toBe("note-orphan");
    });

    it("add() reports an error for a preact widget without a parent", () => {
        const w = new WidgetsByParent();
        const preactWidget = {
            _noteId: "note-preact-orphan",
            type: "preact-widget",
            parent: "",
            render: () => null
        } as any;
        w.add(preactWidget);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toBe("note-preact-orphan");
    });

    it("get() returns legacy widgets plus rendered+positioned preact widgets", () => {
        const w = new WidgetsByParent();
        w.add(legacyWidget("note-legacy", "right-pane"));
        w.add({
            _noteId: "note-preact",
            type: "preact-widget",
            parent: "right-pane",
            render: () => null,
            position: 77
        } as any);

        const widgets = w.get("right-pane");
        // one legacy + one wrapped preact widget
        expect(widgets).toHaveLength(2);
        const wrapped = widgets[1] as any;
        expect(wrapped.position).toBe(77);
    });

    it("get() wraps a preact widget without a position without overriding it", () => {
        const w = new WidgetsByParent();
        w.add({
            _noteId: "note-preact",
            type: "preact-widget",
            parent: "right-pane",
            render: () => null
        } as any);

        const widgets = w.get("right-pane");
        expect(widgets).toHaveLength(1);
        // No position was supplied, so the `if (preactWidget.position)` branch is skipped and the
        // wrapped widget keeps the ReactWrappedWidget default `_position` (undefined) rather than
        // being overridden to a falsy value.
        const wrapped = widgets[0] as any;
        expect(wrapped).toBeInstanceOf(ReactWrappedWidget);
        expect(wrapped.position).toBeUndefined();
    });
});

describe("getWidgetBundlesByParent (default export)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (window as any).logError = vi.fn();
    });

    it("executes widget bundles, tags them with noteId, and adds them by parent", async () => {
        const id = buildNote({ title: "Widget note" }).noteId;
        // bundle returns a widget object that becomes a legacy widget once tagged with _noteId
        const bundle: Bundle = {
            script: `return { parentWidget: "left-pane" };`,
            html: "",
            noteId: id,
            allNoteIds: [id]
        };
        server.get = vi.fn(async (url: string) => {
            if (url === "script/widgets") return [bundle];
            return [];
        }) as unknown as typeof server.get;

        const result = await bundleService.getWidgetBundlesByParent();
        const widgets = result.getLegacyWidgets("left-pane");
        expect(widgets).toHaveLength(1);
        expect((widgets[0] as any)._noteId).toBe(id);
    });

    it("ignores bundles that produce no widget (falsy return)", async () => {
        const id = buildNote({ title: "Empty widget note" }).noteId;
        const bundle: Bundle = {
            script: `return undefined;`,
            html: "",
            noteId: id,
            allNoteIds: [id]
        };
        server.get = vi.fn(async (url: string) => {
            if (url === "script/widgets") return [bundle];
            return [];
        }) as unknown as typeof server.get;

        const result = await bundleService.getWidgetBundlesByParent();
        expect(result.getLegacyWidgets("left-pane")).toEqual([]);
    });

    it("reports a per-bundle error when executing a single bundle throws", async () => {
        const id = buildNote({ title: "Bad widget note" }).noteId;
        const errorSpy = vi.spyOn(toast, "showErrorForScriptNote").mockResolvedValue(undefined);
        // executeBundleWithoutErrorHandling needs the note to resolve in froca; force the per-bundle
        // try/catch by making add() throw on a widget that has neither parent nor parentWidget while
        // also having a falsy _noteId is not enough — instead throw during execution by referencing
        // an unknown allNoteId so ScriptContext can't build the api, surfacing inside executeBundle's
        // own handler. To exercise getWidgetBundlesByParent's inner catch we make add() throw.
        const w = new WidgetsByParent();
        const addSpy = vi.spyOn(WidgetsByParent.prototype, "add").mockImplementation(() => {
            throw new Error("add failed");
        });
        const bundle: Bundle = {
            script: `return { parentWidget: "left-pane" };`,
            html: "",
            noteId: id,
            allNoteIds: [id]
        };
        server.get = vi.fn(async (url: string) => {
            if (url === "script/widgets") return [bundle];
            return [];
        }) as unknown as typeof server.get;

        const result = await bundleService.getWidgetBundlesByParent();
        expect(addSpy).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
        expect(errorSpy.mock.calls[0][0]).toBe(id);
        expect((window as any).logError).toHaveBeenCalled();
        expect(result).toBeInstanceOf(WidgetsByParent);
        void w;
        addSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it("shows a persistent toast when fetching the widget list fails", async () => {
        const persistentSpy = vi.spyOn(toast.default, "showPersistent").mockReturnValue(undefined as any);
        server.get = vi.fn(async (url: string) => {
            if (url === "script/widgets") throw new Error("list fetch failed");
            return [];
        }) as unknown as typeof server.get;

        const result = await bundleService.getWidgetBundlesByParent();
        expect(persistentSpy).toHaveBeenCalledWith(expect.objectContaining({
            id: "custom-widget-list-failure",
            icon: "bx bx-error-circle"
        }));
        expect(result).toBeInstanceOf(WidgetsByParent);
        persistentSpy.mockRestore();
    });
});

function getBundle(script: string) {
    const id = buildNote({
        title: "Script note"
    }).noteId;
    const bundle: Bundle = {
        script: [
            '',
            `apiContext.modules['${id}'] = { exports: {} };`,
            `return await ((async function(exports, module, require, api) {`,
            `try {`,
            `${script}`,
            `;`,
            `} catch (e) { throw new Error(\"Load of script note \\\"Client\\\" (${id}) failed with: \" + e.message); }`,
            `for (const exportKey in exports) module.exports[exportKey] = exports[exportKey];`,
            `return module.exports;`,
            `}).call({}, {}, apiContext.modules['${id}'], apiContext.require([]), apiContext.apis['${id}']));`,
            ''
        ].join('\n'),
        html: "",
        noteId: id,
        allNoteIds: [ id ]
    };
    return bundle;
}
