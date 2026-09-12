import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    electron: true,
    enabled: true,
    languageCode: "en-US",
    saved: [] as [ string, string | boolean ][],
    triggerCommand: vi.fn(),
    spellcheck: {
        setSpellCheckerEnabled: vi.fn(),
        setSpellCheckerLanguages: vi.fn(),
        getAvailableSpellCheckerLanguages: vi.fn(() => [ "de-DE", "en-US" ]),
        addWordToDictionary: vi.fn()
    }
}));

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

// The page is desktop-only; a server build has no spell checker of its own to configure.
vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    isElectron: () => mocks.electron
}));

vi.mock("../../../components/app_context", () => ({
    default: { triggerCommand: mocks.triggerCommand }
}));

vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOption: (name: string) => [
        mocks.languageCode,
        (value: string) => void mocks.saved.push([ name, value ])
    ],
    useTriliumOptionBool: (name: string) => [
        mocks.enabled,
        (value: boolean) => void mocks.saved.push([ name, value ])
    ]
}));

vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ below }: { below?: preact.ComponentChildren }) => <div className="header-stub">{below}</div>
}));

import SpellcheckSettings from "./spellcheck";

let host: HTMLElement;

beforeEach(() => {
    mocks.electron = true;
    mocks.enabled = true;
    mocks.languageCode = "en-US";
    mocks.saved = [];
    (window as unknown as { electronApi: unknown }).electronApi = { spellcheck: mocks.spellcheck };
    host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
    render(null, host);
    document.body.innerHTML = "";
    delete (window as unknown as { electronApi?: unknown }).electronApi;
    vi.clearAllMocks();
});

function open() {
    act(() => {
        render(null, host);
        render(<SpellcheckSettings />, host);
    });
}

const cardHeadings = () =>
    [ ...host.querySelectorAll(".tn-card-heading") ].map((heading) => heading.firstChild?.textContent);
const masterSwitch = () => host.querySelector<HTMLInputElement>(".header-stub input.switch-toggle");

describe("the spellcheck page on a server build", () => {
    it("says the page has nothing to offer here, rather than showing settings that do nothing", () => {
        mocks.electron = false;
        open();

        expect(host.querySelector(".no-items")).not.toBeNull();
        expect(host.querySelector(".tn-card")).toBeNull();
    });
});

describe("the master switch", () => {
    it("stands in the header, since everything on the page hangs off it", () => {
        open();

        expect(masterSwitch()).not.toBeNull();
        expect(masterSwitch()?.closest(".tn-card")).toBeNull();
    });

    it("brings out the languages and the dictionary only once spellchecking is on", () => {
        open();
        expect(cardHeadings()).toEqual([
            "spellcheck.language_code_label",
            "spellcheck.custom_dictionary_title"
        ]);

        mocks.enabled = false;
        open();
        // The switch is the page: nothing stands in for what it turns off.
        expect(cardHeadings()).toEqual([]);
        expect(masterSwitch()).not.toBeNull();
    });
});

describe("choosing the languages", () => {
    it("offers what the checker actually has, named in the reader's own language and sorted by it", () => {
        open();

        const labels = [ ...host.querySelectorAll(".spellcheck-languages label") ].map((label) => label.textContent?.trim());
        expect(labels).toHaveLength(2);
        expect(labels).toEqual([ ...labels ].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
    });

    it("reads the stored codes as a list, whatever spacing they were written with", () => {
        mocks.languageCode = " en-US , de-DE ";
        open();

        const ticked = [ ...host.querySelectorAll<HTMLInputElement>(".spellcheck-languages input") ]
            .filter((box) => box.checked);
        expect(ticked).toHaveLength(2);
    });

    it("stores nothing at all when the checker offers no languages", () => {
        mocks.spellcheck.getAvailableSpellCheckerLanguages.mockReturnValueOnce([]);
        open();

        expect(host.querySelectorAll(".spellcheck-languages input")).toHaveLength(0);
    });
});

describe("the custom dictionary", () => {
    it("opens the note it is kept in, rather than editing it here", () => {
        open();

        const button = host.querySelector<HTMLButtonElement>("button[name='open-custom-dictionary']");
        act(() => button?.click());

        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "_customDictionary" });
    });
});
