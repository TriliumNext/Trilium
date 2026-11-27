import {
    NOTIFICATION_CATEGORIES, NOTIFICATION_SOUND_MAX_BYTES, NOTIFICATION_SOUND_NOTE_ID,
    type NotificationCategory, RESOURCES_NOTE_ID
} from "@triliumnext/commons/src/lib/notifications.js";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import {
    getCustomSoundUrl, resetCustomSound, uploadCustomSound
} from "../../../services/notification_sound";
import { NotificationRequestError } from "../../../services/notifications";
import toast from "../../../services/toast";
import { formatSize } from "../../../services/utils";
import Button from "../../react/Button";
import { Card, OptionCardSection } from "../../react/Card";
import { FormFileUploadButton } from "../../react/FormFileUpload";
import FormToggle from "../../react/FormToggle";
import { useChildNotes, useNoteBlob } from "../../react/hooks/note";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks/options";
import LazyComponent from "../../react/LazyComponent";
import OptionsPageHeader from "./components/OptionsPageHeader";

/** What the file picker offers: the three formats that a custom sound can have. */
const SOUND_FILE_TYPES = "audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.oga,.wav";

export default function NotificationSettings() {
    return (
        <>
            <OptionsPageHeader helpUrl="Q2MCMjHbxohz" />
            <AlertSettings />
            <CategorySettings />
            <LazyComponent loader={() => import("./notification_channels/ChannelsCard")} />
        </>
    );
}

function AlertSettings() {
    const [ isSoundEnabled, setIsSoundEnabled ] = useTriliumOptionBool("notificationSoundEnabled");

    return (
        <Card heading={t("notification_settings.alerts_title")}>
            <OptionCardSection
                name="notification-sound"
                label={t("notification_settings.sound")}
                description={t("notification_settings.sound_description")}
                subSectionsVisible={isSoundEnabled}
                subSections={<CustomSoundSection />}
            >
                <FormToggle currentValue={isSoundEnabled} onChange={setIsSoundEnabled} />
            </OptionCardSection>
        </Card>
    );
}

/** "Browse..." while no custom sound is set, "Play" and "Reset to default" once one is. */
function CustomSoundSection() {
    const stored = useCustomSound();
    // What the last request here made of the sound, until froca brings the change.
    const [ requested, setRequested ] = useState<boolean>();
    const [ isBusy, setIsBusy ] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const isSet = requested ?? !!stored;
    const maxSize = formatSize(NOTIFICATION_SOUND_MAX_BYTES);

    useEffect(() => setRequested(undefined), [ stored ]);
    useEffect(() => () => audioRef.current?.pause(), []);

    async function change(request: () => Promise<void>, isSetAfter: boolean) {
        setIsBusy(true);
        try {
            await request();
            setRequested(isSetAfter);
        } catch (e) {
            toast.showError(getFailureMessage(e, isSetAfter, maxSize));
        } finally {
            setIsBusy(false);
        }
    }

    function play() {
        audioRef.current?.pause();
        const audio = new Audio(getCustomSoundUrl(stored?.blobId));
        audioRef.current = audio;
        audio.play().catch((e: unknown) => {
            // A second press interrupts the first one, which is no failure.
            if ((e as Error | null)?.name !== "AbortError") {
                toast.showError(t("notification_settings.sound_play_failed"));
            }
        });
    }

    return (
        <OptionCardSection
            className="custom-notification-sound"
            label={t("notification_settings.custom_sound")}
            description={t("notification_settings.custom_sound_description", { size: maxSize })}
        >
            <span className="tn-card-option-actions">
                {isSet ? <>
                    <Button
                        name="play-notification-sound-button"
                        text={t("notification_settings.play")}
                        icon="bx bx-play"
                        size="micro"
                        disabled={isBusy}
                        onClick={play}
                    />
                    <Button
                        name="reset-notification-sound-button"
                        text={t("notification_settings.reset_sound")}
                        size="micro"
                        disabled={isBusy}
                        onClick={() => change(resetCustomSound, false)}
                    />
                </> : (
                    <FormFileUploadButton
                        name="browse-notification-sound-button"
                        text={t("notification_settings.browse")}
                        size="micro"
                        disabled={isBusy}
                        accept={SOUND_FILE_TYPES}
                        onChange={(files) => {
                            const file = files?.[0];
                            if (file) {
                                void change(() => uploadCustomSound(file), true);
                            }
                        }}
                    />
                )}
            </span>
        </OptionCardSection>
    );
}

function CategorySettings() {
    const [ disabledCategories, setDisabledCategories ] = useDisabledCategories();

    return (
        <Card
            heading={t("notification_settings.categories_title")}
            description={t("notification_settings.categories_description")}
        >
            {NOTIFICATION_CATEGORIES.map((category) => (
                <OptionCardSection
                    key={category}
                    name={`notification-category-${category}`}
                    label={t(`notification_settings.categories.${category}`)}
                    description={category === "general"
                        ? t("notification_settings.general_description")
                        : undefined}
                >
                    <FormToggle
                        currentValue={!disabledCategories.includes(category)}
                        onChange={(isOn) => setDisabledCategories(category, !isOn)}
                    />
                </OptionCardSection>
            ))}
        </Card>
    );
}

/** The blob of the custom sound while one is set: a reset leaves the note empty. */
function useCustomSound() {
    const resources = useChildNotes(RESOURCES_NOTE_ID);
    const note = resources.find(({ noteId }) => noteId === NOTIFICATION_SOUND_NOTE_ID);
    const blob = useNoteBlob(note);
    return blob?.contentLength ? blob : null;
}

/**
 * The categories that the synced option turns off, and a setter of one of them. A value that does
 * not parse turns none off, as the backend reads it, and the names that this client does not know
 * stay in the list.
 */
function useDisabledCategories(): [
    string[], (category: NotificationCategory, isOff: boolean) => void
] {
    const [ value, setValue ] = useTriliumOption("notificationDisabledCategories");
    const disabled = parseCategories(value);

    return [ disabled, (category, isOff) => {
        const others = disabled.filter((name) => name !== category);
        void setValue(JSON.stringify(isOff ? [ ...others, category ] : others));
    } ];
}

function parseCategories(value: string): string[] {
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((name): name is string => typeof name === "string")
            : [];
    } catch {
        return [];
    }
}

function getFailureMessage(error: unknown, isUpload: boolean, maxSize: string) {
    const code = error instanceof NotificationRequestError ? error.code : "internal";
    if (code === "too-large") {
        return t("notification_settings.sound_too_large", { size: maxSize });
    }
    if (code === "unsupported-format") {
        return t("notification_settings.sound_unsupported");
    }
    return isUpload
        ? t("notification_settings.sound_upload_failed")
        : t("notification_settings.sound_reset_failed");
}
