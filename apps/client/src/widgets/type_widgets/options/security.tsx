import { useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import { isElectron, restartDesktopApp } from "../../../services/utils";
import Button from "../../react/Button";
import Collapsible from "../../react/Collapsible";
import { useTriliumOptionBool } from "../../react/hooks";
import OptionsPageHeader from "./components/OptionsPageHeader";
import OptionsRow, { OptionsRowWithToggle } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

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
                <OptionsSection noCard>
                    <OptionsRow name="restart" centered>
                        <Button
                            name="restart-app-button"
                            text={t("security.restart_now")}
                            icon="bx bx-refresh"
                            size="micro"
                            onClick={restartDesktopApp}
                        />
                    </OptionsRow>
                </OptionsSection>
            )}
        </>
    );
}

function ServerConfigHint({ configKey, envVar }: { configKey: string; envVar: string }) {
    if (isElectron()) {
        return null;
    }

    return (
        <Collapsible title={t("security.how_to_enable")}>
            <p>{t("security.server_config_hint")}</p>
            <pre><code>{`[Security]\n${configKey}=true`}</code></pre>
            <p>{t("security.server_env_hint")}</p>
            <pre><code>{envVar}=true</code></pre>
        </Collapsible>
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
        const confirmed = await window.electronApi!.security.setBackendScriptingEnabled(enabled);
        if (confirmed) {
            // If toggling back to the live value, clear pending state
            setPendingValue(enabled === liveValue ? null : enabled);
        }
    }

    return (
        <OptionsSection
            title={t("security.backend_scripting_title")}
            description={t("security.backend_scripting_section_description")}
            helpUrl="SPirpZypehBG"
        >
            <OptionsRowWithToggle
                name="backend-scripting-enabled"
                label={t("security.backend_scripting_label")}
                description={hasPendingChange
                    ? t("security.restart_required")
                    : t("security.backend_scripting_description")}
                currentValue={displayValue}
                onChange={handleToggle}
                disabled={!isDesktop}
            />
            <ServerConfigHint
                configKey="backendScriptingEnabled"
                envVar="TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED"
            />
        </OptionsSection>
    );
}

function SqlConsoleSettings({ liveValue, pendingValue, setPendingValue }: ToggleSectionProps) {
    const isDesktop = isElectron();
    const displayValue = pendingValue ?? liveValue;
    const hasPendingChange = pendingValue !== null && pendingValue !== liveValue;

    async function handleToggle(enabled: boolean) {
        const confirmed = await window.electronApi!.security.setSqlConsoleEnabled(enabled);
        if (confirmed) {
            setPendingValue(enabled === liveValue ? null : enabled);
        }
    }

    return (
        <OptionsSection
            title={t("security.sql_console_title")}
            description={t("security.sql_console_section_description")}
            helpUrl="YKWqdJhzi2VY"
        >
            <OptionsRowWithToggle
                name="sql-console-enabled"
                label={t("security.sql_console_label")}
                description={hasPendingChange
                    ? t("security.restart_required")
                    : t("security.sql_console_description")}
                currentValue={displayValue}
                onChange={handleToggle}
                disabled={!isDesktop}
            />
            <ServerConfigHint
                configKey="sqlConsoleEnabled"
                envVar="TRILIUM_SECURITY_SQL_CONSOLE_ENABLED"
            />
        </OptionsSection>
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
        <OptionsSection
            title={t("security.lan_access_title")}
            description={t("security.lan_access_section_description")}
        >
            <OptionsRowWithToggle
                name="lan-access-enabled"
                label={t("security.lan_access_label")}
                description={hasPendingChange
                    ? t("security.restart_required")
                    : t("security.lan_access_description")}
                currentValue={displayValue}
                onChange={handleToggle}
            />
        </OptionsSection>
    );
}
