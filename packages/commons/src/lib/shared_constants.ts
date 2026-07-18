// Default list of allowed HTML tags
export const SANITIZER_DEFAULT_ALLOWED_TAGS = [
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "p", "a", "ul", "ol", "li", "b", "i", "strong", "em",
    "u", "strike", "s", "del", "abbr", "code", "hr", "br", "div", "table", "thead", "caption", "tbody", "tfoot",
    "tr", "th", "td", "pre", "section", "img", "figure", "figcaption", "span", "label", "input", "details",
    "summary", "address", "aside", "footer", "header", "hgroup", "main", "nav", "dl", "dt", "menu", "bdi",
    "bdo", "dfn", "kbd", "mark", "q", "time", "var", "wbr", "area", "map", "track", "video", "audio", "picture",
    "del", "ins",
    // for ENEX import
    "en-media",
    // Additional tags (https://github.com/TriliumNext/Trilium/issues/567)
    "acronym", "article", "big", "button", "cite", "col", "colgroup", "data", "dd", "fieldset", "form", "legend",
    "meter", "noscript", "option", "progress", "rp", "samp", "small", "sub", "sup", "template", "textarea", "tt"
] as const;

export const ALLOWED_PROTOCOLS = [
    'http', 'https', 'ftp', 'ftps', 'mailto', 'data', 'evernote', 'file', 'facetime', 'gemini', 'git',
    'gopher', 'imap', 'irc', 'irc6', 'jabber', 'jar', 'lastfm', 'ldap', 'ldaps', 'magnet', 'message',
    'mumble', 'nfs', 'onenote', 'pop', 'rmi', 's3', 'sftp', 'skype', 'sms', 'spotify', 'steam', 'svn', 'udp',
    'view-source', 'vlc', 'vnc', 'ws', 'wss', 'xmpp', 'jdbc', 'slack', 'tel', 'smb', 'zotero', 'geo',
    'logseq', 'mid', 'obsidian', 'bookends', 'highlights'
];

// Subset of ALLOWED_PROTOCOLS that the main process will hand to
// electron.shell.openExternal. ALLOWED_PROTOCOLS gates DISPLAY (sanitizer /
// CKEditor); this list gates DISPATCH to the OS protocol handler. Derived
// by filtering rather than duplicating so the two stay in sync when
// ALLOWED_PROTOCOLS gains new entries.
//
// Excluded schemes:
//   - file        local-file launcher; routed separately via openFileUrl
//   - data        phishing / arbitrary HTML in the default browser
//   - smb         NTLM credential theft, SMB relay
//   - ldap/ldaps  NTLM relay, JNDI lookup vectors
//   - jar         Java loader RCE history
//   - view-source browser-internal, no value via shell dispatch
const SHELL_OPEN_EXTERNAL_BLOCKLIST = new Set([
    'file', 'data', 'smb', 'ldap', 'ldaps', 'jar', 'view-source'
]);
export const SHELL_OPEN_EXTERNAL_PROTOCOLS = ALLOWED_PROTOCOLS.filter(
    p => !SHELL_OPEN_EXTERNAL_BLOCKLIST.has(p)
);

// Session partition for <webview> guests (the Web View note type on desktop).
// Remote pages must not share the default session with the trilium-app://
// renderer: a separate partition gives them their own cookie jar, storage and
// protocol registry, so guest content can neither ride the app's session
// cookie nor resolve trilium-app:// URLs at all. `persist:` keeps the
// partition on disk so logins inside web views survive app restarts.
// Shared between the client (<webview partition=...>) and the desktop main
// process (session.fromPartition() for permission handlers).
export const WEBVIEW_SESSION_PARTITION = "persist:webview";

// Default per-device blob size limit (bytes) applied on mobile (Capacitor). Blobs whose content
// exceeds this are not pulled from the sync server — the client stores an empty-content stub and
// shows an "open on server" placeholder — to bound the peak memory of the WASM/native heap during
// sync. Other platforms default to 0 (no limit). See `syncMaxBlobContentSize`.
export const MOBILE_SYNC_MAX_BLOB_CONTENT_SIZE = 20 * 1024 * 1024;

// blobId of genuinely empty content, i.e. hashedBlobId(""). A blob row that carries empty content
// but a *different* blobId is a sync stub: its real content was withheld by the sync server because
// it exceeded the client's `syncMaxBlobContentSize`. Because `blobId` is content-derived, this
// distinguishes a withheld blob from a legitimately empty one with no extra stored state. The value
// is hard-coded (hashedBlobId needs the platform crypto provider, unavailable at module load in this
// browser-pure package) and guarded by a unit test asserting it equals hashedBlobId("").
export const EMPTY_BLOB_ID = "z4PhNX7vuL3xVChQ1m2A";
