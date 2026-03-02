import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import TriliumAPI from '../../services/TriliumAPI';

export interface Note {
  noteId: string;
  title: string;
  content: string;
  type: string;
  mime: string;
  isProtected: boolean;
  dateCreated: string;
  dateModified: string;
  parentNoteIds?: string[];
  childNoteIds?: string[];
}

interface NotesState {
  notes: Note[];
  currentNote: Note | null;
  loading: boolean;
  error: string | null;
  searchQuery: string;
  searchResults: Note[];
}

const initialState: NotesState = {
  notes: [],
  currentNote: null,
  loading: false,
  error: null,
  searchQuery: '',
  searchResults: [],
};

export const fetchNotes = createAsyncThunk('notes/fetchNotes', async () => {
  const response = await TriliumAPI.getNotes();
  return response;
});

export const fetchNote = createAsyncThunk(
  'notes/fetchNote',
  async (noteId: string) => {
    const response = await TriliumAPI.getNote(noteId);
    return response;
  }
);

export const createNote = createAsyncThunk(
  'notes/createNote',
  async ({ parentNoteId, title, content, type }: 
    { parentNoteId: string; title: string; content: string; type?: string }) => {
    const response = await TriliumAPI.createNote(parentNoteId, title, content, type);
    return response;
  }
);

export const updateNote = createAsyncThunk(
  'notes/updateNote',
  async ({ noteId, updates }: { noteId: string; updates: { title?: string; content?: string } }) => {
    const response = await TriliumAPI.updateNote(noteId, updates);
    return response;
  }
);

export const deleteNote = createAsyncThunk(
  'notes/deleteNote',
  async (noteId: string) => {
    await TriliumAPI.deleteNote(noteId);
    return noteId;
  }
);

export const searchNotes = createAsyncThunk(
  'notes/searchNotes',
  async (query: string) => {
    const response = await TriliumAPI.search(query);
    return response;
  }
);

const notesSlice = createSlice({
  name: 'notes',
  initialState,
  reducers: {
    setCurrentNote: (state, action: PayloadAction<Note | null>) => {
      state.currentNote = action.payload;
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    clearSearch: (state) => {
      state.searchQuery = '';
      state.searchResults = [];
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch notes
      .addCase(fetchNotes.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchNotes.fulfilled, (state, action) => {
        state.loading = false;
        state.notes = action.payload;
      })
      .addCase(fetchNotes.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch notes';
      })
      // Fetch single note
      .addCase(fetchNote.fulfilled, (state, action) => {
        state.currentNote = action.payload;
      })
      // Create note
      .addCase(createNote.fulfilled, (state, action) => {
        state.notes.unshift(action.payload);
      })
      // Update note
      .addCase(updateNote.fulfilled, (state, action) => {
        const index = state.notes.findIndex(n => n.noteId === action.payload.noteId);
        if (index !== -1) {
          state.notes[index] = action.payload;
        }
        if (state.currentNote?.noteId === action.payload.noteId) {
          state.currentNote = action.payload;
        }
      })
      // Delete note
      .addCase(deleteNote.fulfilled, (state, action) => {
        state.notes = state.notes.filter(n => n.noteId !== action.payload);
        if (state.currentNote?.noteId === action.payload) {
          state.currentNote = null;
        }
      })
      // Search
      .addCase(searchNotes.fulfilled, (state, action) => {
        state.searchResults = action.payload;
      });
  },
});

export const { setCurrentNote, setSearchQuery, clearSearch, clearError } = notesSlice.actions;
export default notesSlice.reducer;
