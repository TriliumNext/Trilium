import "./ChannelDialog.css";

import type {
    NotificationChannelReview, NotificationChannelSettings, NotificationChannelSettingsRequest,
    NotificationChannelView, NotificationProtectedNotesSetting
} from "@triliumnext/commons";
import BUILTIN_ATTRIBUTES from "@triliumnext/commons/src/lib/builtin_attributes.js";
import {
    DEFAULT_NOTIFICATION_CHANNEL_SETTINGS, NOTIFICATION_GRACE_TIME_MAX_SECONDS
} from "@triliumnext/commons/src/lib/notification_channels.js";
import { Component, type ComponentChildren, type ComponentType } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { executeBundleWithoutErrorHandling } from "../../../../services/bundle";
import froca from "../../../../services/froca";
import { t } from "../../../../services/i18n";
import {
    changeSettings, enableChannel, getConfigWidget, getReview
} from "../../../../services/notification_channels";
import { markBidiControls } from "../../../../services/notification_display";
import { NotificationRequestError } from "../../../../services/notifications";
import toast from "../../../../services/toast";
import { rootCauseMessage } from "../../../../services/utils";
import Admonition from "../../../react/Admonition";
import Button from "../../../react/Button";
import { Card, CardSection, OptionCardSection } from "../../../react/Card";
import CodeBlock from "../../../react/CodeBlock";
import FormSelect from "../../../react/FormSelect";
import LoadingSpinner from "../../../react/LoadingSpinner";
import Modal from "../../../react/Modal";
import { ControlledTimeSelector, type TimeSelectorScale } from "../components/TimeSelector";
import { formatAttributeChange, getRefusalCode, getRefusalMessage } from "./channel_messages";

/** The props that the component of a script channel's settings widget is rendered with. */
export interface ConfigWidgetProps {
    settings: Record<string, string>;
    onChange(settings: Record<string, string>): void;
}

interface ChannelDialogProps {
    channel: NotificationChannelView;
    onChanged(): void;
    onClosed(): void;
}

const GRACE_TIME_SCALES = new Set<TimeSelectorScale>([ "seconds", "minutes", "hours" ]);
const BUILTIN_ATTRIBUTE_NAMES = new Set(BUILTIN_ATTRIBUTES.map(({ name }) => name));

/**
 * Enables a channel after a review of what it runs and where, with its settings, or saves the
 * settings of an enabled script channel. A script's settings widget runs only on request.
 */
export default function ChannelDialog({ channel, onChanged, onClosed }: ChannelDialogProps) {
    const [ isShown, setIsShown ] = useState(true);
    const { review, reviewError, loadReview } = useReview(channel.channelId);
    const [ settings, setSettings ] = useChannelSettings(channel);
    const [ labels, setLabels ] = useState<Record<string, string>>();
    const [ notice, setNotice ] = useState<string>();
    const [ isBusy, setIsBusy ] = useState(false);
    const isScript = channel.kind === "script";
    // An enabled channel saves its settings as a settings record, unless its widget changed labels.
    const isSaving = channel.state === "enabled";
    const runsOn = review?.runsOn ?? channel.runsOn;
    const title = markBidiControls(channel.title);

    async function submit() {
        if (!review || isBusy) {
            return;
        }

        setIsBusy(true);
        setNotice(undefined);
        try {
            if (isSaving && !labels) {
                const change = getSettingsChange(channel, settings);
                if (change) {
                    await changeSettings(channel.channelId, change);
                }
            } else {
                const { isRecorded } = await enableChannel(channel.channelId, {
                    revision: review.revision, ...settings, ...(labels ? { labels } : {})
                });
                if (!isRecorded) {
                    toast.showMessage(t("notification_channels.enable_not_recorded"));
                }
            }
            onChanged();
            setIsShown(false);
        } catch (e) {
            if (getRefusalCode(e) !== "stale-revision") {
                setNotice(getRefusalMessage(e));
            } else if (isSaving && !labels) {
                setNotice(t("notification_channels.settings_changed_elsewhere"));
                onChanged();
            } else {
                setNotice(t("notification_channels.review_changed"));
                setLabels(undefined);
                void loadReview();
            }
        } finally {
            setIsBusy(false);
        }
    }

    return (
        <Modal
            className="notification-channel-dialog"
            size="lg"
            scrollable
            stackable
            portal
            title={isSaving
                ? t("notification_channels.edit_title", { title })
                : t("notification_channels.enable_title", { title })}
            show={isShown}
            onHidden={onClosed}
            onSubmit={() => void submit()}
            footer={<>
                <Button text={t("common.cancel")} onClick={() => setIsShown(false)} />
                <Button
                    name="submit-channel-dialog"
                    kind="primary"
                    text={isSaving ? t("common.save") : t("notification_channels.enable")}
                    disabled={!review?.isRunnable || isBusy}
                />
            </>}
        >
            <p className="notification-channel-runs-on">{getRunsOnText(channel, runsOn)}</p>

            {reviewError && <Admonition type="caution">{reviewError}</Admonition>}
            {!review && !reviewError && <LoadingSpinner />}
            {review && !review.isRunnable && (
                <Admonition type="caution">{t("notification_channels.not_runnable")}</Admonition>
            )}
            {isScript && review && runsOn === "backend" && (
                <BackendScriptingNote isRunning={review.forwardingRunsBackendScripts} />
            )}
            {isScript && review && <ReviewCard review={review} />}
            {isScript && review?.hasConfigWidget && (
                <ConfigWidgetSlot
                    key={review.revision}
                    channelId={channel.channelId}
                    revision={review.revision}
                    labels={labels}
                    onChange={setLabels}
                />
            )}

            <ChannelSettingsFields settings={settings} onChange={setSettings} />
            {notice && <Admonition type="caution">{notice}</Admonition>}
        </Modal>
    );
}

interface ChannelSettingsFieldsProps {
    settings: NotificationChannelSettings;
    onChange(settings: NotificationChannelSettings): void;
}

/** The grace time and the setting for protected notes of a channel. */
export function ChannelSettingsFields({ settings, onChange }: ChannelSettingsFieldsProps) {
    const [ scale, setScale ] = useState(() => getGraceTimeScale(settings.graceTime));
    const protectedNotesChoices = [
        { value: "none", label: t("notification_channels.protected_notes_none") },
        { value: "public", label: t("notification_channels.protected_notes_public") }
    ];

    return (
        <Card
            className="notification-channel-settings"
            heading={t("notification_channels.settings")}
        >
            <OptionCardSection
                label={t("notification_channels.grace_time")}
                description={t("notification_channels.grace_time_description")}
            >
                <ControlledTimeSelector
                    name="notification-channel-grace-time"
                    seconds={settings.graceTime}
                    scale={scale}
                    onChange={(graceTime) => onChange({ ...settings, graceTime })}
                    onScaleChange={setScale}
                    includedTimeScales={GRACE_TIME_SCALES}
                    maximumSeconds={NOTIFICATION_GRACE_TIME_MAX_SECONDS}
                />
            </OptionCardSection>

            <OptionCardSection
                name="notification-channel-protected-notes"
                label={t("notification_channels.protected_notes")}
                description={t("notification_channels.protected_notes_description")}
            >
                <FormSelect
                    values={protectedNotesChoices}
                    keyProperty="value"
                    titleProperty="label"
                    currentValue={settings.protectedNotes}
                    onChange={(value) => onChange({
                        ...settings, protectedNotes: value as NotificationProtectedNotesSetting
                    })}
                />
            </OptionCardSection>
        </Card>
    );
}

/**
 * The settings that a dialog edits: those of the channel, taken again when its activation or its
 * settings records change, and the defaults for a channel that is not enabled.
 */
export function useChannelSettings(channel: NotificationChannelView | undefined) {
    const [ settings, setSettings ] = useState(() => getInitialSettings(channel));
    const channelRef = useRef(channel);
    channelRef.current = channel;
    const recordsKey = channel
        ? `${channel.state}:${channel.activationId}:${channel.settingsRecordIds.join()}`
        : "";

    useEffect(() => {
        setSettings(getInitialSettings(channelRef.current));
    }, [ recordsKey ]);

    return [ settings, setSettings ] as const;
}

/** The request that changes the settings of an enabled channel, or `null` when none changed. */
export function getSettingsChange(
    channel: NotificationChannelView,
    settings: NotificationChannelSettings
): NotificationChannelSettingsRequest | null {
    if (!channel.activationId) {
        return null;
    }

    const change: NotificationChannelSettingsRequest = {
        expected: { activationId: channel.activationId, recordIds: channel.settingsRecordIds }
    };
    if (settings.graceTime !== channel.settings.graceTime) {
        change.graceTime = settings.graceTime;
    }
    if (settings.protectedNotes !== channel.settings.protectedNotes) {
        change.protectedNotes = settings.protectedNotes;
    }
    return change.graceTime === undefined && change.protectedNotes === undefined ? null : change;
}

function useReview(channelId: string) {
    const [ review, setReview ] = useState<NotificationChannelReview>();
    const [ reviewError, setReviewError ] = useState<string>();

    const loadReview = useCallback(async () => {
        setReview(undefined);
        setReviewError(undefined);
        try {
            setReview(await getReview(channelId));
        } catch (e) {
            setReviewError(getRefusalMessage(e));
        }
    }, [ channelId ]);

    useEffect(() => {
        void loadReview();
    }, [ loadReview ]);

    return { review, reviewError, loadReview };
}

/** What a channel runs, as text, or only the attributes of its note that changed. */
function ReviewCard({ review }: { review: NotificationChannelReview }) {
    if (review.changes) {
        return (
            <Card
                className="notification-channel-review"
                heading={t("notification_channels.review_changes")}
                description={t("notification_channels.review_changes_description")}
            >
                <CardSection>
                    <ul className="notification-channel-changes">
                        {review.changes.map((change, index) => (
                            <li key={index}>
                                <span className="notification-channel-change-kind">
                                    {t(`notification_channels.attribute_${change.change}`)}
                                </span>
                                <code>{formatAttributeChange(change)}</code>
                            </li>
                        ))}
                    </ul>
                </CardSection>
            </Card>
        );
    }

    return (
        <Card
            className="notification-channel-review"
            heading={t("notification_channels.review")}
            description={t("notification_channels.review_description")}
        >
            <CardSection noPadding>
                <CodeBlock className="notification-channel-review-text" code={review.text} wrap />
            </CardSection>
        </Card>
    );
}

function BackendScriptingNote({ isRunning }: { isRunning: boolean | null }) {
    if (isRunning === false) {
        return (
            <Admonition type="caution" className="notification-channel-backend-scripting">
                {t("notification_channels.backend_scripting_off")}
            </Admonition>
        );
    }

    return (
        <p className="notification-channel-backend-scripting">
            {isRunning
                ? t("notification_channels.backend_scripting_on")
                : t("notification_channels.backend_scripting_unknown")}
        </p>
    );
}

type WidgetState =
    | { status: "idle" | "loading" }
    | {
        status: "ready";
        Widget: ComponentType<ConfigWidgetProps>;
        initialSettings: Record<string, string>;
    }
    | { status: "failed"; message: string };

interface ConfigWidgetSlotProps {
    channelId: string;
    revision: string;
    labels: Record<string, string> | undefined;
    onChange(labels: Record<string, string>): void;
}

/**
 * The button that runs a script channel's settings widget for the reviewed revision, and the
 * widget once it runs. The widget gets the channel note's own labels as its first settings.
 */
function ConfigWidgetSlot({ channelId, revision, labels, onChange }: ConfigWidgetSlotProps) {
    const [ state, setState ] = useState<WidgetState>({ status: "idle" });

    async function run() {
        setState({ status: "loading" });
        try {
            const bundle = await getConfigWidget(channelId, revision);
            const Widget: unknown = await executeBundleWithoutErrorHandling(bundle);
            if (typeof Widget !== "function") {
                setState({ status: "failed", message: t("notification_channels.widget_invalid") });
                return;
            }
            setState({
                status: "ready",
                Widget: Widget as ComponentType<ConfigWidgetProps>,
                initialSettings: await getOwnSettings(channelId)
            });
        } catch (e) {
            const message = e instanceof NotificationRequestError
                ? getRefusalMessage(e)
                : rootCauseMessage(e);
            setState({ status: "failed", message });
        }
    }

    if (state.status === "ready") {
        const { Widget, initialSettings } = state;
        return (
            <div className="notification-channel-widget">
                <WidgetErrorBoundary>
                    <Widget settings={labels ?? initialSettings} onChange={onChange} />
                </WidgetErrorBoundary>
            </div>
        );
    }

    return (
        <div className="notification-channel-widget">
            <Button
                name="run-channel-widget"
                icon="bx-play"
                text={t("notification_channels.run_widget")}
                disabled={state.status === "loading"}
                onClick={() => void run()}
            />
            {state.status === "failed" && (
                <pre className="notification-channel-widget-error">{state.message}</pre>
            )}
        </div>
    );
}

interface WidgetErrorState {
    message?: string;
}

/** Shows the message of an error that a settings widget throws while it renders, as text. */
class WidgetErrorBoundary extends Component<{ children: ComponentChildren }, WidgetErrorState> {

    state: WidgetErrorState = {};

    componentDidCatch(error: unknown) {
        this.setState({ message: rootCauseMessage(error) });
    }

    render() {
        const { message } = this.state;
        return message
            ? <pre className="notification-channel-widget-error">{message}</pre>
            : this.props.children;
    }

}

/** The owned labels of a channel note that `BUILTIN_ATTRIBUTES` does not know. */
async function getOwnSettings(channelId: string) {
    const note = await froca.getNote(channelId);
    const settings: Record<string, string> = {};
    for (const { name, value } of note?.getOwnedLabels() ?? []) {
        if (!BUILTIN_ATTRIBUTE_NAMES.has(name)) {
            settings[name] = value;
        }
    }
    return settings;
}

function getInitialSettings(channel: NotificationChannelView | undefined) {
    return channel && channel.state !== "found"
        ? channel.settings
        : DEFAULT_NOTIFICATION_CHANNEL_SETTINGS;
}

/** The unit that a grace time is shown in: the largest that divides it. */
function getGraceTimeScale(seconds: number) {
    if (seconds > 0 && seconds % 3600 === 0) {
        return "3600";
    }
    return seconds % 60 === 0 ? "60" : "1";
}

function getRunsOnText(
    channel: NotificationChannelView,
    runsOn: NotificationChannelView["runsOn"]
) {
    if (channel.kind === "built-in") {
        return t("notification_channels.runs_on_built_in");
    }
    return runsOn === "backend"
        ? t("notification_channels.runs_on_backend")
        : t("notification_channels.runs_on_frontend");
}
