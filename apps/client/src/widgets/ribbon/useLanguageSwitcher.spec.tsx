import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The note's `#language`, which has no options entry to drive it through. */
const state = vi.hoisted(() => ({ noteLanguage: null as string | null }));

// The real hooks module pulls in app_context and the keyboard actions at module scope. Only the two
// readers the switcher uses matter here, so stub the module rather than boot half the app.
//
// `useTriliumOption` reads the real options store rather than a map of its own: `resolveContentLanguage`
// reads that store directly, and a separate fixture would let the two disagree — which is exactly the
// bug this suite would then fail to catch.
vi.mock("../react/hooks", async () => {
    const options = (await import("../../services/options")).default;
    type OptionNames = Parameters<typeof options.get>[0];
    return {
        useTriliumOption: (name: OptionNames) => [ options.get(name), vi.fn() ],
        useNoteLabel: () => [ state.noteLanguage, vi.fn() ],
        useNoteLabelBoolean: () => [ false, vi.fn() ],
        useNoteProperty: () => undefined,
        useTriliumEvent: () => {}
    };
});

// t() echoes the key with its interpolation, so assertions can name the resolved language without
// depending on the English wording.
vi.mock("../../services/i18n", async () => {
    const { LOCALES } = await import("@triliumnext/commons");
    return {
        t: (key: string, opts?: { language?: string }) => (opts?.language ? `${key}|${opts.language}` : key),
        getAvailableLocales: () => LOCALES,
        getLocaleById: (id: string | null | undefined) => LOCALES.find((l) => l.id === id) ?? null
    };
});

import options from "../../services/options";
import { useLanguageSwitcher } from "./BasicPropertiesTab";

type Switcher = ReturnType<typeof useLanguageSwitcher>;

/** Renders the hook and hands back what it returned. */
function runHook(): Switcher {
    let result: Switcher | undefined;
    function Probe() {
        result = useLanguageSwitcher(null);
        return null;
    }

    const container = document.createElement("div");
    render(<Probe />, container);
    render(null, container);

    if (!result) throw new Error("the hook did not run");
    return result;
}

afterEach(() => {
    state.noteLanguage = null;
    options.set("defaultContentLanguage", "");
    options.set("locale", "");
});

describe("useLanguageSwitcher", () => {
    it("names the resolved default in the entry that used to just say 'no language set'", () => {
        options.set("defaultContentLanguage", "de");

        // The interpolated name is the point: the entry has to say *which* language is in force.
        expect(runHook().DEFAULT_LOCALE.name).toBe("note_language.not_set_with_default|Deutsch");
    });

    it("follows the application's language when the default is the empty 'auto' entry", () => {
        options.set("defaultContentLanguage", "");
        options.set("locale", "fr");

        expect(runHook().DEFAULT_LOCALE.name).toBe("note_language.not_set_with_default|Français");
    });

    it("falls back to the bare wording when nothing resolves", () => {
        expect(runHook().DEFAULT_LOCALE.name).toBe("note_language.not_set");
    });

    it("keeps the empty id, which is the sentinel that clears the label", () => {
        options.set("defaultContentLanguage", "de");

        expect(runHook().DEFAULT_LOCALE.id).toBe("");
    });

    it("reports the effective locale as the note's own when it has one, else the default", () => {
        options.set("defaultContentLanguage", "de");

        // No `#language`: the note is written in the default.
        expect(runHook().effectiveLocale?.id).toBe("de");

        // An explicit language wins, and is not dragged to the default.
        state.noteLanguage = "fr";
        expect(runHook().effectiveLocale?.id).toBe("fr");
    });

    it("reports no effective locale for a language outside the catalog", () => {
        state.noteLanguage = "not-a-locale";

        // Better to render nothing than to claim the note is in the default language.
        expect(runHook().effectiveLocale).toBeNull();
    });
});
