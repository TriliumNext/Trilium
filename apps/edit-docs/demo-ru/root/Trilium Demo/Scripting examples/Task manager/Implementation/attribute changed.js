if (!["task", "location", "tag", "todoDate", "doneDate"].includes(api.originEntity.name)) {
    return;
}

const tagRootNote = api.getNoteWithLabel('taskTagRoot');
const doneRootNote = api.getNoteWithLabel('taskDoneRoot');
const todoRootNote = api.getNoteWithLabel('taskTodoRoot');

if (!tagRootNote || !doneRootNote || !todoRootNote) {
    console.log("Один из узлов tagRootNote, doneRootNote или todoRootNote не существует");
    return;
}

const note = api.originEntity.getNote();

if (note.isDeleted) {
    return;
}
    
const attributes = note.getAttributes();

const todoDate = note.getLabelValue('todoDate');
const doneDate = note.getLabelValue('doneDate');

function isWithinExpectedRange(date) {
    if (!date) {
        return true;
    }
    
    const year = parseInt(date.substr(0, 4));
    
    return year >= 2010 && year < 2050;
}

if (!isWithinExpectedRange(todoDate) || !isWithinExpectedRange(doneDate)) {
    console.log(`One or both dates - ${todoDate}, ${doneDate} - is outside of expected range`);
    
    return;
}

const isTaskDone = !!doneDate;

api.toggleNoteInParent(isTaskDone, note.noteId, doneRootNote.noteId);
api.toggleNoteInParent(!isTaskDone, note.noteId, todoRootNote.noteId);

const location = note.getLabelValue('location');
const locationRootNote = api.getNoteWithLabel('taskLocationRoot');

reconcileAssignments(note, locationRootNote, location ? [location] : [], 'taskLocationNote', isTaskDone);

const tags = attributes.filter(attr => attr.type === 'label' && attr.name === 'tag').map(attr => attr.value);

reconcileAssignments(note, tagRootNote, tags, 'taskTagNote', isTaskDone);

note.toggleLabel(isTaskDone, "cssClass", "done");

const doneTargetNoteId = isTaskDone ?  api.getDayNote(doneDate).noteId : null;
api.setNoteToParent(note.noteId, 'DONE', doneTargetNoteId);

note.toggleLabel(!isTaskDone, "cssClass", "todo");

const todoTargetNoteId = (!isTaskDone && todoDate) ? api.getDayNote(todoDate).noteId : null;
api.setNoteToParent(note.noteId, 'TODO', todoTargetNoteId);