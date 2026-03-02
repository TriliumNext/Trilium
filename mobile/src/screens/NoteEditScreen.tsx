import React, { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { WebView } from 'react-native-webview';
import { RootState } from '../store';
import { fetchNote, updateNote, createNote, setCurrentNote } from '../store/notesSlice';

const CKEditorHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.ckeditor.com/ckeditor5/41.0.0/classic/ckeditor.js"></script>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, sans-serif; }
    #editor { min-height: 300px; }
    .ck-editor__editable { min-height: 300px; }
  </style>
</head>
<body>
  <div id="editor"></div>
  <script>
    let editor;
    ClassicEditor
      .create(document.querySelector('#editor'), {
        toolbar: ['heading', '|', 'bold', 'italic', 'link', 'bulletedList', 'numberedList', '|', 'undo', 'redo']
      })
      .then(newEditor => {
        editor = newEditor;
        window.editorReady = true;
      })
      .catch(error => {
        console.error(error);
      });
    
    function setContent(content) {
      if (editor) {
        editor.setData(content);
      }
    }
    
    function getContent() {
      return editor ? editor.getData() : '';
    }
  </script>
</body>
</html>
`;

const NoteEditScreen = ({ route, navigation }: any) => {
  const { noteId, isNew } = route.params || {};
  const dispatch = useDispatch();
  const { currentNote, loading } = useSelector((state: RootState) => state.notes);
  
  const [title, setTitle] = useState('');
  const [webViewLoaded, setWebViewLoaded] = useState(false);
  const webViewRef = React.useRef<WebView>(null);

  useEffect(() => {
    if (noteId && !isNew) {
      dispatch(fetchNote(noteId));
    }
    return () => {
      dispatch(setCurrentNote(null));
    };
  }, [noteId, isNew, dispatch]);

  useEffect(() => {
    if (currentNote) {
      setTitle(currentNote.title || '');
      if (webViewRef.current && webViewLoaded) {
        webViewRef.current.injectJavaScript(`
          setContent(${JSON.stringify(currentNote.content || '')});
        `);
      }
    }
  }, [currentNote, webViewLoaded]);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Title is required');
      return;
    }

    webViewRef.current?.injectJavaScript(`
      window.ReactNativeWebView.postMessage(getContent());
    `);
  };

  const handleMessage = async (event: any) => {
    const content = event.nativeEvent.data;
    
    try {
      if (isNew) {
        await dispatch(createNote({
          parentNoteId: 'root',
          title,
          content,
          type: 'text'
        }) as any);
      } else if (noteId) {
        await dispatch(updateNote({
          noteId,
          updates: { title, content }
        }) as any);
      }
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', 'Failed to save note');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Note',
      'Are you sure you want to delete this note?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: () => {
            // Delete logic
            navigation.goBack();
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        
        <View style={styles.actions}>
          {!isNew && (
            <TouchableOpacity onPress={handleDelete} style={styles.deleteButton}>
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <TextInput
        style={styles.titleInput}
        placeholder="Note Title"
        value={title}
        onChangeText={setTitle}
      />

      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: CKEditorHTML }}
        style={styles.webview}
        onLoad={() => setWebViewLoaded(true)}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  backButton: {
    fontSize: 16,
    color: '#4CAF50',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deleteButton: {
    marginRight: 16,
    padding: 8,
  },
  deleteText: {
    color: '#f44336',
    fontSize: 14,
  },
  saveButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
  },
  saveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  titleInput: {
    padding: 16,
    fontSize: 20,
    fontWeight: '600',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  webview: {
    flex: 1,
  },
});

export default NoteEditScreen;
