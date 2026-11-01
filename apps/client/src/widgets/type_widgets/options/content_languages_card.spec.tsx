import { LOCALES } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type Component from "../../../components/component";
import dialog from "../../../services/dialog";
import type LoadResults from "../../../services/load_results";
import options from "../../../services/options";
import { renderInto } from "../../../test/render";
import type { PickerItem } from "../../dialogs/item_picker";
import { ParentComponent } from "../../react/react_utils";
import { ContentLanguagesCard } from "./content_languages_card";

vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n")>()),
    t: (key: string, values?: Record<string, unknown>) =>
        values ? `${key} ${Object.values(values).join(" ")}` : key
}));

describe("ContentLanguagesCard", () => {
    let originalLanguages: string;

    beforeEach(() => {
        originalLanguages = options.get("languages");
        options.set("languages", JSON.stringify([ "ro", "de", "fr" ]));
    });

    afterEach(() => {
        options.set("languages", originalLanguages);
        window.glob.isDev = false;
        vi.restoreAllMocks();
    });

    it("lists the languages by native name, in alphabetical order and with a globe", () => {
        const container = draw();

        expect(names(container)).toEqual([ "Deutsch", "Français", "Română" ]);
        expect(segments(container).map((element) => element.querySelector(".bx-globe")))
            .not.toContain(null);
        expect(container.querySelector(".tn-sortable-card")).toBeNull();
        expect(container.querySelector(".content-languages-english-name")).toBeNull();
    });

    it("names each language in English as well in a development build", () => {
        window.glob.isDev = true;
        const container = draw();

        expect(segment(container, "Deutsch")
            ?.querySelector(".content-languages-english-name")?.textContent).toBe("German");
    });

    describe("adding a language", () => {
        it("offers the languages not enabled yet, in alphabetical order", async () => {
            const picking = vi.spyOn(dialog, "pickSingleItem").mockResolvedValue(null);
            const container = draw();

            await click(container.querySelector(".tn-card-adder"));

            const items = picking.mock.calls.at(-1)?.[0].items as PickerItem[];
            const keys = items.map((item) => item.key);
            expect(keys).toContain("it");
            expect(keys).not.toContain("de");
            expect(keys).toEqual(LOCALES
                .map((locale) => locale.id)
                .filter((id) => ![ "ro", "de", "fr" ].includes(id)));
            expect(stored()).toEqual([ "ro", "de", "fr" ]);
        });

        it("adds what was picked, keeping the list sorted", async () => {
            vi.spyOn(dialog, "pickSingleItem")
                .mockResolvedValue({ key: "it", caption: "Italiano" });
            const container = draw();

            await click(container.querySelector(".tn-card-adder"));

            expect(stored()).toEqual([ "ro", "de", "fr", "it" ]);
            expect(names(container)).toEqual([ "Deutsch", "Français", "Italiano", "Română" ]);
        });

        it("keeps a language removed elsewhere while the picker is open", async () => {
            let answer: (item: PickerItem | null) => void = () => {};
            vi.spyOn(dialog, "pickSingleItem")
                .mockReturnValue(new Promise((resolve) => { answer = resolve; }));
            const container = draw();

            await click(container.querySelector(".tn-card-adder"));
            act(() => {
                options.set("languages", JSON.stringify([ "ro", "de" ]));
                reloadOption("languages");
            });
            await act(async () => { answer({ key: "it", caption: "Italiano" }); });
            await act(async () => {});

            expect(stored()).toEqual([ "ro", "de", "it" ]);
            expect(names(container)).toEqual([ "Deutsch", "Italiano", "Română" ]);
        });

        it("says how many languages are left to add, as the first one or another", () => {
            expect(draw().querySelector(".tn-card-adder")?.textContent?.trim())
                .toBe(`content_language.add_another ${LOCALES.length - 3}`);

            options.set("languages", "[]");
            expect(draw().querySelector(".tn-card-adder")?.textContent?.trim())
                .toBe(`content_language.add_first ${LOCALES.length}`);
        });
    });

    it("removes a language with its button, handing its focus to the nearest one left", async () => {
        options.set("languages", JSON.stringify([ "ro", "de", "fr", "it" ]));
        const container = draw();
        const removeButton = (name: string) => segment(container, name)
            ?.querySelector<HTMLElement>(".content-languages-remove") ?? null;
        expect(removeButton("Français")).toBeInstanceOf(HTMLElement);

        // Without the focus, there is none to hand on.
        await click(removeButton("Français"));
        expect(stored()).toEqual([ "ro", "de", "it" ]);
        expect(names(container)).toEqual([ "Deutsch", "Italiano", "Română" ]);
        expect(document.activeElement).toBe(document.body);

        act(() => removeButton("Italiano")?.focus());
        await click(removeButton("Italiano"));
        expect(names(container)).toEqual([ "Deutsch", "Română" ]);
        expect(document.activeElement).toBe(removeButton("Română"));

        await click(removeButton("Română"));
        expect(document.activeElement).toBe(removeButton("Deutsch"));

        await click(removeButton("Deutsch"));
        expect(stored()).toEqual([]);
        expect(document.activeElement).toBe(container.querySelector(".tn-card-adder"));
    });
});

type ReloadHandler = (data: { loadResults: LoadResults }) => void;

/** The card's `entitiesReloaded` handlers, which `reloadOption()` calls. */
const reloadHandlers = new Set<ReloadHandler>();

function draw() {
    const parent = {
        registerHandler: (name: string, handler: ReloadHandler) => {
            if (name === "entitiesReloaded") reloadHandlers.add(handler);
        },
        removeHandler: (name: string, handler: ReloadHandler) => {
            if (name === "entitiesReloaded") reloadHandlers.delete(handler);
        }
    } as unknown as Component;

    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentComponent.Provider value={parent}>
                <ContentLanguagesCard heading="Languages" />
            </ParentComponent.Provider>);
    });
    if (!container) throw new Error("The card did not render");
    return container;
}

/** Announces a changed option, the way a change made in another window arrives. */
function reloadOption(name: string) {
    const loadResults = { getOptionNames: () => [ name ] } as unknown as LoadResults;
    for (const handler of reloadHandlers) handler({ loadResults });
}

function stored() {
    return JSON.parse(options.get("languages"));
}

/** The enabled languages, each a section of the card. */
function segments(container: HTMLElement) {
    return [ ...container.querySelectorAll<HTMLElement>(
        ".content-languages-card > .tn-card-body > .tn-card-section.content-languages-item") ];
}

function names(container: HTMLElement) {
    return segments(container)
        .map((element) => element.querySelector(".content-languages-native-name")?.textContent);
}

function segment(container: HTMLElement, name: string) {
    return segments(container).find((element) =>
        element.querySelector(".content-languages-native-name")?.textContent === name) ?? null;
}

/** Clicks and waits for what the click awaits, such as the picker. */
async function click(target: Element | null) {
    await act(async () => {
        target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
}
