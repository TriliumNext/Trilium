import "./TablePrintView.css";

import { useEffect, useRef, useState } from "preact/hooks";
import { ExportModule, FormatModule, Tabulator as VanillaTabulator} from 'tabulator-tables';

import { RawHtmlBlock } from "../../react/RawHtml";
import { ViewModeProps } from "../interface";
import useData, { TableConfig } from "./data";
import Tabulator from "./tabulator";

export default function TablePrintView({ note, noteIds, viewConfig, onReady }: ViewModeProps<TableConfig>) {
    const tabulatorRef = useRef<VanillaTabulator>(null);
    const { columnDefs, rowData, hasChildren } = useData(note, noteIds, viewConfig, undefined, () => {});
    const [ html, setHtml ] = useState<string>();

    useEffect(() => {
        if (!html) return;
        onReady?.({
            type: "collection",
            ignoredNoteIds: []
        });
    }, [ html ]);

    return rowData && (
        <>
            <h1>{note.title}</h1>

            <div className="table-print-view">

                {!html ? (
                    <Tabulator
                        tabulatorRef={tabulatorRef}
                        className="table-print-view-container"
                        modules={[ ExportModule, FormatModule ]}
                        columns={columnDefs ?? []}
                        data={rowData}
                        index="branchId"
                        dataTree={hasChildren}
                        printAsHtml={true}
                        printStyled={false}
                        onReady={() => {
                            const tabulator = tabulatorRef.current;
                            if (!tabulator) return;
                            setHtml(tabulator.getHtml());
                        }}
                    />
                ) : (
                    <RawHtmlBlock html={html} />
                )}
            </div>
        </>

    );
}
