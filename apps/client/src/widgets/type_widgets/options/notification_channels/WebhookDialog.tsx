import "./WebhookDialog.css";

import type {
    NotificationChannelSecretPutRequest, NotificationChannelSecretView, NotificationChannelView,
    NotificationForwardingState, NotificationWebhookNetwork, TOTPStatus
} from "@triliumnext/commons";
import {
    NOTIFICATION_TEMPLATE_FIELDS, WEBHOOK_MAX_HEADERS, WEBHOOK_MAX_VALUES
} from "@triliumnext/commons/src/lib/notification_channels.js";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../../services/i18n";
import {
    changeSettings, createChannel, deleteSecret, editChannel, getSecret, putSecret
} from "../../../../services/notification_channels";
import { markBidiControls } from "../../../../services/notification_display";
import options from "../../../../services/options";
import server, { type Credentials } from "../../../../services/server";
import { formatDateTime } from "../../../../utils/formatters";
import ActionButton from "../../../react/ActionButton";
import Admonition from "../../../react/Admonition";
import Button from "../../../react/Button";
import { Card, CardSection, OptionCardSection } from "../../../react/Card";
import CodeBlock from "../../../react/CodeBlock";
import FormCheckbox from "../../../react/FormCheckbox";
import FormTextArea from "../../../react/FormTextArea";
import FormTextBox from "../../../react/FormTextBox";
import HelpButton from "../../../react/HelpButton";
import Modal from "../../../react/Modal";
import { useCredentialsPrompt } from "../components/CredentialsModal";
import { getRefusalCode, getRefusalMessage } from "./channel_messages";
import { ChannelSettingsFields, getSettingsChange, useChannelSettings } from "./ChannelDialog";

interface WebhookDialogProps {
    /** The webhook to edit, or none to add one. */
    channel?: NotificationChannelView;
    forwarding: NotificationForwardingState;
    onChanged(): void;
    onClosed(): void;
}

/** What the dialog changes of a webhook's address. The page never reads a value back. */
export interface AddressEdit {
    url: string;
    label: string;
    /** New values by name, `null` to remove a header. */
    headers: Record<string, string | null>;
    /** New values by name, `null` to remove a secret value. */
    values: Record<string, string | null>;
    /** A new signing secret, `null` to remove it, `undefined` to keep it. */
    signingSecret?: string | null;
    network: NotificationWebhookNetwork;
}

type SecretChange = Omit<NotificationChannelSecretPutRequest, "template" | "expected">;

const NO_LOCAL_NETWORK: NotificationWebhookNetwork = { allowPrivate: false, allowLoopback: false };

/**
 * Adds or edits a webhook: its title and body template, its settings once it is enabled, and on
 * the forwarding instance its address. A change of the address needs the password, asked once
 * per save.
 */
export default function WebhookDialog({
    channel, forwarding, onChanged, onClosed
}: WebhookDialogProps) {
    const isForwarding = forwarding.isForwardingInstance;
    const [ isShown, setIsShown ] = useState(true);
    const [ title, setTitle ] = useState(
        () => channel?.title ?? t("notification_channels.webhook_default_title"));
    const savedTemplate = channel?.config?.template ?? "";
    const [ template, setTemplate ] = useState(savedTemplate);
    const [ settings, setSettings ] = useChannelSettings(channel);
    const { secret, edit, setEdit, loadSecret } = useAddress(isForwarding, channel?.channelId);
    const [ notice, setNotice ] = useState<string>();
    const [ isBusy, setIsBusy ] = useState(false);
    const [ askCredentials, credentialsModal ] = useCredentialsPrompt();
    // The ID of a webhook that this dialog created, before the card lists it.
    const createdId = useRef<string | undefined>(undefined);
    const isNewAddress = edit.url.trim() !== "";

    async function askForCredentials(): Promise<Credentials | null> {
        if (!options.is("isPasswordSet")) {
            setNotice(t("notification_channels.refusals.password-not-set"));
            return null;
        }
        let isCodeAsked: boolean;
        try {
            ({ isCodeAsked } = await server.get<TOTPStatus>("totp/status"));
        } catch (e) {
            setNotice(getRefusalMessage(e));
            return null;
        }
        return await askCredentials({
            title: t("notification_channels.credentials_title"), isCodeAsked
        });
    }

    async function save() {
        if (isBusy || !title.trim()) {
            return;
        }
        setNotice(undefined);
        if (isForwarding && template.trim() && !isJson(template)) {
            setNotice(t("notification_channels.refusals.invalid-template"));
            return;
        }

        const isTemplateChanged = isForwarding && template !== savedTemplate;
        const secretChange = isForwarding
            ? getSecretChange(edit, secret, isTemplateChanged || channel?.isTemplateBound === false)
            : null;
        const credentials = secretChange ? await askForCredentials() : null;
        if (secretChange && !credentials) {
            return;
        }

        setIsBusy(true);
        let channelId = channel?.channelId ?? createdId.current;
        try {
            const config = isForwarding ? { config: { template } } : {};
            if (!channelId) {
                const created = await createChannel({ type: "webhook", title, ...config });
                channelId = created.channel.channelId;
                createdId.current = channelId;
            } else if (title !== channel?.title || isTemplateChanged) {
                await editChannel(channelId, { title, ...(isTemplateChanged ? config : {}) });
            }

            if (secretChange && credentials) {
                const expected = secret?.version ?? (await getSecret(channelId)).version;
                await putSecret(channelId, { ...secretChange, template, expected }, credentials);
            }

            const settingsChange = channel?.state === "enabled"
                ? getSettingsChange(channel, settings)
                : null;
            if (settingsChange) {
                await changeSettings(channelId, settingsChange);
            }
            onChanged();
            setIsShown(false);
        } catch (e) {
            setNotice(getRefusalMessage(e));
            onChanged();
            if (channelId && getRefusalCode(e) === "stale-revision") {
                void loadSecret(channelId);
            }
        } finally {
            setIsBusy(false);
        }
    }

    async function removeAddress() {
        const channelId = channel?.channelId;
        if (!channelId || !secret) {
            return;
        }
        const credentials = await askForCredentials();
        if (!credentials) {
            return;
        }

        setIsBusy(true);
        setNotice(undefined);
        try {
            await deleteSecret(channelId, { expected: secret.version }, credentials);
            onChanged();
        } catch (e) {
            setNotice(getRefusalMessage(e));
        } finally {
            setIsBusy(false);
            void loadSecret(channelId);
        }
    }

    return <>
        <Modal
            className="webhook-dialog"
            size="lg"
            scrollable
            stackable
            portal
            title={channel
                ? t("notification_channels.edit_title", { title: markBidiControls(channel.title) })
                : t("notification_channels.add_webhook_title")}
            show={isShown}
            onHidden={onClosed}
            onSubmit={() => void save()}
            footer={<>
                <Button text={t("common.cancel")} onClick={() => setIsShown(false)} />
                <Button
                    name="save-webhook"
                    kind="primary"
                    text={t("common.save")}
                    disabled={isBusy}
                />
            </>}
        >
            <Card className="webhook-general">
                <OptionCardSection
                    name="webhook-title"
                    stacked
                    label={t("notification_channels.webhook_title")}
                >
                    <FormTextBox required currentValue={title} onChange={setTitle} />
                </OptionCardSection>
            </Card>

            <TemplateCard
                template={template}
                isEditable={isForwarding}
                availableValues={getAvailableValues(edit, secret)}
                onChange={setTemplate}
            />

            {isForwarding ? (
                <AddressCard
                    secret={secret}
                    edit={edit}
                    isNewAddress={isNewAddress}
                    isBusy={isBusy}
                    onChange={setEdit}
                    onRemove={() => void removeAddress()}
                />
            ) : (
                <Card className="webhook-address" heading={t("notification_channels.address")}>
                    <CardSection>
                        {channel?.isAddressSet
                            ? t("notification_channels.address_set_elsewhere")
                            : t("notification_channels.address_unset_elsewhere")}
                    </CardSection>
                </Card>
            )}

            {channel?.state === "enabled" && (
                <ChannelSettingsFields settings={settings} onChange={setSettings} />
            )}
            {notice && <Admonition type="caution">{notice}</Admonition>}
        </Modal>
        {credentialsModal}
    </>;
}

/** The secret view of a webhook on the forwarding instance, and what the dialog changes of it. */
function useAddress(isForwarding: boolean, channelId: string | undefined) {
    const [ secret, setSecret ] = useState<NotificationChannelSecretView>();
    const [ edit, setEdit ] = useState<AddressEdit>(() => getInitialEdit(undefined));
    // A webhook that the dialog creates has no address to read until a save enters one.
    const [ initialChannelId ] = useState(channelId);

    const loadSecret = useCallback(async (id: string) => {
        try {
            const loaded = await getSecret(id);
            setSecret(loaded);
            setEdit(getInitialEdit(loaded));
        } catch {
            setSecret(undefined);
        }
    }, []);

    useEffect(() => {
        if (isForwarding && initialChannelId) {
            void loadSecret(initialChannelId);
        }
    }, [ isForwarding, initialChannelId, loadSecret ]);

    return { secret, edit, setEdit, loadSecret };
}

interface TemplateCardProps {
    template: string;
    isEditable: boolean;
    /** The secret values that the address has, or will have after the save. */
    availableValues: string[];
    onChange(template: string): void;
}

function TemplateCard({ template, isEditable, availableValues, onChange }: TemplateCardProps) {
    const missingValues = getMissingValues(template, availableValues);

    return (
        <Card
            className="webhook-template"
            heading={t("notification_channels.template")}
            description={t("notification_channels.template_description")}
            actions={<HelpButton helpPage="hEKnvzPYgJsx" />}
        >
            <CardSection>
                {isEditable ? <>
                    <FormTextArea
                        className="webhook-template-text"
                        rows={10}
                        spellcheck={false}
                        placeholder={t("notification_channels.template_placeholder")}
                        currentValue={template}
                        onChange={onChange}
                    />
                    <div className="webhook-template-starters">
                        <span>{t("notification_channels.template_start_from")}</span>
                        {WEBHOOK_TEMPLATES.map(({ name, text }) => (
                            <Button
                                key={name}
                                name={`webhook-template-${name}`}
                                size="micro"
                                text={t(`notification_channels.template_${name}`)}
                                onClick={() => onChange(text)}
                            />
                        ))}
                    </div>
                    {missingValues.length > 0 && (
                        <p className="webhook-template-missing">
                            {t("notification_channels.template_missing_values", {
                                names: missingValues.join(", ")
                            })}
                        </p>
                    )}
                </> : <>
                    <p>{t("notification_channels.template_set_elsewhere")}</p>
                    {template
                        ? <CodeBlock className="webhook-template-text" code={template} wrap />
                        : <p>{t("notification_channels.template_default")}</p>}
                </>}
            </CardSection>
        </Card>
    );
}

interface AddressCardProps {
    secret: NotificationChannelSecretView | undefined;
    edit: AddressEdit;
    isNewAddress: boolean;
    isBusy: boolean;
    onChange(edit: AddressEdit): void;
    onRemove(): void;
}

/** The write-only fields of a webhook's address, which only the forwarding instance keeps. */
function AddressCard({ secret, edit, isNewAddress, isBusy, onChange, onRemove }: AddressCardProps) {
    const isSet = !!secret?.isSet;
    // A new address drops what was entered for the old one, so those names are not listed.
    const keptSecret = isNewAddress ? undefined : secret;

    return (
        <Card
            className="webhook-address"
            heading={t("notification_channels.address")}
            description={t("notification_channels.address_description")}
            actions={isSet && (
                <Button
                    name="remove-webhook-address"
                    size="micro"
                    text={t("notification_channels.remove_address")}
                    disabled={isBusy}
                    onClick={onRemove}
                />
            )}
        >
            <OptionCardSection
                name="webhook-url"
                stacked
                label={t("notification_channels.url")}
                description={isSet
                    ? t("notification_channels.url_set", {
                        time: formatDateTime(secret?.changedAt)
                    })
                    : t("notification_channels.url_unset")}
            >
                <FormTextBox
                    autocomplete="off"
                    spellcheck={false}
                    placeholder="https://"
                    currentValue={edit.url}
                    onChange={(url) => onChange({ ...edit, url })}
                />
            </OptionCardSection>

            {isNewAddress && isSet && (
                <CardSection>
                    <Admonition type="note">{t("notification_channels.new_address")}</Admonition>
                </CardSection>
            )}

            <OptionCardSection
                name="webhook-address-label"
                stacked
                label={t("notification_channels.address_label")}
                description={t("notification_channels.address_label_description")}
            >
                <FormTextBox
                    placeholder={t("notification_channels.address_label_placeholder")}
                    currentValue={edit.label}
                    onChange={(label) => onChange({ ...edit, label })}
                />
            </OptionCardSection>

            <SecretEntries
                name="webhook-headers"
                label={t("notification_channels.headers")}
                description={t("notification_channels.headers_description", {
                    count: WEBHOOK_MAX_HEADERS
                })}
                names={keptSecret?.headers ?? []}
                changes={edit.headers}
                onChange={(headers) => onChange({ ...edit, headers })}
            />

            <SecretEntries
                name="webhook-values"
                label={t("notification_channels.secret_values")}
                description={t("notification_channels.secret_values_description", {
                    count: WEBHOOK_MAX_VALUES, secretValue: "{{secret.name}}"
                })}
                names={keptSecret?.values ?? []}
                changes={edit.values}
                onChange={(values) => onChange({ ...edit, values })}
            />

            <OptionCardSection
                name="webhook-signing-secret"
                stacked
                label={t("notification_channels.signing_secret")}
                description={keptSecret?.hasSigningSecret
                    ? t("notification_channels.signing_secret_set")
                    : t("notification_channels.signing_secret_unset")}
            >
                <FormTextBox
                    type="password"
                    autocomplete="new-password"
                    placeholder={t("notification_channels.signing_secret_placeholder")}
                    disabled={edit.signingSecret === null}
                    currentValue={edit.signingSecret ?? ""}
                    onChange={(value) => onChange({ ...edit, signingSecret: value || undefined })}
                />
            </OptionCardSection>
            {keptSecret?.hasSigningSecret && (
                <CardSection>
                    <FormCheckbox
                        name="webhook-remove-signing-secret"
                        label={t("notification_channels.remove_signing_secret")}
                        currentValue={edit.signingSecret === null}
                        onChange={(isRemoved) => onChange({
                            ...edit, signingSecret: isRemoved ? null : undefined
                        })}
                    />
                </CardSection>
            )}

            {secret?.isNetworkAllowed && (
                <OptionCardSection
                    stacked
                    label={t("notification_channels.network")}
                    description={t("notification_channels.network_description")}
                >
                    <div className="webhook-network">
                        <FormCheckbox
                            name="webhook-allow-private"
                            label={t("notification_channels.network_private")}
                            currentValue={edit.network.allowPrivate}
                            onChange={(allowPrivate) => onChange({
                                ...edit, network: { ...edit.network, allowPrivate }
                            })}
                        />
                        <FormCheckbox
                            name="webhook-allow-loopback"
                            label={t("notification_channels.network_loopback")}
                            currentValue={edit.network.allowLoopback}
                            onChange={(allowLoopback) => onChange({
                                ...edit, network: { ...edit.network, allowLoopback }
                            })}
                        />
                    </div>
                </OptionCardSection>
            )}
        </Card>
    );
}

interface SecretEntriesProps {
    name: string;
    label: string;
    description: string;
    /** The names that the address has. */
    names: string[];
    /** New values by name, `null` for a name to remove. */
    changes: Record<string, string | null>;
    onChange(changes: Record<string, string | null>): void;
}

/** The headers or the secret values of an address: the names that are set, and new values. */
function SecretEntries({ name, label, description, names, changes, onChange }: SecretEntriesProps) {
    const [ newName, setNewName ] = useState("");
    const [ newValue, setNewValue ] = useState("");
    const shownNames = [ ...new Set([ ...names, ...Object.keys(changes) ]) ]
        .filter((entryName) => changes[entryName] !== null);

    /** Removes a name that the address has on save, and drops one that the dialog added. */
    function remove(entryName: string) {
        onChange(names.includes(entryName)
            ? { ...changes, [entryName]: null }
            : withoutKey(changes, entryName));
    }

    function add() {
        const entryName = newName.trim();
        if (!entryName || !newValue) {
            return;
        }
        onChange({ ...changes, [entryName]: newValue });
        setNewName("");
        setNewValue("");
    }

    function addOnEnter(event: KeyboardEvent) {
        if (event.key === "Enter") {
            event.preventDefault();
            add();
        }
    }

    return (
        <OptionCardSection
            className={`webhook-secret-entries ${name}`}
            stacked
            label={label}
            description={description}
        >
            <div className="webhook-secret-entry-list">
                {shownNames.map((entryName) => (
                    <div key={entryName} className="webhook-secret-entry">
                        <code>{markBidiControls(entryName)}</code>
                        <span className="webhook-secret-entry-state">
                            {getEntryState(changes[entryName], names.includes(entryName))}
                        </span>
                        <ActionButton
                            className="destructive-action-icon"
                            icon="bx bx-x"
                            text={t("notification_channels.entry_delete")}
                            onClick={() => remove(entryName)}
                        />
                    </div>
                ))}
                <div className="webhook-secret-entry-new">
                    <FormTextBox
                        name={`${name}-name`}
                        placeholder={t("notification_channels.entry_name")}
                        currentValue={newName}
                        onChange={setNewName}
                        onKeyDown={addOnEnter}
                    />
                    <FormTextBox
                        name={`${name}-value`}
                        type="password"
                        autocomplete="new-password"
                        placeholder={t("notification_channels.entry_value")}
                        currentValue={newValue}
                        onChange={setNewValue}
                        onKeyDown={addOnEnter}
                    />
                    <Button
                        name={`${name}-add`}
                        size="small"
                        text={t("notification_channels.entry_add")}
                        disabled={!newName.trim() || !newValue}
                        onClick={add}
                    />
                </div>
            </div>
        </OptionCardSection>
    );
}

/**
 * The change of the address that a save sends, without its template and version, or `null` when
 * the save sends none. A change with a new URL replaces the whole entry, so it includes every field
 * of the address; one without includes only the fields that changed, and the template when it
 * needs binding.
 */
export function getSecretChange(
    edit: AddressEdit,
    secret: NotificationChannelSecretView | undefined,
    isTemplateToBind: boolean
): SecretChange | null {
    const url = edit.url.trim();
    if (url) {
        const change: SecretChange = {
            url,
            label: edit.label,
            network: edit.network,
            headers: withoutRemovals(edit.headers),
            values: withoutRemovals(edit.values)
        };
        if (edit.signingSecret) {
            change.signingSecret = edit.signingSecret;
        }
        return change;
    }
    if (!secret?.isSet) {
        return null;
    }

    const change: SecretChange = {};
    if (Object.keys(edit.headers).length > 0) {
        change.headers = edit.headers;
    }
    if (Object.keys(edit.values).length > 0) {
        change.values = edit.values;
    }
    if (edit.signingSecret !== undefined) {
        change.signingSecret = edit.signingSecret;
    }
    if (edit.label !== (secret.label ?? "")) {
        change.label = edit.label;
    }
    if (edit.network.allowPrivate !== secret.network.allowPrivate
        || edit.network.allowLoopback !== secret.network.allowLoopback) {
        change.network = edit.network;
    }
    return Object.keys(change).length > 0 || isTemplateToBind ? change : null;
}

function getInitialEdit(secret: NotificationChannelSecretView | undefined): AddressEdit {
    return {
        url: "",
        label: secret?.label ?? "",
        headers: {},
        values: {},
        network: secret?.network ?? NO_LOCAL_NETWORK
    };
}

/** The names of the secret values that the address will have once the dialog saves. */
function getAvailableValues(edit: AddressEdit, secret: NotificationChannelSecretView | undefined) {
    const kept = edit.url.trim() ? [] : secret?.values ?? [];
    const names = new Set(kept);
    for (const [ name, value ] of Object.entries(edit.values)) {
        if (value === null) {
            names.delete(name);
        } else {
            names.add(name);
        }
    }
    return [ ...names ];
}

/** The secret values that a template refers to and the address lacks. */
function getMissingValues(template: string, availableValues: string[]) {
    const referenced = [ ...template.matchAll(/\{\{secret\.([^{}]+)\}\}/g) ]
        .map(([ , name ]) => name);
    return [ ...new Set(referenced) ].filter((name) => !availableValues.includes(name));
}

function getEntryState(change: string | null | undefined, isSet: boolean) {
    if (change === undefined || change === null) {
        return t("notification_channels.entry_set");
    }
    return isSet
        ? t("notification_channels.entry_new_value")
        : t("notification_channels.entry_new");
}

function withoutKey(changes: Record<string, string | null>, key: string) {
    const { [key]: _removed, ...rest } = changes;
    return rest;
}

function withoutRemovals(changes: Record<string, string | null>) {
    const kept: Record<string, string> = {};
    for (const [ name, value ] of Object.entries(changes)) {
        if (value !== null) {
            kept[name] = value;
        }
    }
    return kept;
}

function isJson(text: string) {
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

/** The body templates of common receivers that the dialog offers to start from. */
const WEBHOOK_TEMPLATES = [
    {
        name: "ntfy",
        text: toTemplate({
            topic: "{{secret.topic}}",
            title: "{{title}}",
            message: "{{description}}",
            priority: 4
        })
    },
    {
        name: "pushover",
        text: toTemplate({
            token: "{{secret.token}}",
            user: "{{secret.user}}",
            message: "{{title}}\n{{description}}"
        })
    },
    {
        name: "json",
        text: toTemplate(Object.fromEntries(
            NOTIFICATION_TEMPLATE_FIELDS.map((field) => [ field, `{{${field}}}` ])))
    }
];

function toTemplate(body: object) {
    return JSON.stringify(body, null, 4);
}
