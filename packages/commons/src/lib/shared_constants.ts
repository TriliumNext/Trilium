// Default list of allowed HTML tags
export const SANITIZER_DEFAULT_ALLOWED_TAGS = [
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "p", "a", "ul", "ol", "li", "b", "i", "strong", "em",
    "strike", "s", "del", "abbr", "code", "hr", "br", "div", "table", "thead", "caption", "tbody", "tfoot",
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
    'logseq', 'mid', 'obsidian'
];
