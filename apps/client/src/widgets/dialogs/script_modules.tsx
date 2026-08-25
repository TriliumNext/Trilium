import "./script_modules.css";

import type { ScriptModuleSummary } from "@triliumnext/commons";
import { useCallback, useEffect, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import server from "../../services/server";
import { formatSize } from "../../services/utils";
import ActionButton from "../react/ActionButton";
import Alert from "../react/Alert";
import Button from "../react/Button";
import FormGroup from "../react/FormGroup";
import FormTextBox from "../react/FormTextBox";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import NoItems from "../react/NoItems";

export default function ScriptModulesDialog() {
    const [ shown, setShown ] = useState(false);
    const [ modules, setModules ] = useState<ScriptModuleSummary[]>([]);
    const [ spec, setSpec ] = useState("");
    const [ installing, setInstalling ] = useState(false);
    const [ error, setError ] = useState<string>();

    const refresh = useCallback(async () => {
        setModules(await server.get<ScriptModuleSummary[]>("script-modules"));
    }, []);

    useTriliumEvent("showScriptModules", () => {
        setError(undefined);
        setSpec("");
        setShown(true);
    });

    useEffect(() => {
        if (shown) void refresh();
    }, [ shown, refresh ]);

    async function install() {
        const wanted = spec.trim();
        if (!wanted || installing) return;

        setInstalling(true);
        setError(undefined);
        try {
            await server.post<ScriptModuleSummary>("script-modules", { spec: wanted });
            setSpec("");
            await refresh();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setInstalling(false);
        }
    }

    async function remove(module: ScriptModuleSummary) {
        setError(undefined);
        try {
            await server.remove(`script-modules/${module.noteId}`);
            await refresh();
        } catch (e) {
            setError(errorMessage(e));
        }
    }

    return (
        <Modal
            className="script-modules-dialog"
            title={t("script_modules.title")}
            size="lg" maxWidth={600}
            onSubmit={install}
            onHidden={() => setShown(false)}
            show={shown}
            footer={<Button text={t("modal.close")} onClick={() => setShown(false)} />}
        >
            <div className="script-modules-install">
                <FormGroup name="script-module-spec" description={t("script_modules.spec_description")}>
                    <FormTextBox
                        currentValue={spec}
                        onChange={setSpec}
                        placeholder={t("script_modules.spec_placeholder")}
                        autoFocus
                    />
                </FormGroup>
                <Button
                    text={installing ? t("script_modules.installing") : t("script_modules.install")}
                    disabled={installing || !spec.trim()}
                    kind="primary"
                />
            </div>

            {error && <Alert type="danger">{error}</Alert>}

            {modules.length > 0
                ? <ul className="script-modules-list">
                    {modules.map((module) => (
                        <li key={module.noteId}>
                            <span className="script-module-spec">{module.spec}</span>
                            <span className="script-module-detail">
                                {t("script_modules.module_detail", {
                                    provider: module.providerId,
                                    fileCount: module.fileCount,
                                    size: formatSize(module.size)
                                })}
                            </span>
                            <ActionButton
                                icon="bx bx-trash"
                                text={t("script_modules.remove")}
                                onClick={() => void remove(module)}
                            />
                        </li>
                    ))}
                </ul>
                : <NoItems icon="bx bx-cube" text={t("script_modules.none_installed")} size="small" />}
        </Modal>
    );
}

/** Pulls the server's message out of a rejected request, which arrives as the raw response body. */
function errorMessage(e: unknown): string {
    if (typeof e === "string") {
        try {
            const parsed = JSON.parse(e);
            if (parsed && typeof parsed.message === "string") {
                return parsed.message;
            }
        } catch {
            return e;
        }
        return e;
    }

    return e instanceof Error ? e.message : String(e);
}
