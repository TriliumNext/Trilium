import { SyncTestResponse } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import Button from "../../react/Button";
import { Card, OptionCardSection } from "../../react/Card";
import FormTextBox from "../../react/FormTextBox";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import OptionsPageHeader from "./components/OptionsPageHeader";
import TimeSelector from "./components/TimeSelector";

export default function SyncOptions() {
    return (
        <>
            <OptionsPageHeader helpUrl="cbkrhQjrkKrh" />
            <SyncConfiguration />
        </>
    );
}

/**
 * The sync settings, followed by a card for what is not a setting: the address sync contacts, and
 * the test that contacts it.
 *
 * `testConnection()` saves the address boxes before it posts to `sync/test`, so it reads what is
 * still on screen rather than what is stored.
 */
export function SyncConfiguration() {
    const [syncServerHost, setSyncServerHost] = useTriliumOption("syncServerHost");
    const [syncProxy, setSyncProxy] = useTriliumOption("syncProxy");
    const [localHost, setLocalHost] = useState(syncServerHost);
    const [localProxy, setLocalProxy] = useState(syncProxy);

    useEffect(() => setLocalHost(syncServerHost), [syncServerHost]);
    useEffect(() => setLocalProxy(syncProxy), [syncProxy]);

    async function testConnection() {
        await Promise.all([
            setSyncServerHost(localHost),
            setSyncProxy(localProxy)
        ]);
        const result = await server.post<SyncTestResponse>("sync/test");

        if (result.success && result.message) {
            toast.showMessage(result.message);
        } else {
            toast.showError(t("sync_2.handshake_failed", { message: result.message }));
        }
    }

    return (
        <>
            <Card heading={t("sync_2.config_title")}>
                <OptionCardSection
                    name="sync-server-host"
                    label={t("sync_2.server_address")}
                    description={t("sync_2.server_address_description")}
                    stacked
                >
                    <FormTextBox
                        placeholder="https://<host>:<port>"
                        currentValue={localHost}
                        onChange={setLocalHost}
                        onBlur={setSyncServerHost}
                    />
                </OptionCardSection>

                <OptionCardSection
                    name="sync-proxy"
                    label={t("sync_2.proxy_label")}
                    description={t("sync_2.proxy_description")}
                    stacked
                >
                    <FormTextBox
                        placeholder="https://<host>:<port>"
                        currentValue={localProxy}
                        onChange={setLocalProxy}
                        onBlur={setSyncProxy}
                    />
                </OptionCardSection>

                <OptionCardSection
                    name="sync-server-timeout"
                    label={t("sync_2.timeout")}
                    description={t("sync_2.timeout_description")}
                >
                    <TimeSelector
                        name="sync-server-timeout"
                        optionValueId="syncServerTimeout"
                        optionTimeScaleId="syncServerTimeoutTimeScale"
                        minimumSeconds={1}
                    />
                </OptionCardSection>
            </Card>

            <Card>
                <EffectiveSyncServer />

                <OptionCardSection
                    label={t("sync_2.test_title")}
                    description={t("sync_2.test_description")}
                >
                    <Button
                        name="test-sync-button"
                        text={t("sync_2.test_button")}
                        size="micro"
                        onClick={() => void testConnection()}
                    />
                </OptionCardSection>
            </Card>
        </>
    );
}

/**
 * The address sync contacts, shown only when config.ini or an environment variable supplies it.
 * Without an override it would repeat the box above, where the stored option is already editable.
 */
function EffectiveSyncServer() {
    const [isOverridden] = useTriliumOptionBool("syncServerHostOverridden");
    const [effectiveSyncServerHost] = useTriliumOption("effectiveSyncServerHost");

    if (!isOverridden) {
        return null;
    }

    return (
        <OptionCardSection
            label={t("sync_2.effective_server")}
            description={t("sync_2.effective_server_description")}
        >
            <span className="tn-card-option-value">
                {effectiveSyncServerHost || t("sync_2.effective_server_disabled")}
            </span>
        </OptionCardSection>
    );
}
