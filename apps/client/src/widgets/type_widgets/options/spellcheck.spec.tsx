import { ComponentChildren, render, VNode } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the `onChange` props the wiring under test passes into its children so we can invoke the
// "live apply" handlers directly without depending on the real toggle/checkbox DOM plumbing.
const captured: {
    toggleOnChange?: (enabled: boolean) => void;
    checkboxOnChange?: (codes: string[]) => void;
} = {};

const setSpellCheckEnabled = vi.fn();
const setSpellCheckLanguageCode = vi.fn();

// `useTriliumOptionBool` drives the enabled state, `useTriliumOption` drives the language codes; both
// return the value plus a setter spy so we can assert the persisted option is written. Partial-mock so
// other hooks used by sibling components (e.g. `useUniqueName` in OptionsRow) keep their real impl.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useTriliumOptionBool: vi.fn(() => [true, setSpellCheckEnabled]),
    useTriliumOption: vi.fn(() => ["en-US", setSpellCheckLanguageCode]),
    useNoteContext: vi.fn(() => ({ note: undefined }))
}));

vi.mock("../../../services/utils", async (importActual) => ({
    ...(await importActual<typeof import("../../../services/utils")>()),
    isElectron: vi.fn(() => true)
}));

vi.mock("./components/OptionsPageHeader", () => ({
    default: ({ actions }: { actions?: ComponentChildren }) => <div className="header-stub">{actions}</div>
}));

vi.mock("../../react/FormToggle", () => ({
    default: ({ onChange }: { onChange: (enabled: boolean) => void }) => {
        captured.toggleOnChange = onChange;
        return <div className="toggle-stub" />;
    }
}));

vi.mock("./components/CheckboxList", () => ({
    default: ({ onChange }: { onChange: (codes: string[]) => void }) => {
        captured.checkboxOnChange = onChange;
        return <div className="checkbox-stub" />;
    }
}));

// Import AFTER the mocks (vi.mock is hoisted, but the component import must resolve the mocked deps).
import SpellcheckSettings from "./spellcheck";

let container: HTMLDivElement | undefined;

function renderInto(vnode: VNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);
    return container;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
});

function setElectronApi(api: unknown) {
    (window as unknown as { electronApi?: unknown }).electronApi = api;
}

function spellcheckApiStub() {
    return {
        setSpellCheckerEnabled: vi.fn(),
        setSpellCheckerLanguages: vi.fn(),
        getAvailableSpellCheckerLanguages: vi.fn(() => ["en-US", "de-DE"]),
        addWordToDictionary: vi.fn()
    };
}

describe("SpellcheckSettings live apply", () => {
    beforeEach(() => {
        captured.toggleOnChange = undefined;
        captured.checkboxOnChange = undefined;
        vi.clearAllMocks();
    });

    it("persists the option AND applies to live Electron sessions for both toggle and languages", () => {
        const spellcheck = spellcheckApiStub();
        setElectronApi({ spellcheck });

        renderInto(<SpellcheckSettings />);

        const toggleOnChange = captured.toggleOnChange;
        const checkboxOnChange = captured.checkboxOnChange;
        expect(toggleOnChange).toBeDefined();
        expect(checkboxOnChange).toBeDefined();

        toggleOnChange?.(false);
        expect(setSpellCheckEnabled).toHaveBeenCalledWith(false);
        expect(spellcheck.setSpellCheckerEnabled).toHaveBeenCalledWith(false);

        checkboxOnChange?.(["en-US", "de-DE"]);
        expect(setSpellCheckLanguageCode).toHaveBeenCalledWith("en-US, de-DE");
        expect(spellcheck.setSpellCheckerLanguages).toHaveBeenCalledWith(["en-US", "de-DE"]);
    });

    it("does not throw when window.electronApi is undefined (web/server build no-op)", () => {
        setElectronApi(undefined);

        renderInto(<SpellcheckSettings />);

        const toggleOnChange = captured.toggleOnChange;
        const checkboxOnChange = captured.checkboxOnChange;
        expect(toggleOnChange).toBeDefined();
        expect(checkboxOnChange).toBeDefined();

        expect(() => toggleOnChange?.(true)).not.toThrow();
        expect(() => checkboxOnChange?.(["fr-FR"])).not.toThrow();

        // The persisted option is still written even without the Electron bridge.
        expect(setSpellCheckEnabled).toHaveBeenCalledWith(true);
        expect(setSpellCheckLanguageCode).toHaveBeenCalledWith("fr-FR");
    });
});
