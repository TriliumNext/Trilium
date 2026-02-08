import "./import_preview.css";

import { DangerousAttributeCategory, ImportPreviewResponse } from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { cancelUploadWithPreview, executeUploadWithPreview } from "../../services/import";
import { boolToString, dynamicRequire, isElectron } from "../../services/utils";
import { Badge } from "../react/Badge";
import Button from "../react/Button";
import { Card } from "../react/Card";
import FormGroup from "../react/FormGroup";
import FormRadioGroup from "../react/FormRadioGroup";
import { useTriliumEvent, useTriliumOptionBool } from "../react/hooks";
import Modal from "../react/Modal";
import NoteAutocomplete from "../react/NoteAutocomplete";

export interface ImportPreviewData {
    parentNoteId?: string;
    previews: ImportPreviewResponse[];
}

type DangerousCategory = "critical" | "warning";
const DANGEROUS_CATEGORIES_MAPPINGS: Record<DangerousAttributeCategory, {
    title: string;
    description: string;
    icon: string;
    category: DangerousCategory;
}> = {
    clientSideScripting: {
        icon: "bx bx-window-alt",
        title: t("import_preview.badge_client_side_scripting_title"),
        description: t("import_preview.badge_client_side_scripting_tooltip"),
        category: "critical"
    },
    serverSideScripting: {
        icon: "bx bx-server",
        title: t("import_preview.badge_server_side_scripting_title"),
        description: t("import_preview.badge_server_side_scripting_tooltip"),
        category: "critical"
    },
    codeExecution: {
        icon: "bx bx-terminal",
        title: t("import_preview.badge_code_execution_title"),
        description: t("import_preview.badge_code_execution_description"),
        category: "critical"
    },
    iconPack: {
        icon: "bx bx-package",
        title: t("import_preview.badge_icon_pack_title"),
        description: t("import_preview.badge_icon_pack_description"),
        category: "warning"
    },
    webview: {
        icon: "bx bx-globe",
        title: t("import_preview.badge_web_view_title"),
        description: t("import_preview.badge_web_view_description"),
        category: "warning"
    }
};

const SEVERITY_ORDER: Record<DangerousCategory, number> = {
    critical: 0,
    warning: 1
};

const IMPORT_BUTTON_TIMEOUT = 3;

export default function ImportPreviewDialog() {
    const [ data, setData ] = useState<ImportPreviewData | null>(null);
    const [ shown, setShown ] = useState(false);
    const [ importMethod, setImportMethod ] = useState<string>("safe");
    const isDangerousImport = data?.previews.some(preview => preview.isDangerous);
    const [ importButtonTimeout, setImportButtonTimeout ] = useState(0);
    const [ compressImages ] = useTriliumOptionBool("compressImages");
    const hasSubmittedRef = useRef(false);

    useEffect(() => {
        // If safe → reset and do nothing
        if (!isDangerousImport) {
            setImportButtonTimeout(0);
            return;
        }

        // Start countdown
        setImportButtonTimeout(IMPORT_BUTTON_TIMEOUT);

        const interval = setInterval(() => {
            setImportButtonTimeout(prev => {
                if (prev <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isDangerousImport]);

    useTriliumEvent("showImportPreviewDialog", (data) => {
        setData(data);
        setShown(true);
        setImportButtonTimeout(IMPORT_BUTTON_TIMEOUT);
        hasSubmittedRef.current = false;
    });

    useEffect(() => {
        if (!isElectron()) return;
        const { ipcRenderer } = dynamicRequire("electron");
        const onShow = (_event: any, data: ImportPreviewData) => {
            setData(data);
            setShown(true);
            setImportButtonTimeout(IMPORT_BUTTON_TIMEOUT);
            hasSubmittedRef.current = false;
        };
        ipcRenderer.send("import-preview-ready");
        ipcRenderer.on("show-import-preview-dialog", onShow);
        return () => {
            ipcRenderer.removeListener("show-import-preview-dialog", onShow);
        };
    }, []);

    return (
        <Modal
            className="import-preview-dialog"
            size="lg"
            title={t("import_preview.title")}
            footer={<>
                <Button text={t("import_preview.cancel")} onClick={() => setShown(false)}/>
                <Button
                    text={importButtonTimeout
                        ? t("import_preview.import_with_timeout", { timeout: importButtonTimeout })
                        : t("import_preview.import")}
                    disabled={importButtonTimeout > 0}
                    primary
                />
            </>}
            show={shown}
            onSubmit={() => {
                if (!data) return;
                hasSubmittedRef.current = true;
                executeUploadWithPreview(data.parentNoteId, data.previews, {
                    shrinkImages: boolToString(compressImages),
                    safeImport: boolToString(importMethod === "safe")
                });
                setShown(false);
            }}
            onHidden={() => {
                setShown(false);
                setData(null);
                setImportButtonTimeout(3);
                if (!hasSubmittedRef.current) {
                    hasSubmittedRef.current = true;
                    if (data?.previews) {
                        cancelUploadWithPreview(data.previews);
                    }
                }
            }}
        >
            <p>{isDangerousImport
                ? t("import_preview.intro_unsafe", { count: data?.previews.length })
                : t("import_preview.intro_safe", { count: data?.previews.length })}</p>

            {data?.previews.map(preview => <SinglePreview key={preview.id} preview={preview} />)}

            <div className="import-options">
                <FormGroup name="parent-note" label={t("import_preview.parent_note")}>
                    <NoteAutocomplete
                        noteId={data?.parentNoteId}
                        noteIdChanged={noteId => {
                            if (!data) return;
                            setData({
                                ...data,
                                parentNoteId: noteId
                            });
                        }}
                    />
                </FormGroup>

                <FormRadioGroup
                    name="import-method"
                    currentValue={importMethod} onChange={setImportMethod}
                    values={[
                        { value: "safe", label: t("import_preview.import_safely"), inlineDescription: t("import_preview.import_safely_description") },
                        { value: "unsafe", label: t("import_preview.import_trust"), inlineDescription: t("import_preview.import_trust_description") }
                    ]}
                />
            </div>
        </Modal>
    );
}

function SinglePreview({ preview }: { preview: ImportPreviewResponse }) {
    const categories = sortDangerousAttributeCategoryBySeverity(preview.dangerousAttributeCategories);

    return (
        <Card
            title={preview.fileName}
            className={DANGEROUS_CATEGORIES_MAPPINGS[categories[0]]?.category ?? "safe"}
        >
            <div className="stats">
                <span>{t("import_preview.notes_count", { count: preview.numNotes })}</span>
                <span>{t("import_preview.attributes_count", { count: preview.numAttributes })}</span>
                <span>{t("import_preview.attachments_count", { count: preview.numAttachments })}</span>
            </div>

            <div className="dangerous-categories">
                {categories.length > 0
                    ? categories.map(dangerousCategory => {
                        const mapping = DANGEROUS_CATEGORIES_MAPPINGS[dangerousCategory];
                        return (
                            <Badge
                                key={dangerousCategory}
                                className={mapping.category}
                                icon={mapping.icon}
                                text={mapping.title}
                                tooltip={mapping.description}
                            />
                        );
                    })
                    : (
                        <Badge
                            className="safe"
                            icon="bx bx-check"
                            text="Safe"
                            tooltip="This archive has no active content such as scripts or widgets that could affect your knowledge base or access sensitive data."
                        />
                    )}
            </div>
        </Card>
    );
}

function sortDangerousAttributeCategoryBySeverity(categories: string[]) {
    return categories.toSorted((a, b) => {
        const aLevel = DANGEROUS_CATEGORIES_MAPPINGS[a].category;
        const bLevel = DANGEROUS_CATEGORIES_MAPPINGS[b].category;
        return SEVERITY_ORDER[aLevel] - SEVERITY_ORDER[bLevel];
    });
}
