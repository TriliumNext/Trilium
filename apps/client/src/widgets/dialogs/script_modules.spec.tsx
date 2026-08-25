/**
 * The script modules dialog, whose field doubles as the npm spec to install and as a search box.
 *
 * What is held here is when the registry is reached: a search leaves the instance, so it happens
 * only where the row offering it is picked, never while the user types.
 */
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import ScriptModulesDialog from "./script_modules";

// i18next is not initialized under test, so t() returns "". The key stands in for the text, with any
// interpolated values after it, which is enough to tell the rows apart.
vi.mock("../../services/i18n", () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key)
}));

const mocks = vi.hoisted(() => ({
    // Answers whatever is asked until a scenario says otherwise: the option service reaches for the
    // server as it is imported, well before any test runs.
    get: vi.fn(async (url: string) => (url === "options" ? {} : [])),
    post: vi.fn(),
    remove: vi.fn()
}));

vi.mock("../../services/server", () => ({ default: mocks }));

const CHEERIO = { name: "cheerio", version: "1.1.2", description: "Fast, flexible HTML parsing" };

/** The dialog asks for the installed modules on opening; a search answers with whatever is given. */
function mockServer(results: unknown[] | Error = []) {
    mocks.get.mockImplementation(async (url: string) => {
        if (url.startsWith("script-modules/search")) {
            if (results instanceof Error) throw results;
            return results;
        }
        return url === "options" ? {} : [];
    });
}

/** Opens the dialog, as the command that shows it does. */
async function open() {
    const host = new Component();
    renderInto(
        <ParentComponent.Provider value={host}>
            <ScriptModulesDialog />
        </ParentComponent.Provider>
    );

    await act(async () => { await host.handleEvent("showScriptModules", {}); });
    await settle();
}

/** Lets the debounced lookup and anything it started run to completion. */
async function settle() {
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

function field() {
    const input = document.querySelector<HTMLInputElement>(".script-modules-dialog input.script-module-spec-input");
    if (!input) throw new Error("the dialog has no spec field");
    return input;
}

/** Types into the field and runs out the debounced lookup. */
async function type(text: string) {
    const input = field();
    // Two acts: the field has to re-render as open before the effect that schedules the lookup runs,
    // so advancing the timers in the same act would find nothing scheduled.
    await act(async () => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
}

/** The rows on offer. The dropdown is portalled to the body, so it is looked for there. */
function rows() {
    return [ ...document.querySelectorAll<HTMLElement>(".form-autocomplete-dropdown li") ];
}

function labels() {
    return rows().map((row) => row.querySelector(".form-autocomplete-entry-name")?.textContent ?? row.textContent);
}

async function pick(index: number) {
    await act(async () => { rows()[index].click(); });
    await settle();
}

/** What the registry was asked, for the searches that reached it. */
function searches() {
    return mocks.get.mock.calls.map(([ url ]) => url as string)
        .filter((url) => url.startsWith("script-modules/search"));
}

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    mocks.get.mockClear();
    mocks.post.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("ScriptModulesDialog", () => {
    it("offers to search rather than searching while the user types", async () => {
        mockServer([ CHEERIO ]);
        await open();

        await type("cheerio");

        expect(labels()).toEqual([ "script_modules.search_online(cheerio)" ]);
        expect(searches()).toEqual([]);
    });

    it("searches the registry once the row offering it is picked, and lists what came back", async () => {
        mockServer([ CHEERIO ]);
        await open();
        await type("cheerio");

        await pick(0);

        expect(searches()).toEqual([ "script-modules/search?q=cheerio" ]);
        expect(labels()).toEqual([ "cheerio@1.1.2" ]);
        expect(rows()[0].textContent).toContain("Fast, flexible HTML parsing");
    });

    it("puts the exact version of a picked package in the field, ready to install", async () => {
        mockServer([ CHEERIO ]);
        await open();
        await type("cheerio");
        await pick(0);

        await pick(0);

        expect(field().value).toBe("cheerio@1.1.2");
        // The list stands down once a package has been taken, the choice having been made.
        expect(rows()).toEqual([]);

        const install = [ ...document.querySelectorAll<HTMLButtonElement>(".script-modules-dialog button") ]
            .find((button) => button.textContent?.includes("script_modules.install"));
        await act(async () => { install?.click(); });
        await settle();

        expect(mocks.post).toHaveBeenCalledWith("script-modules", { spec: "cheerio@1.1.2" });
    });

    it("reports a search that found nothing or failed in the list itself", async () => {
        mockServer([]);
        await open();
        await type("nothing-like-this");
        await pick(0);

        expect(labels()).toEqual([ "script_modules.no_results" ]);

        mockServer(new Error("the registry is unreachable"));
        await type("cheerio");
        await pick(0);

        expect(labels()).toEqual([ "script_modules.search_failed" ]);
        expect(rows()[0].textContent).toContain("the registry is unreachable");
    });
});
