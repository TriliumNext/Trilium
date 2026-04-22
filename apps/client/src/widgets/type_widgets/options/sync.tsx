import { SyncTestResponse } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import FormTextBox from "../../react/FormTextBox";
import { useTriliumOption } from "../../react/hooks";
import OptionsRow, { OptionsRowWithButton } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";
import TimeSelector from "./components/TimeSelector";

export default function SyncOptions() {
    return <SyncConfiguration />;
}

export function SyncConfiguration() {
    const [syncServerHost, setSyncServerHost] = useTriliumOption("syncServerHost");
    const [syncProxy, setSyncProxy] = useTriliumOption("syncProxy");
    const [localHost, setLocalHost] = useState(syncServerHost);
    const [localProxy, setLocalProxy] = useState(syncProxy);

    useEffect(() => setLocalHost(syncServerHost), [syncServerHost]);
    useEffect(() => setLocalProxy(syncProxy), [syncProxy]);

    return (
        <OptionsSection helpUrl="cbkrhQjrkKrh">
            <OptionsRow name="sync-server-host" label={t("sync_2.server_address")} description={t("sync_2.server_address_description")} stacked>
                <FormTextBox
                    placeholder="https://<host>:<port>"
                    currentValue={localHost}
                    onChange={setLocalHost}
                    onBlur={setSyncServerHost}
                />
            </OptionsRow>

            <OptionsRow name="sync-proxy" label={t("sync_2.proxy_label")} description={t("sync_2.proxy_description")} stacked>
                <FormTextBox
                    placeholder="https://<host>:<port>"
                    currentValue={localProxy}
                    onChange={setLocalProxy}
                    onBlur={setSyncProxy}
                />
            </OptionsRow>

            <OptionsRow name="sync-server-timeout" label={t("sync_2.timeout")} description={t("sync_2.timeout_description")}>
                <TimeSelector
                    name="sync-server-timeout"
                    optionValueId="syncServerTimeout"
                    optionTimeScaleId="syncServerTimeoutTimeScale"
                    minimumSeconds={1}
                />
            </OptionsRow>

            <OptionsRowWithButton
                label={t("sync_2.test_button")}
                description={t("sync_2.test_description")}
                onClick={async () => {
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
                }}
            />
        </OptionsSection>
    );
}
