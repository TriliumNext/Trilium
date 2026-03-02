/**
 * Trilium API Service
 * Handles communication with Trilium server
 */

import axios from 'axios';
import { Platform } from 'react-native';

const API_BASE_URL = 'http://localhost:8080';

class TriliumAPI {
  private token: string | null = null;
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  setToken(token: string) {
    this.token = token;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  private getHeaders() {
    return {
      'Authorization': this.token ? `Bearer ${this.token}` : '',
      'Content-Type': 'application/json',
    };
  }

  // Login
  async login(password: string): Promise<{ token: string }> {
    const response = await axios.post(
      `${this.baseUrl}/api/login`,
      { password },
      { headers: { 'Content-Type': 'application/json' } }
    );
    return response.data;
  }

  // Get all notes
  async getNotes(): Promise<any[]> {
    const response = await axios.get(
      `${this.baseUrl}/api/notes`,
      { headers: this.getHeaders() }
    );
    return response.data;
  }

  // Get note by ID
  async getNote(noteId: string): Promise<any> {
    const response = await axios.get(
      `${this.baseUrl}/api/notes/${noteId}`,
      { headers: this.getHeaders() }
    );
    return response.data;
  }

  // Create note
  async createNote(parentNoteId: string, title: string, content: string, type: string = 'text'): Promise<any> {
    const response = await axios.post(
      `${this.baseUrl}/api/notes`,
      {
        parentNoteId,
        title,
        content,
        type
      },
      { headers: this.getHeaders() }
    );
    return response.data;
  }

  // Update note
  async updateNote(noteId: string, updates: { title?: string; content?: string }): Promise<any> {
    const response = await axios.patch(
      `${this.baseUrl}/api/notes/${noteId}`,
      updates,
      { headers: this.getHeaders() }
    );
    return response.data;
  }

  // Delete note
  async deleteNote(noteId: string): Promise<void> {
    await axios.delete(
      `${this.baseUrl}/api/notes/${noteId}`,
      { headers: this.getHeaders() }
    );
  }

  // Sync changes
  async sync(lastSyncId: string): Promise<any> {
    const response = await axios.get(
      `${this.baseUrl}/api/sync/changed?lastSyncId=${lastSyncId}`,
      { headers: this.getHeaders() }
    );
    return response.data;
  }

  // Search notes
  async search(query: string): Promise<any[]> {
    const response = await axios.get(
      `${this.baseUrl}/api/notes?search=${encodeURIComponent(query)}`,
      { headers: this.getHeaders() }
    );
    return response.data;
  }
}

export default new TriliumAPI();
