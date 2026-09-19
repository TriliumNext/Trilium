/**
 * @trilium-script
 *
 * id: carddav
 * type: backend
 * title: CardDAV Address Book Server
 * customRequestHandler: carddav(/.*)?
 */

/*
 * A CardDAV server implemented entirely as a Trilium backend script, exposing address book
 * notes to CardDAV clients (DAVx⁵, iOS/macOS Contacts, Thunderbird) at /custom/carddav/.
 *
 * Data model — "one note per contact":
 * - An address book is any note carrying #carddavAddressBook. One named "Contacts" is created
 *   under the root on first use, as a `book` collection with table view and inheritable
 *   promoted attribute definitions, so contacts edit nicely in the Trilium UI too.
 * - A contact is a child note of an address book. vCard properties map to labels (#email,
 *   #phone, #firstName, ...), FN maps to the note title and NOTE to the note content, so
 *   contacts are searchable (`#email *=* "@acme.com"`) and cloneable like any other note.
 *
 * Authentication: HTTP Basic. The password is the value of #carddavPassword on this script
 * note; the username is ignored. Requests are refused until that label is set.
 *
 * Protocol subset: OPTIONS, PROPFIND (depth 0/1), REPORT (addressbook-query and
 * addressbook-multiget), GET, PUT, DELETE — the set DAVx⁵ and Apple clients need for
 * two-way sync. No sync-collection REPORT (clients fall back to CTag polling) and no
 * /.well-known/carddav (scripts cannot register routes outside /custom, so the client must
 * be configured with the base URL directly).
 */

const BASE_PATH = "/custom/carddav";
const DAV_CAPABILITIES = "1, 3, addressbook";
const VCARD_CONTENT_TYPE = "text/vcard; charset=utf-8";
const XML_CONTENT_TYPE = "application/xml; charset=utf-8";
const ADDRESS_BOOK_LABEL = "carddavAddressBook";
const PASSWORD_LABEL = "carddavPassword";

/** vCard property name → contact note label, for single-valued properties. */
const SINGLE_VALUE_LABELS: Record<string, string> = {
    ORG: "organization",
    TITLE: "jobTitle",
    BDAY: "birthday",
    URL: "website"
};

/** vCard property name → contact note label, for properties that repeat. */
const MULTI_VALUE_LABELS: Record<string, string> = {
    EMAIL: "email",
    TEL: "phone"
};

/**
 * Properties handled structurally (not via the two maps above). Anything outside this set
 * and the maps is preserved verbatim in #vcardExtra so foreign clients' data survives a
 * round trip — except PHOTO, whose inline base64 payload is too large for an attribute.
 */
const STRUCTURAL_PROPERTIES = new Set([
    "BEGIN", "END", "VERSION", "PRODID", "REV", "UID", "FN", "N", "ADR", "NOTE", "CATEGORIES",
    "PHOTO"
]);

interface VCardProperty {
    name: string;
    params: string[];
    value: string;
    rawLine: string;
}

type ScriptNote = NonNullable<ReturnType<typeof api.getNote>>;

main();

function main() {
    const req = api.req;
    const res = api.res;

    if (!req || !res) {
        throw new Error("carddav: not invoked as a custom request handler");
    }

    res.setHeader("DAV", DAV_CAPABILITIES);

    try {
        if (!checkAuthorization()) {
            return;
        }
        dispatch();
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        api.log(`carddav: ${req.method} ${req.path} failed: ${message}`);
        if (!res.headersSent) {
            res.status(500).setHeader("Content-Type", "text/plain").send(message);
        }
    }
}

// ── Authentication ───────────────────────────────────────────────────────────

function checkAuthorization(): boolean {
    const req = api.req;
    const res = api.res;
    if (!req || !res) {
        return false;
    }

    if (req.method === "OPTIONS") {
        // Clients probe capabilities before authenticating.
        return true;
    }

    const expected = api.currentNote.getLabelValue(PASSWORD_LABEL);
    if (!expected) {
        res.status(403).setHeader("Content-Type", "text/plain")
            .send(`CardDAV is not configured: set #${PASSWORD_LABEL} on the script note.`);
        return false;
    }

    const header = req.headers.authorization ?? "";
    const [ scheme, encoded ] = header.split(" ");
    if (scheme?.toLowerCase() === "basic" && encoded) {
        const decoded = decodeBase64(encoded);
        const colon = decoded.indexOf(":");
        const password = colon === -1 ? decoded : decoded.slice(colon + 1);
        if (constantTimeEquals(password, expected)) {
            return true;
        }
    }

    res.status(401)
        .setHeader("WWW-Authenticate", 'Basic realm="Trilium CardDAV"')
        .setHeader("Content-Type", "text/plain")
        .send("Authentication required.");
    return false;
}

/**
 * Best-effort constant-time comparison. Scripts cannot require node:crypto (module
 * blocklist) and cannot await crypto.subtle (backend scripts are synchronous), so
 * timingSafeEqual is out of reach — this XOR fold is the scriptable approximation.
 */
function constantTimeEquals(a: string, b: string): boolean {
    let diff = a.length === b.length ? 0 : 1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        diff |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0)
            ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
    }
    return diff === 0;
}

function decodeBase64(encoded: string): string {
    // Scripts run in Node, where atob exists but Buffer decoding handles UTF-8 correctly.
    // Buffer is a global, so no blocked module import is needed.
    try {
        return Buffer.from(encoded, "base64").toString("utf-8");
    } catch {
        return "";
    }
}

// ── Routing ──────────────────────────────────────────────────────────────────

function dispatch() {
    const req = api.req;
    const res = api.res;
    if (!req || !res) {
        return;
    }

    const method = req.method.toUpperCase();
    const segments = req.path.slice(BASE_PATH.length).split("/").filter((s) => s.length > 0);

    if (method === "OPTIONS") {
        res.setHeader("Allow", "OPTIONS, PROPFIND, REPORT, GET, PUT, DELETE").status(200).send("");
        return;
    }

    // /custom/carddav[/]              → service root
    // /custom/carddav/principal/      → the (single) principal
    // /custom/carddav/addressbooks/   → address book home set
    // /custom/carddav/addressbooks/<bookNoteId>/            → one address book
    // /custom/carddav/addressbooks/<bookNoteId>/<name>.vcf  → one contact
    if (segments.length === 0) {
        handleServiceRoot(method);
    } else if (segments[0] === "principal" && segments.length === 1) {
        handlePrincipal(method);
    } else if (segments[0] === "addressbooks" && segments.length === 1) {
        handleHomeSet(method);
    } else if (segments[0] === "addressbooks" && segments.length === 2) {
        handleAddressBook(method, segments[1]);
    } else if (segments[0] === "addressbooks" && segments.length === 3) {
        handleContact(method, segments[1], segments[2]);
    } else {
        res.status(404).setHeader("Content-Type", "text/plain").send("Unknown CardDAV path.");
    }
}

function handleServiceRoot(method: string) {
    const res = api.res;
    if (!res) {
        return;
    }
    if (method !== "PROPFIND") {
        methodNotAllowed();
        return;
    }

    const props = requestedProperties();
    sendMultistatus([
        propfindResponse(`${BASE_PATH}/`, props, {
            "resourcetype": "<d:collection/>",
            "current-user-principal": href(`${BASE_PATH}/principal/`),
            "displayname": xmlEscape("Trilium CardDAV")
        })
    ]);
}

function handlePrincipal(method: string) {
    if (method !== "PROPFIND") {
        methodNotAllowed();
        return;
    }

    const props = requestedProperties();
    sendMultistatus([
        propfindResponse(`${BASE_PATH}/principal/`, props, {
            "resourcetype": "<d:collection/><d:principal/>",
            "current-user-principal": href(`${BASE_PATH}/principal/`),
            "principal-URL": href(`${BASE_PATH}/principal/`),
            "displayname": xmlEscape("Trilium user"),
            "addressbook-home-set": href(`${BASE_PATH}/addressbooks/`)
        })
    ]);
}

function handleHomeSet(method: string) {
    if (method !== "PROPFIND") {
        methodNotAllowed();
        return;
    }

    const props = requestedProperties();
    const responses = [
        propfindResponse(`${BASE_PATH}/addressbooks/`, props, {
            resourcetype: "<d:collection/>",
            displayname: xmlEscape("Address books")
        })
    ];

    if (depth() >= 1) {
        for (const book of getAddressBooks()) {
            responses.push(addressBookResponse(book, props));
        }
    }

    sendMultistatus(responses);
}

function handleAddressBook(method: string, bookNoteId: string) {
    const res = api.res;
    if (!res) {
        return;
    }

    const book = getAddressBooks().find((b) => b.noteId === bookNoteId);
    if (!book) {
        res.status(404).setHeader("Content-Type", "text/plain").send("No such address book.");
        return;
    }

    if (method === "PROPFIND") {
        const props = requestedProperties();
        const responses = [ addressBookResponse(book, props) ];
        if (depth() >= 1) {
            for (const contact of book.getChildNotes()) {
                responses.push(contactResponse(book, contact, props, false));
            }
        }
        sendMultistatus(responses);
    } else if (method === "REPORT") {
        handleReport(book);
    } else {
        methodNotAllowed();
    }
}

function handleReport(book: ScriptNote) {
    const res = api.res;
    const body = typeof api.req?.body === "string" ? api.req.body : "";
    if (!res) {
        return;
    }

    const parsed = body.trim() ? parseXml(body) : null;
    const rootName = parsed ? Object.keys(parsed)[0] : "";
    const root = parsed ? parsed[rootName] : null;
    const wantsAddressData = xmlRequestsAddressData(root);

    if (rootName === "addressbook-multiget") {
        const hrefs: string[] = collectXmlText(root, "href");
        const responses = hrefs.map((rawHref) => {
            const base = contactBasename(rawHref);
            const contact = base === null ? null : findContact(book, base);
            if (!contact) {
                return `<d:response>${href(normalizeHref(rawHref))}`
                    + "<d:status>HTTP/1.1 404 Not Found</d:status></d:response>";
            }
            const props = [ "getetag", ...(wantsAddressData ? [ "address-data" ] : []) ];
            return contactResponse(book, contact, props, wantsAddressData);
        });
        sendMultistatus(responses);
    } else if (rootName === "addressbook-query") {
        // Filters are not evaluated — the full collection is returned and the client narrows.
        const props = [ "getetag", ...(wantsAddressData ? [ "address-data" ] : []) ];
        const responses = book.getChildNotes().map((contact) =>
            contactResponse(book, contact, props, wantsAddressData));
        sendMultistatus(responses);
    } else {
        res.status(403).setHeader("Content-Type", XML_CONTENT_TYPE)
            .send(`<?xml version="1.0" encoding="utf-8"?>`
                + `<d:error xmlns:d="DAV:"><d:supported-report/></d:error>`);
    }
}

function handleContact(method: string, bookNoteId: string, filename: string) {
    const res = api.res;
    if (!res) {
        return;
    }

    const book = getAddressBooks().find((b) => b.noteId === bookNoteId);
    const base = filename.endsWith(".vcf") ? filename.slice(0, -4) : filename;
    if (!book || !base) {
        res.status(404).setHeader("Content-Type", "text/plain").send("No such address book.");
        return;
    }

    const contact = findContact(book, base);

    if (method === "GET" || method === "HEAD") {
        if (!contact) {
            res.status(404).setHeader("Content-Type", "text/plain").send("No such contact.");
            return;
        }
        res.status(200)
            .setHeader("Content-Type", VCARD_CONTENT_TYPE)
            .setHeader("ETag", contactEtag(contact))
            .send(method === "HEAD" ? "" : serializeContact(contact));
    } else if (method === "PUT") {
        handlePut(book, contact, base);
    } else if (method === "DELETE") {
        if (!contact) {
            res.status(404).setHeader("Content-Type", "text/plain").send("No such contact.");
            return;
        }
        api.transactional(() => contact.deleteNote());
        res.status(204).send("");
    } else if (method === "PROPFIND") {
        if (!contact) {
            res.status(404).setHeader("Content-Type", "text/plain").send("No such contact.");
            return;
        }
        sendMultistatus([ contactResponse(book, contact, requestedProperties(), false) ]);
    } else {
        methodNotAllowed();
    }
}

function handlePut(book: ScriptNote, existing: ScriptNote | null, base: string) {
    const req = api.req;
    const res = api.res;
    if (!req || !res) {
        return;
    }

    const body = typeof req.body === "string" ? req.body : "";
    if (!/BEGIN:VCARD/i.test(body)) {
        res.status(400).setHeader("Content-Type", "text/plain")
            .send("Request body is not a vCard.");
        return;
    }

    const ifMatch = req.headers["if-match"];
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch === "*" && existing) {
        res.status(412).setHeader("Content-Type", "text/plain").send("Contact already exists.");
        return;
    }
    const etagMismatch = !existing
        || stripWeakPrefix(ifMatch ?? "") !== stripWeakPrefix(contactEtag(existing));
    if (typeof ifMatch === "string" && etagMismatch) {
        res.status(412).setHeader("Content-Type", "text/plain").send("ETag mismatch.");
        return;
    }

    const properties = parseVCard(body);
    let contact: ScriptNote | null = existing;

    api.transactional(() => {
        if (!contact) {
            const created = api.createNewNote({
                parentNoteId: book.noteId,
                title: contactTitle(properties),
                content: "",
                type: "text"
            });
            contact = created.note as unknown as ScriptNote;
            contact.setLabel("carddavHref", base);
        }
        applyVCard(contact, properties, base);
    });

    if (!contact) {
        res.status(500).setHeader("Content-Type", "text/plain").send("Contact creation failed.");
        return;
    }

    res.status(existing ? 204 : 201)
        .setHeader("ETag", contactEtag(contact))
        .send("");
}

function methodNotAllowed() {
    api.res?.status(405)
        .setHeader("Allow", "OPTIONS, PROPFIND, REPORT, GET, PUT, DELETE")
        .setHeader("Content-Type", "text/plain")
        .send("Method not supported on this resource.");
}

// ── Address book and contact lookup ──────────────────────────────────────────

function getAddressBooks(): ScriptNote[] {
    const books = api.getNotesWithLabel(ADDRESS_BOOK_LABEL);
    if (books.length > 0) {
        return books;
    }
    return [ createDefaultAddressBook() ];
}

/**
 * First-use provisioning: a `book` collection with table view whose inheritable promoted
 * attribute definitions mirror the vCard mapping, so contacts synced from a phone edit
 * nicely in the Trilium UI (email/phone fields render mailto/tel action buttons).
 */
function createDefaultAddressBook(): ScriptNote {
    return api.transactional(() => {
        const { note } = api.createNewNote({
            parentNoteId: "root",
            title: "Contacts",
            content: "",
            type: "book"
        });
        const book = note as unknown as ScriptNote;
        book.setLabel(ADDRESS_BOOK_LABEL);
        book.setLabel("viewType", "table");
        book.setLabel("hidePromotedAttributes");
        const definitions: [string, string][] = [
            [ "label:firstName", "promoted,alias=First name,single,text" ],
            [ "label:lastName", "promoted,alias=Last name,single,text" ],
            [ "label:email", "promoted,alias=Email,multi,email" ],
            [ "label:phone", "promoted,alias=Phone,multi,phone" ],
            [ "label:organization", "promoted,alias=Organization,single,text" ],
            [ "label:jobTitle", "promoted,alias=Job title,single,text" ],
            [ "label:birthday", "promoted,alias=Birthday,single,date" ],
            [ "label:website", "promoted,alias=Website,single,url" ],
            [ "label:address", "promoted,alias=Address,single,text" ],
            [ "label:category", "promoted,alias=Groups,multi,text" ]
        ];
        for (const [ name, value ] of definitions) {
            attachInheritableLabel(book, name, value);
        }
        api.log(`carddav: created default address book note '${book.noteId}'`);
        return book;
    });
}

/**
 * setLabel() cannot create inheritable attributes, so definition labels go through the
 * underlying entity API. The cast reaches past ScriptBNote, which does not expose
 * addAttribute — one of the scripting gaps this prototype documents.
 */
function attachInheritableLabel(note: ScriptNote, name: string, value: string) {
    const entity = note as unknown as {
        addAttribute(type: string, name: string, value?: string, isInheritable?: boolean): unknown;
    };
    entity.addAttribute("label", name, value, true);
}

function findContact(book: ScriptNote, base: string): ScriptNote | null {
    const direct = api.getNote(base) as unknown as ScriptNote | null;
    if (direct && direct.getParentNotes().some((parent) => parent.noteId === book.noteId)) {
        return direct;
    }
    for (const child of book.getChildNotes()) {
        if (child.getLabelValue("carddavHref") === base
            || child.getLabelValue("vcardUid") === base) {
            return child;
        }
    }
    return null;
}

function contactHref(book: ScriptNote, contact: ScriptNote): string {
    const base = contact.getLabelValue("carddavHref") ?? contact.noteId;
    return `${BASE_PATH}/addressbooks/${book.noteId}/${encodeURIComponent(base)}.vcf`;
}

// ── ETag / CTag ──────────────────────────────────────────────────────────────

/**
 * Changes whenever the note's content (blobId), metadata (utcDateModified) or any owned
 * attribute changes — the three ways a contact can be edited from the Trilium side.
 */
function contactEtag(contact: ScriptNote): string {
    let fingerprint = `${contact.noteId}|${contact.utcDateModified}|${contact.blobId}`;
    for (const attribute of contact.getOwnedAttributes()) {
        fingerprint += `|${attribute.name}=${attribute.value}@${attribute.utcDateModified}`;
    }
    return `"${fnv1a(fingerprint)}"`;
}

function addressBookCtag(book: ScriptNote): string {
    let fingerprint = `${book.noteId}|${book.utcDateModified}`;
    for (const contact of book.getChildNotes()) {
        fingerprint += `|${contactEtag(contact)}`;
    }
    return fnv1a(fingerprint);
}

function fnv1a(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

function stripWeakPrefix(etag: string): string {
    return etag.startsWith("W/") ? etag.slice(2) : etag;
}

// ── PROPFIND / REPORT plumbing ───────────────────────────────────────────────

function depth(): number {
    const raw = api.req?.headers["depth"];
    if (raw === "0") {
        return 0;
    }
    return 1; // "1", "infinity" and a missing header all behave as 1 here.
}

/** Property names requested in the PROPFIND body; a default set when absent or allprop. */
function requestedProperties(): string[] {
    const body = typeof api.req?.body === "string" ? api.req.body : "";
    const fallback = [ "resourcetype", "displayname", "current-user-principal", "getetag",
        "getctag" ];
    if (!body.trim()) {
        return fallback;
    }
    try {
        const parsed = parseXml(body);
        const prop = parsed?.propfind?.prop?.[0];
        if (!prop || typeof prop !== "object") {
            return fallback;
        }
        return Object.keys(prop);
    } catch {
        return fallback;
    }
}

function propfindResponse(
    path: string, requested: string[], available: Record<string, string>
): string {
    const found: string[] = [];
    const missing: string[] = [];

    for (const name of requested) {
        if (name in available) {
            found.push(`<${qualify(name)}>${available[name]}</${qualify(name)}>`);
        } else {
            missing.push(`<${qualify(name)}/>`);
        }
    }

    let out = `<d:response>${href(path)}`;
    if (found.length > 0) {
        out += `<d:propstat><d:prop>${found.join("")}</d:prop>`
            + "<d:status>HTTP/1.1 200 OK</d:status></d:propstat>";
    }
    if (missing.length > 0) {
        out += `<d:propstat><d:prop>${missing.join("")}</d:prop>`
            + "<d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>";
    }
    return `${out}</d:response>`;
}

function addressBookResponse(book: ScriptNote, props: string[]): string {
    return propfindResponse(`${BASE_PATH}/addressbooks/${book.noteId}/`, props, {
        "resourcetype": "<d:collection/><card:addressbook/>",
        "displayname": xmlEscape(book.title),
        "getctag": addressBookCtag(book),
        "supported-report-set":
            "<d:supported-report><d:report><card:addressbook-query/></d:report>"
            + "</d:supported-report>"
            + "<d:supported-report><d:report><card:addressbook-multiget/></d:report>"
            + "</d:supported-report>",
        "supported-address-data":
            '<card:address-data-type content-type="text/vcard" version="3.0"/>',
        "current-user-privilege-set":
            "<d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege>",
        "addressbook-description": xmlEscape(book.title)
    });
}

function contactResponse(
    book: ScriptNote, contact: ScriptNote, props: string[], includeAddressData: boolean
): string {
    const available: Record<string, string> = {
        resourcetype: "",
        displayname: xmlEscape(contact.title),
        getetag: xmlEscape(contactEtag(contact)),
        getcontenttype: VCARD_CONTENT_TYPE
    };
    if (includeAddressData || props.includes("address-data")) {
        available["address-data"] = xmlEscape(serializeContact(contact));
    }
    return propfindResponse(contactHref(book, contact), props, available);
}

function sendMultistatus(responses: string[]) {
    const xml = `<?xml version="1.0" encoding="utf-8"?>` +
        `<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"`
        + ` xmlns:cs="http://calendarserver.org/ns/">` +
        responses.join("") +
        `</d:multistatus>`;
    api.res?.status(207).setHeader("Content-Type", XML_CONTENT_TYPE).send(xml);
}

/** Namespace-qualifies a property name for response XML. */
function qualify(name: string): string {
    const carddav = new Set([
        "addressbook-home-set", "address-data", "supported-address-data", "addressbook-description"
    ]);
    if (carddav.has(name)) {
        return `card:${name}`;
    }
    if (name === "getctag") {
        return "cs:getctag";
    }
    return `d:${name}`;
}

function href(path: string): string {
    return `<d:href>${xmlEscape(path)}</d:href>`;
}

function xmlEscape(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

/** Extracts the contact basename from a client-supplied href (absolute URLs included). */
function contactBasename(rawHref: string): string | null {
    const path = normalizeHref(rawHref);
    const match = path.match(/\/([^/]+)\.vcf$/);
    return match ? decodeURIComponent(match[1]) : null;
}

function normalizeHref(rawHref: string): string {
    return rawHref.replace(/^https?:\/\/[^/]+/, "");
}

/** xml2js invokes its callback synchronously (async:false default), so this works untangled. */
function parseXml(xml: string): Record<string, any> {
    let output: Record<string, any> | null = null;
    let failure: Error | null = null;
    api.xml2js.parseString(
        xml,
        { tagNameProcessors: [ api.xml2js.processors.stripPrefix ] },
        (err: Error | null, result: Record<string, any>) => {
            failure = err;
            output = result;
        }
    );
    if (failure) {
        throw failure;
    }
    if (!output) {
        throw new Error("XML parser did not complete synchronously.");
    }
    return output;
}

function xmlRequestsAddressData(root: any): boolean {
    const prop = root?.prop?.[0];
    return Boolean(prop && typeof prop === "object" && "address-data" in prop);
}

/** Depth-first search for all text nodes of the given (namespace-stripped) element name. */
function collectXmlText(node: any, name: string): string[] {
    const out: string[] = [];
    walk(node);
    return out;

    function walk(current: any) {
        if (current === null || typeof current !== "object") {
            return;
        }
        for (const [ key, value ] of Object.entries(current)) {
            if (key === name && Array.isArray(value)) {
                for (const entry of value) {
                    if (typeof entry === "string") {
                        out.push(entry);
                    } else if (entry && typeof entry === "object" && typeof entry._ === "string") {
                        out.push(entry._);
                    }
                }
            } else if (Array.isArray(value)) {
                value.forEach(walk);
            }
        }
    }
}

// ── vCard parsing ────────────────────────────────────────────────────────────

function parseVCard(text: string): VCardProperty[] {
    const unfolded = text.replace(/\r?\n[ \t]/g, "");
    const properties: VCardProperty[] = [];

    for (const line of unfolded.split(/\r?\n/)) {
        if (!line.trim()) {
            continue;
        }
        const colon = findUnescaped(line, ":");
        if (colon === -1) {
            continue;
        }
        const nameAndParams = line.slice(0, colon);
        const value = line.slice(colon + 1);
        const parts = splitUnescaped(nameAndParams, ";");
        // Group prefixes (item1.EMAIL) are stripped for mapping; the raw line keeps them.
        const bareName = parts[0].replace(/^[^.]+\./, "").toUpperCase();
        properties.push({ name: bareName, params: parts.slice(1), value, rawLine: line });
    }

    return properties;
}

function findUnescaped(text: string, char: string): number {
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "\\") {
            i++;
        } else if (text[i] === char) {
            return i;
        }
    }
    return -1;
}

function splitUnescaped(text: string, separator: string): string[] {
    const parts: string[] = [];
    let current = "";
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "\\" && i + 1 < text.length) {
            current += text[i] + text[i + 1];
            i++;
        } else if (text[i] === separator) {
            parts.push(current);
            current = "";
        } else {
            current += text[i];
        }
    }
    parts.push(current);
    return parts;
}

function unescapeValue(value: string): string {
    return value.replace(/\\(.)/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

function escapeValue(value: string): string {
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll("\n", "\\n")
        .replaceAll(",", "\\,")
        .replaceAll(";", "\\;");
}

// ── vCard ⇄ note mapping ─────────────────────────────────────────────────────

function contactTitle(properties: VCardProperty[]): string {
    const fn = properties.find((p) => p.name === "FN");
    if (fn && unescapeValue(fn.value).trim()) {
        return unescapeValue(fn.value).trim();
    }
    const n = properties.find((p) => p.name === "N");
    if (n) {
        const [ last = "", first = "" ] = splitUnescaped(n.value, ";").map(unescapeValue);
        const composed = `${first} ${last}`.trim();
        if (composed) {
            return composed;
        }
    }
    return "Unnamed contact";
}

function applyVCard(contact: ScriptNote, properties: VCardProperty[], base: string) {
    renameNote(contact, contactTitle(properties));

    const managed = [
        "firstName", "lastName", "address", "vcardUid", "vcardExtra",
        ...Object.values(SINGLE_VALUE_LABELS),
        ...Object.values(MULTI_VALUE_LABELS),
        "category"
    ];
    for (const label of managed) {
        for (const attribute of contact.getOwnedLabels(label)) {
            contact.removeLabel(label, attribute.value);
        }
    }

    const extras: string[] = [];

    for (const property of properties) {
        const single = SINGLE_VALUE_LABELS[property.name];
        const multi = MULTI_VALUE_LABELS[property.name];

        if (single) {
            const value = unescapeValue(property.value).trim();
            if (value) {
                const cleaned = property.name === "ORG" ? value.replace(/;+$/, "") : value;
                contact.setLabel(single, cleaned);
            }
        } else if (multi) {
            const value = unescapeValue(property.value).trim();
            if (value) {
                addLabelValue(contact, multi, value);
            }
        } else if (property.name === "N") {
            const [ last = "", first = "" ] = splitUnescaped(property.value, ";")
                .map((v) => unescapeValue(v).trim());
            if (first) {
                contact.setLabel("firstName", first);
            }
            if (last) {
                contact.setLabel("lastName", last);
            }
        } else if (property.name === "ADR") {
            const joined = splitUnescaped(property.value, ";")
                .map((v) => unescapeValue(v).trim())
                .filter((v) => v.length > 0)
                .join(", ");
            if (joined) {
                contact.setLabel("address", joined);
            }
        } else if (property.name === "CATEGORIES") {
            for (const category of splitUnescaped(property.value, ",")) {
                const value = unescapeValue(category).trim();
                if (value) {
                    addLabelValue(contact, "category", value);
                }
            }
        } else if (property.name === "NOTE") {
            const text = unescapeValue(property.value);
            const html = text.split("\n").map((line) => `<p>${api.escapeHtml(line)}</p>`).join("");
            contact.setContent(html);
        } else if (property.name === "UID") {
            contact.setLabel("vcardUid", unescapeValue(property.value).trim());
        } else if (!STRUCTURAL_PROPERTIES.has(property.name)) {
            extras.push(property.rawLine);
        }
    }

    if (!contact.getLabelValue("vcardUid")) {
        contact.setLabel("vcardUid", base);
    }
    if (extras.length > 0) {
        contact.setLabel("vcardExtra", encodeURIComponent(extras.join("\n")));
    }
}

/** setLabel() overwrites the first same-named label, so repeated values need the entity API. */
function addLabelValue(note: ScriptNote, name: string, value: string) {
    const entity = note as unknown as {
        addAttribute(type: string, name: string, value?: string): unknown;
    };
    entity.addAttribute("label", name, value);
}

/** ScriptBNote exposes a writable title but no save(); another documented typing gap. */
function renameNote(note: ScriptNote, title: string) {
    if (note.title === title) {
        return;
    }
    const entity = note as unknown as { title: string; save(): void };
    entity.title = title;
    entity.save();
}

function serializeContact(contact: ScriptNote): string {
    const lines: string[] = [ "BEGIN:VCARD", "VERSION:3.0",
        "PRODID:-//Trilium Notes//CardDAV script//EN" ];

    lines.push(`UID:${escapeValue(contact.getLabelValue("vcardUid") ?? contact.noteId)}`);
    lines.push(`FN:${escapeValue(contact.title)}`);

    const first = contact.getLabelValue("firstName") ?? "";
    const last = contact.getLabelValue("lastName") ?? "";
    lines.push(`N:${escapeValue(last)};${escapeValue(first)};;;`);

    for (const [ property, label ] of Object.entries(MULTI_VALUE_LABELS)) {
        for (const value of contact.getLabelValues(label)) {
            lines.push(`${property}:${escapeValue(value)}`);
        }
    }
    for (const [ property, label ] of Object.entries(SINGLE_VALUE_LABELS)) {
        const value = contact.getLabelValue(label);
        if (value) {
            lines.push(`${property}:${escapeValue(value)}`);
        }
    }

    const address = contact.getLabelValue("address");
    if (address) {
        lines.push(`ADR:;;${escapeValue(address)};;;;`);
    }

    const categories = contact.getLabelValues("category");
    if (categories.length > 0) {
        lines.push(`CATEGORIES:${categories.map(escapeValue).join(",")}`);
    }

    const noteText = plainTextContent(contact);
    if (noteText) {
        lines.push(`NOTE:${escapeValue(noteText)}`);
    }

    const extras = contact.getLabelValue("vcardExtra");
    if (extras) {
        for (const raw of decodeURIComponent(extras).split("\n")) {
            if (raw.trim()) {
                lines.push(raw);
            }
        }
    }

    lines.push(`REV:${revisionTimestamp(contact)}`);
    lines.push("END:VCARD");

    return lines.map(foldLine).join("\r\n") + "\r\n";
}

function plainTextContent(contact: ScriptNote): string {
    const content = contact.getContent();
    if (typeof content !== "string" || !content.trim()) {
        return "";
    }
    return api.unescapeHtml(
        content
            .replace(/<\/(p|div|li|h[1-6]|br)>/gi, "\n")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]*>/g, "")
    ).replace(/\n{2,}/g, "\n").trim();
}

/** utcDateModified ("2026-08-17 20:14:55.123Z") → iCal basic format (20260817T201455Z). */
function revisionTimestamp(contact: ScriptNote): string {
    const digits = contact.utcDateModified.replace(/[^0-9]/g, "").slice(0, 14);
    return `${digits.slice(0, 8)}T${digits.slice(8)}Z`;
}

/** RFC 6350 line folding at 75 octets (approximated as characters). */
function foldLine(line: string): string {
    if (line.length <= 75) {
        return line;
    }
    const chunks: string[] = [ line.slice(0, 75) ];
    for (let i = 75; i < line.length; i += 74) {
        chunks.push(" " + line.slice(i, i + 74));
    }
    return chunks.join("\r\n");
}
