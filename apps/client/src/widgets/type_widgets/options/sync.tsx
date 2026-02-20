import { useRef } from "preact/hooks";
import { t } from "../../../services/i18n";
import { openInAppHelpFromUrl } from "../../../services/utils";
import Button from "../../react/Button";
import FormGroup from "../../react/FormGroup";
import FormTextBox, { FormTextBoxWithUnit } from "../../react/FormTextBox";
import RawHtml from "../../react/RawHtml";
import OptionsSection from "./components/OptionsSection";
import { useTriliumOptions } from "../../react/hooks";
import FormText from "../../react/FormText";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { SyncTestResponse } from "@triliumnext/commons";

export default function SyncOptions() {
    return (
        <>
            <SyncConfiguration />
            <SyncTest />
        </>
    )
}

export function SyncConfiguration() {
    const [ options, setOptions ] = useTriliumOptions("syncServerHost", "syncServerTimeout", "syncProxy");
    const syncServerHost = useRef(options.syncServerHost);
    const syncServerTimeout = useRef(options.syncServerTimeout);
    const syncProxy = useRef(options.syncProxy);

    return (
        <OptionsSection title={t("sync_2.config_title")}>
            <form onSubmit={(e) => {
                setOptions({
                    syncServerHost: syncServerHost.current,
                    syncServerTimeout: syncServerTimeout.current,
                    syncProxy: syncProxy.current
                });
                e.preventDefault();
            }}>
                <FormGroup name="sync-server-host" label={t("sync_2.server_address")}>
                    <FormTextBox                        
                        placeholder="https://<host>:<port>"
                        currentValue={syncServerHost.current} onChange={(newValue) => syncServerHost.current = newValue}
                    />
                </FormGroup>

                <FormGroup name="sync-proxy" label={t("sync_2.proxy_label")}
                    description={<>
                        <strong>{t("sync_2.note")}:</strong> {t("sync_2.note_description")}<br/>
                        <RawHtml html={t("sync_2.special_value_description")} />
                    </>}
                >
                    <FormTextBox                        
                        placeholder="https://<host>:<port>"
                        currentValue={syncProxy.current} onChange={(newValue) => syncProxy.current = newValue}
                    />
                </FormGroup>

                <FormGroup name="sync-server-timeout" label={t("sync_2.timeout")}>
                    <FormTextBoxWithUnit                        
                        min={1} max={10000000} type="number"
                        unit={t("sync_2.timeout_unit")}
                        currentValue={syncServerTimeout.current} onChange={(newValue) => syncServerTimeout.current = newValue}
                    />
                </FormGroup>

                <div style={{ display: "flex", justifyContent: "spaceBetween"}}>
                    <Button text={t("sync_2.save")} kind="primary" />
                    <Button text={t("sync_2.help")} onClick={() => openInAppHelpFromUrl("cbkrhQjrkKrh")} />
                </div>
            </form>
        </OptionsSection>
    )
}

export function SyncTest() {
    return (
        <OptionsSection title={t("sync_2.test_title")}>
            <FormText>{t("sync_2.test_description")}</FormText>
            <Button
                text={t("sync_2.test_button")}
                onClick={async () => {
                    const result = await server.post<SyncTestResponse>("sync/test");

                    if (result.success && result.message) {
                        toast.showMessage(result.message);
                    } else {
                        toast.showError(t("sync_2.handshake_failed", { message: result.message }));
                    }
                }}
            />
        </OptionsSection>
    )
}