import { useState } from "preact/hooks";

import type { SecurityToggleName } from "@triliumnext/commons";

import { t } from "../../../services/i18n";
import { isElectron, isStandalone } from "../../../services/utils";
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
            {hasPendingChanges && canToggle() && (
                <RestartAction
                    text={isElectron()
                        ? t("security.restart_now")
                        : t("security.standalone.reload_now")}
                    icon="bx-refresh"
                />
            )}
        </>
    );
}

/**
 * Whether this build can change the settings from here: the desktop, which writes its data
 * directory, and the standalone tab that owns the worker holding the OPFS file's lock. Everywhere
 * else the toggle shows the state and `WhereToEnableHint` says where to change it.
 */
function canToggle(): boolean {
    return isElectron() || (isStandalone && !!window.standaloneApi?.security);
}

/**
 * Asks the platform to change a setting, and says whether the user agreed to it.
 *
 * The confirmation is the platform's, not this page's: a note script can reach any dialog the
 * application draws for itself, so the desktop asks the operating system and standalone asks the
 * browser. Which means this is not the only caller — the page is one way to reach a request that
 * the user still has to answer either way.
 */
async function requestSecurityChange(
    setting: SecurityToggleName, enabled: boolean
): Promise<boolean> {
    const api = window.electronApi?.security ?? window.standaloneApi?.security;

    if (setting === "backendScriptingEnabled") {
        return await api?.setBackendScriptingEnabled(enabled) === true;
    }

    return await api?.setSqlConsoleEnabled(enabled) === true;
}

/**
 * Where to change a setting this build does not change from here.
 *
 * A server reads them from `config.ini`; a standalone tab that does not own the database has no
 * worker to write the file through, so the one that does is where the toggle works.
 */
function WhereToEnableHint({ configKey, envVar }: { configKey: string; envVar: string }) {
    if (canToggle()) {
        return null;
    }

    if (isStandalone) {
        return (
            <CardSection>
                <p>{t("security.standalone.other_tab_hint")}</p>
            </CardSection>
        );
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
    const displayValue = pendingValue ?? liveValue;
    const hasPendingChange = pendingValue !== null && pendingValue !== liveValue;

    async function handleToggle(enabled: boolean) {
        if (await requestSecurityChange("backendScriptingEnabled", enabled)) {
            // If toggling back to the live value, clear pending state
            setPendingValue(enabled === liveValue ? null : enabled);
        }
    }

    return (
        <Card
            heading={t("security.backend_scripting_title")}
            // Standalone runs core in a Web Worker, so what a backend script reaches there is the
            // database: every note, the options table, and the sync credentials it holds.
            description={isStandalone
                ? t("security.standalone.backend_scripting_section_description")
                : t("security.backend_scripting_section_description")}
            actions={<HelpButton helpPage="SPirpZypehBG" />}
        >
            <OptionCardSection
                name="backend-scripting-enabled"
                label={t("security.backend_scripting_label")}
                description={hasPendingChange
                    ? restartRequiredText()
                    : t("security.backend_scripting_description")}
            >
                <FormToggle currentValue={displayValue} onChange={handleToggle} disabled={!canToggle()} />
            </OptionCardSection>

            <WhereToEnableHint
                configKey="backendScriptingEnabled"
                envVar="TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED"
            />
        </Card>
    );
}

/** What has to happen before a change counts: a relaunch on the desktop, a reload in a browser. */
function restartRequiredText(): string {
    return isElectron() ? t("security.restart_required") : t("security.standalone.reload_required");
}

function SqlConsoleSettings({ liveValue, pendingValue, setPendingValue }: ToggleSectionProps) {
    const displayValue = pendingValue ?? liveValue;
    const hasPendingChange = pendingValue !== null && pendingValue !== liveValue;

    async function handleToggle(enabled: boolean) {
        if (await requestSecurityChange("sqlConsoleEnabled", enabled)) {
            setPendingValue(enabled === liveValue ? null : enabled);
        }
    }

    return (
        <Card
            heading={t("security.sql_console_title")}
            // The options table holds the sync credentials and the password hash wherever Trilium
            // runs, so what the SQL console reaches is the same in a browser as anywhere else.
            description={t("security.sql_console_section_description")}
            actions={<HelpButton helpPage="YKWqdJhzi2VY" />}
        >
            <OptionCardSection
                name="sql-console-enabled"
                label={t("security.sql_console_label")}
                description={hasPendingChange
                    ? restartRequiredText()
                    : t("security.sql_console_description")}
            >
                <FormToggle currentValue={displayValue} onChange={handleToggle} disabled={!canToggle()} />
            </OptionCardSection>

            <WhereToEnableHint
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
