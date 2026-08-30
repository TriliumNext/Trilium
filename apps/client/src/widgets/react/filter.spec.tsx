import { type ComponentChildren, Fragment, render } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";

import { renderInto } from "../../test/render";
import {
    FilterPassthrough, FilterProvider, filterRoleClass, filterText, filterTokens, matchesFilter,
    useFilterMatch, useFilterState, useIsFiltering
} from "./filter";

describe("filterText", () => {
    it("reads text out of anything renderable, and nothing out of what has none", () => {
        expect(filterText("Backups")).toBe("Backups");
        expect(filterText(42)).toBe("42");
        expect(filterText([ "Take", "backups" ])).toBe("Take backups");
        expect(filterText(<b>Backups</b>)).toBe("Backups");
        expect(filterText(<p>Take a <b>backup</b> daily</p>)).toBe("Take a  backup  daily");
        expect(filterText(<Fragment>{[ "Take", <b>backups</b> ]}</Fragment>)).toBe("Take backups");

        expect(filterText(null)).toBe("");
        expect(filterText(undefined)).toBe("");
        expect(filterText(false)).toBe("");
        expect(filterText(<hr />)).toBe("");
    });

    it("cannot see inside a custom component, whose text is only known once it renders", () => {
        function PageTitle() {
            return <span>Backups</span>;
        }

        expect(filterText(<PageTitle />)).toBe("");
        expect(filterText(<p>Backups <PageTitle /></p>)).toBe("Backups  ");
    });
});

describe("filterTokens", () => {
    it("splits a query into terms, ignoring case, accents and spacing", () => {
        expect(filterTokens("Take Backups")).toEqual([ "take", "backups" ]);
        expect(filterTokens("  spaced   out\tterms\n")).toEqual([ "spaced", "out", "terms" ]);
        expect(filterTokens("Modèle Français")).toEqual([ "modele", "francais" ]);
    });

    it("finds no terms in a query holding none", () => {
        expect(filterTokens("")).toEqual([]);
        expect(filterTokens("   ")).toEqual([]);
    });
});

describe("matchesFilter", () => {
    it("passes content holding every term, in any order and as part of a word", () => {
        expect(matchesFilter([ "back" ], "Backup interval")).toBe(true);
        expect(matchesFilter([ "interval", "backup" ], "Backup interval")).toBe(true);
        expect(matchesFilter([ "backup", "daily" ], "Backup interval")).toBe(false);
    });

    it("matches across everything it is given, ignoring case and accents", () => {
        expect(matchesFilter([ "daily" ], "Backup", "Taken daily")).toBe(true);
        expect(matchesFilter([ "modele" ], "Modèle")).toBe(true);
        expect(matchesFilter([ "backup" ], <b>Backups</b>)).toBe(true);
        expect(matchesFilter([ "backup" ], null, undefined)).toBe(false);
    });

    it("passes anything when there are no terms to match", () => {
        expect(matchesFilter([], "Backup")).toBe(true);
        expect(matchesFilter([], null)).toBe(true);
    });
});

describe("filterRoleClass", () => {
    it("names the part content plays, and says nothing where it plays none", () => {
        expect(filterRoleClass("match")).toBe("tn-filter-match");
        expect(filterRoleClass("scope")).toBe("tn-filter-scope");
        expect(filterRoleClass("companion")).toBe("tn-filter-companion");

        expect(filterRoleClass(undefined)).toBeUndefined();
        expect(filterRoleClass(false)).toBeUndefined();
    });
});

describe("useFilterMatch", () => {
    it("renders everything when there is no filter, and only matches when there is one", () => {
        const outside = renderInto(<Settings />);
        expect(labelsIn(outside)).toEqual([ "Backup interval", "Theme", "Language" ]);

        const filtered = renderInto(
            <FilterProvider query="the"><Settings /></FilterProvider>
        );
        expect(labelsIn(filtered)).toEqual([ "Theme" ]);
    });

    it("matches on the description as well as the label", () => {
        const container = renderInto(
            <FilterProvider query="colours"><Settings /></FilterProvider>
        );

        expect(labelsIn(container)).toEqual([ "Theme" ]);
    });

    it("treats a query with no terms in it as no filter at all", () => {
        for (const query of [ "", "   ", null, undefined ]) {
            const container = renderInto(
                <FilterProvider query={query}><Settings /></FilterProvider>
            );

            expect(labelsIn(container)).toHaveLength(3);
            expect(container.querySelector(".filtering")?.textContent).toBe("false");
        }
    });

    it("reports the filter in force, with the terms ready to be matched or highlighted", () => {
        const container = renderInto(
            <FilterProvider query="Thème Dark"><Settings /></FilterProvider>
        );

        expect(container.querySelector(".filtering")?.textContent).toBe("true");
        expect(container.querySelector(".tokens")?.textContent).toBe("theme,dark");
    });
});

describe("FilterPassthrough", () => {
    it("shows the whole of a group that matched by its own heading", () => {
        const container = renderInto(
            <FilterProvider query="appearance">
                <Group heading="Appearance"><Settings /></Group>
            </FilterProvider>
        );

        expect(container.querySelector(".group")?.getAttribute("data-matched")).toBe("true");
        expect(labelsIn(container)).toEqual([ "Backup interval", "Theme", "Language" ]);
    });

    it("leaves the group's contents to match on their own when it did not", () => {
        const container = renderInto(
            <FilterProvider query="theme">
                <Group heading="Appearance"><Settings /></Group>
            </FilterProvider>
        );

        expect(container.querySelector(".group")?.getAttribute("data-matched")).toBe("false");
        expect(labelsIn(container)).toEqual([ "Theme" ]);
    });

    it("lifts only its own filter, so one set up further down still applies", () => {
        const container = renderInto(
            <FilterProvider query="appearance">
                <Group heading="Appearance">
                    <FilterProvider query="language"><Settings /></FilterProvider>
                </Group>
            </FilterProvider>
        );

        expect(labelsIn(container)).toEqual([ "Language" ]);
    });

    it("keeps the children in place as the group starts and stops matching", async () => {
        const container = renderInto(null);

        mounts = 0;
        await act(() => render(<Tree query="theme" />, container));
        await act(() => render(<Tree query="appearance" />, container));
        expect(labelsIn(container)).toHaveLength(3);

        await act(() => render(<Tree query="nothing here" />, container));
        expect(labelsIn(container)).toHaveLength(0);

        expect(mounts).toBe(1);
    });
});

function Setting({ label, description }: { label: string, description?: ComponentChildren }) {
    if (!useFilterMatch(label, description)) return null;

    return <span className="setting">{label}</span>;
}

/** A handful of settings to filter, plus a readout of the filter they are being shown under. */
function Settings() {
    const state = useFilterState();

    return (
        <>
            <span className="filtering">{String(useIsFiltering())}</span>
            <span className="tokens">{state?.tokens.join(",")}</span>

            <Setting label="Backup interval" description="How often a copy is taken." />
            <Setting label="Theme" description={<>Which <b>colours</b> the app is drawn in.</>} />
            <Setting label="Language" />
        </>
    );
}

function Group({ heading, children }: { heading: string, children: ComponentChildren }) {
    const matched = useFilterMatch(heading);

    return (
        <div className="group" data-matched={String(matched)}>
            <FilterPassthrough when={matched}>{children}</FilterPassthrough>
        </div>
    );
}

let mounts = 0;

/** Sits in the group without filtering itself, so its mounts tell whether the group remounted. */
function Persistent() {
    useEffect(() => {
        mounts++;
    }, []);

    return null;
}

function Tree({ query }: { query: string }) {
    return (
        <FilterProvider query={query}>
            <Group heading="Appearance">
                <Persistent />
                <Settings />
            </Group>
        </FilterProvider>
    );
}

function labelsIn(container: HTMLElement) {
    return [ ...container.querySelectorAll(".setting") ].map((el) => el.textContent);
}
