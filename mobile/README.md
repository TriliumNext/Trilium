# Trilium Mobile App

Official React Native mobile application for Trilium Notes.

## Features

- 📱 **Cross-Platform**: iOS and Android support
- 📝 **Full Note Management**: Create, edit, delete notes
- 🔍 **Search**: Quick search through all notes
- 💻 **Rich Text Editing**: CKEditor integration for WYSIWYG editing
- 🔄 **Offline-First**: Works offline with sync capability
- 🔐 **Secure**: Token-based authentication

## Tech Stack

- React Native 0.77+
- TypeScript
- Redux Toolkit (State Management)
- React Navigation (Routing)
- CKEditor 5 (Rich Text Editor)
- Axios (HTTP Client)

## Installation

```bash
# Clone the repository
git clone https://github.com/TriliumNext/Trilium.git
cd Trilium/mobile

# Install dependencies
npm install

# iOS (Mac only)
cd ios && pod install && cd ..
npx react-native run-ios

# Android
npx react-native run-android
```

## Configuration

1. Start your Trilium server
2. Open the app and enter your server URL (e.g., `http://localhost:8080`)
3. Login with your password

## Development

```bash
# Start Metro bundler
npm start

# Run on iOS
npm run ios

# Run on Android
npm run android

# Run tests
npm test

# Lint
npm run lint
```

## Project Structure

```
src/
├── components/     # Reusable UI components
├── screens/        # Application screens
│   ├── LoginScreen.tsx
│   ├── NotesListScreen.tsx
│   ├── NoteEditScreen.tsx
│   └── SettingsScreen.tsx
├── services/       # API services
│   └── TriliumAPI.ts
├── store/          # Redux store
│   ├── authSlice.ts
│   └── notesSlice.ts
├── navigation/     # Navigation configuration
│   └── AppNavigator.tsx
└── utils/          # Utility functions
```

## API Integration

The app communicates with Trilium server via REST API:
- Authentication: `/api/login`
- Notes: `/api/notes`
- Sync: `/api/sync/changed`

## Offline Support

- Notes are cached locally
- Edits queue when offline
- Automatic sync when connection restored

## Screenshots

*Coming soon*

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is part of Trilium Notes and follows the same license.

## Acknowledgments

- [Trilium Notes](https://github.com/zadam/trilium) - Original project
- [CKEditor](https://ckeditor.com/) - Rich text editor
- [React Native](https://reactnative.dev/) - Mobile framework
