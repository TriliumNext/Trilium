import "./ChannelsCard.css";

import type {
    EntityChange, NotificationChannelListResponse, NotificationChannelState,
    NotificationChannelTestResponse, NotificationChannelView, NotificationForwardingState,
    WebSocketMessage
} from "@triliumnext/commons";
import type { ComponentChildren, JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import dialog from "../../../../services/dialog";
import { t } from "../../../../services/i18n";
import {
    deleteChannel, disableChannel, getSecret, listChannels, resumeForwarding, sendTestNotification
} from "../../../../services/notification_channels";
import { markBidiControls } from "../../../../services/notification_display";
import toast from "../../../../services/toast";
import { escapeHtml } from "../../../../services/utils";
import { subscribeToMessages, unsubscribeToMessage } from "../../../../services/ws";
import { formatDateTime } from "../../../../utils/formatters";
import ActionButton from "../../../react/ActionButton";
import Admonition from "../../../react/Admonition";
import { Badge } from "../../../react/Badge";
import Button from "../../../react/Button";
import { Card, CardSection, ItemCreationRow, OptionCardSection } from "../../../react/Card";
import FormToggle from "../../../react/FormToggle";
import HelpButton from "../../../react/HelpButton";
import Icon from "../../../react/Icon";
import NoItems from "../../../react/NoItems";
import { getOutcomeText, getRefusalMessage } from "./channel_messages";
import ChannelDialog from "./ChannelDialog";
import WebhookDialog from "./WebhookDialog";

/** How long the card waits after a change that concerns channels before it loads the list. */
const RELOAD_DELAY_MS = 500;
/** The attributes that make a note a channel, or name the settings widget of one. */
const CHANNEL_ATTRIBUTE_NAMES = new Set([ "notificationChannel", "configWidget" ]);
const STATE_ICONS: Record<NotificationChannelState, string> = {
    found: "bx bx-search",
    enabled: "bx bx-check",
    changed: "bx bx-error"
};

type OpenDialog =
    | { kind: "channel"; channelId: string }
    | { kind: "webhook"; channelId?: string };

type TestResults = Record<string, NotificationChannelTestResponse>;

/** The channels that forward notifications, and the state of forwarding on this instance. */
export default function NotificationChannelsCard() {
    const { list, isFailed, reload } = useChannelList();
    const addressTimes = useAddressTimes(list);
    const [ openDialog, setOpenDialog ] = useState<OpenDialog>();
    const [ testResults, setTestResults ] = useState<TestResults>({});
    const isForwarding = !!list?.forwarding.isForwardingInstance;
    const webhookType = list?.types.find(({ type }) => type === "webhook");
    const dialogChannel = openDialog?.channelId
        ? list?.channels.find(({ channelId }) => channelId === openDialog.channelId)
        : undefined;

    /** Runs a request of the card, shows why it failed, and loads the list again. */
    async function run(request: () => Promise<unknown>) {
        try {
            await request();
        } catch (e) {
            toast.showError(getRefusalMessage(e));
        }
        await reload();
    }

    function toggle(channel: NotificationChannelView, isOn: boolean) {
        if (isOn) {
            review(channel);
        } else {
            void disable(channel);
        }
    }

    /** Opens the review of a channel, which enables it. */
    function review({ channelId }: NotificationChannelView) {
        setOpenDialog({ kind: "channel", channelId });
    }

    function disable({ channelId }: NotificationChannelView) {
        return run(async () => {
            const { isRecorded } = await disableChannel(channelId);
            if (!isRecorded) {
                toast.showMessage(t("notification_channels.disable_not_recorded"));
            }
        });
    }

    function test({ channelId }: NotificationChannelView) {
        return run(async () => {
            const result = await sendTestNotification(channelId);
            setTestResults((results) => ({ ...results, [channelId]: result }));
        });
    }

    async function remove({ channelId, title }: NotificationChannelView) {
        const message = t("notification_channels.delete_confirm", { title: escapeHtml(title) });
        if (await dialog.confirm(message)) {
            await run(() => deleteChannel(channelId));
        }
    }

    function edit({ channelId, kind }: NotificationChannelView) {
        setOpenDialog(kind === "script"
            ? { kind: "channel", channelId }
            : { kind: "webhook", channelId });
    }

    return (
        <Card
            className="notification-channels"
            heading={t("notification_channels.title")}
            description={t("notification_channels.description")}
            actions={<HelpButton helpPage="hEKnvzPYgJsx" />}
        >
            {list && (
                <ForwardingSections
                    forwarding={list.forwarding}
                    onResume={(sendDue) => void run(() => resumeForwarding(sendDue))}
                />
            )}
            {isFailed && (
                <CardSection>
                    <NoItems
                        icon="bx bx-error-circle"
                        text={t("notification_channels.load_failed")}
                        size="small"
                    />
                </CardSection>
            )}

            {list?.channels.map((channel) => (
                <ChannelRow
                    key={channel.channelId}
                    channel={channel}
                    isForwarding={isForwarding}
                    addressChangedAt={isForwarding
                        ? addressTimes[channel.channelId]
                        : channel.status?.addressChangedAt}
                    testResult={testResults[channel.channelId]}
                    onToggle={(isOn) => toggle(channel, isOn)}
                    onReview={() => review(channel)}
                    onDisable={() => void disable(channel)}
                    onEdit={() => edit(channel)}
                    onDelete={() => void remove(channel)}
                    onTest={() => void test(channel)}
                />
            ))}
            {list?.channels.length === 0 && (
                <CardSection>
                    <NoItems
                        icon="bx bx-broadcast"
                        text={t("notification_channels.no_channels")}
                        size="small"
                    />
                </CardSection>
            )}

            {webhookType && (webhookType.isAvailable ? (
                <ItemCreationRow buttons={[ {
                    name: "add-webhook",
                    label: t("notification_channels.add_webhook"),
                    icon: "bx bx-plus",
                    onClick: () => setOpenDialog({ kind: "webhook" })
                } ]} />
            ) : (
                <CardSection className="notification-webhooks-unavailable">
                    {t("notification_channels.webhooks_need_sync_server")}
                </CardSection>
            ))}

            {list && openDialog?.kind === "channel" && dialogChannel && (
                <ChannelDialog
                    key={dialogChannel.channelId}
                    channel={dialogChannel}
                    onChanged={() => void reload()}
                    onClosed={() => setOpenDialog(undefined)}
                />
            )}
            {list && openDialog?.kind === "webhook" && (dialogChannel || !openDialog.channelId) && (
                <WebhookDialog
                    key={openDialog.channelId ?? ""}
                    channel={dialogChannel}
                    forwarding={list.forwarding}
                    onChanged={() => void reload()}
                    onClosed={() => setOpenDialog(undefined)}
                />
            )}
        </Card>
    );
}

interface ForwardingSectionsProps {
    forwarding: NotificationForwardingState;
    onResume(sendDue: boolean): void;
}

/** Which instance forwards, and why this one does not forward. */
function ForwardingSections({ forwarding, onResume }: ForwardingSectionsProps) {
    const { off, pause, isRecordReadable, recordName } = forwarding;

    return <>
        <CardSection className="notification-forwarding">
            <Icon icon={forwarding.isForwardingInstance ? "bx bx-server" : "bx bx-devices"} />
            <span>
                {forwarding.isForwardingInstance
                    ? t("notification_channels.forwarding_here")
                    : t("notification_channels.forwarding_elsewhere")}
            </span>
        </CardSection>

        {off && (
            <CardSection className="notification-forwarding-off">
                <Admonition type="caution">{t(`notification_channels.off.${off}`)}</Admonition>
            </CardSection>
        )}
        {!isRecordReadable && (
            <CardSection className="notification-forwarding-record">
                <Admonition type="caution">
                    {t("notification_channels.record_unreadable", { name: recordName })}
                </Admonition>
            </CardSection>
        )}
        {pause && (
            <CardSection className="notification-forwarding-pause">
                <Admonition type="caution">
                    <p>
                        {t("notification_channels.pause", { time: formatDateTime(pause.since) })}
                    </p>
                    <ul>
                        {pause.causes.map((cause) => (
                            <li key={cause}>{t(`notification_channels.pause_causes.${cause}`)}</li>
                        ))}
                    </ul>
                    <div className="notification-forwarding-actions">
                        <Button
                            name="send-due-notifications"
                            kind="primary"
                            size="small"
                            text={t("notification_channels.send_due")}
                            onClick={() => onResume(true)}
                        />
                        <Button
                            name="skip-due-notifications"
                            size="small"
                            text={t("notification_channels.skip_due")}
                            onClick={() => onResume(false)}
                        />
                    </div>
                </Admonition>
            </CardSection>
        )}
    </>;
}

interface ChannelRowProps {
    channel: NotificationChannelView;
    isForwarding: boolean;
    /** When the webhook's address last changed. */
    addressChangedAt?: string;
    testResult?: NotificationChannelTestResponse;
    onToggle(isOn: boolean): void;
    /** Opens the review of the channel, to enable it again. */
    onReview(): void;
    onDisable(): void;
    onEdit(): void;
    onDelete(): void;
    onTest(): void;
}

/** A channel: its title and state, its status, and what can be done with it. */
function ChannelRow(props: ChannelRowProps) {
    const { channel, isForwarding, addressChangedAt, onToggle, onEdit, onDelete, onTest } = props;
    const { state, kind, runsOn } = channel;
    const notices = getNotices(props);

    return (
        <OptionCardSection
            className="notification-channel"
            label={
                <span className="notification-channel-title">
                    <Icon icon={channel.icon} />
                    <span className="notification-channel-name">
                        {markBidiControls(channel.title)}
                    </span>
                    <Badge
                        className={`notification-channel-state ${state}`}
                        icon={STATE_ICONS[state]}
                        text={t(`notification_channels.states.${state}`)}
                        outline
                    />
                </span>
            }
            description={getStatusLines(channel, isForwarding, addressChangedAt).join("\n")}
            subSections={notices}
            subSectionsVisible={notices.length > 0}
        >
            <span className="tn-card-option-actions">
                {state === "enabled" && runsOn === "backend" && (
                    <ActionButton
                        icon="bx bx-paper-plane"
                        text={t("notification_channels.send_test")}
                        onClick={onTest}
                    />
                )}
                {(kind === "built-in" || state === "enabled") && (
                    <ActionButton
                        icon="bx bx-edit"
                        text={t("notification_channels.edit")}
                        onClick={onEdit}
                    />
                )}
                {kind === "built-in" && (
                    <ActionButton
                        className="destructive-action-icon"
                        icon="bx bx-trash"
                        text={t("notification_channels.delete")}
                        onClick={onDelete}
                    />
                )}
            </span>
            <FormToggle currentValue={state !== "found"} onChange={onToggle} />
        </OptionCardSection>
    );
}

/** The sections below a channel's row: the states that need an action, and its last test. */
function getNotices({ channel, testResult, onReview, onDisable, onEdit }: ChannelRowProps) {
    const notices: JSX.Element[] = [];
    if (channel.state === "changed") {
        notices.push(
            <ChannelNotice key="changed" text={t("notification_channels.changed_notice")}>
                <Button
                    name="review-channel"
                    size="micro"
                    text={t("notification_channels.review_again")}
                    onClick={onReview}
                />
            </ChannelNotice>
        );
    }
    if (channel.recordHold === "missing") {
        notices.push(
            <ChannelNotice key="missing" text={t("notification_channels.record_missing")}>
                <Button
                    name="enable-channel-again"
                    size="micro"
                    text={t("notification_channels.enable_again")}
                    onClick={onReview}
                />
                <Button
                    name="disable-channel"
                    size="micro"
                    text={t("notification_channels.disable")}
                    onClick={onDisable}
                />
            </ChannelNotice>
        );
    }
    if (channel.isTemplateBound === false) {
        notices.push(
            <ChannelNotice key="template" text={t("notification_channels.template_unbound")}>
                <Button
                    name="bind-webhook-template"
                    size="micro"
                    text={t("notification_channels.enter_credentials")}
                    onClick={onEdit}
                />
            </ChannelNotice>
        );
    }
    if (testResult) {
        notices.push(<TestResult key="test" result={testResult} />);
    }
    return notices;
}

function ChannelNotice({ text, children }: { text: string; children: ComponentChildren }) {
    return (
        <CardSection className="notification-channel-notice">
            <span className="notification-channel-notice-text">{text}</span>
            <span className="notification-channel-notice-actions">{children}</span>
        </CardSection>
    );
}

/** The outcome of a test send, with the message of a script's error as text. */
function TestResult({ result }: { result: NotificationChannelTestResponse }) {
    return (
        <CardSection className="notification-channel-test-result">
            <span>
                {t("notification_channels.test_result", { outcome: getOutcomeText(result.code) })}
            </span>
            <code className="notification-channel-test-code">{result.code}</code>
            {result.diagnostic && (
                <pre className="notification-channel-diagnostic">{result.diagnostic}</pre>
            )}
        </CardSection>
    );
}

/** The list of channels, loaded at once, after `reload()` and after changes that concern them. */
function useChannelList() {
    const [ list, setList ] = useState<NotificationChannelListResponse>();
    const [ isFailed, setIsFailed ] = useState(false);
    const lastRequest = useRef(0);

    const reload = useCallback(async () => {
        const request = ++lastRequest.current;
        try {
            const loaded = await listChannels();
            if (request === lastRequest.current) {
                setList(loaded);
                setIsFailed(false);
            }
        } catch {
            if (request === lastRequest.current) {
                setIsFailed(true);
            }
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [ reload ]);
    useReloadOnChannelChanges(list?.channels, reload);

    return { list, isFailed, reload };
}

/**
 * Loads the list again, once the changes stop, after a `frontend-update` that changes a channel
 * record, the note of a script channel, or an attribute that makes a note a channel.
 */
function useReloadOnChannelChanges(
    channels: NotificationChannelView[] | undefined,
    reload: () => Promise<void>
) {
    const channelIds = useRef(new Set<string>());
    channelIds.current = new Set(channels?.map(({ channelId }) => channelId));

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onMessage = (message: WebSocketMessage) => {
            if (message.type !== "frontend-update" || !message.data.entityChanges.some(
                (change) => concernsChannels(change, channelIds.current))) {
                return;
            }
            clearTimeout(timer);
            timer = setTimeout(() => void reload(), RELOAD_DELAY_MS);
        };

        subscribeToMessages(onMessage);
        return () => {
            clearTimeout(timer);
            unsubscribeToMessage(onMessage);
        };
    }, [ reload ]);
}

/**
 * On the forwarding instance: when the address of each webhook last changed, as the secret route
 * reads it from the secrets file.
 */
function useAddressTimes(list: NotificationChannelListResponse | undefined) {
    const [ times, setTimes ] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!list?.forwarding.isForwardingInstance) {
            return;
        }

        let isCancelled = false;
        const webhooks = list.channels.filter(({ kind, isAddressSet }) =>
            kind === "built-in" && isAddressSet);
        void Promise.all(webhooks.map(async ({ channelId }) => {
            try {
                return [ channelId, (await getSecret(channelId)).changedAt ] as const;
            } catch {
                return [ channelId, undefined ] as const;
            }
        })).then((entries) => {
            if (!isCancelled) {
                setTimes(Object.fromEntries(entries.filter(
                    (entry): entry is readonly [ string, string ] => !!entry[1])));
            }
        });
        return () => {
            isCancelled = true;
        };
    }, [ list ]);

    return times;
}

function concernsChannels(change: EntityChange, channelIds: Set<string>) {
    if (change.entityName === "notification_channel_records") {
        return true;
    }
    if (change.entityName === "notes") {
        return channelIds.has(change.entityId);
    }
    if (change.entityName === "attributes") {
        const row = change.entity as { noteId?: string; name?: string } | undefined;
        return channelIds.has(row?.noteId ?? "") || CHANNEL_ATTRIBUTE_NAMES.has(row?.name ?? "");
    }
    return false;
}

/** The status lines of a channel's row, below its title. */
function getStatusLines(
    channel: NotificationChannelView,
    isForwarding: boolean,
    addressChangedAt: string | undefined
) {
    const { kind, runsOn, state, recordHold, status } = channel;
    const lines = [ runsOn === "backend"
        ? t("notification_channels.status_runs_on_backend")
        : t("notification_channels.status_runs_on_frontend") ];

    if (recordHold === "pending") {
        lines.push(state === "found"
            ? t("notification_channels.record_pending_disable")
            : t("notification_channels.record_pending_enable"));
    } else if (recordHold === "full") {
        lines.push(t("notification_channels.record_full"));
    }
    if (channel.isNotRunnable) {
        lines.push(t("notification_channels.not_runnable"));
    }
    if (kind === "script" && runsOn === "backend" && status?.runsBackendScripts === false) {
        lines.push(t("notification_channels.status_backend_scripting_off"));
    }
    if (kind === "built-in") {
        if (!channel.isAddressSet) {
            lines.push(isForwarding
                ? t("notification_channels.address_unset")
                : t("notification_channels.address_unset_elsewhere"));
        } else if (addressChangedAt) {
            lines.push(t("notification_channels.address_changed", {
                time: formatDateTime(addressChangedAt)
            }));
        }
    }

    const counts = runsOn === "frontend" ? channel.localCounts : status?.counts;
    if (counts) {
        lines.push(runsOn === "frontend"
            ? t("notification_channels.local_counts", { ...counts })
            : t("notification_channels.counts", { ...counts }));
        if (counts.sentPublic > 0) {
            lines.push(t("notification_channels.counts_public", { count: counts.sentPublic }));
        }
        if (counts.waitingForBudget > 0) {
            lines.push(t("notification_channels.waiting_for_budget", {
                count: counts.waitingForBudget
            }));
        }
    }
    if (runsOn === "backend" && status?.lastErrorCode) {
        lines.push(status.lastErrorCode === "http" && status.lastHttpStatus
            ? t("notification_channels.last_error_http", { status: status.lastHttpStatus })
            : t("notification_channels.last_error", {
                error: getOutcomeText(status.lastErrorCode)
            }));
    }
    if (runsOn === "backend" && status?.runningSince) {
        lines.push(t("notification_channels.running_since", {
            time: formatDateTime(status.runningSince)
        }));
    }
    return lines;
}
