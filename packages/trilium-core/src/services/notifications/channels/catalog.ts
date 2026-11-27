/**
 * @module
 *
 * The channels of the database, script and built-in alike: what each runs, its revision now, and
 * the state that the synced records give it.
 */
import type {
    NotificationChannelRunsOn,
    NotificationChannelState
} from "@triliumnext/commons";

import type { ActivationRecord, ChannelDefinition } from "../model.js";
import { getActivation, getDefinition, getRecords, isRevoked } from "./records.js";
import { getChannelType } from "./registry.js";
import {
    collectChannel,
    type CollectedChannel,
    findScriptChannels,
    getScriptChannel,
    hashText,
    type ScriptChannel
} from "./script_channels.js";
import type { NotificationChannelType } from "./types.js";

/** The icon of a built-in channel whose type this runtime lacks. */
const UNKNOWN_TYPE_ICON = "bx bx-broadcast";

export interface Channel {
    channelId: string;
    kind: "script" | "built-in";
    runsOn: NotificationChannelRunsOn;
    title: string;
    icon: string;
    script?: ScriptChannel;
    definition?: ChannelDefinition;
    /** The type of a built-in channel, `null` where this runtime lacks it. */
    type?: NotificationChannelType | null;
}

/** What a channel runs now. */
export interface CurrentRevision {
    /** `null` when a note of a script's bundle has content that is not available. */
    revision: string | null;
    collected?: CollectedChannel;
}

/** Every channel: the script channels, and the built-in ones that are not deleted. */
export function getChannels(): Channel[] {
    const channels = new Map<string, Channel>();
    for (const script of findScriptChannels()) {
        channels.set(script.channelId, toScriptChannel(script));
    }
    for (const { channelId, content } of getRecords("channel")) {
        if (!content.isDeleted && !channels.has(channelId)) {
            channels.set(channelId, toBuiltInChannel(channelId, content));
        }
    }
    return [ ...channels.values() ];
}

/** A channel by its ID: a note that owns the label wins over a `channel` record of that ID. */
export function getChannel(channelId: string): Channel | null {
    const script = getScriptChannel(channelId);
    if (script) {
        return toScriptChannel(script);
    }
    const definition = getDefinition(channelId);
    return definition && !definition.isDeleted ? toBuiltInChannel(channelId, definition) : null;
}

/** The revision of what a channel runs now. */
export function getCurrentRevision(channel: Channel): CurrentRevision {
    if (channel.script) {
        const collected = collectChannel(channel.script) ?? undefined;
        return { revision: collected?.revision ?? null, collected };
    }
    return { revision: channel.definition ? getBuiltInRevision(channel.definition) : null };
}

/** The revision of a built-in channel: a hash of the part of its configuration not secret. */
export function getBuiltInRevision(definition: ChannelDefinition) {
    return hashText(JSON.stringify({ type: definition.type, config: definition.config }));
}

/** The live activation of a channel, or `null`: one that the record names and none revokes. */
export function getLiveActivation(channelId: string): ActivationRecord | null {
    const activation = getActivation(channelId);
    if (!activation || activation.activationId === null || isRevoked(activation.activationId)) {
        return null;
    }
    return activation;
}

/** "Found, not enabled", "Enabled", or "Changed since it was enabled". */
export function getChannelState(
    activation: ActivationRecord | null,
    current: CurrentRevision
): NotificationChannelState {
    if (!activation) {
        return "found";
    }
    return current.revision !== null && current.revision === activation.revision
        ? "enabled"
        : "changed";
}

/** Whether the database holds the channel: a `channel` record not deleted, or a labeled note. */
export function isChannelHeld(channelId: string) {
    return getChannel(channelId) !== null;
}

function toScriptChannel(script: ScriptChannel): Channel {
    return {
        channelId: script.channelId,
        kind: "script",
        runsOn: script.runsOn,
        title: script.note.title,
        icon: script.note.getIcon(),
        script
    };
}

function toBuiltInChannel(channelId: string, definition: ChannelDefinition): Channel {
    const type = getChannelType(definition.type);
    return {
        channelId,
        kind: "built-in",
        runsOn: "backend",
        title: definition.title,
        icon: type?.icon ?? UNKNOWN_TYPE_ICON,
        definition,
        type
    };
}
