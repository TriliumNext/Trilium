import {
    getTranscriptionModel, TRANSCRIPTION_MODELS as MODEL_CHOICES, TRANSCRIPTION_RESOURCES
} from "@triliumnext/commons";
import resources, {
    type ResourceDefinition, type ResourceFile
} from "@triliumnext/server/src/services/resources.js";
import { t } from "i18next";
import path from "path";

import type { ModelPaths } from "./protocol";

const VAD_FILE = "silero_vad.onnx";
const SPEAKER_FILE = "nemo_en_titanet_small.onnx";

const PARAKEET = "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78";
const PARAKEET_FP32 = "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3/resolve/1a468a35cbba69418f126de829e75261dea4a4e4";
const SHERPA_RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download";

const PARAKEET_INT8_FILES: ResourceFile[] = [
    {
        path: "encoder.int8.onnx",
        url: `${PARAKEET}/encoder.int8.onnx`,
        size: 652184281,
        sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247"
    },
    {
        path: "decoder.int8.onnx",
        url: `${PARAKEET}/decoder.int8.onnx`,
        size: 11845275,
        sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e"
    },
    {
        path: "joiner.int8.onnx",
        url: `${PARAKEET}/joiner.int8.onnx`,
        size: 6355277,
        sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3"
    },
    {
        path: "tokens.txt",
        url: `${PARAKEET}/tokens.txt`,
        size: 93939,
        sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"
    }
];

/** The full-precision export: `encoder.onnx` keeps its weights in `encoder.weights`. */
const PARAKEET_FP32_FILES: ResourceFile[] = [
    {
        path: "encoder.onnx",
        url: `${PARAKEET_FP32}/encoder.onnx`,
        size: 41766257,
        sha256: "3eed7ce424bf8339ad09233533c687e2dbd07e74ccf5027b5e7344019ea373b0"
    },
    {
        path: "encoder.weights",
        url: `${PARAKEET_FP32}/encoder.weights`,
        size: 2435420160,
        sha256: "3af3f51af5f2d01dbbf5af47d42c7962a2c205f11004254bb4f2b979862f39a8"
    },
    {
        path: "decoder.onnx",
        url: `${PARAKEET_FP32}/decoder.onnx`,
        size: 47233743,
        sha256: "d593cdb0e571f5a457ec2219af9968cbf6b0e8198e8f7839b40a8754593bf68c"
    },
    {
        path: "joiner.onnx",
        url: `${PARAKEET_FP32}/joiner.onnx`,
        size: 25286330,
        sha256: "b9b0bcf88ac571902e69a6536223ed2d94885e981b85045410f1403d53121a63"
    },
    {
        path: "tokens.txt",
        url: `${PARAKEET_FP32}/tokens.txt`,
        size: 93939,
        sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"
    }
];

/** Parakeet TDT 0.6B v3 at each precision: the files `loadSherpaEngine()` reads as its recognizer. */
export const RECOGNIZER_MODELS: ResourceDefinition[] = [
    parakeet(MODEL_CHOICES["parakeet-int8"].resourceId, PARAKEET_INT8_FILES,
        () => t("transcription.recognizer-int8-title"),
        "Exported to ONNX and quantized to int8 by the k2-fsa sherpa-onnx project, "
            + "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8."),
    parakeet(MODEL_CHOICES["parakeet-fp32"].resourceId, PARAKEET_FP32_FILES,
        () => t("transcription.recognizer-fp32-title"),
        "Exported to ONNX by the k2-fsa sherpa-onnx project, "
            + "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3.")
];

export const VAD_MODEL: ResourceDefinition = {
    id: TRANSCRIPTION_RESOURCES.vad,
    title: () => t("transcription.vad-title"),
    description: () => t("transcription.vad-description"),
    icon: "bx bx-pulse",
    license: "MIT",
    attribution: {
        work: "Silero VAD",
        author: "Silero Team",
        homepage: "https://github.com/snakers4/silero-vad",
        copyright: "Copyright (c) 2020-present Silero Team",
        changes: "Redistributed in the releases of the k2-fsa sherpa-onnx project."
    },
    files: [ {
        path: VAD_FILE,
        url: `${SHERPA_RELEASES}/asr-models/${VAD_FILE}`,
        size: 643854,
        sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"
    } ]
};

export const SPEAKER_MODEL: ResourceDefinition = {
    id: TRANSCRIPTION_RESOURCES.speaker,
    title: () => t("transcription.speaker-title"),
    description: () => t("transcription.speaker-description"),
    icon: "bx bx-user-voice",
    // NGC states TitaNet is under the license of the NeMo toolkit, which is Apache-2.0.
    license: "Apache-2.0",
    attribution: {
        work: "TitaNet-S",
        author: "NVIDIA",
        homepage: "https://catalog.ngc.nvidia.com/orgs/nvidia/teams/nemo/models/titanet_small",
        changes: "Exported to ONNX by the k2-fsa sherpa-onnx project."
    },
    files: [ {
        path: SPEAKER_FILE,
        url: `${SHERPA_RELEASES}/speaker-recongition-models/${SPEAKER_FILE}`,
        size: 40257283,
        sha256: "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e"
    } ]
};

export const TRANSCRIPTION_MODELS = [ ...RECOGNIZER_MODELS, VAD_MODEL, SPEAKER_MODEL ];

/**
 * Returns where the installed models are for a recording with the model `modelId` (a key of
 * `TRANSCRIPTION_MODELS` in commons), or `null` while its recognizer or the VAD is missing.
 * The speaker model is left out unless `identifySpeakers` holds and it is installed; without it,
 * the transcript labels no speakers.
 */
export function getModelPaths(modelId: string | null, identifySpeakers: boolean): ModelPaths | null {
    const model = getTranscriptionModel(modelId);
    const recognizer = resources.getPath(model.resourceId);
    const vad = resources.getPath(VAD_MODEL.id);
    const speaker = identifySpeakers ? resources.getPath(SPEAKER_MODEL.id) : null;
    if (!recognizer || !vad) {
        return null;
    }
    return {
        recognizer: { directory: recognizer, precision: model.precision },
        vad: path.join(vad, VAD_FILE),
        speaker: speaker ? path.join(speaker, SPEAKER_FILE) : null
    };
}

function parakeet(id: string, files: ResourceFile[], title: () => string,
    changes: string): ResourceDefinition {
    return {
        id,
        title,
        description: () => t("transcription.recognizer-description"),
        icon: "bx bx-captions",
        license: "CC-BY-4.0",
        attribution: {
            work: "Parakeet TDT 0.6B v3",
            author: "NVIDIA",
            homepage: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3",
            changes
        },
        files
    };
}
