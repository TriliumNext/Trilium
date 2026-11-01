#!/usr/bin/env node
// Prepares and checks hotwords for Parakeet.
//
//   node hotwords.mjs vocab [model dir]          # write <model dir>/bpe.vocab from tokenizer.json
//   node hotwords.mjs check "heap/STM32/Iconiq" [model dir]
//
// sherpa-onnx encodes a hotword into tokens with a BPE vocabulary (`modelingUnit: "bpe"`,
// `bpeVocab`), which the Parakeet archives do not ship. `vocab` builds one from NVIDIA's
// tokenizer.json, scoring each piece by the rank of the merge that forms it, so that hotwords are
// split as the model itself splits words. The model directory defaults to the app's download of
// Parakeet, full precision first; tokens.txt there must match the tokenizer. The app ignores
// files it did not download, so bpe.vocab can stay beside them.
//
// `check` prints how each hotword is split and flags the ones whose first piece is a common word
// on its own: sherpa's NeMo beam search keeps the bonus of a hotword's first piece even when the
// word is never completed, so "Iconiq" (▁I c oni q) inserts a stray "I" and "heap" (▁he ap) turns
// other words into "he".

import fs from "node:fs";
import path from "node:path";

import { findResource, MODEL_RESOURCES, requireResource } from "./recordings.mjs";

const TOKENIZER_URL = "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/resolve/main/tokenizer.json";
const UNMERGED_SCORE = -100000;
/** Words a first piece is risky as: frequent enough that boosting them changes ordinary speech. */
const COMMON_WORDS = new Set([
    "i", "a", "he", "she", "it", "we", "you", "they", "me", "my", "us", "so", "to", "in", "on", "at",
    "of", "or", "is", "be", "do", "go", "no", "an", "as", "by", "up", "if", "the", "and", "but",
    "for", "not", "all", "are", "was", "can", "one", "out", "now", "how", "his", "her", "its"
]);

const [ command, ...args ] = process.argv.slice(2);
if (command === "vocab") {
    await writeVocab(args[0] ?? getDefaultModelDir());
} else if (command === "check" && args[0]) {
    check(args[0], args[1] ?? getDefaultModelDir());
} else {
    console.error("Usage: node hotwords.mjs vocab [model dir] | check \"a/b/c\" [model dir]");
    process.exit(1);
}

async function writeVocab(modelDir) {
    const tokenizerPath = path.join(modelDir, "tokenizer.json");
    if (!fs.existsSync(tokenizerPath)) {
        console.log(`Downloading ${TOKENIZER_URL}…`);
        const response = await fetch(TOKENIZER_URL);
        if (!response.ok) {
            throw new Error(`${TOKENIZER_URL}: HTTP ${response.status}`);
        }
        fs.writeFileSync(tokenizerPath, Buffer.from(await response.arrayBuffer()));
    }
    const { model } = JSON.parse(fs.readFileSync(tokenizerPath, "utf8"));
    const tokens = readTokens(modelDir);
    const mismatched = tokens.filter(({ piece, id }) => piece in model.vocab && model.vocab[piece] !== id);
    if (mismatched.length) {
        throw new Error(`tokens.txt does not match tokenizer.json (${mismatched.length} ids differ).`);
    }
    const rank = new Map();
    for (const [ index, merge ] of model.merges.entries()) {
        const [ left, right ] = Array.isArray(merge) ? merge : merge.split(" ");
        if (!rank.has(left + right)) {
            rank.set(left + right, index);
        }
    }
    const lines = tokens.map(({ piece }) => `${piece}\t${rank.has(piece) ? -rank.get(piece) : UNMERGED_SCORE}`);
    fs.writeFileSync(path.join(modelDir, "bpe.vocab"), `${lines.join("\n")}\n`);
    console.log(`Wrote ${path.join(modelDir, "bpe.vocab")} (${lines.length} pieces).`);
}

function check(hotwords, modelDir) {
    const vocabPath = path.join(modelDir, "bpe.vocab");
    if (!fs.existsSync(vocabPath)) {
        throw new Error(`No ${vocabPath}; run "node hotwords.mjs vocab" first.`);
    }
    const scores = new Map(fs.readFileSync(vocabPath, "utf8").split("\n").filter(Boolean).map((line) => {
        const [ piece, score ] = line.split("\t");
        return [ piece, Number(score) ];
    }));
    for (const hotword of hotwords.split("/").map((word) => word.replace(/\s*:[\d.]+$/, "").trim()).filter(Boolean)) {
        const pieces = encode(hotword, scores);
        const first = pieces[0].replace(/^▁/, "");
        const warning = COMMON_WORDS.has(first.toLowerCase())
            ? `  ← boosts the word "${first}" wherever it is not completed`
            : "";
        console.log(`${hotword.padEnd(20)} ${pieces.join(" ")}${warning}`);
    }
}

/** Splits a word as sherpa's BPE encoder does: merge the best-scoring adjacent pair until none is left. */
function encode(text, scores) {
    const pieces = [ ..."▁" + text.replace(/ /g, "▁") ];
    for (;;) {
        let best = -Infinity;
        let at = -1;
        for (let i = 0; i + 1 < pieces.length; i++) {
            const score = scores.get(pieces[i] + pieces[i + 1]);
            if (score !== undefined && score > UNMERGED_SCORE && score > best) {
                best = score;
                at = i;
            }
        }
        if (at < 0) {
            return pieces;
        }
        pieces.splice(at, 2, pieces[at] + pieces[at + 1]);
    }
}

function readTokens(modelDir) {
    return fs.readFileSync(path.join(modelDir, "tokens.txt"), "utf8").split("\n").filter(Boolean).map((line) => {
        const separator = line.lastIndexOf(" ");
        return { piece: line.slice(0, separator), id: Number(line.slice(separator + 1)) };
    });
}

/** The app's download of Parakeet, full precision when it is there. */
function getDefaultModelDir() {
    return findResource(MODEL_RESOURCES.fp32) ?? requireResource(MODEL_RESOURCES.int8);
}
