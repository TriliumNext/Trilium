import { describe, expect, it } from "vitest";

import { equivLabelName } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import { note, NoteBuilder } from "../test/becca_mocking.js";
import {
    buildCanonicalMapping,
    buildEquivalentNotesResponse,
    collapseLinkMap,
    connectedComponents,
    getClassMembers,
    getEquivalenceTypeConfigs,
    getEquivalenceTypeNames,
    getIndependentClassMembers,
    getUnionClassMembers,
    isAllowedExpandedHit,
    languageMatchesLocale,
    pickCanonicalMember,
    resolveTypesToCollapse,
    resolveTypesToExpand
} from "./equivalence.js";

describe("connectedComponents", () => {
    it("unions a path into one class and leaves a disjoint pair separate", () => {
        const groups = connectedComponents([
            ["a", "b"],
            ["b", "c"],
            ["d", "e"]
        ]);

        const classes = [...groups.values()].map((members) => [...members].sort());
        expect(classes).toEqual(expect.arrayContaining([
            ["a", "b", "c"],
            ["d", "e"]
        ]));
        expect(classes).toHaveLength(2);
    });

    it("ignores empty endpoints and self-loops", () => {
        const groups = connectedComponents([
            ["a", "a"],
            ["", "b"],
            ["c", ""]
        ]);
        expect(groups.size).toBe(0);
    });

    it("adds the (n+1)th member with one edge", () => {
        const n = ["a", "b", "c"];
        const edges: [string, string][] = [["a", "b"], ["b", "c"]];
        edges.push(["c", "d"]);

        const members = [...connectedComponents(edges).values()][0] ?? [];
        expect([...members].sort()).toEqual(["a", "b", "c", "d"]);
        expect(n).toHaveLength(3);
    });
});

describe("pickCanonicalMember", () => {
    const base = {
        canonicalNoteIds: new Set<string>(),
        languageByNoteId: new Map<string, string>(),
        locale: "en"
    };

    it("prefers an explicit canonical member, then locale, then preferred, then sorted id", () => {
        expect(pickCanonicalMember({
            ...base,
            members: ["b", "a", "c"],
            canonicalNoteIds: new Set(["c"])
        })).toBe("c");

        expect(pickCanonicalMember({
            ...base,
            members: ["de1", "en1"],
            languageByNoteId: new Map([["de1", "de"], ["en1", "en"]]),
            locale: "de"
        })).toBe("de1");

        expect(pickCanonicalMember({
            ...base,
            members: ["z", "a"],
            preferredNoteId: "z"
        })).toBe("z");

        expect(pickCanonicalMember({
            ...base,
            members: ["z", "a"]
        })).toBe("a");
    });

    it("matches language tags against a locale prefix", () => {
        expect(languageMatchesLocale("en", "en")).toBe(true);
        expect(languageMatchesLocale("en-GB", "en")).toBe(true);
        expect(languageMatchesLocale("en", "en-US")).toBe(true);
        expect(languageMatchesLocale("de", "en")).toBe(false);
    });
});

describe("collapseLinkMap", () => {
    it("merges members onto the canonical, drops collapsed self-loops, and merges remaining edges", () => {
        const notes: [string, string, string, string | null, string][] = [
            ["car", "Car", "text", null, "bx bx-car"],
            ["auto", "Auto", "text", "blue", "bx bx-car"],
            ["paper", "Paper", "text", null, "bx bx-file"]
        ];
        const links = [
            { id: "car-equiv-auto", sourceNoteId: "car", targetNoteId: "auto", name: "equiv" },
            { id: "car-cites-paper", sourceNoteId: "car", targetNoteId: "paper", name: "cites" },
            { id: "auto-cites-paper", sourceNoteId: "auto", targetNoteId: "paper", name: "cites" }
        ];
        const canonicalOf = new Map([["car", "car"], ["auto", "car"]]);
        const classTitles = new Map([["car", "Car / Auto"]]);

        const collapsed = collapseLinkMap(notes, links, { car: 1, auto: 2, paper: 0 }, canonicalOf, classTitles);

        expect(collapsed.notes.map((row) => row[0]).sort()).toEqual(["car", "paper"]);
        expect(collapsed.notes.find((row) => row[0] === "car")?.[1]).toBe("Car / Auto");
        expect(collapsed.links).toEqual([
            { id: "car-cites-paper", sourceNoteId: "car", targetNoteId: "paper", name: "cites" }
        ]);
        expect(collapsed.noteIdToDescendantCountMap.car).toBe(3);
    });
});

describe("typed equivalence on becca notes", () => {
    let rootNote: NoteBuilder;

    function resetTree() {
        becca.reset();
        rootNote = new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({
            branchId: "none_root",
            noteId: "root",
            parentNoteId: "none",
            notePosition: 10
        });
    }

    it("treats ~equiv as an undirected class and excludes an equivHub from membership", () => {
        resetTree();
        const hub = note("Concept").label("equivHub", "");
        const car = note("Car");
        const auto = note("Auto");
        const kuruma = note("Kuruma");
        car.relation("equiv", hub.note);
        auto.relation("equiv", hub.note);
        kuruma.relation("equiv", hub.note);
        rootNote.child(hub).child(car).child(auto).child(kuruma);

        const members = getClassMembers(car.note.noteId, "equiv").sort();
        expect(members).toEqual([auto.note.noteId, car.note.noteId, kuruma.note.noteId].sort());
        expect(members).not.toContain(hub.note.noteId);
    });

    it("does not compose distinct types for independent membership, but does for a union collapse", () => {
        resetTree();
        const auto = note("Auto");
        const car = note("Car");
        const vehicle = note("Vehicle");
        auto.relation("translation", car.note);
        car.relation("entity", vehicle.note);
        rootNote
            .label("relation:translation", "multi,inverse=translation,equivalence")
            .label("relation:entity", "multi,inverse=entity,equivalence")
            .child(auto).child(car).child(vehicle);

        const independent = getIndependentClassMembers(auto.note.noteId, ["translation", "entity"]);
        expect(independent.sort()).toEqual([auto.note.noteId, car.note.noteId].sort());
        expect(independent).not.toContain(vehicle.note.noteId);

        const union = getUnionClassMembers(auto.note.noteId, ["translation", "entity"]);
        expect(union.sort()).toEqual(
            [auto.note.noteId, car.note.noteId, vehicle.note.noteId].sort()
        );
    });

    it("lists equiv plus every relation definition marked equivalence", () => {
        resetTree();
        rootNote.label("relation:translation", "multi,inverse=translation,equivalence");

        expect(getEquivalenceTypeNames().sort()).toEqual(["equiv", "translation"]);
        const translation = getEquivalenceTypeConfigs().find((config) => config.name === "translation");
        expect(translation?.expandSearch).toBe(false);
        expect(translation?.collapseMap).toBe(false);
        const equiv = getEquivalenceTypeConfigs().find((config) => config.name === "equiv");
        expect(equiv?.expandSearch).toBe(true);
        expect(equiv?.collapseMap).toBe(true);
    });

    it("resolves search expansion and map collapse from definition flags and overrides", () => {
        resetTree();
        rootNote.label("relation:translation", "multi,inverse=translation,equivalence,expandSearch,collapseMap");

        expect(resolveTypesToExpand({
            enabled: true,
            expandAll: false,
            requestedTypes: []
        }).sort()).toEqual(["equiv", "translation"]);
        expect(resolveTypesToExpand({
            enabled: true,
            expandAll: false,
            requestedTypes: [ "translation" ]
        })).toEqual(["translation"]);
        expect(resolveTypesToExpand({
            enabled: false,
            expandAll: false,
            requestedTypes: []
        })).toEqual([]);
        expect(resolveTypesToCollapse([])).toEqual(expect.arrayContaining(["equiv", "translation"]));
        expect(resolveTypesToCollapse(["none"])).toEqual([]);
        expect(resolveTypesToCollapse(["translation"])).toEqual(["translation"]);
    });

    it("scopes #equivHub and #canonical to a type", () => {
        resetTree();
        const hub = note("Concept").label("equivHub:translation", "");
        const car = note("Car").label("canonical:translation", "");
        const auto = note("Auto");
        car.relation("translation", hub.note);
        auto.relation("translation", hub.note);
        rootNote
            .label("relation:translation", "multi,inverse=translation,equivalence")
            .child(hub).child(car).child(auto);

        const members = getClassMembers(car.note.noteId, "translation");
        expect(members.sort()).toEqual([auto.note.noteId, car.note.noteId].sort());
        expect(members).not.toContain(hub.note.noteId);

        const { canonicalOf } = buildCanonicalMapping(["translation"], auto.note.noteId);
        expect(canonicalOf.get(auto.note.noteId)).toBe(car.note.noteId);
    });

    it("names a member per type and uses that name on the collapsed map", () => {
        resetTree();
        expect(equivLabelName("equiv")).toBe("equivLabel");
        expect(equivLabelName("translation")).toBe("equivLabel:translation");

        const de = note("Auto").label("equivLabel", "German");
        const en = note("Car").label("equivLabel", "English");
        de.relation("equiv", en.note);
        rootNote.child(de).child(en);

        const listed = buildEquivalentNotesResponse(de.note.noteId);
        const equivGroup = listed.groups.find((group) => group.relationName === "equiv");
        const byId = new Map((equivGroup?.members ?? []).map((member) => [ member.noteId, member.displayName ]));
        expect(byId.get(de.note.noteId)).toBe("German");
        expect(byId.get(en.note.noteId)).toBe("English");

        const { classTitles, canonicalOf } = buildCanonicalMapping(["equiv"], de.note.noteId);
        const canonicalId = canonicalOf.get(de.note.noteId);
        expect(canonicalId).toBeTruthy();
        if (!canonicalId) {
            return;
        }
        expect(classTitles.get(canonicalId)?.split(" / ").sort()).toEqual(["English", "German"]);

        const deT = note("Wagen").label("equivLabel:translation", "Deutsch");
        const enT = note("Wagon");
        deT.relation("translation", enT.note);
        rootNote
            .label("relation:translation", "multi,inverse=translation,equivalence")
            .child(deT).child(enT);

        const typed = buildEquivalentNotesResponse(deT.note.noteId);
        const translation = typed.groups.find((group) => group.relationName === "translation");
        const typedById = new Map(
            (translation?.members ?? []).map((member) => [ member.noteId, member.displayName ])
        );
        expect(typedById.get(deT.note.noteId)).toBe("Deutsch");
        expect(typedById.get(enT.note.noteId)).toBeUndefined();
        const equivGroupForTyped = typed.groups.find((group) => group.relationName === "equiv");
        expect(equivGroupForTyped).toBeUndefined();
    });

    it("rejects archived expanded hits unless includeArchivedNotes is set", () => {
        resetTree();
        const archived = note("Auto").label("archived", "");
        rootNote.child(archived);

        expect(isAllowedExpandedHit(archived.note, {
            includeArchivedNotes: false,
            includeHiddenNotes: true
        })).toBe(false);
        expect(isAllowedExpandedHit(archived.note, {
            includeArchivedNotes: true,
            includeHiddenNotes: true
        })).toBe(true);
    });

    it("maps a class of size > 1 onto one canonical for the link map", () => {
        resetTree();
        const car = note("Car").label("canonical", "");
        const auto = note("Auto");
        car.relation("equiv", auto.note);
        rootNote.child(car).child(auto);

        const { canonicalOf, classTitles } = buildCanonicalMapping(["equiv"], car.note.noteId);
        expect(canonicalOf.get(auto.note.noteId)).toBe(car.note.noteId);
        expect(classTitles.get(car.note.noteId)).toContain("Car");
        expect(classTitles.get(car.note.noteId)).toContain("Auto");
    });
});
