import { AnonymizedDbResponse, DatabaseAnonymizeResponse, DatabaseCheckIntegrityResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import { type ExperimentalFeatureId,experimentalFeatures } from "../../../services/experimental_features";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import FormText from "../../react/FormText";
import { useTriliumOptionJson } from "../../react/hooks";
import { OptionsRowWithButton, OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

export default function AdvancedSettings() {
    return <>
        <DatabaseOptions />
        <DatabaseAnonymizationOptions />
        <ExperimentalOptions />
        <AdvancedSyncOptions />
    </>;
}

function AdvancedSyncOptions() {
    return (
        <OptionsSection title={t("sync.title")}>
            <OptionsRowWithButton
                label={t("sync.force_full_sync_label")}
                description={t("sync.force_full_sync_description")}
                onClick={async () => {
                    await server.post("sync/force-full-sync");
                    toast.showMessage(t("sync.full_sync_triggered"));
                }}
            />

            <OptionsRowWithButton
                label={t("sync.fill_entity_changes_label")}
                description={t("sync.fill_entity_changes_description")}
                onClick={async () => {
                    toast.showMessage(t("sync.filling_entity_changes"));
                    await server.post("sync/fill-entity-changes");
                    toast.showMessage(t("sync.sync_rows_filled_successfully"));
                }}
            />
        </OptionsSection>
    );
}

function DatabaseOptions() {
    return (
        <OptionsSection title={t("database.title")}>
            <OptionsRowWithButton
                label={t("database_integrity_check.check_integrity_label")}
                description={t("database_integrity_check.check_integrity_description")}
                onClick={async () => {
                    toast.showMessage(t("database_integrity_check.checking_integrity"));

                    const { results } = await server.get<DatabaseCheckIntegrityResponse>("database/check-integrity");

                    if (results.length === 1 && results[0].integrity_check === "ok") {
                        toast.showMessage(t("database_integrity_check.integrity_check_succeeded"));
                    } else {
                        toast.showMessage(t("database_integrity_check.integrity_check_failed", { results: JSON.stringify(results, null, 2) }), 15000);
                    }
                }}
            />

            <OptionsRowWithButton
                label={t("consistency_checks.find_and_fix_label")}
                description={t("consistency_checks.find_and_fix_description")}
                onClick={async () => {
                    toast.showMessage(t("consistency_checks.finding_and_fixing_message"));
                    await server.post("database/find-and-fix-consistency-issues");
                    toast.showMessage(t("consistency_checks.issues_fixed_message"));
                }}
            />

            <OptionsRowWithButton
                label={t("vacuum_database.vacuum_label")}
                description={t("vacuum_database.vacuum_description")}
                onClick={async () => {
                    toast.showMessage(t("vacuum_database.vacuuming_database"));
                    await server.post("database/vacuum-database");
                    toast.showMessage(t("vacuum_database.database_vacuumed"));
                }}
            />
        </OptionsSection>
    );
}

function DatabaseAnonymizationOptions() {
    const [existingAnonymizedDatabases, setExistingAnonymizedDatabases] = useState<AnonymizedDbResponse[]>([]);

    function refreshAnonymizedDatabase() {
        server.get<AnonymizedDbResponse[]>("database/anonymized-databases").then(setExistingAnonymizedDatabases);
    }

    useEffect(refreshAnonymizedDatabase, []);

    return (
        <OptionsSection title={t("database_anonymization.title")}>
            <FormText>{t("database_anonymization.description")}</FormText>

            <OptionsRowWithButton
                label={t("database_anonymization.full_anonymization")}
                description={t("database_anonymization.full_anonymization_description")}
                onClick={async () => {
                    toast.showMessage(t("database_anonymization.creating_fully_anonymized_database"));
                    const resp = await server.post<DatabaseAnonymizeResponse>("database/anonymize/full");

                    if (!resp.success) {
                        toast.showError(t("database_anonymization.error_creating_anonymized_database"));
                    } else {
                        toast.showMessage(t("database_anonymization.successfully_created_fully_anonymized_database", { anonymizedFilePath: resp.anonymizedFilePath }), 10000);
                        refreshAnonymizedDatabase();
                    }
                }}
            />

            <OptionsRowWithButton
                label={t("database_anonymization.light_anonymization")}
                description={t("database_anonymization.light_anonymization_description")}
                onClick={async () => {
                    toast.showMessage(t("database_anonymization.creating_lightly_anonymized_database"));
                    const resp = await server.post<DatabaseAnonymizeResponse>("database/anonymize/light");

                    if (!resp.success) {
                        toast.showError(t("database_anonymization.error_creating_anonymized_database"));
                    } else {
                        toast.showMessage(t("database_anonymization.successfully_created_lightly_anonymized_database", { anonymizedFilePath: resp.anonymizedFilePath }), 10000);
                        refreshAnonymizedDatabase();
                    }
                }}
            />

            <hr />

            <ExistingAnonymizedDatabases databases={existingAnonymizedDatabases} />
        </OptionsSection>
    );
}

function ExistingAnonymizedDatabases({ databases }: { databases: AnonymizedDbResponse[] }) {
    if (!databases.length) {
        return <FormText>{t("database_anonymization.no_anonymized_database_yet")}</FormText>;
    }

    return (
        <table className="table table-stripped">
            <thead>
                <th>{t("database_anonymization.existing_anonymized_databases")}</th>
            </thead>
            <tbody>
                {databases.map(({ filePath }) => (
                    <tr>
                        <td>{filePath}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}


function ExperimentalOptions() {
    const [enabledFeatures, setEnabledFeatures] = useTriliumOptionJson<ExperimentalFeatureId[]>("experimentalFeatures", true);
    const filteredFeatures = useMemo(() => experimentalFeatures.filter(e => e.id !== "new-layout"), []);

    const toggleFeature = useCallback((featureId: ExperimentalFeatureId, enabled: boolean) => {
        if (enabled) {
            setEnabledFeatures([...enabledFeatures, featureId]);
        } else {
            setEnabledFeatures(enabledFeatures.filter(id => id !== featureId));
        }
    }, [enabledFeatures, setEnabledFeatures]);

    if (filteredFeatures.length === 0) {
        return null;
    }

    return (
        <OptionsSection title={t("experimental_features.title")}>
            <FormText>{t("experimental_features.disclaimer")}</FormText>

            {filteredFeatures.map((feature) => (
                <OptionsRowWithToggle
                    key={feature.id}
                    name={`experimental-${feature.id}`}
                    label={feature.name}
                    description={feature.description}
                    currentValue={enabledFeatures.includes(feature.id)}
                    onChange={(enabled) => toggleFeature(feature.id, enabled)}
                />
            ))}
        </OptionsSection>
    );
}
