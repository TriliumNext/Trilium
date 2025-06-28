import FNote from "../../../entities/fnote.js";
import type { LabelType } from "../../../services/promoted_attribute_definition_parser.js";
import type { ColumnDefinition } from "tabulator-tables";
import link from "../../../services/link.js";

export type TableData = {
    noteId: string;
    title: string;
    labels: Record<string, boolean | string | null>;
    branchId: string;
    position: number;
};

export interface PromotedAttributeInformation {
    name: string;
    title?: string;
    type?: LabelType;
}

const labelTypeMappings: Record<LabelType, Partial<ColumnDefinition>> = {
    text: {
        editor: "input"
    },
    boolean: {
        formatter: "tickCross",
        editor: "tickCross"
    },
    date: {
        editor: "date",
    },
    datetime: {
        editor: "datetime"
    },
    number: {
        editor: "number"
    },
    time: {
        editor: "input"
    },
    url: {
        formatter: "link",
        editor: "input"
    }
};

type GridLabelType = 'text' | 'number' | 'boolean' | 'date' | 'dateString' | 'object';

export async function buildData(parentNote: FNote, info: PromotedAttributeInformation[], notes: FNote[]) {
    const columnDefs = buildColumnDefinitions(info);
    const rowData = await buildRowDefinitions(parentNote, notes, info);

    return {
        rowData,
        columnDefs
    }
}

export function buildColumnDefinitions(info: PromotedAttributeInformation[]) {
    const columnDefs: ColumnDefinition[] = [
        {
            title: "#",
            formatter: "rownum",
            headerSort: false,
            hozAlign: "center",
            resizable: false,
            frozen: true
        },
        {
            field: "iconClass",
            title: "Icon",
            width: 40,
            headerSort: false,
            hozAlign: "center",
            formatter(cell) {
                const iconClass = cell.getValue();
                return `<span class="bx ${iconClass}"></span>`;
            },
        },
        {
            field: "noteId",
            title: "Note ID",
        },
        {
            field: "title",
            title: "Title",
            editor: "input"
        },
        {
            field: "position",
            title: "Position"
        }
    ];

    for (const { name, title, type } of info) {
        columnDefs.push({
            field: `labels.${name}`,
            title: title ?? name,
            editor: "input",
            ...labelTypeMappings[type ?? "text"],
        });
    }

    // End actions
    columnDefs.push({
        title: "Open note",
        width: 40,
        hozAlign: "center",
        headerSort: false,
        formatter: () => `<span class="bx bx-window-open"></span>`,
        cellClick: (e, cell) => {
            const noteId = cell.getRow().getCell("noteId").getValue();
            console.log("Got note ID", noteId);
            if (noteId) {
                link.goToLinkExt(e as MouseEvent, `#root/${noteId}`);
            }
        }
    });

    return columnDefs;
}

export async function buildRowDefinitions(parentNote: FNote, notes: FNote[], infos: PromotedAttributeInformation[]) {
    const definitions: GridOptions<TableData>["rowData"] = [];
    for (const branch of parentNote.getChildBranches()) {
        const note = await branch.getNote();
        if (!note) {
            continue; // Skip if the note is not found
        }

        const labels: typeof definitions[0]["labels"] = {};
        for (const { name, type } of infos) {
            if (type === "boolean") {
                labels[name] = note.hasLabel(name);
            } else {
                labels[name] = note.getLabelValue(name);
            }
        }
        definitions.push({
            iconClass: note.getIcon(),
            noteId: note.noteId,
            title: note.title,
            labels,
            position: branch.notePosition,
            branchId: branch.branchId
        });
    }

    return definitions;
}

export default function getPromotedAttributeInformation(parentNote: FNote) {
    const info: PromotedAttributeInformation[] = [];
    for (const promotedAttribute of parentNote.getPromotedDefinitionAttributes()) {
        if (promotedAttribute.type !== "label") {
            console.warn("Relations are not supported for now");
            continue;
        }

        const def = promotedAttribute.getDefinition();
        if (def.multiplicity !== "single") {
            console.warn("Multiple values are not supported for now");
            continue;
        }

        info.push({
            name: promotedAttribute.name.split(":", 2)[1],
            title: def.promotedAlias,
            type: def.labelType
        })
    }
    return info;
}
