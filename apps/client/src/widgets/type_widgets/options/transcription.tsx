import "./transcription.css";

import {
    getTranscriptionModel, type ResourcesStatusResponse, TRANSCRIPTION_MODELS,
    type TranscriptionModelId
} from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import { formatSize, isElectron } from "../../../services/utils";
import { useTranscriptionSupported } from "../../launch_bar/RecordMeetingButton";
import { Badge } from "../../react/Badge";
import { Card, CardSection, OptionCardSection } from "../../react/Card";
import { DirectoryLocation } from "../../react/DirectoryLink";
import FormDropdownList from "../../react/FormDropdownList";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";
import Icon from "../../react/Icon";
import NoItems from "../../react/NoItems";
import OptionsPageHeader from "./components/OptionsPageHeader";
import RelatedSettings from "./components/RelatedSettings";

export default function TranscriptionSettings() {
    const [ isEnabled, setIsEnabled ] = useTriliumOptionBool("transcriptionEnabled");
    const isSupported = useTranscriptionSupported(true);

    if (!isElectron()) {
        return (
            <>
                <OptionsPageHeader />
                <NoItems icon="bx bx-microphone" text={t("desktop.web_placeholder")} />
            </>
        );
    }

    if (isSupported === false) {
        return (
            <>
                <OptionsPageHeader helpUrl="Y84QCbArmK3z" />
                <NoItems icon="bx bx-microphone-off" text={t("transcription_options.unsupported")} />
            </>
        );
    }

    return (
        <>
            <OptionsPageHeader
                helpUrl="Y84QCbArmK3z"
                badge={<Badge text={t("common.beta")} className="transcription-beta-badge" outline />}
                below={
                    <OptionCardSection
                        className="options-header-switch"
                        name="transcription-enabled"
                        label={t("transcription_options.enabled")}
                        description={t("transcription_options.enabled_description")}
                    >
                        <FormToggle currentValue={isEnabled} onChange={setIsEnabled} />
                    </OptionCardSection>
                }
            />

            {isEnabled && (
                <>
                    <RecognitionSettings />
                    <TroubleshootingSettings />
                </>
            )}

            <RelatedSettings items={[
                {
                    title: t("transcription_options.related_resources"),
                    description: t("transcription_options.related_resources_description"),
                    targetPage: "_optionsResources"
                }
            ]} />
        </>
    );
}

function RecognitionSettings() {
    const [ model, setModel ] = useTriliumOption("transcriptionModel");
    const [ speakersEnabled, setSpeakersEnabled ] = useTriliumOptionBool("transcriptionSpeakersEnabled");
    const sizes = useModelSizes();
    const texts: Record<TranscriptionModelId, { label: string; description: string }> = {
        "parakeet-int8": {
            label: t("transcription_options.model_standard"),
            description: t("transcription_options.model_standard_description")
        },
        "parakeet-fp32": {
            label: t("transcription_options.model_high_accuracy"),
            description: t("transcription_options.model_high_accuracy_description")
        }
    };
    const models = Object.values(TRANSCRIPTION_MODELS).map(({ id, resourceId }) => {
        const size = sizes[resourceId];
        const { label, description } = texts[id];
        const sizeLine = size === undefined
            ? undefined
            : t("transcription_options.model_size", { size: formatSize(size, 1) });
        return { id, label, description: sizeLine ? `${description}\n${sizeLine}` : description };
    });

    return (
        <Card heading={t("transcription_options.recognition_title")}>
            <OptionCardSection
                name="transcription-model"
                label={t("transcription_options.european_languages")}
                description={t("transcription_options.european_languages_description")}
            >
                <FormDropdownList
                    className="transcription-model-picker"
                    values={models}
                    keyProperty="id"
                    titleProperty="label"
                    descriptionProperty="description"
                    currentValue={getTranscriptionModel(model).id}
                    onChange={setModel}
                />
            </OptionCardSection>

            <OptionCardSection
                name="identify-speakers"
                label={t("transcription_options.identify_speakers")}
                description={t("transcription_options.identify_speakers_description")}
            >
                <FormToggle currentValue={speakersEnabled} onChange={setSpeakersEnabled} />
            </OptionCardSection>
        </Card>
    );
}

/**
 * The download size of each model's resource, by resource ID. Empty until it arrives, and if it
 * cannot be read, in which case the models are listed without their size.
 */
function useModelSizes() {
    const [ sizes, setSizes ] = useState<Record<string, number>>({});

    useEffect(() => {
        const ids = Object.values(TRANSCRIPTION_MODELS).map(({ resourceId }) => resourceId);
        let isCurrent = true;
        server.get<ResourcesStatusResponse>(`resources?ids=${ids.join(",")}`)
            .then(({ resources }) => {
                if (isCurrent) {
                    setSizes(Object.fromEntries(resources.map(({ id, size }) => [ id, size ])));
                }
            })
            .catch(() => {});
        return () => {
            isCurrent = false;
        };
    }, []);

    return sizes;
}

function TroubleshootingSettings() {
    const [ keepRecordings, setKeepRecordings ] = useTriliumOptionBool("transcriptionKeepRecordings");
    const [ directory, setDirectory ] = useState<string>();

    // Asking for the folder creates it, so it is asked for only once recordings are to be kept.
    useEffect(() => {
        if (!keepRecordings) {
            return;
        }
        let isCurrent = true;
        void window.electronApi?.transcription.getRecordingsDirectory().then((result) => {
            if (isCurrent) {
                setDirectory(result);
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [ keepRecordings ]);

    return (
        <Card heading={t("transcription_options.troubleshooting_title")}>
            <OptionCardSection
                name="keep-recordings"
                className="transcription-keep-recordings"
                label={t("transcription_options.keep_recordings")}
                description={t("transcription_options.keep_recordings_description")}
                subSections={
                    <CardSection className="transcription-keep-recordings-warning">
                        <Icon icon="bx bx-error" />
                        <p>{t("transcription_options.keep_recordings_warning")}</p>
                    </CardSection>
                }
                subSectionsVisible
            >
                <FormToggle currentValue={keepRecordings} onChange={setKeepRecordings} />
            </OptionCardSection>

            {keepRecordings && directory && (
                <DirectoryLocation label={t("transcription_options.saved_in")} directory={directory} />
            )}
        </Card>
    );
}
