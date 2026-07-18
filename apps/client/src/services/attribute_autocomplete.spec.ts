import { beforeEach, describe, expect, it, vi } from "vitest";
import $ from "jquery";

import server from "./server.js";
import attributeAutocomplete from "./attribute_autocomplete.js";

type Dataset = {
    displayKey: string;
    cache: boolean;
    source: (term: string, cb: (rows: object[]) => void) => void | Promise<void>;
};

// Captures the most recent `$el.autocomplete(config, datasets)` init call so tests
// can invoke the registered `source` callback directly and exercise its body.
let lastDatasets: Dataset[] | undefined;
let autocompleteSpy: ReturnType<typeof vi.fn>;

function registerAutocompleteStub() {
    lastDatasets = undefined;
    autocompleteSpy = vi.fn(function (this: JQuery, config: object | string, datasets?: Dataset[]) {
        if (typeof config === "object" && Array.isArray(datasets)) {
            lastDatasets = datasets;
        }
        return this;
    });
    ($.fn as any).autocomplete = autocompleteSpy;
}

function makeEl(extraClass = "") {
    return $(`<input class="${extraClass}" />`);
}

describe("attribute_autocomplete", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerAutocompleteStub();
    });

    describe("initAttributeNameAutocomplete", () => {
        it("initializes autocomplete, wires the name source and the readonly opened handler", async () => {
            const $el = makeEl();
            server.get = vi.fn(async () => ["foo", "bar"]) as typeof server.get;

            attributeAutocomplete.initAttributeNameAutocomplete({
                $el,
                attributeType: "label",
                open: true
            });

            // init form (config + datasets) followed by the "open" command.
            expect(autocompleteSpy).toHaveBeenCalledWith(
                expect.objectContaining({ openOnFocus: true, minLength: 0 }),
                expect.any(Array)
            );
            expect(autocompleteSpy).toHaveBeenCalledWith("open");
            expect(lastDatasets?.[0].displayKey).toBe("name");
            expect(lastDatasets?.[0].cache).toBe(false);

            // Exercise the source callback with a static attributeType.
            const cb = vi.fn();
            await lastDatasets![0].source("co lor", cb);
            expect(server.get).toHaveBeenCalledWith("attribute-names/?type=label&query=co%20lor");
            expect(cb).toHaveBeenCalledWith([{ name: "foo" }, { name: "bar" }]);

            // readonly element -> opened handler closes the autocomplete.
            $el.attr("readonly", "readonly");
            $el.trigger("autocomplete:opened");
            expect(autocompleteSpy).toHaveBeenCalledWith("close");
        });

        it("resolves a function attributeType and does not close when not readonly; skips open when open=false", async () => {
            const $el = makeEl();
            server.get = vi.fn(async () => ["x"]) as typeof server.get;

            attributeAutocomplete.initAttributeNameAutocomplete({
                $el,
                attributeType: () => "relation",
                open: false
            });

            // open=false -> the "open" command is never issued.
            expect(autocompleteSpy).not.toHaveBeenCalledWith("open");

            const cb = vi.fn();
            await lastDatasets![0].source("q", cb);
            expect(server.get).toHaveBeenCalledWith("attribute-names/?type=relation&query=q");

            // not readonly -> opened handler does NOT close.
            $el.trigger("autocomplete:opened");
            expect(autocompleteSpy).not.toHaveBeenCalledWith("close");
        });

        it("skips re-initialization when the element already has the aa-input class", () => {
            const $el = makeEl("aa-input");

            attributeAutocomplete.initAttributeNameAutocomplete({
                $el,
                attributeType: "label",
                open: false
            });

            // Already initialized -> no init call (config+datasets) was made.
            expect(lastDatasets).toBeUndefined();
            expect(autocompleteSpy).not.toHaveBeenCalled();
        });
    });

    describe("initLabelValueAutocomplete", () => {
        it("returns early without a nameCallback (empty attribute name)", async () => {
            const $el = makeEl();
            server.get = vi.fn(async () => ["v"]) as typeof server.get;

            await attributeAutocomplete.initLabelValueAutocomplete({ $el, open: true });

            expect(server.get).not.toHaveBeenCalled();
            expect(autocompleteSpy).not.toHaveBeenCalled();
        });

        it("returns early when the nameCallback yields a blank name", async () => {
            const $el = makeEl();
            server.get = vi.fn(async () => ["v"]) as typeof server.get;

            await attributeAutocomplete.initLabelValueAutocomplete({
                $el,
                open: true,
                nameCallback: () => "   "
            });

            expect(server.get).not.toHaveBeenCalled();
        });

        it("returns early when no attribute values are returned", async () => {
            const $el = makeEl();
            server.get = vi.fn(async () => []) as typeof server.get;

            await attributeAutocomplete.initLabelValueAutocomplete({
                $el,
                open: true,
                nameCallback: () => "color"
            });

            expect(server.get).toHaveBeenCalledWith("attribute-values/color");
            expect(autocompleteSpy).not.toHaveBeenCalledWith(expect.any(Object), expect.any(Array));
        });

        it("destroys an existing instance, inits the value source, filters case-insensitively and closes on readonly", async () => {
            const $el = makeEl("aa-input");
            server.get = vi.fn(async () => ["Apple", "Banana", "Cherry"]) as typeof server.get;

            await attributeAutocomplete.initLabelValueAutocomplete({
                $el,
                open: true,
                nameCallback: () => "my color"
            });

            // aa-input present -> destroy was called before re-init.
            expect(autocompleteSpy).toHaveBeenCalledWith("destroy");
            expect(server.get).toHaveBeenCalledWith("attribute-values/my%20color");
            expect(autocompleteSpy).toHaveBeenCalledWith(
                expect.objectContaining({ openOnFocus: false }),
                expect.any(Array)
            );
            expect(autocompleteSpy).toHaveBeenCalledWith("open");
            expect(lastDatasets?.[0].displayKey).toBe("value");

            // source filters by lower-cased substring ("AN" -> "an" matches only "Banana").
            const cb = vi.fn();
            await lastDatasets![0].source("AN", cb);
            expect(cb).toHaveBeenCalledWith([{ value: "Banana" }]);

            // readonly -> opened handler closes.
            $el.attr("readonly", "readonly");
            $el.trigger("autocomplete:opened");
            expect(autocompleteSpy).toHaveBeenCalledWith("close");
        });

        it("does not destroy when not aa-input, does not open when open=false, and keeps the dropdown open when not readonly", async () => {
            const $el = makeEl();
            server.get = vi.fn(async () => ["a"]) as typeof server.get;

            await attributeAutocomplete.initLabelValueAutocomplete({
                $el,
                open: false,
                nameCallback: () => "tag"
            });

            expect(autocompleteSpy).not.toHaveBeenCalledWith("destroy");
            expect(autocompleteSpy).not.toHaveBeenCalledWith("open");

            // not readonly -> opened handler does not close.
            $el.trigger("autocomplete:opened");
            expect(autocompleteSpy).not.toHaveBeenCalledWith("close");
        });
    });
});
