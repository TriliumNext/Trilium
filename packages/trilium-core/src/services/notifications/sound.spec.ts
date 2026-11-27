import { describe, expect, it } from "vitest";

import { detectSoundMime } from "./sound.js";

function bytesOf(...parts: (string | number[])[]) {
    return Uint8Array.from(parts.flatMap((part) => (typeof part === "string"
        ? [ ...part ].map((char) => char.charCodeAt(0))
        : part)));
}

describe("detectSoundMime", () => {
    it("names the format of an MP3, OGG or WAV file by its first bytes", () => {
        const recognized: [ string, Uint8Array, string ][] = [
            [ "an ID3v2.4 tag", bytesOf("ID3", [ 4, 0, 0, 0, 0, 0, 10 ]), "audio/mpeg" ],
            [ "an ID3v2.2 tag", bytesOf("ID3", [ 2, 0, 0, 0, 0, 0x7f, 0x7f ]), "audio/mpeg" ],
            [ "an MPEG-1 Layer III frame", bytesOf([ 0xff, 0xfb, 0x90, 0x64 ]), "audio/mpeg" ],
            [ "an MPEG-2 Layer III frame", bytesOf([ 0xff, 0xf3, 0x48, 0xc4 ]), "audio/mpeg" ],
            [ "an MPEG-2.5 Layer III frame", bytesOf([ 0xff, 0xe3, 0x18, 0xc4 ]), "audio/mpeg" ],
            [ "an Ogg page", bytesOf("OggS", [ 0, 2 ]), "audio/ogg" ],
            [ "a RIFF WAVE file", bytesOf("RIFF", [ 36, 0, 0, 0 ], "WAVEfmt "), "audio/wav" ]
        ];
        for (const [ label, bytes, mime ] of recognized) {
            expect(detectSoundMime(bytes), label).toBe(mime);
        }
    });

    it("refuses every other file, also one that begins like a sound", () => {
        const refused: [ string, Uint8Array ][] = [
            [ "nothing", new Uint8Array(0) ],
            [ "an HTML page", bytesOf("<!doctype html><script>") ],
            [ "an AAC ADTS frame", bytesOf([ 0xff, 0xf1, 0x50, 0x80 ]) ],
            [ "an MPEG Layer II frame", bytesOf([ 0xff, 0xfd, 0x90, 0x64 ]) ],
            [ "a frame of the reserved version", bytesOf([ 0xff, 0xeb, 0x90, 0x64 ]) ],
            [ "a frame with an invalid bitrate", bytesOf([ 0xff, 0xfb, 0xf0, 0x64 ]) ],
            [ "a frame with a reserved sample rate", bytesOf([ 0xff, 0xfb, 0x9c, 0x64 ]) ],
            [ "half a frame header", bytesOf([ 0xff, 0xfb ]) ],
            [ "an ID3 tag of version 5", bytesOf("ID3", [ 5, 0, 0, 0, 0, 0, 10 ]) ],
            [ "an ID3 tag whose size is not syncsafe", bytesOf("ID3", [ 4, 0, 0, 0, 0, 0, 0x80 ]) ],
            [ "a cut ID3 tag", bytesOf("ID3", [ 4, 0, 0 ]) ],
            [ "an Ogg page of another version", bytesOf("OggS", [ 1, 2 ]) ],
            [ "a RIFF AVI file", bytesOf("RIFF", [ 36, 0, 0, 0 ], "AVI LIST") ],
            [ "a FLAC file", bytesOf("fLaC", [ 0, 0, 0, 34 ]) ]
        ];
        for (const [ label, bytes ] of refused) {
            expect(detectSoundMime(bytes), label).toBeNull();
        }
    });
});
