import { SyncTestResponse } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import Button from "../../react/Button";
import { Card, OptionCardSection } from "../../react/Card";
import FormTextBox from "../../react/FormTextBox";
import { useTriliumOption } from "../../react/hooks";
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
 * Where to sync and how patiently, followed by the one thing on this page that acts rather than sets.
 *
 * The test stands on a card of its own, so that what it does is not read as one more setting; it is
 * still driven from here because it saves what has been typed before it runs, and so needs the values
 * still sitting in the boxes rather than the ones already stored.
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
