import { describe, expect, it } from "vitest";

import Component from "../components/component.js";
import { collectShortcutHints, ShortcutHintCollector, type ShortcutHintSection } from "./shortcut_hints.js";

function componentWithHints(sections: ShortcutHintSection[] | null): Component {
    const component = new Component();
    if (sections) {
        component.getContextualShortcutHints = (collector) => collector.add(...sections);
    }
    return component;
}

describe("ShortcutHintCollector", () => {
    it("appends sections in call order", () => {
        const collector = new ShortcutHintCollector();
        const a: ShortcutHintSection = { hints: [{ keys: ["A"], labelKey: "a" }] };
        const b: ShortcutHintSection = { hints: [{ keys: ["B"], labelKey: "b" }] };

        collector.add(a);
        collector.add(b);

        expect(collector.sections).toEqual([a, b]);
    });
});

describe("collectShortcutHints", () => {
    it("returns nothing for a missing start component", () => {
        expect(collectShortcutHints(undefined)).toEqual([]);
        expect(collectShortcutHints(null)).toEqual([]);
    });

    it("collects from the start component", () => {
        const section: ShortcutHintSection = { titleKey: "leaf", hints: [{ keys: ["A"], labelKey: "a" }] };
        expect(collectShortcutHints(componentWithHints([section]))).toEqual([section]);
    });

    it("walks up the parent chain, focused component first then ancestors", () => {
        const leafSection: ShortcutHintSection = { titleKey: "leaf", hints: [{ keys: ["A"], labelKey: "a" }] };
        const rootSection: ShortcutHintSection = { titleKey: "root", hints: [{ action: "jumpToNote" }] };

        const root = componentWithHints([rootSection]);
        const middle = componentWithHints(null); // no hints — should be skipped
        const leaf = componentWithHints([leafSection]);
        root.child(middle);
        middle.child(leaf);

        expect(collectShortcutHints(leaf)).toEqual([leafSection, rootSection]);
    });
});
