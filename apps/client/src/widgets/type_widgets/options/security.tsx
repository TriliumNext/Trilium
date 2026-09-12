import { useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { isElectron } from "../../../services/utils";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import CodeBlock from "../../react/CodeBlock";
import Collapsible from "../../react/Collapsible";
import FormToggle from "../../react/FormToggle";
import HelpButton from "../../react/HelpButton";
import { useTriliumOptionBool } from "../../react/hooks";
import OptionsPageHeader from "./components/OptionsPageHeader";
import RestartAction from "./components/RestartAction";

export default function SecuritySettings() {
    // Local state tracks what's been written to security.json (pending restart).
    // null = no change made yet, use the live config value.
    const [pendingBackendScripting, setPendingBackendScripting] = useState<boolean | null>(null);
    const [pendingSqlConsole, setPendingSqlConsole] = useState<boolean | null>(null);
    const [pendingLanAccess, setPendingLanAccess] = useState<boolean | null>(null);

    const [liveBackendScripting] = useTriliumOptionBool("backendScriptingEnabled");
    const [liveSqlConsole] = useTriliumOptionBool("sqlConsoleEnabled");
    const [liveLanAccess] = useTriliumOptionBool("allowLanAccess");

    const hasPendingChanges =
        (pendingBackendScripting !== null && pendingBackendScripting !== liveBackendScripting) ||
        (pendingSqlConsole !== null && pendingSqlConsole !== liveSqlConsole) ||
        (pendingLanAccess !== null && pendingLanAccess !== liveLanAccess);

    return (
        <>
            <OptionsPageHeader />
            <BackendScriptingSettings
                liveValue={liveBackendScripting}
                pendingValue={pendingBackendScripting}
                setPendingValue={setPendingBackendScripting}
            />
            <SqlConsoleSettings
                liveValue={liveSqlConsole}
                pendingValue={pendingSqlConsole}
                setPendingValue={setPendingSqlConsole}
            />
            {isElectron() && (
                <LanAccessSettings
                    liveValue={liveLanAccess}
                    pendingValue={pendingLanAccess}
                    setPendingValue={setPendingLanAccess}
                />
            )}
            {hasPendingChanges && isElectron() && (
                <RestartAction text={t("security.restart_now")} icon="bx-refresh" />
            )}
        </>
    );
}

function ServerConfigHint({ configKey, envVar }: { configKey: string; envVar: string }) {
    if (isElectron()) {
        return null;
    }

    return (
        <CardSection>
            <Collapsible title={t("security.how_to_enable")}>
                <p>{t("security.server_config_hint")}</p>
                {/* `text/x-toml` is Trilium's entry for INI-family files — it is backed by
                    highlight.js's `ini` grammar, which is what config.ini actually is. */}
                <CodeBlock mimeType="text/x-toml" code={`[Security]\n${configKey}=true`} />
                <p>{t("security.server_env_hint")}</p>
                <CodeBlock mimeType="text/x-sh" code={`${envVar}=true`} />
            </Collapsible>
        </CardSection>
    );
}

interface ToggleSectionProps {
    liveValue: boolean;
    pendingValue: boolean | null;
    setPendingValue: (value: boolean | null) => void;
}

function BackendScriptingSettings({ liveValue, pendingValue, setPendingValue }: ToggleSectionProps) {
    const isDesktop = isElectron();
    const displayValue = pendingValue ?? liveValue;
    const hasPendingChange = pendingValue !== null && pendingValue !== liveValue;

    async function handleToggle(enabled: boolean) {
        const confirmed = await window.electronApi?.security.setBackendScriptingEnabled(enabled);
        if (confirmed) {
            // If toggling back to the live value, clear pending state
            setPendingValue(enabled === liveValue ? null : enabled);
        }
    }

    return (
        <Card
            heading={t("security.backend_scripting_title")}
            description={t("security.backend_scripting_section_description")}
            actions={<HelpButton helpPage="SPirpZypehBG" />}
        >
            <OptionCardSection
                name="backend-scripting-enabled"
                label={t("security.backend_scripting_label")}
                description={hasPendingChange
                    ? t("security.restart_required")
                    : t("security.backend_scripting_description")}
            >
                <FormToggle currentValue={displayValue} onChange={handleToggle} disabled={!isDesktop} />
            </OptionCardSection>

            <ServerConfigHint
                configKey="backendScriptingEnabled"
                envVar="TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED"
            />
        </Card>
    );
}

function SqlConsoleSettings({ liveValue, pendingValue, setPendingValue }: ToggleSectionProps) {
    const isDesktop = isElectron();
    const displayValue = pendingValue ?? liveValue;
    const hasPendingChange = pendingValue !== null && pendingValue !== liveValue;

    async function handleToggle(enabled: boolean) {
        const confirmed = await window.electronApi?.security.setSqlConsoleEnabled(enabled);
        if (confirmed) {
            setPendingValue(enabled === liveValue ? null : enabled);
        }
    }

    return (
        <Card
            heading={t("security.sql_console_title")}
            description={t("security.sql_console_section_description")}
            actions={<HelpButton helpPage="YKWqdJhzi2VY" />}
        >
            <OptionCardSection
                name="sql-console-enabled"
                label={t("security.sql_console_label")}
                description={hasPendingChange
                    ? t("security.restart_required")
                    : t("security.sql_console_description")}
            >
                <FormToggle currentValue={displayValue} onChange={handleToggle} disabled={!isDesktop} />
            </OptionCardSection>

            <ServerConfigHint
                configKey="sqlConsoleEnabled"
                envVar="TRILIUM_SECURITY_SQL_CONSOLE_ENABLED"
            />
        </Card>
    );
}

// Desktop only: a server build is already reachable on its bound interface
// (configured via [Network] host), so this toggle is gated behind isElectron()
// by the caller.
function LanAccessSettings({ liveValue, pendingValue, setPendingValue }: ToggleSectionProps) {
    const displayValue = pendingValue ?? liveValue;
    const hasPendingChange = pendingValue !== null && pendingValue !== liveValue;

    async function handleToggle(enabled: boolean) {
        const confirmed = await window.electronApi?.security.setLanAccessEnabled(enabled);
        if (confirmed) {
            setPendingValue(enabled === liveValue ? null : enabled);
        }
    }

    return (
        <Card
            heading={t("security.lan_access_title")}
            description={t("security.lan_access_section_description")}
            actions={<HelpButton helpPage="swSFivWk6KkA" />}
        >
            <OptionCardSection
                name="lan-access-enabled"
                label={t("security.lan_access_label")}
                description={hasPendingChange
                    ? t("security.restart_required")
                    : t("security.lan_access_description")}
            >
                <FormToggle currentValue={displayValue} onChange={handleToggle} />
            </OptionCardSection>
        </Card>
    );
}
