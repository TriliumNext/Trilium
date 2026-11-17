import { describe, expect, it } from "vitest";

import { placeCustomWidgets } from "./custom_widgets";

describe("placeCustomWidgets", () => {
    it("orders the widgets among the built-in children as `BasicWidget.child()` did", () => {
        const gaps = placeCustomWidgets([
            { widget: "last" },
            { widget: "tied", position: 20 },
            { widget: "first", position: 5 },
            { widget: "between", position: 15 },
            { widget: "lastToo" },
            { widget: "beyond", position: 1000 },
            { widget: "before", position: -3 }
        ], 2);

        // Built-in children at 10 and 20; a tie goes after the built-in child, and the widgets
        // without a position take 30 and 40, before one at 1000.
        expect(gaps).toEqual([
            [ "before", "first" ],
            [ "between" ],
            [ "tied", "last", "lastToo", "beyond" ]
        ]);
        expect(placeCustomWidgets([ { widget: "only", position: 1 } ], 0)).toEqual([ [ "only" ] ]);
    });
});
