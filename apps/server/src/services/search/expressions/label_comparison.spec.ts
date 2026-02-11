import { assert, test, expect, vi, beforeEach } from "vitest";
import becca from "../../../becca/becca.js";
import BNote from "../../../becca/entities/bnote.js";
import BAttribute from "../../../becca/entities/battribute.js";
import NoteSet from "../note_set.js";
import SearchContext from "../search_context.js";
import LabelComparisonExp from "./label_comparison.js";

vi.mock("../../../becca/becca.js");
vi.mock("../../../becca/entities/bnote.js");
vi.mock("../../../becca/entities/battribute.js");

beforeEach(() => {
    vi.resetAllMocks();
});

test("should find inherites attributes", () => {
    // Consider following search string:
    // `~template.title = "Task template" AND #is_done = false`.
    // This query narrows notes to task template instances and then filters by
    // label `is_done` with value `false`. Assume, that `is_done = false` is a
    // default label declared directly in that template. `inputNoteSet` for
    // this testcase are task template instances (first condition). Despite attribute
    // being declared on template, LabelComparisonExp `#is_done = false` execution
    // (second condition) still should keep all task instances as results.
    const instance_note = new BNote();
    instance_note.noteId = "n2_id";
    instance_note.title = "Inheriting note";

    const template_note = new BNote();
    template_note.noteId = "n1_id";
    template_note.title = "Task template";
    vi.mocked(template_note.isInherited).mockImplementation(() => true);
    vi.mocked(template_note.getInheritingNotes).mockImplementation(() => [
        // template note itself is included in getInheritingNotes implementation
        template_note,
        instance_note,
    ]);

    const attr_type = "mytype";
    const attr = new BAttribute();
    attr.attributeId = "a1_id";
    // only test template inheritance in this test.
    attr.isInheritable = false;
    attr.noteId = "n1_id";
    attr.type = "label";
    attr.name = "is_done";
    attr.value = "false";
    vi.spyOn(attr, "note", "get").mockReturnValue(template_note);

    vi.mocked(becca.findAttributes).mockImplementation((type, name) =>
        type == attr_type && name === attr.name ? [attr] : [],
    );

    const result = new LabelComparisonExp(
        attr_type,
        attr.name,
        (v) => v == attr.value,
    ).execute(new NoteSet([instance_note]), {}, new SearchContext());

    expect(result.notes.length).toEqual(1);
    assert(result.hasNote(instance_note));
});
