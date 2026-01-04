# Code Block Preservation - User Guide

## Overview

The **Code Block Preservation** feature ensures that code blocks and technical content remain in their original positions when saving technical articles, documentation, and tutorials to Trilium Notes. Without this feature, code blocks may be relocated or removed during the article extraction process.

This feature is particularly useful when saving content from:
- Technical blogs and tutorials
- Stack Overflow questions and answers
- GitHub README files and documentation
- Programming reference sites
- Developer documentation

## How It Works

When you save a web page, the extension uses Mozilla's Readability library to extract the main article content and remove clutter (ads, navigation, etc.). However, Readability's cleaning process can sometimes relocate or remove code blocks.

The Code Block Preservation feature:
1. **Detects** code blocks in the page before extraction
2. **Marks** them for preservation during Readability processing
3. **Restores** them to their original positions after extraction
4. **Only activates** on sites you've enabled (via the allow list)

## Getting Started

### Initial Setup

1. **Open Extension Options**
   - Right-click the extension icon → "Options"
   - Or click the extension icon and select "Settings"

2. **Navigate to Code Block Settings**
   - Scroll down to the "Code Block Preservation" section
   - Click "Configure Allow List →"

3. **Enable the Feature**
   - Toggle "Enable Code Block Preservation" to ON
   - The feature is now active for default sites

### Default Sites

The extension comes pre-configured with popular technical sites:

**Developer Q&A:**
- Stack Overflow (`stackoverflow.com`)
- Stack Exchange (`stackexchange.com`)

**Code Hosting:**
- GitHub (`github.com`)
- GitLab (`gitlab.com`)

**Blogging Platforms:**
- Dev.to (`dev.to`)
- Medium (`medium.com`)
- Hashnode (`hashnode.com`)

**Documentation:**
- Read the Docs (`readthedocs.io`)
- MDN Web Docs (`developer.mozilla.org`)

**Technical Blogs:**
- CSS-Tricks (`css-tricks.com`)
- Smashing Magazine (`smashingmagazine.com`)

You can enable/disable any of these or add your own custom sites.

## Using the Allow List

### Adding a Site

1. **Open Allow List Settings**
   - Go to Options → Code Block Preservation → Configure Allow List

2. **Choose Entry Type**
   - **Domain**: Apply to entire domain and all subdomains
     - Example: `example.com` matches `www.example.com`, `blog.example.com`, etc.
   - **URL**: Apply to specific page or URL pattern
     - Example: `https://example.com/tutorials/`

3. **Enter Value**
   - For domains: Enter just the domain (e.g., `myblog.com`)
   - For URLs: Enter the complete URL (e.g., `https://myblog.com/tech/`)

4. **Click "Add Entry"**
   - The site will be added to your allow list
   - Code blocks will now be preserved on this site

### Domain Examples

✅ **Valid domain entries:**
- `stackoverflow.com` - Matches all Stack Overflow pages
- `github.com` - Matches all GitHub pages
- `*.github.io` - Matches all GitHub Pages sites
- `docs.python.org` - Matches Python documentation

❌ **Invalid domain entries:**
- `https://github.com` - Don't include protocol for domains
- `github.com/user/repo` - Use URL type for specific paths
- `github` - Must be a complete domain

### URL Examples

✅ **Valid URL entries:**
- `https://myblog.com/tutorials/` - Specific section
- `https://docs.example.com/api/` - API documentation
- `https://example.com/posts/2024/` - Year-specific posts

❌ **Invalid URL entries:**
- `myblog.com/tutorials` - Must include protocol (https://)
- `example.com` - Use domain type for whole site

### Managing Entries

**Enable/Disable an Entry:**
- Toggle the switch in the "Status" column
- Disabled entries remain in the list but are inactive

**Remove an Entry:**
- Click the "Remove" button for custom entries
- Default entries cannot be removed (only disabled)

**View Entry Type:**
- Domain entries show a globe icon 🌐
- URL entries show a link icon 🔗

## Auto-Detect Mode

**Auto-Detect** mode automatically preserves code blocks on any page, regardless of the allow list.

### When to Use Auto-Detect

✅ **Enable Auto-Detect if:**
- You frequently save content from various technical sites
- You want code blocks preserved everywhere
- You don't want to manage an allow list

⚠️ **Disable Auto-Detect if:**
- You only need preservation on specific sites
- You want precise control over where it applies
- You're concerned about performance on non-technical sites

### Enabling Auto-Detect

1. Go to Options → Code Block Preservation → Configure Allow List
2. Toggle "Auto-detect code blocks on all sites" to ON
3. Code blocks will now be preserved everywhere

**Note:** When Auto-Detect is enabled, the allow list is ignored.

## How Code Blocks Are Detected

The extension identifies code blocks using multiple heuristics:

### Recognized Patterns

1. **`<pre>` tags** - Standard preformatted text blocks
2. **`<code>` tags** - Both inline and block-level code
3. **Syntax highlighting classes** - Common highlighting libraries:
   - Prism (`language-*`, `prism-*`)
   - Highlight.js (`hljs`, `language-*`)
   - CodeMirror (`cm-*`, `CodeMirror`)
   - Rouge (`highlight`)

### Block vs Inline Code

The extension distinguishes between:

**Block-level code** (preserved):
- Multiple lines of code
- Code in `<pre>` tags
- `<code>` tags with syntax highlighting classes
- Code blocks longer than 80 characters
- Code that fills most of its parent container

**Inline code** (not affected):
- Single-word code references (e.g., `className`)
- Short code snippets within sentences
- Variable or function names in text

## Troubleshooting

### Code Blocks Still Being Removed

**Check these settings:**
1. Is Code Block Preservation enabled?
   - Go to Options → Code Block Preservation → Configure Allow List
   - Ensure "Enable Code Block Preservation" is ON

2. Is the site in your allow list?
   - Check if the domain/URL is listed
   - Ensure the entry is enabled (toggle is ON)
   - Try adding the specific URL if domain isn't working

3. Is Auto-Detect enabled?
   - If you want it to work everywhere, enable Auto-Detect
   - If using allow list, ensure Auto-Detect is OFF

**Try these solutions:**
- Add the site to your allow list as both domain and URL
- Enable Auto-Detect mode
- Check browser console for error messages (F12 → Console)

### Code Blocks in Wrong Position

This may occur if:
- The page has complex nested HTML structure
- Code blocks are inside dynamically loaded content
- The site uses unusual code block markup

**Solutions:**
- Try saving the page again
- Report the issue with the specific URL
- Consider using Auto-Detect mode

### Performance Issues

If saving pages becomes slow:

1. **Disable Auto-Detect** - Use allow list instead
2. **Reduce allow list** - Only include frequently used sites
3. **Disable feature temporarily** - Turn off Code Block Preservation

The feature adds minimal overhead (typically <100ms) but may be slower on:
- Very large pages (>10,000 words)
- Pages with many code blocks (>50 blocks)

### Extension Errors

If you see error messages:

1. **Check browser console** (F12 → Console)
   - Look for messages starting with `[CodeBlockSettings]` or `[ArticleExtraction]`
   - Note the error and report it

2. **Reset settings**
   - Go to Options → Code Block Preservation
   - Disable and re-enable the feature
   - Reload the page you're trying to save

3. **Clear extension data**
   - Right-click extension icon → "Options"
   - Clear all settings and start fresh

## Privacy & Data

### What Data Is Stored

The extension stores:
- Your enable/disable preference
- Your Auto-Detect preference
- Your custom allow list entries (domains/URLs only)

### What Data Is NOT Stored

- The content of pages you visit
- The content of code blocks
- Your browsing history
- Any personal information

### Data Sync

Settings are stored using Chrome's `storage.sync` API:
- Settings sync across devices where you're signed into Chrome
- Allow list is shared across your devices
- No data is sent to external servers

## Tips & Best Practices

### For Best Results

1. **Start with defaults** - Try the pre-configured sites first
2. **Add sites as needed** - Only add sites you frequently use
3. **Use domains over URLs** - Domains are more flexible
4. **Test after adding** - Save a test page to verify it works
5. **Keep list organized** - Remove sites you no longer use

### Common Workflows

**Technical Blog Reader:**
1. Enable Code Block Preservation
2. Keep default technical blog domains
3. Add your favorite blogs as you discover them

**Documentation Saver:**
1. Enable Code Block Preservation
2. Add documentation sites to allow list
3. Consider using URL entries for specific doc sections

**Stack Overflow Power User:**
1. Enable Code Block Preservation
2. Stack Overflow is included by default
3. No additional configuration needed

**Casual User:**
1. Enable Auto-Detect mode
2. Don't worry about the allow list
3. Code blocks preserved everywhere automatically

## Examples

### Saving a Stack Overflow Question

1. Find a question with code examples
2. Click the extension icon or use `Alt+Shift+S`
3. Code blocks are automatically preserved (Stack Overflow is in default list)
4. Content is saved to Trilium with code in original position

### Saving a GitHub README

1. Navigate to a repository README
2. Click the extension icon
3. Code examples are preserved (GitHub is in default list)
4. Markdown code blocks are saved correctly

### Saving a Tutorial Blog Post

1. Navigate to tutorial article (e.g., on your favorite tech blog)
2. If site isn't in default list:
   - Add to allow list: `yourtechblog.com`
3. Save the page
4. Code examples remain in correct order

### Saving Documentation

1. Navigate to documentation page
2. Add domain to allow list (e.g., `docs.myframework.com`)
3. Save documentation pages
4. Code examples and API references preserved

## Getting Help

### Support Resources

- **GitHub Issues**: Report bugs or request features
- **Extension Options**: Link to documentation
- **Browser Console**: View detailed error messages (F12 → Console)

### Before Reporting Issues

Please provide:
1. The URL of the page you're trying to save
2. Whether the site is in your allow list
3. Your Auto-Detect setting
4. Any error messages from the browser console
5. Screenshots if helpful

### Feature Requests

We welcome suggestions for:
- Additional default sites to include
- Improved code block detection heuristics
- UI/UX improvements
- Performance optimizations

## Frequently Asked Questions

**Q: Does this work on all websites?**
A: It works on any site you add to the allow list, or everywhere if Auto-Detect is enabled.

**Q: Will this slow down the extension?**
A: The performance impact is minimal (<100ms) on most pages. Only pages with many code blocks may see slight delays.

**Q: Can I use wildcards in domains?**
A: Yes, `*.github.io` matches all GitHub Pages sites.

**Q: What happens if I disable a default entry?**
A: The site remains in the list but code blocks won't be preserved. You can re-enable it anytime.

**Q: Can I export my allow list?**
A: Not currently, but this feature is planned for a future update.

**Q: Does this work with syntax highlighting?**
A: Yes, the extension recognizes code blocks with common syntax highlighting classes.

**Q: What if the code blocks are still being removed?**
A: Try enabling Auto-Detect mode, or ensure the site is correctly added to your allow list.

**Q: Can I preserve specific code blocks but not others?**
A: Not currently. The feature preserves all detected code blocks on allowed sites.

## Advanced Usage

### Debugging

Enable detailed logging:
1. Open browser DevTools (F12)
2. Go to Console tab
3. Filter for `[CodeBlock` to see relevant messages
4. Save a page and watch for log messages

Log messages include:
- `[CodeBlockSettings]` - Settings loading/saving
- `[CodeBlockDetection]` - Code block detection
- `[ReadabilityCodePreservation]` - Preservation process
- `[ArticleExtraction]` - Overall extraction flow

### Testing a Site

To test if preservation works on a new site:
1. Add the site to your allow list
2. Open browser console (F12)
3. Save a page from that site
4. Look for messages like:
   - `Code blocks detected: X`
   - `Applying code block preservation`
   - `Code blocks preserved successfully`

### Custom Patterns

For sites with unusual code block markup:
1. Report the site to us with examples
2. We can add custom detection patterns
3. Or enable Auto-Detect as a workaround

## What's Next?

Future enhancements planned:
- Import/export allow list
- Per-site preservation strength settings
- Code block syntax highlighting preservation
- Automatic site detection based on content
- Allow list sharing with other users

---

**Last Updated:** November 2025  
**Version:** 1.0.0
