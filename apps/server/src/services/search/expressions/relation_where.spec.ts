import { describe, test, expect, vi, beforeEach } from "vitest";
import becca from "../../../becca/becca.js";
import BNote from "../../../becca/entities/bnote.js";
import BAttribute from "../../../becca/entities/battribute.js";
import RelationWhereExp, { RELATION_NAME_WILDCARD } from "./relation_where";
import TrueExp from "./true.js";
import NoteSet from "../note_set.js";
import SearchContext from "../search_context.js";

vi.mock("../../../becca/becca.js");
// BNote and BAttribute are itself hard-wired to becca, mock them away as well
vi.mock("../../../becca/entities/bnote.js");
vi.mock("../../../becca/entities/battribute.js");

const n1 = new BNote();
n1.noteId = "n1_id";
n1.title = "n1 title";

const n2 = new BNote();
n2.noteId = "n2_id";
n2.title = "n2 title";

const a1 = new BAttribute();
a1.attributeId = "a1_id";
a1.noteId = "n1_id";
a1.type = "relation";
a1.name = "internallink";
a1.value = "n2_id";
vi.spyOn(a1, "note", "get").mockReturnValue(n1);
vi.spyOn(a1, "targetNote", "get").mockReturnValue(n2);

const a2 = new BAttribute();
a2.attributeId = "a2_id";
a2.noteId = "n2_id";
a2.type = "relation";
a2.name = "links_to";
a2.value = "n1_id";
vi.spyOn(a2, "note", "get").mockReturnValue(n2);
vi.spyOn(a2, "targetNote", "get").mockReturnValue(n1);

beforeEach(() => {
    becca.notes = {};
    becca.attributes = {};
    vi.mocked(becca.findAttributes).mockReset();

    becca.notes[n1.noteId] = n1;
    becca.notes[n2.noteId] = n2;
    becca.attributes[a1.attributeId] = a1;
    becca.attributes[a2.attributeId] = a2;

    vi.mocked(becca.findAttributes).mockImplementation((type, name) =>
        name === "links_to" ? [a2] : [a1],
    );
});

describe("relation name wildcard search", () => {
    test("both internal link and explicit relation are returned", () => {
        const result = new RelationWhereExp(
            RELATION_NAME_WILDCARD,
            new TrueExp(),
        ).execute(new NoteSet([n1, n2]), {}, new SearchContext());

        expect(becca.findAttributes).not.toHaveBeenCalled();
        expect(result.notes.length).toEqual(2);
    });
});

describe("single relation search", () => {
    test("both internal link and explicit relation are returned", () => {
        const result = new RelationWhereExp("links_to", new TrueExp()).execute(
            new NoteSet([n1, n2]),
            {},
            new SearchContext(),
        );

        expect(becca.findAttributes).toHaveBeenCalled();
        expect(result.notes.length).toEqual(1);
    });
});
