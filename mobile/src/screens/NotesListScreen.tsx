import React, { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { fetchNotes, setCurrentNote, searchNotes } from '../store/notesSlice';
import { logout } from '../store/authSlice';

const NotesListScreen = ({ navigation }: any) => {
  const dispatch = useDispatch();
  const { notes, loading, searchQuery, searchResults } = useSelector(
    (state: RootState) => state.notes
  );

  useEffect(() => {
    dispatch(fetchNotes());
  }, [dispatch]);

  const handleRefresh = () => {
    dispatch(fetchNotes());
  };

  const handleNotePress = (note: any) => {
    dispatch(setCurrentNote(note));
    navigation.navigate('NoteEdit', { noteId: note.noteId });
  };

  const handleSearch = (text: string) => {
    dispatch(searchNotes(text));
  };

  const displayNotes = searchQuery ? searchResults : notes;

  const renderNoteItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.noteItem}
      onPress={() => handleNotePress(item)}
    >
      <Text style={styles.noteTitle} numberOfLines={1}>
        {item.title || 'Untitled'}
      </Text>
      <Text style={styles.noteDate}>
        {new Date(item.dateModified).toLocaleDateString()}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Notes</Text>
        <TouchableOpacity onPress={() => dispatch(logout())}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Search notes..."
        value={searchQuery}
        onChangeText={handleSearch}
      />

      <FlatList
        data={displayNotes}
        renderItem={renderNoteItem}
        keyExtractor={(item) => item.noteId}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={handleRefresh} />
        }
        contentContainerStyle={styles.listContent}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('NoteEdit', { isNew: true })}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#4CAF50',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  logoutText: {
    color: '#fff',
    fontSize: 14,
  },
  searchInput: {
    margin: 16,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
  },
  listContent: {
    padding: 16,
  },
  noteItem: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  noteTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  noteDate: {
    fontSize: 12,
    color: '#666',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fabText: {
    fontSize: 24,
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default NotesListScreen;
