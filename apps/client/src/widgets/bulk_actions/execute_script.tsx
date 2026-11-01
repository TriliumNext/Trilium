import "./execute_script.css";

import type VanillaCodeMirror from "@triliumnext/codemirror";
import { SCRIPT_MIME_BACKEND } from "@triliumnext/codemirror/src/type_completion/index";
import { lazy, Suspense } from "preact/compat";
import { useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n.js";
import AbstractBulkAction, { ActionDefinition } from "./abstract_bulk_action.js";
import BulkAction, { useSaveAction } from "./BulkAction.jsx";

function ExecuteScriptBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition }) {
    const [ script, setScript ] = useState(actionDef.script ?? "");
    // `CodeEditor` replaces its document whenever `content` changes, so it only receives the
    // script the row opens with.
    const [ initialScript ] = useState(script);
    const editorRef = useRef<VanillaCodeMirror>(null);
    useSaveAction(bulkAction, { script });

    return (
        <BulkAction
            bulkAction={bulkAction}
        >
            <div className="bulk-action-script form-control tn-input-field">
                <Suspense fallback={null}>
                    <CodeEditor
                        ntxId={null}
                        editorRef={editorRef}
                        content={initialScript}
                        mime={SCRIPT_MIME_BACKEND}
                        bulkActionNote
                        lineWrapping
                        placeholder="note.title = note.title + '- suffix';"
                        onContentChanged={() => setScript(editorRef.current?.getText() ?? "")}
                    />
                </Suspense>
            </div>
        </BulkAction>
    );
}

/** The editor and its TypeScript completion, loaded only once a script action is shown. */
const CodeEditor = lazy(() => import("../type_widgets/code/Code")
    .then(({ CodeEditor: editor }) => ({ default: editor })));

export default class ExecuteScriptBulkAction extends AbstractBulkAction {

    static get actionName() {
        return "executeScript";
    }
    static get actionTitle() {
        return t("execute_script.execute_script");
    }
    static get actionIcon() {
        return "bx bx-play";
    }
    static get actionDescription() {
        return t("execute_script.description");
    }

    doRender() {
        return <ExecuteScriptBulkActionComponent bulkAction={this} actionDef={this.actionDef} />
    }

}
