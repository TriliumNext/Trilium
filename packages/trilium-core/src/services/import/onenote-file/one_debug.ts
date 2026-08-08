/**
 * Serializes a parsed OneNote page's object space to plain JSON, for the `.one` importer's debug mode —
 * attached as `OneNote source.json` on each imported page note, the offline counterpart of the Graph
 * importer's "attach original HTML".
 *
 * The dump is deliberately **id-driven, not name-driven**: every object and every property is emitted keyed
 * by its raw jcid / property id, and the parser's friendly names are only annotations. Nothing is filtered
 * by what the importer currently understands, because {@link ./one_parser.js} already parses *whole*
 * property sets — character and paragraph formatting, tables, note tags and outline geometry are sitting in
 * there unread, keyed by ids the `PROP` table doesn't name yet. Those are precisely what a future feature
 * needs to see, so they must survive into the dump.
 *
 * For the same reason binary payloads are base64'd in full rather than previewed: a truncated blob is
 * exactly how a run-formatting array would be lost. The one exception is embedded file data (images,
 * attachments), which is summarized by length — those bytes are already saved as real attachments on the
 * note, so re-encoding them here would only double the import's size.
 *
 * What a dump *cannot* show, because the parser drops it earlier: revisions other than the newest, objects
 * declared by FileNode types `parseObjectGroup` doesn't handle, and anything after a truncated FileNodeList.
 */

import { encodeBase64 } from "../../utils/binary.js";
import { decodeLatin1, decodeUtf16, JCID, type ObjectPropSet, type ObjectSpace, PROP, type Property, PT, refCounts } from "./one_parser.js";

export interface OnePageDump {
    /** Id (`guid:n`) of the object space this page was parsed from. */
    spaceId: string;
    /** Root object per root role, as declared by the revision manifest (role 1 is the page's default content). */
    roots: Record<number, string>;
    /** Object count per jcid, most frequent first — an index of what the page is made of, unnamed types included. */
    jcids: OneJcidCount[];
    objects: OneObjectDump[];
}

export interface OneJcidCount {
    jcid: string;
    name?: string;
    count: number;
}

export interface OneObjectDump {
    /** ExGuid key (`guid:n`), the id other objects reference this one by. */
    id: string;
    jcid: string;
    /** The parser's name for this jcid, when it has one — absent means "the parser doesn't know this type". */
    name?: string;
    props: OnePropertyDump[];
    /** Embedded file payload: its size and declared extension (the bytes themselves are a note attachment). */
    fileData?: { length: number; ext?: string };
}

export interface OnePropertyDump {
    /** The full 32-bit property id (type in the high bits), matching the parser's `PROP` constants. */
    id: string;
    /** The parser's name for this property, when it has one — absent means "not read by the importer yet". */
    name?: string;
    type: string;
    /** Value of a `Bool` property (carried by the property id's high bit). */
    bool?: boolean;
    /** Value of the fixed-width numeric types. */
    num?: number;
    data?: OneDataDump;
    /** Objects this property references, resolved in declaration order. */
    refs?: string[];
    /** Object spaces this property references (e.g. a page series' pages). */
    spaceRefs?: string[];
    /** How many context ids the property references; the parser doesn't retain the ids themselves. */
    contextRefs?: number;
    /** Properties of a nested `PropertySet`. */
    props?: OnePropertyDump[];
    /** One property list per element of an `ArrayOfPropertyValues`. */
    array?: OnePropertyDump[][];
}

export interface OneDataDump {
    length: number;
    /** The complete payload — never truncated, so the dump itself loses nothing. */
    base64: string;
    /** UTF-16LE rendering (how `RichEditTextUnicode` stores text), when the payload looks like text. */
    utf16?: string;
    /** Latin-1 rendering (how `TextExtendedAscii` stores text), when the payload looks like text. */
    latin1?: string;
}

/** Builds the JSON-serializable dump of a page's object space. */
export function dumpObjectSpace(space: ObjectSpace): OnePageDump {
    const objects: OneObjectDump[] = [];
    const jcidCounts = new Map<number, number>();

    for (const [id, object] of space.objects) {
        jcidCounts.set(object.jcid, (jcidCounts.get(object.jcid) ?? 0) + 1);
        objects.push({
            id,
            jcid: hex32(object.jcid),
            name: JCID_NAMES.get(object.jcid),
            props: dumpPropertySet(object.propSet, { oid: 0, osid: 0 }, object.propSet.set.props),
            ...(object.fileData ? { fileData: { length: object.fileData.length, ext: object.fileExt } } : {})
        });
    }

    return {
        spaceId: space.id,
        roots: Object.fromEntries(space.roots),
        jcids: [...jcidCounts]
            .map(([jcid, count]) => ({ jcid: hex32(jcid), name: JCID_NAMES.get(jcid), count }))
            .sort((a, b) => b.count - a.count || a.jcid.localeCompare(b.jcid)),
        objects
    };
}

/** Reverse lookups for the parser's tables. Property ids are keyed by their low 26 bits, the form parsed
 *  property ids carry; jcids and value types are whole values. */
const JCID_NAMES = new Map<number, string>(Object.entries(JCID).map(([name, value]) => [value as number, name]));
const PROP_NAMES = new Map<number, string>(Object.entries(PROP).map(([name, value]) => [(value as number) & 0x03ffffff, name]));
const PT_NAMES = new Map<number, string>(Object.entries(PT).map(([name, value]) => [value as number, name]));

/** Cursor into an object's flat reference arrays, consumed in property-declaration order. */
interface RefCursor {
    oid: number;
    osid: number;
}

/**
 * Dumps a property list, resolving reference properties against the owning object's id arrays. Those arrays
 * are flat: each reference property takes the next `refCount` entries, so the cursor advances in exactly the
 * order {@link refCounts} counts them — including through nested property sets, whose references the
 * parser's own accessors can't reach.
 */
function dumpPropertySet(owner: ObjectPropSet, cursor: RefCursor, props: Property[]): OnePropertyDump[] {
    return props.map((prop) => dumpProperty(owner, cursor, prop));
}

function dumpProperty(owner: ObjectPropSet, cursor: RefCursor, prop: Property): OnePropertyDump {
    const dump: OnePropertyDump = {
        id: hex32(((prop.type << 26) | prop.id) >>> 0),
        name: PROP_NAMES.get(prop.id),
        type: PT_NAMES.get(prop.type) ?? hex32(prop.type)
    };
    const { value } = prop;
    const count = value.refCount ?? 0;

    switch (value.type) {
        case PT.Bool:
            dump.bool = prop.bool;
            break;
        case PT.OneByte:
        case PT.TwoBytes:
        case PT.FourBytes:
        case PT.EightBytes:
            dump.num = value.num;
            break;
        case PT.LengthPrefixedData:
            if (value.data) {
                dump.data = dumpData(value.data);
            }
            break;
        case PT.ObjectID:
        case PT.ArrayOfObjectIDs:
            dump.refs = owner.objectIds.slice(cursor.oid, cursor.oid + count);
            cursor.oid += count;
            break;
        case PT.ObjectSpaceID:
        case PT.ArrayOfObjectSpaceIDs:
            dump.spaceRefs = owner.objectSpaceIds.slice(cursor.osid, cursor.osid + count);
            cursor.osid += count;
            break;
        case PT.ContextID:
        case PT.ArrayOfContextIDs:
            dump.contextRefs = count;
            break;
        case PT.PropertySet:
            if (value.props) {
                dump.props = dumpPropertySet(owner, cursor, value.props.props);
            }
            break;
        case PT.ArrayOfPropertyValues:
            if (value.array) {
                dump.array = value.array.map((entry) => dumpPropertySet(owner, cursor, entry.props));
            }
            break;
        default:
            // PT.NoData, and any type the parser starts retaining later: the id, name and type above are
            // still emitted, so a new value type shows up as a known property with no value rather than
            // vanishing from the dump.
            break;
    }

    return dump;
}

/**
 * Both text encodings the format uses are offered, rather than one guess: OneNote stores a run as UTF-16LE
 * (`RichEditTextUnicode`) *or* latin-1 (`TextExtendedAscii`) depending on its content, and the same bytes
 * read plausibly either way — "Test" in latin-1 decodes to a pair of valid CJK characters as UTF-16. Picking
 * for the reader would therefore hide half the text runs behind convincing gibberish.
 */
function dumpData(data: Uint8Array): OneDataDump {
    return {
        length: data.length,
        base64: encodeBase64(data),
        utf16: textPreview(data.length % 2 === 0 ? decodeUtf16(data) : ""),
        latin1: textPreview(decodeLatin1(data))
    };
}

const TEXT_PREVIEW_LIMIT = 500;
const PRINTABLE_RATIO = 0.9;

/**
 * Accepts a decoding that plausibly *is* text, so runs are readable at a glance; formatting and geometry
 * blobs decode to control-character soup and are rejected rather than dumped as noise. The test is
 * deliberately permissive about scripts (a note may legitimately be Chinese), so some binary payloads do
 * slip through as plausible-looking text — `base64` stays the authoritative copy either way.
 */
function textPreview(decoded: string): string | undefined {
    let printable = 0;
    let total = 0;
    for (const character of decoded) {
        const code = character.codePointAt(0) ?? 0;
        if (code === 9 || code === 10 || code === 13 || code >= 32) {
            printable++;
        }
        total++;
    }
    if (total === 0 || printable < total * PRINTABLE_RATIO) {
        return undefined;
    }
    return decoded.length > TEXT_PREVIEW_LIMIT ? `${decoded.slice(0, TEXT_PREVIEW_LIMIT)}…` : decoded;
}

function hex32(value: number): string {
    return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
