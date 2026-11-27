import { binary_utils, type DeliveryRecordPort, getCrypto } from "@triliumnext/core";

/**
 * The delivery record of the notification channels in the origin's private filesystem, beside the
 * pointer to the live database.
 *
 * That filesystem has no rename on every browser, so the record has two slots, written in turn.
 * Each holds a counter and a checksum, and a read takes the valid slot with the higher counter: a
 * write that stops half way leaves the other slot whole.
 *
 * @module
 */

const SLOT_NAMES = [ "notification-deliveries.0.json", "notification-deliveries.1.json" ] as const;

interface Slot {
    counter: number;
    text: string;
}

export default class SlotRecordPort implements DeliveryRecordPort {

    readonly name = "notification-deliveries.json";
    /** The counter and the index of the newest valid slot, as the last read or write left it. */
    private newest: { counter: number; index: number } | null = null;

    async read(): Promise<string | null> {
        const slots = await Promise.all(SLOT_NAMES.map((name) => readSlot(name)));
        if (slots.every((slot) => slot === "missing")) {
            this.newest = null;
            return null;
        }

        let best: { slot: Slot; index: number } | null = null;
        for (const [ index, slot ] of slots.entries()) {
            const isValid = slot !== "missing" && slot !== "invalid";
            if (isValid && (!best || slot.counter > best.slot.counter)) {
                best = { slot, index };
            }
        }
        if (!best) {
            throw new Error("record");
        }
        this.newest = { counter: best.slot.counter, index: best.index };
        return best.slot.text;
    }

    async write(text: string): Promise<void> {
        const counter = (this.newest?.counter ?? 0) + 1;
        const index = this.newest ? 1 - this.newest.index : 0;
        const content = JSON.stringify({ counter, checksum: getChecksum(counter, text), text });

        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(SLOT_NAMES[index], { create: true });
        const writable = await handle.createWritable();
        try {
            await writable.write(content);
        } finally {
            await writable.close();
        }
        this.newest = { counter, index };
    }

}

/** Reads a slot: its content, `missing` without a file, `invalid` when it fails its checksum. */
async function readSlot(name: string): Promise<Slot | "missing" | "invalid"> {
    let raw: string;
    try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(name);
        raw = await (await handle.getFile()).text();
    } catch {
        return "missing";
    }

    try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== "object" || value === null) {
            return "invalid";
        }
        const { counter, checksum, text } = value as Record<string, unknown>;
        return Number.isSafeInteger(counter) && typeof text === "string"
            && checksum === getChecksum(counter as number, text)
            ? { counter: counter as number, text }
            : "invalid";
    } catch {
        return "invalid";
    }
}

function getChecksum(counter: number, text: string) {
    return binary_utils.encodeBase64(getCrypto().createHash("sha256", `${counter}|${text}`));
}
