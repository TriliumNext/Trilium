import type {
    NotificationChannelConfig,
    NotificationChannelListResponse,
    NotificationChannelReview,
    NotificationChannelSwitchResponse,
    NotificationChannelView,
    NotificationErrorBody
} from "@triliumnext/commons";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca";
import { getContext } from "../../services/context";
import noteService from "../../services/notes";
import { getActivation, getRecords } from "../../services/notifications/channels/records";
import {
    clearChannelTypes, registerChannelType
} from "../../services/notifications/channels/registry";
import type { NotificationChannelType } from "../../services/notifications/channels/types";
import { getPlatform } from "../../services/platform";
import { getSql } from "../../services/sql/index";
import { CoreApiTester } from "../../test/api_tester";

const TABLES = [ "notification_channel_records", "notification_deliveries" ];
const SETTINGS = { graceTime: 120, protectedNotes: "none" };

const SPEC_TYPE: NotificationChannelType = {
    type: "spechook",
    title: "Spec hook",
    icon: "bx bx-test-tube",
    isAvailable: () => true,
    checkConfig: (config) => (config ?? {}) as NotificationChannelConfig,
    getAddressState: () => null,
    send: () => Promise.resolve()
};

let api: CoreApiTester;

beforeAll(() => {
    api = CoreApiTester.build();
});

beforeEach(() => {
    getContext().init(() => getSql().transactional(() => {
        for (const table of TABLES) {
            getSql().execute(`DELETE FROM ${table}`);
            getSql().execute("DELETE FROM entity_changes WHERE entityName = ?", [ table ]);
        }
    }));
    becca.notificationChannelRecords = {};
    clearChannelTypes();
    registerChannelType(SPEC_TYPE);
});

afterEach(() => {
    vi.restoreAllMocks();
});

function createChannelNote(mime = "application/javascript;env=backend") {
    return getContext().init(() => {
        const { note } = noteService.createNewNote({
            parentNoteId: "root",
            title: "Spec channel",
            type: "code",
            mime,
            content: "return api.channelSettings;"
        });
        note.setLabel("notificationChannel");
        return note;
    });
}

async function review(channelId: string) {
    const { status, body } = await api.get<NotificationChannelReview>(
        `/api/notification-channels/${channelId}/review`);
    expect(status).toBe(200);
    return body;
}

async function list() {
    return (await api.get<NotificationChannelListResponse>("/api/notification-channels")).body;
}

describe("the channel routes", () => {
    it("enables a reviewed script channel with its widget's labels, and disables it", async () => {
        const note = createChannelNote();
        const { revision, text, isRunnable } = await review(note.noteId);
        expect(isRunnable).toBe(true);
        expect(text).toContain("return api.channelSettings;");
        expect((await list()).channels.find(({ channelId }) => channelId === note.noteId)?.state)
            .toBe("found");

        const stale = await api.post<NotificationErrorBody>(
            `/api/notification-channels/${note.noteId}/enable`,
            { body: { revision: "outdated", ...SETTINGS } });
        expect(stale).toMatchObject({ status: 409, body: { code: "stale-revision" } });

        const enabled = await api.post<NotificationChannelSwitchResponse>(
            `/api/notification-channels/${note.noteId}/enable`,
            { body: { revision, ...SETTINGS, labels: { topic: "alerts" } } });
        expect(enabled.status).toBe(200);
        expect(enabled.body).toMatchObject(
            { isRecorded: true, channel: { state: "enabled", settings: SETTINGS } });
        expect(becca.getNoteOrThrow(note.noteId).getOwnedLabelValue("topic")).toBe("alerts");
        expect(getActivation(note.noteId)?.ownedAttributes).toContainEqual(
            { type: "label", name: "topic", value: "alerts", isInheritable: false });

        getContext().init(() => becca.getNoteOrThrow(note.noteId).setContent("return 2;"));
        expect((await list()).channels.find(({ channelId }) => channelId === note.noteId)?.state)
            .toBe("changed");

        const disabled = await api.delete<NotificationChannelSwitchResponse>(
            `/api/notification-channels/${note.noteId}/enable`);
        expect(disabled.body).toMatchObject({ isRecorded: true, channel: { state: "found" } });
        expect(getRecords("revocation").map(({ channelId }) => channelId)).toEqual([ note.noteId ]);
    });

    it("refuses the labels of a widget beyond their limits", async () => {
        const note = createChannelNote();
        const { revision } = await review(note.noteId);
        const manyLabels = Object.fromEntries(
            Array.from({ length: 21 }, (_, index) => [ `label${index}`, "x" ]));
        for (const labels of [ manyLabels, { big: "x".repeat(2048) }, { run: "hourly" },
            { "bad name": "x" }, { topic: 1 } ]) {
            const { status, body } = await api.post<NotificationErrorBody>(
                `/api/notification-channels/${note.noteId}/enable`,
                { body: { revision, ...SETTINGS, labels } });
            expect([ status, body.code ], JSON.stringify(labels).substring(0, 40))
                .toEqual([ 400, "invalid-input" ]);
        }

        getContext().init(() => {
            for (let index = 0; index < 20; index++) {
                becca.getNoteOrThrow(note.noteId).setLabel(`own${index}`, "y".repeat(1000));
            }
        });
        const large = await api.post<NotificationErrorBody>(
            `/api/notification-channels/${note.noteId}/enable`, { body: {
                revision: (await review(note.noteId)).revision, ...SETTINGS,
                labels: Object.fromEntries(Array.from({ length: 20 }, (_, index) =>
                    [ `new${index}`, "z".repeat(1000) ]))
            } });
        expect(large.body.code).toBe("too-large");
        expect(getActivation(note.noteId)).toBeNull();
    });

    it("changes settings of the current state, and serves the widget at its revision", async () => {
        const note = createChannelNote();
        const widget = createChannelNote("application/javascript;env=frontend");
        getContext().init(() => {
            becca.getNoteOrThrow(widget.noteId).removeLabel("notificationChannel");
            becca.getNoteOrThrow(note.noteId).setRelation("configWidget", widget.noteId);
        });
        const { revision, hasConfigWidget } = await review(note.noteId);
        expect(hasConfigWidget).toBe(true);
        const enabled = await api.post<NotificationChannelSwitchResponse>(
            `/api/notification-channels/${note.noteId}/enable`,
            { body: { revision, ...SETTINGS } });
        const { activationId } = enabled.body.channel;

        const changed = await api.patch<{ channel: NotificationChannelView }>(
            `/api/notification-channels/${note.noteId}/settings`,
            { body: { graceTime: 600, expected: { activationId, recordIds: [] } } });
        expect(changed.body.channel.settings).toEqual({ graceTime: 600, protectedNotes: "none" });
        const again = await api.patch<NotificationErrorBody>(
            `/api/notification-channels/${note.noteId}/settings`,
            { body: { graceTime: 60, expected: { activationId, recordIds: [] } } });
        expect(again).toMatchObject({ status: 409, body: { code: "stale-revision" } });

        const served = await api.get<{ bundle: { noteId: string } }>(
            `/api/notification-channels/${note.noteId}/config-widget`, { query: { revision } });
        expect(served.body.bundle.noteId).toBe(widget.noteId);
        expect((await api.get(`/api/notification-channels/${note.noteId}/config-widget`,
            { query: { revision: "other" } })).status).toBe(409);
        vi.spyOn(getPlatform(), "getEnv").mockImplementation((key) =>
            (key === "TRILIUM_SAFE_MODE" ? "1" : undefined));
        const inSafeMode = await api.get<NotificationErrorBody>(
            `/api/notification-channels/${note.noteId}/config-widget`, { query: { revision } });
        expect(inSafeMode.body).toEqual({ code: "safe-mode" });
    });

    it("creates, edits and deletes a built-in channel; five test sends a minute", async () => {
        const unavailable = await api.post<NotificationErrorBody>("/api/notification-channels",
            { body: { type: "webhook", title: "Hook" } });
        expect(unavailable.body.code).toBe("type-unavailable");

        const created = await api.post<{ channel: NotificationChannelView }>(
            "/api/notification-channels", { body: { type: "spechook", title: "Pager" } });
        const { channelId } = created.body.channel;
        expect(created.body.channel)
            .toMatchObject({ kind: "built-in", type: "spechook", state: "found" });
        const edited = await api.patch<{ channel: NotificationChannelView }>(
            `/api/notification-channels/${channelId}`, { body: { title: "Renamed" } });
        expect(edited.body.channel.title).toBe("Renamed");

        const { revision } = await review(channelId);
        await api.post(`/api/notification-channels/${channelId}/enable`,
            { body: { revision, ...SETTINGS } });
        const codes: unknown[] = [];
        for (let index = 0; index < 6; index++) {
            const { status, body } = await api.post<{ code: string }>(
                `/api/notification-channels/${channelId}/test`);
            codes.push(status === 200 ? body.code : `${status} ${body.code}`);
        }
        expect(codes).toEqual([ ...new Array(5).fill("address"), "409 rate-limit" ]);

        expect((await api.delete(`/api/notification-channels/${channelId}`)).status).toBe(204);
        expect((await list()).channels.map((channel) => channel.channelId))
            .not.toContain(channelId);
        expect((await list()).types).toContainEqual(
            { type: "webhook", title: "Webhook", icon: "bx bx-link-external", isAvailable: false });
    });

    it("checks the bodies of claims and results", async () => {
        for (const body of [
            { deliveryKey: "short", profileId: "p1" },
            { deliveryKey: "a".repeat(43), profileId: "p 1" }
        ]) {
            expect((await api.post("/api/notification-channels/deliveries/claim", { body })).status)
                .toBe(400);
        }
        const key = "a".repeat(43);
        for (const body of [
            { deliveryKey: key, profileId: "p1", durationMs: 5, errorCode: "boom" },
            { deliveryKey: key, profileId: "p1", durationMs: 24 * 3600 * 1000 },
            { deliveryKey: key, profileId: "p1", durationMs: 1.5 }
        ]) {
            const { status } = await api.post("/api/notification-channels/deliveries/result",
                { body });
            expect(status).toBe(400);
        }
        const unknown = await api.post<NotificationErrorBody>(
            "/api/notification-channels/deliveries/result",
            { body: { deliveryKey: key, profileId: "p1", durationMs: 5 } });
        expect(unknown.body).toEqual({ code: "not-found" });
        const resumed = await api.post("/api/notification-channels/resume",
            { body: { sendDue: "yes" } });
        expect(resumed.status).toBe(400);
    });
});
