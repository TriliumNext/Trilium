import "./SqlConsole.css";

import { SchemaResponse, SqlExecuteResponse } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";
import { ClipboardModule, EditModule, ExportModule, FilterModule, FormatModule, FrozenColumnsModule, KeybindingsModule, PageModule, ResizeColumnsModule, SelectRangeModule, SelectRowModule, SortModule } from "tabulator-tables";

import { t } from "../../services/i18n";
import server from "../../services/server";
import Tabulator from "../collections/table/tabulator";
import Button from "../react/Button";
import Dropdown from "../react/Dropdown";
import { useTriliumEvent } from "../react/hooks";
import NoItems from "../react/NoItems";
import SplitEditor from "./helpers/SplitEditor";
import { TypeWidgetProps } from "./type_widget";

export default function SqlConsole(props: TypeWidgetProps) {
    return (
        <SplitEditor
            noteType="code"
            {...props}
            editorBefore={<SqlTableSchemas {...props} />}
            previewContent={<SqlResults key={props.note.noteId} {...props} />}
            forceOrientation="vertical"
            splitOptions={{
                sizes: [ 70, 30 ]
            }}
        />
    );
}

function SqlResults({ ntxId }: TypeWidgetProps) {
    const [ response, setResponse ] = useState<SqlExecuteResponse>();

    useTriliumEvent("sqlQueryResults", ({ ntxId: eventNtxId, response }) => {
        if (eventNtxId !== ntxId) return;
        setResponse(response);
    });

    // Not yet executed.
    if (response === undefined) {
        return (
            <NoItems
                icon="bx bx-data"
                text={t("sql_result.not_executed")}
            >
                <Button
                    text={t("sql_result.execute_now")}
                    triggerCommand="runActiveNote"
                />
            </NoItems>
        );
    }

    // Executed but failed.
    if (response && !response.success) {
        return (
            <NoItems
                icon="bx bx-error"
                text={t("sql_result.failed")}
            >
                <pre className="sql-error-message selectable-text">{response.error}</pre>
            </NoItems>
        );
    }

    // Zero results.
    if (response?.results.length === 1 && Array.isArray(response.results[0]) && response.results[0].length === 0) {
        return (
            <NoItems
                icon="bx bx-rectangle"
                text={t("sql_result.no_rows")}
            />
        );
    }

    return (
        <div className="sql-result-widget">
            <div className="sql-console-result-container selectable-text">
                {response?.results.map((rows, index) => {
                    // inserts, updates
                    if (typeof rows === "object" && !Array.isArray(rows)) {
                        return (
                            <NoItems
                                key={index}
                                icon="bx bx-play"
                                text={t("sql_result.statement_result")}
                            >
                                <pre key={index}>{JSON.stringify(rows, null, "\t")}</pre>
                            </NoItems>
                        );
                    }

                    // selects
                    return <SqlResultTable key={index} rows={rows} />;
                })}
            </div>
        </div>
    );
}

function SqlResultTable({ rows }: { rows: object[] }) {
    if (!rows.length) return;

    return (
        <Tabulator
            layout="fitDataFill"
            modules={[ ResizeColumnsModule, SortModule, SelectRangeModule, ClipboardModule, KeybindingsModule, EditModule, ExportModule, SelectRowModule, FormatModule, FrozenColumnsModule, FilterModule, PageModule ]}
            selectableRange
            clipboard="copy"
            clipboardCopyRowRange="range"
            clipboardCopyConfig={{
                rowHeaders: false,
                columnHeaders: false
            }}
            pagination
            paginationSize={15}
            paginationSizeSelector
            paginationCounter="rows"
            height="100%"
            columns={[
                {
                    title: "#",
                    formatter: "rownum",
                    width: 60,
                    hozAlign: "right",
                    frozen: true
                },
                ...Object.keys(rows[0]).map(key => ({
                    title: key,
                    field: key,
                    width: 250,
                    minWidth: 100,
                    widthGrow: 1,
                    resizable: true,
                    headerFilter: true as const
                }))
            ]}
            data={rows}
        />
    );
}

export function SqlTableSchemas({ note }: TypeWidgetProps) {
    const [ schemas, setSchemas ] = useState<SchemaResponse[]>();

    useEffect(() => {
        server.get<SchemaResponse[]>("sql/schema").then(setSchemas);
    }, []);

    const isEnabled = note.isTriliumSqlite() && schemas;
    return (
        <div className={`sql-table-schemas-widget ${!isEnabled ? "hidden-ext" : ""}`}>
            {isEnabled && (
                <>
                    {t("sql_table_schemas.tables")}{": "}

                    <span class="sql-table-schemas">
                        {schemas.map(({ name, columns }) => (
                            <Dropdown key={name} text={name} noSelectButtonStyle hideToggleArrow>
                                <table className="table-schema">
                                    {columns.map(column => (
                                        <tr key={column.name}>
                                            <td>{column.name}</td>
                                            <td>{column.type}</td>
                                        </tr>
                                    ))}
                                </table>
                            </Dropdown>
                        ))}
                    </span>
                </>
            )}
        </div>
    );
}
