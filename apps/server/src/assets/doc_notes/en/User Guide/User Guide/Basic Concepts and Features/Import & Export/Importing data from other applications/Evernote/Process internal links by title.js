const query = `note.type = "text" and note.content *=* "evernote:///view/"`;
const notes = api.searchForNotes(query);

for (const note of notes) {
    api.log(`Processing note ${note.title}...`);
    
    const content = note.getContent();
    const root = api.htmlParser.parse(content);
    
    for (const el of root.querySelectorAll("a")) {
        const url = el.getAttribute("href");
        if (!url?.startsWith("evernote:///")) continue;

        const text = el.textContent;
        const matchingNotes = api.searchForNotes(`note.title = "${text}"`);
        if (matchingNotes.length === 0) {
            api.log(`No matching notes for "${text}..."`);
            continue;
        }

        if (matchingNotes.length > 1) {
            api.log(`Found multiple matching notes for "${text}". Skipping.`);
            continue;
        }

        const matchingNote = matchingNotes[0];
        
        api.log(`Found matching note: ${matchingNote.title} ${matchingNote.noteId}`);
        el.setAttribute("href", `#root/${matchingNote.noteId}`);
        el.classList.add("reference-link");
    }
    note.setContent(root.toString());   
}
