import type { DefinitionObject } from "@triliumnext/commons";
import {
    extractAttributeDefinitionTypeAndName
} from "@triliumnext/commons/src/lib/promoted_attribute_definition_parser.js";
import { type Dispatch, type StateUpdater, useEffect, useState } from "preact/hooks";

import type NoteContext from "../components/note_context";
import type FAttribute from "../entities/fattribute";
import type FNote from "../entities/fnote";
import type { Attribute } from "../services/attribute_parser";
import attributes from "../services/attributes";
import { randomString } from "../services/utils";
import { useTriliumEvent } from "./react/hooks/events";
import { useNoteLabel } from "./react/hooks/note";

/**
 * Handles the individual cells (fields for promoted attributes, including empty ones). A definition
 * allowing several values is one cell holding the whole set — see {@link buildPromotedCells}.
 *
 * The cells are returned as a state since they can also be altered internally if needed, for example
 * to patch a value the grid itself has just written.
 */
export function usePromotedAttributeData(note: FNote | null | undefined, componentId: string, noteContext: NoteContext | undefined): [ Cell[] | undefined, Dispatch<StateUpdater<Cell[] | undefined>> ] {
    const [ viewType ] = useNoteLabel(note, "viewType");
    const [ cells, setCells ] = useState<Cell[]>();

    function refresh() {
        if (!note || viewType === "table" || noteContext?.viewScope?.viewMode !== "default") {
            setCells([]);
            return;
        }
        setCells(buildPromotedCells(note));
    }

    useEffect(refresh, [ note, viewType, noteContext ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows(componentId).find((attr) => attributes.isAffecting(attr, note))) {
            refresh();
        }
    });

    return [ cells, setCells ];
}

/**
 * The fields a note's promoted definitions ask for, in the order they are shown.
 *
 * One definition is one field, however many values it allows: a definition allowing several is a
 * field of chips holding the whole set — a label's values as the text they are, a relation's as the
 * notes they point at.
 *
 * A definition the note holds nothing under still gets its field, empty, so that a value can be
 * entered where there is none. For a set that is the field with no chips in it rather than a blank
 * value among them: an empty chip would stand for nothing, and pressing its remove button would
 * remove nothing.
 *
 * Exported for its own tests.
 */
export function buildPromotedCells(note: FNote): Cell[] {
    const promotedDefAttrs = note.getPromotedDefinitionAttributes();
    const ownedAttributes = note.getOwnedAttributes();
    // attrs are not resorted if position changes after the initial load
    // promoted attrs are sorted primarily by order of definitions, but with multi-valued promoted attrs
    // the order of attributes is important as well
    ownedAttributes.sort((a, b) => a.position - b.position);

    const cells: Cell[] = [];
    for (const definitionAttr of promotedDefAttrs) {
        const [ valueType, valueName ] = extractAttributeDefinitionTypeAndName(definitionAttr.name);
        const definition = definitionAttr.getDefinition();
        const held = ownedAttributes.filter((el) => el.name === valueName && el.type === valueType) as Attribute[];
        const blank: Attribute = {
            attributeId: "",
            type: valueType,
            name: valueName,
            value: ""
        };

        if (definition.multiplicity === "multi") {
            cells.push({
                definitionAttr,
                definition,
                valueName,
                // The set is written back by name rather than through any one attribute, so the field
                // carries the definition's own blank: what it needs from an attribute is the type and
                // the name, which every value under it shares.
                valueAttr: blank,
                values: held.map((attr) => attr.value).filter((value): value is string => !!value),
                uniqueId: randomString()
            });
            continue;
        }

        let valueAttrs = held.length ? held : [ blank ];
        if (definition.multiplicity === "single") {
            valueAttrs = valueAttrs.slice(0, 1);
        }

        for (const valueAttr of valueAttrs) {
            // if not owned, we'll force creation of a new attribute instead of updating the inherited one
            if (valueAttr.noteId !== note.noteId) {
                valueAttr.attributeId = "";
            }

            cells.push({ definitionAttr, definition, valueAttr, valueName, uniqueId: randomString() });
        }
    }

    return cells;
}

export interface Cell {
    uniqueId: string;
    definitionAttr: FAttribute;
    definition: DefinitionObject;
    valueAttr: Attribute;
    valueName: string;
    /**
     * Every value the note holds under this name, for a definition that allows several — the whole
     * set being edited as one field of chips rather than as a field per value. For a relation the
     * values are the targets' noteIds, shown as the notes they name.
     *
     * Absent for a definition holding one value.
     */
    values?: string[];
}
