import becca from "./becca.js";
import log from "../services/log.js";
import beccaService from "./becca_service.js";
import dateUtils from "../services/date_utils.js";
import { JSDOM } from "jsdom";
import type BNote from "./entities/bnote.js";
import { SimilarNote } from "@triliumnext/commons";

const DEBUG = false;

const IGNORED_ATTRS = ["datenote", "monthnote", "yearnote"];

const IGNORED_ATTR_NAMES = [
    "includenotelink",
    "internallink",
    "imagelink",
    "relationmaplink",
    "template",
    "disableversioning",
    "archived",
    "hidepromotedattributes",
    "keyboardshortcut",
    "noteinfowidgetdisabled",
    "linkmapwidgetdisabled",
    "revisionswidgetdisabled",
    "whatlinksherewidgetdisabled",
    "similarnoteswidgetdisabled",
    "disableinclusion",
    "rendernote",
    "pageurl"
];

interface DateLimits {
    minDate: string;
    minExcludedDate: string;
    maxExcludedDate: string;
    maxDate: string;
}

function filterUrlValue(value: string) {
    return value
        .replace(/https?:\/\//gi, "")
        .replace(/www.js\./gi, "")
        .replace(/(\.net|\.com|\.org|\.info|\.edu)/gi, "");
}

function buildRewardMap(note: BNote) {
    // Need to use Map instead of object: https://github.com/zadam/trilium/issues/1895
    const map = new Map();

    function addToRewardMap(text: string | undefined | null, rewardFactor: number) {
        if (!text) {
            return;
        }

        for (const word of splitToWords(text)) {
            if (word) {
                const currentReward = map.get(word) || 0;

                // reward grows with the length of matched string
                const length = word.length - 0.9; // to penalize specifically very short words - 1 and 2 characters

                map.set(word, currentReward + rewardFactor * Math.pow(length, 0.7));
            }
        }
    }

    for (const ancestorNote of note.getAncestors()) {
        if (ancestorNote.noteId === "root") {
            continue;
        }

        if (ancestorNote.isDecrypted) {
            addToRewardMap(ancestorNote.title, 0.3);
        }

        for (const branch of ancestorNote.getParentBranches()) {
            addToRewardMap(branch.prefix, 0.3);
        }
    }

    addToRewardMap(trimMime(note.mime), 0.5);

    if (note.isDecrypted) {
        addToRewardMap(note.title, 1);
    }

    for (const branch of note.getParentBranches()) {
        addToRewardMap(branch.prefix, 1);
    }

    for (const attr of note.getAttributes()) {
        if (attr.name.startsWith("child:") || attr.name.startsWith("relation:") || attr.name.startsWith("label:")) {
            continue;
        }

        // inherited notes get small penalization
        let reward = note.noteId === attr.noteId ? 0.8 : 0.5;

        if (IGNORED_ATTRS.includes(attr.name)) {
            continue;
        }

        if (!IGNORED_ATTR_NAMES.includes(attr.name)) {
            addToRewardMap(attr.name, reward);
        }

        if (attr.name === "cliptype") {
            reward /= 2;
        }

        let value = attr.value;

        if (value.startsWith("http")) {
            value = filterUrlValue(value);

            // words in URLs are not that valuable
            reward = reward / 2;
        }

        addToRewardMap(value, reward);
    }

    if (note.type === "text" && note.isDecrypted) {
        const content = note.getContent();
        const dom = new JSDOM(content);

        const addHeadingsToRewardMap = (elName: string, rewardFactor: number) => {
            for (const el of dom.window.document.querySelectorAll(elName)) {
                addToRewardMap(el.textContent, rewardFactor);
            }
        };

        // the title is the top with weight 1 so smaller headings will have lower weight

        // technically H1 is not supported, but for the case it's present let's weigh it just as H2
        addHeadingsToRewardMap("h1", 0.9);
        addHeadingsToRewardMap("h2", 0.9);
        addHeadingsToRewardMap("h3", 0.8);
        addHeadingsToRewardMap("h4", 0.7);
        addHeadingsToRewardMap("h5", 0.6);
        addHeadingsToRewardMap("h6", 0.5);
    }

    return map;
}

const mimeCache: Record<string, string> = {};

function trimMime(mime: string) {
    if (!mime || mime === "text/html") {
        return;
    }

    if (!(mime in mimeCache)) {
        const chunks = mime.split("/");

        let str = "";

        if (chunks.length >= 2) {
            // we're not interested in 'text/' or 'application/' prefix
            str = chunks[1];

            if (str.startsWith("-x")) {
                str = str.substr(2);
            }
        }

        mimeCache[mime] = str;
    }

    return mimeCache[mime];
}

function buildDateLimits(baseNote: BNote): DateLimits {
    const dateCreatedTs = dateUtils.parseDateTime(baseNote.utcDateCreated).getTime();

    return {
        minDate: dateUtils.utcDateTimeStr(new Date(dateCreatedTs - 3600 * 1000)),
        minExcludedDate: dateUtils.utcDateTimeStr(new Date(dateCreatedTs - 5 * 1000)),
        maxExcludedDate: dateUtils.utcDateTimeStr(new Date(dateCreatedTs + 5 * 1000)),
        maxDate: dateUtils.utcDateTimeStr(new Date(dateCreatedTs + 3600 * 1000))
    };
}

// Need to use Map instead of object: https://github.com/zadam/trilium/issues/1895
const wordCache = new Map();

const WORD_BLACKLIST = [
    "a",
    "the",
    "in",
    "for",
    "from",
    "but",
    "s",
    "so",
    "if",
    "while",
    "until",
    "whether",
    "after",
    "before",
    "because",
    "since",
    "when",
    "where",
    "how",
    "than",
    "then",
    "and",
    "either",
    "or",
    "neither",
    "nor",
    "both",
    "also"
];

function splitToWords(text: string) {
    let words = wordCache.get(text);

    if (!words) {
        words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
        wordCache.set(text, words);

        for (const idx in words) {
            if (WORD_BLACKLIST.includes(words[idx])) {
                words[idx] = "";
            }
            // special case for english plurals
            else if (words[idx].length > 2 && words[idx].endsWith("es")) {
                words[idx] = words[idx].substr(0, words[idx] - 2);
            } else if (words[idx].length > 1 && words[idx].endsWith("s")) {
                words[idx] = words[idx].substr(0, words[idx] - 1);
            }
        }
    }

    return words;
}

/**
 * includeNoteLink and imageLink relation mean that notes are clearly related, but so clearly
 * that it doesn't actually need to be shown to the user.
 */
function hasConnectingRelation(sourceNote: BNote, targetNote: BNote) {
    return sourceNote.getAttributes().find((attr) => attr.type === "relation" && ["includenotelink", "imagelink"].includes(attr.name) && attr.value === targetNote.noteId);
}

async function findSimilarNotes(noteId: string): Promise<SimilarNote[] | undefined> {
    const results: SimilarNote[] = [];
    let i = 0;

    const baseNote = becca.notes[noteId];

    if (!baseNote || !baseNote.utcDateCreated) {
        return [];
    }

    let dateLimits: DateLimits;

    try {
        dateLimits = buildDateLimits(baseNote);
    } catch (e: any) {
        throw new Error(`Date limits failed with ${e.message}, entity: ${JSON.stringify(baseNote.getPojo())}`);
    }

    const rewardMap = buildRewardMap(baseNote);
    let ancestorRewardCache: Record<string, number> = {};
    const ancestorNoteIds = new Set(baseNote.getAncestors().map((note) => note.noteId));
    ancestorNoteIds.add(baseNote.noteId);

    let displayRewards = false;

    function gatherRewards(text?: string | null, factor: number = 1) {
        if (!text) {
            return 0;
        }

        let counter = 0;

        // when the title is very long, then weight of each individual word should be lowered,
        // also pretty important in e.g. long URLs in label values
        const lengthPenalization = 1 / Math.pow(text.length, 0.3);

        for (const word of splitToWords(text)) {
            const reward = rewardMap.get(word) * factor * lengthPenalization || 0;

            if (displayRewards && reward > 0) {
                console.log(`Reward ${Math.round(reward * 10) / 10} for word: ${word}`);
                console.log(`Before: ${counter}, add ${reward}, res: ${counter + reward}`);
                console.log(`${rewardMap.get(word)} * ${factor} * ${lengthPenalization}`);
            }

            counter += reward;
        }

        return counter;
    }

    function gatherAncestorRewards(note?: BNote) {
        if (!note || ancestorNoteIds.has(note.noteId)) {
            return 0;
        }

        if (!(note.noteId in ancestorRewardCache)) {
            let score = 0;

            for (const parentNote of note.parents) {
                if (!ancestorNoteIds.has(parentNote.noteId)) {
                    if (displayRewards) {
                        console.log("Considering", parentNote.title);
                    }

                    if (parentNote.isDecrypted) {
                        score += gatherRewards(parentNote.title, 0.3);
                    }

                    for (const branch of parentNote.getParentBranches()) {
                        score += gatherRewards(branch.prefix, 0.3) + gatherAncestorRewards(branch.parentNote);
                    }
                }
            }

            ancestorRewardCache[note.noteId] = score;
        }

        return ancestorRewardCache[note.noteId];
    }

    function computeScore(candidateNote: BNote) {
        let score = gatherRewards(trimMime(candidateNote.mime)) + gatherAncestorRewards(candidateNote);

        if (candidateNote.isDecrypted) {
            score += gatherRewards(candidateNote.title);
        }

        for (const branch of candidateNote.getParentBranches()) {
            score += gatherRewards(branch.prefix);
        }

        for (const attr of candidateNote.getAttributes()) {
            if (attr.name.startsWith("child:") || attr.name.startsWith("relation:") || attr.name.startsWith("label:")) {
                continue;
            }

            if (IGNORED_ATTRS.includes(attr.name)) {
                continue;
            }

            if (!IGNORED_ATTR_NAMES.includes(attr.name)) {
                score += gatherRewards(attr.name);
            }

            let value = attr.value;
            let factor = 1;

            if (!value.startsWith) {
                log.info(`Unexpected falsy value for attribute ${JSON.stringify(attr.getPojo())}`);
                continue;
            } else if (value.startsWith("http")) {
                value = filterUrlValue(value);

                // words in URLs are not that valuable
                factor = 0.5;
            }

            score += gatherRewards(value, factor);
        }

        if (candidateNote.type === baseNote.type) {
            if (displayRewards) {
                console.log("Adding reward for same note type");
            }

            score += 0.2;
        }

        /**
         * We want to improve the standing of notes which have been created in similar time to each other since
         * there's a good chance they are related.
         *
         * But there's an exception - if they were created really close to each other (within few seconds) then
         * they are probably part of the import and not created by hand - these OTOH should not benefit.
         */
        const { utcDateCreated } = candidateNote;

        if (utcDateCreated < dateLimits.minExcludedDate || utcDateCreated > dateLimits.maxExcludedDate) {
            if (utcDateCreated >= dateLimits.minDate && utcDateCreated <= dateLimits.maxDate) {
                if (displayRewards) {
                    console.log("Adding reward for very similar date of creation");
                }

                score += 1;
            } else if (utcDateCreated.substr(0, 10) === dateLimits.minDate.substr(0, 10) || utcDateCreated.substr(0, 10) === dateLimits.maxDate.substr(0, 10)) {
                if (displayRewards) {
                    console.log("Adding reward for same day of creation");
                }

                // smaller bonus when outside of the window but within the same date
                score += 0.5;
            }
        }

        return score;
    }

    for (const candidateNote of Object.values(becca.notes)) {
        if (candidateNote.noteId === baseNote.noteId || hasConnectingRelation(candidateNote, baseNote) || hasConnectingRelation(baseNote, candidateNote)) {
            continue;
        }

        let score = computeScore(candidateNote);

        if (score >= 1.5) {
            const notePath = candidateNote.getBestNotePath();

            // this takes care of note hoisting
            if (!notePath) {
                // TODO: This return is suspicious, it should probably be continue
                return;
            }

            if (beccaService.isNotePathArchived(notePath)) {
                score -= 0.5; // archived penalization
            }

            results.push({ score, notePath, noteId: candidateNote.noteId });
        }

        i++;

        if (i % 1000 === 0) {
            await setImmediatePromise();
        }
    }

    results.sort((a, b) => (a.score > b.score ? -1 : 1));

    if (DEBUG) {
        console.log("REWARD MAP", rewardMap);

        if (results.length >= 1) {
            for (const { noteId } of results) {
                const note = becca.notes[noteId];

                displayRewards = true;
                ancestorRewardCache = {}; // reset cache
                const totalReward = computeScore(note);

                console.log("Total reward:", Math.round(totalReward * 10) / 10);
            }
        }
    }

    return results.length > 200 ? results.slice(0, 200) : results;
}

/**
 * The point of this is to break up the long-running sync process to avoid blocking
 * see https://snyk.io/blog/nodejs-how-even-quick-async-functions-can-block-the-event-loop-starve-io/
 */
function setImmediatePromise() {
    return new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 0);
    });
}

export default {
    findSimilarNotes
};
