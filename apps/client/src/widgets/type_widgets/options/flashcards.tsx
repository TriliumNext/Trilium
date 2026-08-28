import "./flashcards.css";

import type { FlashcardSchedulerSettings } from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import flashcards from "../../../services/flashcards";
import { t } from "../../../services/i18n";
import toast from "../../../services/toast";
import { Card, OptionCardSection } from "../../react/Card";
import ActionButton from "../../react/ActionButton";
import FormTextBox, { FormTextBoxWithUnit } from "../../react/FormTextBox";
import FormToggle from "../../react/FormToggle";
import OptionsPageHeader from "./components/OptionsPageHeader";

export default function FlashcardSettings() {
    const [ schedulerConfig, setSchedulerConfig ] = useState<FlashcardSchedulerSettings | null>(null);
    const [ saving, setSaving ] = useState(false);
    const [ loadingError, setLoadingError ] = useState(false);

    useEffect(() => {
        let cancelled = false;

        flashcards.getSettings()
            .then((settings) => {
                if (!cancelled) {
                    setSchedulerConfig(settings.schedulerConfig);
                    setLoadingError(false);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setLoadingError(true);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    async function saveSchedulerConfig(nextConfig: FlashcardSchedulerSettings) {
        const previousConfig = schedulerConfig;
        setSchedulerConfig(nextConfig);
        setSaving(true);

        try {
            const saved = await flashcards.setSettings({ schedulerConfig: nextConfig });
            setSchedulerConfig(saved.schedulerConfig);
            toast.showMessage(t("flashcards.settings_saved"));
        } catch {
            setSchedulerConfig(previousConfig);
            toast.showError(t("flashcards.settings_save_failed"));
        } finally {
            setSaving(false);
        }
    }

    function patchSchedulerConfig(patch: Partial<FlashcardSchedulerSettings>) {
        if (!schedulerConfig) return;
        void saveSchedulerConfig({ ...schedulerConfig, ...patch });
    }

    return (
        <>
            <OptionsPageHeader />
            {renderSettingsCard({ loadingError, schedulerConfig, saving, patchSchedulerConfig })}
            <ImportExportCard />
        </>
    );
}

function ImportExportCard() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [ importing, setImporting ] = useState(false);

    async function handleExportAnki() {
        try {
            flashcards.exportAnkiPackage();
        } catch {
            toast.showError(t("flashcards.anki_export_failed"));
        }
    }

    async function handleExport() {
        try {
            const payload = await flashcards.exportAll();
            const blob = new Blob([ JSON.stringify(payload, null, 2) ], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `trilium-flashcards-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            URL.revokeObjectURL(url);
        } catch {
            toast.showError(t("flashcards.export_failed"));
        }
    }

    async function handleImportFile(file: File) {
        setImporting(true);
        try {
            const payload = JSON.parse(await file.text());
            const result = await flashcards.importData({ payload });
            toast.showMessage(t("flashcards.import_success", {
                created: result.createdCards,
                updated: result.updatedCards,
                skipped: result.skippedCards,
                reviews: result.importedReviews
            }));
        } catch {
            toast.showError(t("flashcards.import_failed"));
        } finally {
            setImporting(false);
        }
    }

    return (
        <Card
            className="flashcards-data"
            heading={t("flashcards.data_title")}
            description={t("flashcards.data_description")}
        >
            <OptionCardSection
                name="flashcard-export"
                label={t("flashcards.export_label")}
                description={t("flashcards.export_description")}
            >
                <ActionButton
                    text={t("flashcards.export_button")}
                    icon="bx bx-download"
                    onClick={() => void handleExport()}
                />
            </OptionCardSection>
            <OptionCardSection
                name="flashcard-export-anki"
                label={t("flashcards.anki_export_label")}
                description={t("flashcards.anki_export_description")}
            >
                <ActionButton
                    text={t("flashcards.anki_export_button")}
                    icon="bx bx-package"
                    onClick={() => void handleExportAnki()}
                />
            </OptionCardSection>
            <OptionCardSection
                name="flashcard-import"
                label={t("flashcards.import_label")}
                description={t("flashcards.import_description")}
            >
                <ActionButton
                    text={t("flashcards.import_button")}
                    icon="bx bx-upload"
                    disabled={importing}
                    onClick={() => fileInputRef.current?.click()}
                />
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="flashcards-import-input"
                    onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        if (file) {
                            void handleImportFile(file);
                            e.currentTarget.value = "";
                        }
                    }}
                />
            </OptionCardSection>
        </Card>
    );
}

interface SettingsCardProps {
    loadingError: boolean;
    schedulerConfig: FlashcardSchedulerSettings | null;
    saving: boolean;
    patchSchedulerConfig: (patch: Partial<FlashcardSchedulerSettings>) => void;
}

function renderSettingsCard({
    loadingError,
    schedulerConfig,
    saving,
    patchSchedulerConfig
}: SettingsCardProps) {
    if (loadingError) {
        return (
            <Card
                heading={t("flashcards.settings_title")}
                description={t("flashcards.settings_load_failed")}
            >
                {null}
            </Card>
        );
    }

    if (!schedulerConfig) {
        return (
            <Card
                heading={t("flashcards.settings_title")}
                description={t("flashcards.settings_loading")}
            >
                {null}
            </Card>
        );
    }

    return (
        <Card
            className="flashcards-settings"
            heading={t("flashcards.settings_title")}
            description={t("flashcards.settings_description")}
        >
            <OptionCardSection
                name="flashcard-request-retention"
                label={t("flashcards.settings_request_retention")}
                description={t("flashcards.settings_request_retention_description")}
            >
                <FormTextBoxWithUnit
                    type="number"
                    min={1}
                    max={99}
                    currentValue={Math.round(schedulerConfig.requestRetention * 100).toString()}
                    unit="%"
                    disabled={saving}
                    onBlur={(value) => {
                        patchSchedulerConfig({ requestRetention: parseInt(value, 10) / 100 });
                    }}
                />
            </OptionCardSection>

            <OptionCardSection
                name="flashcard-maximum-interval"
                label={t("flashcards.settings_maximum_interval")}
                description={t("flashcards.settings_maximum_interval_description")}
            >
                <FormTextBoxWithUnit
                    type="number"
                    min={1}
                    max={36500}
                    currentValue={schedulerConfig.maximumInterval.toString()}
                    unit={t("flashcards.days", { count: schedulerConfig.maximumInterval })}
                    disabled={saving}
                    onBlur={(value) => {
                        patchSchedulerConfig({ maximumInterval: parseInt(value, 10) });
                    }}
                />
            </OptionCardSection>

            <OptionCardSection
                name="flashcard-learning-steps"
                label={t("flashcards.settings_learning_steps")}
                description={t("flashcards.settings_learning_steps_description")}
                stacked
            >
                <FormTextBox
                    currentValue={schedulerConfig.learningSteps.join(" ")}
                    disabled={saving}
                    onBlur={(value) => {
                        const learningSteps = parseStepList(value);
                        if (!learningSteps) return;
                        patchSchedulerConfig({ learningSteps });
                    }}
                />
            </OptionCardSection>

            <OptionCardSection
                name="flashcard-relearning-steps"
                label={t("flashcards.settings_relearning_steps")}
                description={t("flashcards.settings_relearning_steps_description")}
                stacked
            >
                <FormTextBox
                    currentValue={schedulerConfig.relearningSteps.join(" ")}
                    disabled={saving}
                    onBlur={(value) => {
                        const relearningSteps = parseStepList(value);
                        if (!relearningSteps) return;
                        patchSchedulerConfig({ relearningSteps });
                    }}
                />
            </OptionCardSection>

            <OptionCardSection
                name="flashcard-enable-fuzz"
                label={t("flashcards.settings_enable_fuzz")}
                description={t("flashcards.settings_enable_fuzz_description")}
            >
                <FormToggle
                    currentValue={schedulerConfig.enableFuzz}
                    onChange={(enableFuzz) => patchSchedulerConfig({ enableFuzz })}
                    disabled={saving}
                />
            </OptionCardSection>

            <OptionCardSection
                name="flashcard-enable-short-term"
                label={t("flashcards.settings_enable_short_term")}
                description={t("flashcards.settings_enable_short_term_description")}
            >
                <FormToggle
                    currentValue={schedulerConfig.enableShortTerm}
                    onChange={(enableShortTerm) => patchSchedulerConfig({ enableShortTerm })}
                    disabled={saving}
                />
            </OptionCardSection>
        </Card>
    );
}

function parseStepList(value: string) {
    const steps = value
        .split(/[\s,]+/)
        .map((step) => step.trim())
        .filter((step) => step.length > 0);

    if (steps.some((step) => !/^\d+(?:\.\d+)?[mhd]$/.test(step))) {
        toast.showError(t("flashcards.settings_step_validation"));
        return null;
    }

    return steps;
}
