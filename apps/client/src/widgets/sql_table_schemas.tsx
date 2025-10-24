import { useEffect, useState } from "preact/hooks";
import { t } from "../services/i18n";
import { useNoteContext } from "./react/hooks";
import "./sql_table_schemas.css";
import { SchemaResponse } from "@triliumnext/commons";
import server from "../services/server";
import Dropdown from "./react/Dropdown";

export default function SqlTableSchemas() {
    const { note } = useNoteContext();
    const [ schemas, setSchemas ] = useState<SchemaResponse[]>();

    useEffect(() => {
        server.get<SchemaResponse[]>("sql/schema").then(setSchemas);
    }, []);

    const isEnabled = note?.mime === "text/x-sqlite;schema=trilium" && schemas;
    return (
        <div className={`sql-table-schemas-widget ${!isEnabled ? "hidden-ext" : ""}`}>
            {isEnabled && (
                <>
                    {t("sql_table_schemas.tables")}{": "}

                    <span class="sql-table-schemas">
                        {schemas.map(({ name, columns }) => (
                            <>
                                <Dropdown text={name} noSelectButtonStyle hideToggleArrow
                                >
                                    <table className="table-schema">
                                        {columns.map(column => (
                                            <tr>
                                                <td>{column.name}</td>
                                                <td>{column.type}</td>
                                            </tr>
                                        ))}
                                    </table>
                                </Dropdown>
                                {" "}
                            </>
                        ))}
                    </span>
                </>
            )}
        </div>
    )
}