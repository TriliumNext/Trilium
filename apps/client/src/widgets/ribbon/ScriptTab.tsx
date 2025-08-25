import { t } from "../../services/i18n";
import Button from "../react/Button";
import { useNoteLabel } from "../react/hooks";
import { TabContext } from "./ribbon-interface";

export default function ScriptTab({ note }: TabContext) {
    const [ executeDescription ] = useNoteLabel(note, "executeDescription");
    const executeTitle = useNoteLabel(note, "executeTitle")[0] ||
        (note?.isTriliumSqlite() ? t("script_executor.execute_query") : t("script_executor.execute_script"));

    return (
        <div class="script-runner-widget">
            {executeDescription && (
                <div class="execute-description">
                    {executeDescription}
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-around"}}>
                <Button
                    triggerCommand="runActiveNote"
                    className="execute-button"
                    text={executeTitle}
                />
            </div>
        </div>
    );
}