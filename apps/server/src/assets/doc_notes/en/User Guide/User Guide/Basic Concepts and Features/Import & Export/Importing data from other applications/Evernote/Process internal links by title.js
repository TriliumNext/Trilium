const query = `note.type = "text" and note.content *=* "evernote:///view/"`;
const notes = api.searchForNotes(query);

for (const note of notes) {
    api.log(`Processing note ${note.title}...`);
    
    const content = note.getContent();
    const $ = api.cheerio.load(content);
    
    $("a").each((i, el) => {
        const $el = $(el);
        
        const url = $el.attr("href");
        if (!url.startsWith("evernote:///")) return;

        const text = $el.text();
        const matchingNotes = api.searchForNotes(`note.title = "${text}"`);
        if (matchingNotes.length === 0) {
            api.log(`No matching notes for "${text}..."`);
            return;
        }

        if (matchingNotes.length > 1) {
            api.log(`Found multiple matching notes for "${text}". Skipping.`);
            return;
        }

        const matchingNote = matchingNotes[0];
        
        api.log(`Found matching note: ${matchingNote.title} ${matchingNote.noteId}`);
        $el.attr("href", `#root/${matchingNote.noteId}`);
        $el.addClass("reference-link");
    });
    note.setContent($("body").html());   
}