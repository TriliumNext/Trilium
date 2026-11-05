import { describe, expect, it } from "vitest";

import { isProbedContentType, probeMedia } from "./media_probe.js";

describe("probeMedia", () => {
    it("reads an MP4 video and the shape of its track, turned a quarter or not", () => {
        expect(probeMedia(mp4(trak("vide", 1920, 1080, IDENTITY), trak("soun", 0, 0)), ""))
            .toEqual({ type: "video", aspectRatio: "16/9" });
        expect(probeMedia(mp4(trak("vide", 1920, 1080, TURNED)), "application/octet-stream"))
            .toEqual({ type: "video", aspectRatio: "9/16" });
    });

    it("reads an MP4 of sound alone as audio, by its tracks or by its brand", () => {
        expect(probeMedia(mp4(trak("soun", 0, 0)), "video/mp4")).toEqual({ type: "audio" });
        expect(probeMedia(concat(box("ftyp", text("M4A "), new Uint8Array(4)), box("mdat")), ""))
            .toEqual({ type: "audio" });
    });

    it("reads an MP4 whose header comes after its media by its media type", () => {
        const file = concat(
            box("ftyp", text("isom"), new Uint8Array(4)), box("mdat", new Uint8Array(64)));
        expect(probeMedia(file, "audio/mp4")).toEqual({ type: "audio" });
        expect(probeMedia(file, "application/octet-stream")).toEqual({ type: "video" });
    });

    it("reads a WebM video with the size it is shown at, and a WebM of sound as audio", () => {
        expect(probeMedia(webm(trackEntry(1, [
            ebml([ 0xB0 ], uint(1280)), ebml([ 0xBA ], uint(720))
        ])), "")).toEqual({ type: "video", aspectRatio: "16/9" });
        expect(probeMedia(webm(trackEntry(1, [
            ebml([ 0xB0 ], uint(720)), ebml([ 0xBA ], uint(576)),
            ebml([ 0x54, 0xB0 ], uint(16)), ebml([ 0x54, 0xBA ], uint(9))
        ])), "")).toEqual({ type: "video", aspectRatio: "16/9" });
        expect(probeMedia(webm(trackEntry(2)), "video/webm")).toEqual({ type: "audio" });
    });

    it("reads the audio files that start with a header of their own", () => {
        const files = [
            text("ID3\u0004"), text("fLaC"), concat(text("RIFF"), new Uint8Array(4), text("WAVE")),
            Uint8Array.from([ 0xFF, 0xFB, 0x90, 0x64 ]),
            concat(text("OggS"), text("\u0000OpusHead"))
        ];
        expect(files.map((file) => probeMedia(file, "application/octet-stream")))
            .toEqual(Array(5).fill({ type: "audio" }));
        expect(probeMedia(concat(text("OggS"), text("\u0000\u0080theora")), ""))
            .toEqual({ type: "video" });
    });

    it("trusts the media type of any other file, except a playlist, and nothing else", () => {
        expect(probeMedia(text("garbage"), "video/quicktime")).toEqual({ type: "video" });
        expect(probeMedia(text("garbage"), "audio/x-wav")).toEqual({ type: "audio" });
        expect(probeMedia(text("#EXTM3U"), "audio/x-mpegurl")).toBeNull();
        expect(probeMedia(text("PK"), "application/octet-stream")).toBeNull();
        expect(probeMedia(new Uint8Array(), "")).toBeNull();
    });
});

describe("isProbedContentType", () => {
    it("reads the header of what can be a media file, and of what names no type", () => {
        expect([ "video/mp4", "audio/mpeg", "application/ogg", "application/octet-stream", "" ]
            .map(isProbedContentType)).toEqual(Array(5).fill(true));
        expect([ "text/html", "application/json", "image/png" ].map(isProbedContentType))
            .toEqual(Array(3).fill(false));
    });
});

const IDENTITY = [ 0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000 ];
const TURNED = [ 0, 0x10000, 0, -0x10000, 0, 0, 0, 0, 0x40000000 ];

function mp4(...tracks: Uint8Array[]) {
    return concat(
        box("ftyp", text("isom"), new Uint8Array(4), text("isom")), box("moov", ...tracks));
}

function trak(handler: string, width: number, height: number, matrix = IDENTITY) {
    const tkhd = new Uint8Array(84);
    const view = new DataView(tkhd.buffer);
    for (const [ index, value ] of matrix.entries()) {
        view.setInt32(40 + index * 4, value);
    }
    view.setUint32(76, width * 0x10000);
    view.setUint32(80, height * 0x10000);
    const hdlr = concat(new Uint8Array(8), text(handler), new Uint8Array(13));
    return box("trak", box("tkhd", tkhd), box("mdia", box("hdlr", hdlr)));
}

function box(type: string, ...content: Uint8Array[]) {
    const data = concat(...content);
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(0, data.length + 8);
    header.set(text(type), 4);
    return concat(header, data);
}

/** A WebM file whose segment, of unknown size as in a stream, holds `entries` as its tracks. */
function webm(...entries: Uint8Array[]) {
    return concat(
        ebml([ 0x1A, 0x45, 0xDF, 0xA3 ], ebml([ 0x42, 0x82 ], text("webm"))),
        Uint8Array.from([ 0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF ]),
        ebml([ 0x15, 0x49, 0xA9, 0x66 ]),
        ebml([ 0x16, 0x54, 0xAE, 0x6B ], ...entries)
    );
}

function trackEntry(type: number, video?: Uint8Array[]) {
    const videoElement = video ? [ ebml([ 0xE0 ], ...video) ] : [];
    return ebml([ 0xAE ], ebml([ 0x83 ], Uint8Array.of(type)), ...videoElement);
}

function ebml(id: number[], ...content: Uint8Array[]) {
    const data = concat(...content);
    const size = data.length < 0x7F
        ? [ 0x80 | data.length ]
        : [ 0x40 | (data.length >> 8), data.length & 0xFF ];
    return concat(Uint8Array.from(id), Uint8Array.from(size), data);
}

function uint(value: number) {
    return Uint8Array.of(value >> 8, value & 0xFF);
}

function text(value: string) {
    return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]) {
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
}
