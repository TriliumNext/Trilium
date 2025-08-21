import sanitizeHtml from "sanitize-html";
import { sanitizeUrl } from "@braintree/sanitize-url";
import optionService from "./options.js";
import { SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";

// Be consistent with `ALLOWED_PROTOCOLS` in `src\public\app\services\link.js`
// TODO: Deduplicate with client once we can.
export const ALLOWED_PROTOCOLS = [
    'http', 'https', 'ftp', 'ftps', 'mailto', 'data', 'evernote', 'file', 'facetime', 'gemini', 'git',
    'gopher', 'imap', 'irc', 'irc6', 'jabber', 'jar', 'lastfm', 'ldap', 'ldaps', 'magnet', 'message',
    'mumble', 'nfs', 'onenote', 'pop', 'rmi', 's3', 'sftp', 'skype', 'sms', 'spotify', 'steam', 'svn', 'udp',
    'view-source', 'vlc', 'vnc', 'ws', 'wss', 'xmpp', 'jdbc', 'slack', 'tel', 'smb', 'zotero', 'geo',
    'mid'
];

// intended mainly as protection against XSS via import
// secondarily, it (partly) protects against "CSS takeover"
// sanitize also note titles, label values etc. - there are so many usages which make it difficult
// to guarantee all of them are properly handled
function sanitize(dirtyHtml: string) {
    if (!dirtyHtml) {
        return dirtyHtml;
    }

    // avoid H1 per https://github.com/zadam/trilium/issues/1552
    // demote H1, and if that conflicts with existing H2, demote that, etc
    const transformTags: Record<string, string> = {};
    const lowercasedHtml = dirtyHtml.toLowerCase();
    for (let i = 1; i < 6; ++i) {
        if (lowercasedHtml.includes(`<h${i}`)) {
            transformTags[`h${i}`] = `h${i + 1}`;
        } else {
            break;
        }
    }

    // Get allowed tags from options, with fallback to default list if option not yet set
    let allowedTags;
    try {
        allowedTags = JSON.parse(optionService.getOption("allowedHtmlTags"));
    } catch (e) {
        // Fallback to default list if option doesn't exist or is invalid
        allowedTags = SANITIZER_DEFAULT_ALLOWED_TAGS;
    }

    const colorRegex = [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/, /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/];
    const sizeRegex = [/^\d+\.?\d*(?:px|em|%)$/];

    // to minimize document changes, compress H
    return sanitizeHtml(dirtyHtml, {
        allowedTags,
        allowedAttributes: {
            "*": ["class", "style", "title", "src", "href", "hash", "disabled", "align", "alt", "center", "data-*"],
            input: ["type", "checked"],
            img: ["width", "height"]
        },
        allowedStyles: {
            "*": {
                color: colorRegex,
                "background-color": colorRegex
            },
            figure: {
                float: [/^\s*(left|right|none)\s*$/],
                width: sizeRegex,
                height: sizeRegex
            },
            img: {
                "aspect-ratio": [ /^\d+\/\d+$/ ],
                width: sizeRegex,
                height: sizeRegex
            },
            table: {
                "border-color": colorRegex,
                "border-style": [/^\s*(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)\s*$/]
            },
            td: {
                border: [
                    /^\s*\d+(?:px|em|%)\s*(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)\s*(#(0x)?[0-9a-fA-F]+|rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)|hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\))\s*$/
                ]
            },
            col: {
                width: sizeRegex
            }
        },
        selfClosing: [ "img", "br", "hr", "area", "base", "basefont", "input", "link", "meta", "col" ],
        allowedSchemes: ALLOWED_PROTOCOLS,
        nonTextTags: ["head"],
        transformTags
    });
}

export default {
    sanitize,
    sanitizeUrl: (url: string) => {
        return sanitizeUrl(url).trim();
    }
};
