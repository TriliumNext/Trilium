# Trilium Web Clipper (Manifest V3)

A modern Chrome extension for saving web content to [Trilium Notes](https://github.com/zadam/trilium) built with Manifest V3, TypeScript, and modern web standards.

## ✨ Features

- 🔥 **Modern Manifest V3** - Built with latest Chrome extension standards
- 📝 **Multiple Save Options** - Selection, full page, screenshots, links, and images
- ⌨️ **Keyboard Shortcuts** - Quick access with customizable hotkeys
- 🎨 **Modern UI** - Clean, responsive popup interface
- 🛠️ **TypeScript** - Full type safety and developer experience
- 🔍 **Enhanced Error Handling** - Comprehensive logging and user feedback
- 🚀 **Developer Friendly** - Modern build tools and hot reload

## 🚀 Installation

### From Source

1. Clone the repository and navigate to the extension directory
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Load the extension in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `dist` folder

## 🎯 Usage

### Save Content

- **Selection**: Highlight text and use `Ctrl+Shift+S` or right-click menu
- **Full Page**: Use `Alt+Shift+S` or click the extension icon
- **Screenshot**: Use `Ctrl+Shift+E` or right-click menu
- **Links & Images**: Right-click on links or images to save directly

### Keyboard Shortcuts

- `Ctrl+Shift+S` (Mac: `Cmd+Shift+S`) - Save selection
- `Alt+Shift+S` (Mac: `Option+Shift+S`) - Save full page
- `Ctrl+Shift+E` (Mac: `Cmd+Shift+E`) - Save screenshot

### Extension Popup

Click the extension icon to:
- Save current page or selection
- Take a screenshot
- Configure settings
- View save status

## ⚙️ Configuration

1. Right-click the extension icon and select "Options"
2. Enter your Trilium server URL (e.g., `http://localhost:8080`)
3. Configure default note title format
4. Set up saving preferences

### Trilium Server Setup

Ensure your Trilium server is accessible and ETAPI is enabled:
1. In Trilium, go to Options → ETAPI
2. Create a new token or use an existing one
3. Enter the token in the extension options

## 🔧 Development

### Prerequisites

- Node.js 18+ (22+ recommended)
- npm or yarn
- Chrome/Chromium 88+ (for Manifest V3 support)

### Development Workflow

```bash
# Install dependencies
npm install

# Start development mode (watch for changes)
npm run dev

# Build for production
npm run build

# Type checking
npm run type-check

# Lint and format code
npm run lint
npm run format
```

### Project Structure

```
src/
├── background/     # Service worker (background script)
├── content/        # Content scripts
├── popup/          # Extension popup UI
├── options/        # Options page
├── shared/         # Shared utilities and types
└── manifest.json   # Extension manifest
```

## 🐛 Troubleshooting

**Extension not loading:**
- Ensure you're using Chrome 88+ (Manifest V3 support)
- Check that the `dist` folder was created after running `npm run build`
- Look for errors in Chrome's extension management page

**Can't connect to Trilium:**
- Verify Trilium server is running and accessible
- Check that ETAPI is enabled in Trilium options
- Ensure the server URL in extension options is correct

**Content not saving:**
- Check browser console for error messages
- Verify your Trilium ETAPI token is valid
- Ensure the target note or location exists in Trilium

## 📝 License

This project is licensed under the same license as the main Trilium project.

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📋 Changelog

### v1.0.0
- Complete rebuild with Manifest V3
- Modern TypeScript architecture
- Enhanced error handling and logging
- Improved user interface
- Better developer experience