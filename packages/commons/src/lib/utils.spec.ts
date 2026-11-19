import { describe, expect, it } from "vitest";

import { EMPTY_BLOB_ID } from "./shared_constants.js";
import {
    blobIdFromDigest, decodeHtmlEntities, deferred, escapeHtml, fnv1a, FNV1A_OFFSET_BASIS,
    fnv1aUpdate, formatLogMessage, hasOnlyDecodableReferences, Mutex
} from "./utils.js";

describe("#deferred", () => {
    it("should return a promise", () => {
        const result = deferred();
        expect(result).toBeInstanceOf(Promise);
    });
    // TriliumNextTODO: Add further tests!
});

describe("#formatLogMessage", () => {
    it("formats a single string", () => {
        expect(formatLogMessage("hello")).toBe("hello");
    });

    it("formats a single number", () => {
        expect(formatLogMessage(42)).toBe("42");
    });

    it("joins multiple arguments with spaces", () => {
        expect(formatLogMessage("Hi", 1)).toBe("Hi 1");
        expect(formatLogMessage("a", "b", "c")).toBe("a b c");
    });

    it("stringifies objects as JSON", () => {
        expect(formatLogMessage({ key: "value" })).toBe(JSON.stringify({ key: "value" }, null, 4));
    });

    it("handles mixed types", () => {
        const result = formatLogMessage("count:", 3, { x: 1 });
        expect(result).toBe(`count: 3 ${JSON.stringify({ x: 1 }, null, 4)}`);
    });

    it("handles circular references in objects", () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;
        const result = formatLogMessage(obj);
        expect(result).toContain('"a": 1');
        expect(result).toContain('"self": "[Circular]"');
    });

    it("handles null and undefined", () => {
        expect(formatLogMessage(null)).toBe("null");
        expect(formatLogMessage(undefined)).toBe("undefined");
        expect(formatLogMessage("val:", null, undefined)).toBe("val: null undefined");
    });

    it("handles zero arguments", () => {
        expect(formatLogMessage()).toBe("");
    });

    it("limits nesting depth to MAX_LOG_DEPTH, replacing deeper levels with [Object]", () => {
        const result = formatLogMessage({ a: { b: { c: { d: 1 } } } });
        expect(result).toContain("[Object]");
        // The deepest level (d) is beyond the depth limit and is omitted from output.
        expect(result).not.toContain('"d"');
    });

    it("serializes sibling nested objects independently (ancestor pop)", () => {
        const result = formatLogMessage({ first: { x: 1 }, second: { y: 2 } });
        expect(result).toContain('"x": 1');
        expect(result).toContain('"y": 2');
        expect(result).not.toContain("[Circular]");
    });

    it("falls back to String(arg) when JSON.stringify throws (BigInt value)", () => {
        const result = formatLogMessage({ big: 10n });
        expect(result).toBe("[object Object]");
    });
});

describe("#deferred resolution", () => {
    it("can be resolved", async () => {
        const d = deferred<number>();
        d.resolve(5);
        expect(await d).toBe(5);
    });

    it("can be rejected", async () => {
        const d2 = deferred<number>();
        d2.reject(new Error("x"));
        await expect(d2).rejects.toThrow("x");
    });
});

describe("#fnv1a", () => {
    it("returns the FNV-1a reference digests as unsigned 32-bit numbers", () => {
        expect(fnv1a("")).toBe(0x811c9dc5);
        expect(fnv1a("a")).toBe(0xe40c292c);
        expect(fnv1a("foobar")).toBe(0xbf9cf968);
    });

    it("is stable, distinguishes similar inputs and stays in range", () => {
        expect(fnv1a("https://example.com/a")).toBe(fnv1a("https://example.com/a"));
        expect(fnv1a("https://example.com/a")).not.toBe(fnv1a("https://example.com/b"));

        for (const value of ["", "\u00ff", "\u4e2d\u6587", "x".repeat(1000)]) {
            const hash = fnv1a(value);
            expect(Number.isInteger(hash)).toBe(true);
            expect(hash).toBeGreaterThanOrEqual(0);
            expect(hash).toBeLessThanOrEqual(0xffffffff);
        }
    });
});

describe("#fnv1aUpdate", () => {
    it("continues a hash as if the values had been joined", () => {
        expect(fnv1aUpdate(FNV1A_OFFSET_BASIS, "foobar")).toBe(fnv1a("foobar"));
        expect(fnv1aUpdate(fnv1a("foo"), "bar")).toBe(fnv1a("foobar"));
        expect(fnv1aUpdate(fnv1aUpdate(fnv1a(""), "\u4e2d"), "\u6587")).toBe(fnv1a("\u4e2d\u6587"));
        expect(fnv1aUpdate(fnv1a("foo"), "")).toBe(fnv1a("foo"));
    });
});

describe("#blobIdFromDigest", () => {
    it("takes the first 20 characters of the base 64 of the digest, without + and /", async () => {
        const { createHash } = await import("node:crypto");
        for (const content of [ "", "hello", "\u00ff".repeat(100), "abc".repeat(1000) ]) {
            const digest = createHash("sha512").update(content).digest();
            const expected = digest.toString("base64").replaceAll("+", "X").replaceAll("/", "Y")
                .substring(0, 20);
            expect(blobIdFromDigest(new Uint8Array(digest)), content).toBe(expected);
        }
    });

    it("replaces + and / in the base 64", () => {
        // 0xfb 0xef 0xbe is "++++" in base 64, 0xff 0xff 0xff is "////".
        const digest = new Uint8Array(64);
        digest.set([ 0xfb, 0xef, 0xbe, 0xff, 0xff, 0xff ]);
        expect(blobIdFromDigest(digest)).toBe("XXXXYYYYAAAAAAAAAAAA");
    });

    it("gives the empty content the blob id the app stores for it", async () => {
        const { createHash } = await import("node:crypto");
        const digest = new Uint8Array(createHash("sha512").update("").digest());
        expect(blobIdFromDigest(digest)).toBe(EMPTY_BLOB_ID);
    });
});

describe("#escapeHtml", () => {
    it("escapes the characters that end text or a quoted attribute, ampersands first", () => {
        expect(escapeHtml(`<a href="x">Tom & 'Jerry' &amp;</a>`))
            .toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39; &amp;amp;&lt;/a&gt;");
        expect(escapeHtml("plain text = 1/2")).toBe("plain text = 1/2");
        expect(escapeHtml("")).toBe("");
    });
});

describe("#decodeHtmlEntities", () => {
    it("decodes references and basic entities, and keeps those that name no character", () => {
        expect(decodeHtmlEntities("&amp;&lt;&gt;&quot;&apos;&nbsp;&#65;&#x42;&#X43;&#128512;"))
            .toBe("&<>\"'\u{a0}ABC\u{1F600}");
        expect(decodeHtmlEntities("&#x110000; &#xD800; &#0; &#99999999999; &unknown;"))
            .toBe("&#x110000; &#xD800; &#0; &#99999999999; &unknown;");
    });

    it("tells whether every numeric reference names a character", () => {
        expect(hasOnlyDecodableReferences("a&#65;&amp;&unknown;")).toBe(true);
        expect(hasOnlyDecodableReferences("a&#x110000;")).toBe(false);
        expect(hasOnlyDecodableReferences("&#xDFFF;")).toBe(false);
    });
});

describe("Mutex", () => {
    it("returns the callback's value, synchronous or not", async () => {
        const mutex = new Mutex();
        expect(await mutex.runExclusive(async () => 42)).toBe(42);
        expect(await mutex.runExclusive(() => "sync")).toBe("sync");
    });

    it("runs overlapping callers one after another, in call order", async () => {
        const mutex = new Mutex();
        const events: string[] = [];
        const allowFirstToFinish = deferred<void>();
        const firstStarted = deferred<void>();

        const first = mutex.runExclusive(async () => {
            events.push("first-start");
            firstStarted.resolve();
            await allowFirstToFinish;
            events.push("first-end");
        });
        const second = mutex.runExclusive(() => {
            events.push("second");
        });
        const third = mutex.runExclusive(() => {
            events.push("third");
        });

        await firstStarted;
        expect(events).toEqual(["first-start"]);

        allowFirstToFinish.resolve();
        await Promise.all([first, second, third]);
        expect(events).toEqual(["first-start", "first-end", "second", "third"]);
    });

    it("releases the lock when a callback throws or rejects", async () => {
        const mutex = new Mutex();

        await expect(mutex.runExclusive(async () => {
            throw new Error("rejected");
        })).rejects.toThrow("rejected");
        await expect(mutex.runExclusive(() => {
            throw new Error("thrown");
        })).rejects.toThrow("thrown");

        expect(await mutex.runExclusive(() => "recovered")).toBe("recovered");
    });
});
