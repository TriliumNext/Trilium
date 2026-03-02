import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import TriliumAPI from '../../services/TriliumAPI';

interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  serverUrl: string;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  isAuthenticated: false,
  token: null,
  serverUrl: 'http://localhost:8080',
  loading: false,
  error: null,
};

export const login = createAsyncThunk(
  'auth/login',
  async ({ serverUrl, password }: { serverUrl: string; password: string }) => {
    TriliumAPI.setBaseUrl(serverUrl);
    const response = await TriliumAPI.login(password);
    TriliumAPI.setToken(response.token);
    return { token: response.token, serverUrl };
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout: (state) => {
      state.isAuthenticated = false;
      state.token = null;
      state.error = null;
    },
    clearError: (state) => {
      state.error = null;
    },
    setServerUrl: (state, action: PayloadAction<string>) => {
      state.serverUrl = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false;
        state.isAuthenticated = true;
        state.token = action.payload.token;
        state.serverUrl = action.payload.serverUrl;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Login failed';
      });
  },
});

export const { logout, clearError, setServerUrl } = authSlice.actions;
export default authSlice.reducer;
