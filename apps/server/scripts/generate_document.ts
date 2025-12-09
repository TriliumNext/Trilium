/**
 * Usage: tsx ./generate_document.ts 1000
 * will create 1000 new notes and some clones into the current document.db
 */

import sqlInit from "../src/services/sql_init.js";
import noteService from "../src/services/notes.js";
import attributeService from "../src/services/attributes.js";
import cloningService from "../src/services/cloning.js";
import { loremIpsum } from "lorem-ipsum";
import "../src/becca/entity_constructor.js";
import { initializeTranslations } from "../src/services/i18n.js";
import cls from "../src/services/cls.js";

const noteCount = parseInt(process.argv[2]);

if (!noteCount) {
    console.error(`Please enter number of notes as program parameter.`);
    process.exit(1);
}

const notes = ["root"];

function getRandomNoteId() {
    const index = Math.floor(Math.random() * notes.length);

    return notes[index];
}

async function start() {
    if (!sqlInit.isDbInitialized()) {
        console.error("Database not initialized.");
        process.exit(1);
    }

    await initializeTranslations();

    sqlInit.initializeDb();
    await sqlInit.dbReady;

    for (let i = 0; i < noteCount; i++) {
        const title = loremIpsum({
            count: 1,
            units: "sentences",
            sentenceLowerBound: 1,
            sentenceUpperBound: 10
        });

        const paragraphCount = Math.floor(Math.random() * Math.random() * 100);
        const content = loremIpsum({
            count: paragraphCount,
            units: "paragraphs",
            sentenceLowerBound: 1,
            sentenceUpperBound: 15,
            paragraphLowerBound: 3,
            paragraphUpperBound: 10,
            format: "html"
        });

        const { note } = noteService.createNewNote({
            parentNoteId: getRandomNoteId(),
            title,
            content,
            type: "text"
        });

        console.log(`Created note ${i}: ${title}`);

        if (Math.random() < 0.04) {
            const noteIdToClone = note.noteId;
            const parentNoteId = getRandomNoteId();
            const prefix = Math.random() > 0.8 ? "prefix" : "";

            const result = cloningService.cloneNoteToBranch(noteIdToClone, parentNoteId, prefix);

            console.log(`Cloning ${i}:`, result.success ? "succeeded" : "FAILED");
        }

        // does not have to be for the current note
        attributeService.createAttribute({
            noteId: getRandomNoteId(),
            type: "label",
            name: "label",
            value: "value",
            isInheritable: Math.random() > 0.1 // 10% are inheritable
        });

        attributeService.createAttribute({
            noteId: getRandomNoteId(),
            type: "relation",
            name: "relation",
            value: getRandomNoteId(),
            isInheritable: Math.random() > 0.1 // 10% are inheritable
        });

        note.saveRevision();

        notes.push(note.noteId);
    }

    process.exit(0);
}

cls.init(() => start());
