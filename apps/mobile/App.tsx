import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';

/**
 * TRILIUM NOTES OFFICIAL MOBILE APP - MVP
 * Bounty Target: $155 USD (IssueHunt)
 * Architecture: React Native + Expo + Trilium ETAPI
 */

const TRILIUM_ETAPI_URL = process.env.EXPO_PUBLIC_TRILIUM_URL || 'http://localhost:8080/etapi';
const TRILIUM_TOKEN = process.env.EXPO_PUBLIC_TRILIUM_TOKEN || '';

export default function App() {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotes();
  }, []);

  const fetchNotes = async () => {
    try {
      const response = await fetch(`${TRILIUM_ETAPI_URL}/notes`, {
        headers: { 'Authorization': TRILIUM_TOKEN }
      });
      const data = await response.json();
      setNotes(data.results || []);
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderNoteItem = ({ item }: { item: any }) => (
    <TouchableOpacity style={styles.noteCard}>
      <Text style={styles.noteTitle}>{item.title}</Text>
      <Text style={styles.noteDate}>Last updated: {new Date(item.utcDateModified).toLocaleDateString()}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Trilium Mobile</Text>
      </View>
      
      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(item) => item.noteId}
          renderItem={renderNoteItem}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={<Text style={styles.emptyText}>No notes found. Syncing...</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1C1C1E',
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
  },
  listContainer: {
    padding: 16,
  },
  noteCard: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  noteTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 4,
  },
  noteDate: {
    fontSize: 14,
    color: '#8E8E93',
  },
  emptyText: {
    textAlign: 'center',
    color: '#8E8E93',
    marginTop: 40,
    fontSize: 16,
  }
});
