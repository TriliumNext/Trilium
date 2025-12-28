import { AnonymizedDbResponse, DatabaseAnonymizeResponse, DatabaseCheckIntegrityResponse } from "@triliumnext/commons";
import { useEffect, useMemo, useState } from "preact/hooks";

import { experimentalFeatures } from "../../../services/experimental_features";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import Button from "../../react/Button";
import Column from "../../react/Column";
import FormText from "../../react/FormText";
import { useTriliumOptionJson } from "../../react/hooks";
import CheckboxList from "./components/CheckboxList";
import OptionsSection from "./components/OptionsSection";

export default function AdvancedSettings() {
    return <>
        <AdvancedSyncOptions />
        <DatabaseIntegrityOptions />
        <DatabaseAnonymizationOptions />
        <VacuumDatabaseOptions />
        <ExperimentalOptions />
    </>;
}

function AdvancedSyncOptions() {
    return (
        <OptionsSection title={t("sync.title")}>
            <Button
                text={t("sync.force_full_sync_button")}
                onClick={async () => {
                    await server.post("sync/force-full-sync");
                    toast.showMessage(t("sync.full_sync_triggered"));
                }}
            />

            <Button
                text={t("sync.fill_entity_changes_button")}
                onClick={async () => {
                    toast.showMessage(t("sync.filling_entity_changes"));
                    await server.post("sync/fill-entity-changes");
                    toast.showMessage(t("sync.sync_rows_filled_successfully"));
                }}
            />
        </OptionsSection>
    );
}

function DatabaseIntegrityOptions() {
    return (
        <OptionsSection title={t("database_integrity_check.title")}>
            <FormText>{t("database_integrity_check.description")}</FormText>

            <Button
                text={t("database_integrity_check.check_button")}
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

            <Button
                text={t("consistency_checks.find_and_fix_button")}
                onClick={async () => {
                    toast.showMessage(t("consistency_checks.finding_and_fixing_message"));
                    await server.post("database/find-and-fix-consistency-issues");
                    toast.showMessage(t("consistency_checks.issues_fixed_message"));
                }}
            />
        </OptionsSection>
    );
}

function DatabaseAnonymizationOptions() {
    const [ existingAnonymizedDatabases, setExistingAnonymizedDatabases ] = useState<AnonymizedDbResponse[]>([]);

    function refreshAnonymizedDatabase() {
        server.get<AnonymizedDbResponse[]>("database/anonymized-databases").then(setExistingAnonymizedDatabases);
    }

    useEffect(refreshAnonymizedDatabase, []);

    return (
        <OptionsSection title={t("database_anonymization.title")}>
            <FormText>{t("database_anonymization.choose_anonymization")}</FormText>

            <div className="row">
                <DatabaseAnonymizationOption
                    title={t("database_anonymization.full_anonymization")}
                    description={t("database_anonymization.full_anonymization_description")}
                    buttonText={t("database_anonymization.save_fully_anonymized_database")}
                    buttonClick={async () => {
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
                <DatabaseAnonymizationOption
                    title={t("database_anonymization.light_anonymization")}
                    description={t("database_anonymization.light_anonymization_description")}
                    buttonText={t("database_anonymization.save_lightly_anonymized_database")}
                    buttonClick={async () => {
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
            </div>

            <hr />
            <ExistingAnonymizedDatabases databases={existingAnonymizedDatabases} />
        </OptionsSection>
    );
}

function DatabaseAnonymizationOption({ title, description, buttonText, buttonClick }: { title: string, description: string, buttonText: string, buttonClick: () => void }) {
    return (
        <Column md={6} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginTop: "1em" }}>
            <h5>{title}</h5>
            <FormText>{description}</FormText>
            <Button text={buttonText} onClick={buttonClick} />
        </Column>
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

function VacuumDatabaseOptions() {
    return (
        <OptionsSection title={t("vacuum_database.title")}>
            <FormText>{t("vacuum_database.description")}</FormText>

            <Button
                text={t("vacuum_database.button_text")}
                onClick={async () => {
                    toast.showMessage(t("vacuum_database.vacuuming_database"));
                    await server.post("database/vacuum-database");
                    toast.showMessage(t("vacuum_database.database_vacuumed"));
                }}
            />
        </OptionsSection>
    );
}

function ExperimentalOptions() {
    const [ enabledExperimentalFeatures, setEnabledExperimentalFeatures ] = useTriliumOptionJson<string[]>("experimentalFeatures", true);
    const filteredExperimentalFeatures = useMemo(() =>  experimentalFeatures.filter(e => e.id !== "new-layout"), []);

    return (filteredExperimentalFeatures.length > 0 &&
        <OptionsSection title={t("experimental_features.title")}>
            <FormText>{t("experimental_features.disclaimer")}</FormText>

            <CheckboxList
                values={filteredExperimentalFeatures}
                keyProperty="id"
                titleProperty="name"
                descriptionProperty="description"
                currentValue={enabledExperimentalFeatures} onChange={setEnabledExperimentalFeatures}
            />
        </OptionsSection>
    );
}
