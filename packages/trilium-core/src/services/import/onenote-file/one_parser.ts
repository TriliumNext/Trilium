/**
 * Minimal pure-TypeScript parser for the OneNote desktop `.one` / `.onetoc2` binary format
 * (MS-ONESTORE revision store + MS-ONE object model). Ported from the msiemens/onenote.rs reference,
 * scoped to extracting: page hierarchy, page titles, body text (rich-text runs), and embedded
 * images/files. No formatting/ink/tables yet — this is a spike.
 */

// ---------------------------------------------------------------------------------------------------
// Binary reader (little-endian)
// ---------------------------------------------------------------------------------------------------

class Reader {
    readonly view: DataView;
    pos: number;

    constructor(readonly bytes: Uint8Array, pos = 0) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.pos = pos;
    }

    get remaining(): number {
        return this.bytes.length - this.pos;
    }

    u8(): number {
        return this.view.getUint8(this.pos++);
    }
    u16(): number {
        const v = this.view.getUint16(this.pos, true);
        this.pos += 2;
        return v;
    }
    u32(): number {
        const v = this.view.getUint32(this.pos, true);
        this.pos += 4;
        return v;
    }
    u64(): number {
        const lo = this.u32();
        const hi = this.u32();
        return hi * 0x1_0000_0000 + lo;
    }
    bytesN(n: number): Uint8Array {
        const out = this.bytes.subarray(this.pos, this.pos + n);
        this.pos += n;
        return out;
    }
    skip(n: number): void {
        this.pos += n;
    }
    /** A sub-reader over an absolute [stp, stp+cb) window of the whole file. */
    at(stp: number, cb: number): Reader {
        return new Reader(this.bytes.subarray(stp, stp + cb));
    }
    guid(): string {
        // Microsoft mixed-endian: Data1 (u32 LE), Data2 (u16 LE), Data3 (u16 LE), Data4 (8 bytes as-is).
        const d1 = this.u32();
        const d2 = this.u16();
        const d3 = this.u16();
        const d4 = this.bytesN(8);
        const hex = (n: number, width: number) => n.toString(16).padStart(width, "0");
        const b = [...d4].map((x) => hex(x, 2));
        return `${hex(d1, 8)}-${hex(d2, 4)}-${hex(d3, 4)}-${b[0]}${b[1]}-${b[2]}${b[3]}${b[4]}${b[5]}${b[6]}${b[7]}`.toUpperCase();
    }
}

// ---------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------

const NIL_GUID = "00000000-0000-0000-0000-000000000000";
const GUID_FILE_TYPE_ONE = "7B5C52E4-D88C-4DA7-AEB1-5378D02996D3";
const GUID_FILE_TYPE_ONETOC2 = "43FF2FA1-EFD9-4C76-9EE2-10EA5722765F";
const GUID_FILE_FORMAT_REVISION_STORE = "109ADD3F-911B-49F5-A5D0-1791EDC8AED8";
const FILE_NODE_LIST_MAGIC_HI = 0xa4567ab1; // full magic 0xA4567AB1F5F7F4C4 (lo 0xF5F7F4C4)
const FILE_NODE_LIST_MAGIC_LO = 0xf5f7f4c4;
const FDO_HEADER_GUID = "BDE316E7-2665-4511-A4C4-8D4D0B7A9EAC";

// FileNode IDs (hex)
const FN = {
    ObjectSpaceManifestRootFND: 0x004,
    ObjectSpaceManifestListReferenceFND: 0x008,
    ObjectSpaceManifestListStartFND: 0x00c,
    RevisionManifestListReferenceFND: 0x010,
    RevisionManifestListStartFND: 0x014,
    RevisionManifestStart4FND: 0x01b,
    RevisionManifestEndFND: 0x01c,
    RevisionManifestStart6FND: 0x01e,
    RevisionManifestStart7FND: 0x01f,
    GlobalIdTableStartFNDX: 0x021,
    GlobalIdTableStart2FND: 0x022,
    GlobalIdTableEntryFNDX: 0x024,
    GlobalIdTableEntry2FNDX: 0x025,
    GlobalIdTableEntry3FNDX: 0x026,
    GlobalIdTableEndFNDX: 0x028,
    ObjectDeclarationWithRefCountFNDX: 0x02d,
    ObjectDeclarationWithRefCount2FNDX: 0x02e,
    ObjectRevisionWithRefCountFNDX: 0x041,
    ObjectRevisionWithRefCount2FNDX: 0x042,
    RootObjectReference2FNDX: 0x059,
    RootObjectReference3FND: 0x05a,
    ObjectDeclarationFileData3RefCountFND: 0x072,
    ObjectDeclarationFileData3LargeRefCountFND: 0x073,
    ObjectInfoDependencyOverridesFND: 0x084,
    FileDataStoreListReferenceFND: 0x090,
    FileDataStoreObjectReferenceFND: 0x094,
    ObjectDeclaration2RefCountFND: 0x0a4,
    ObjectDeclaration2LargeRefCountFND: 0x0a5,
    ObjectGroupListReferenceFND: 0x0b0,
    ObjectGroupStartFND: 0x0b4,
    ObjectGroupEndFND: 0x0b8,
    ReadOnlyObjectDeclaration2RefCountFND: 0x0c4,
    ReadOnlyObjectDeclaration2LargeRefCountFND: 0x0c5,
    ChunkTerminatorFND: 0x0ff
} as const;

// JCIDs
const JCID = {
    SectionNode: 0x00060007,
    PageSeriesNode: 0x00060008,
    PageMetadata: 0x00020030,
    PageManifestNode: 0x00060037,
    PageNode: 0x0006000b,
    TitleNode: 0x0006002c,
    OutlineNode: 0x0006000c,
    OutlineElementNode: 0x0006000d,
    OutlineGroup: 0x00060019,
    RichTextNode: 0x0006000e,
    ImageNode: 0x00060011,
    PictureContainer: 0x00080039,
    XpsContainer: 0x0008003a,
    EmbeddedFileNode: 0x00060035,
    EmbeddedFileContainer: 0x00080036,
    TocContainer: 0x00020001
} as const;

// Property IDs (full 32-bit values, type encoded in high bits)
const PROP = {
    ElementChildNodes: 0x24001c20, // ArrayOfObjectIDs
    ChildGraphSpaceElementNodes: 0x2c001d63, // ArrayOfObjectSpaceIDs
    MetaDataObjectsAboveGraphSpace: 0x24003442, // ArrayOfObjectIDs (XOR seed)
    ContentChildNodes: 0x24001c1f, // ArrayOfObjectIDs
    StructureElementChildNodes: 0x24001d5f, // ArrayOfObjectIDs
    OutlineElementChildLevel: 0x0c001c03, // u8
    PageLevel: 0x14001dff, // u32
    CachedTitleString: 0x1c001cf3,
    CachedTitleStringFromPage: 0x1c001d3c,
    RichEditTextUnicode: 0x1c001c22, // UTF-16LE
    TextExtendedAscii: 0x1c003498, // latin-1
    PictureContainer: 0x20001c3f, // ObjectID
    ImageFilename: 0x1c001dd7,
    EmbeddedFileContainer: 0x20001d9b, // ObjectID
    EmbeddedFileName: 0x1c001d9c
} as const;

// Property value type nibble (5 bits)
const PT = {
    NoData: 0x1,
    Bool: 0x2,
    OneByte: 0x3,
    TwoBytes: 0x4,
    FourBytes: 0x5,
    EightBytes: 0x6,
    LengthPrefixedData: 0x7,
    ObjectID: 0x8,
    ArrayOfObjectIDs: 0x9,
    ObjectSpaceID: 0xa,
    ArrayOfObjectSpaceIDs: 0xb,
    ContextID: 0xc,
    ArrayOfContextIDs: 0xd,
    ArrayOfPropertyValues: 0x10,
    PropertySet: 0x11
} as const;

// ---------------------------------------------------------------------------------------------------
// Chunk references
// ---------------------------------------------------------------------------------------------------

interface Fcr {
    stp: number;
    cb: number;
    nil: boolean;
}

function readFcr64x32(r: Reader): Fcr {
    const stpLo = r.u32();
    const stpHi = r.u32();
    const stp = stpHi * 0x1_0000_0000 + stpLo;
    const cb = r.u32();
    const nil = (stpHi === 0xffffffff && stpLo === 0xffffffff && cb === 0) || (stp === 0 && cb === 0);
    return { stp, cb, nil };
}

/** FileNodeChunkReference — width driven by StpFormat/CbFormat from the FileNode header. */
function readFileNodeChunkReference(r: Reader, stpFormat: number, cbFormat: number): Fcr {
    let stp: number;
    let stpNil: boolean;
    switch (stpFormat) {
        case 0: {
            const lo = r.u32();
            const hi = r.u32();
            stp = hi * 0x1_0000_0000 + lo;
            stpNil = hi === 0xffffffff && lo === 0xffffffff;
            break;
        }
        case 1:
            stp = r.u32();
            stpNil = stp === 0xffffffff;
            break;
        case 2:
            stp = r.u16() * 8;
            stpNil = stp === 0xffff * 8;
            break;
        default:
            stp = r.u32() * 8;
            stpNil = stp === 0xffffffff * 8;
            break;
    }
    let cb: number;
    switch (cbFormat) {
        case 0:
            cb = r.u32();
            break;
        case 1:
            cb = r.u64();
            break;
        case 2:
            cb = r.u8() * 8;
            break;
        default:
            cb = r.u16() * 8;
            break;
    }
    return { stp, cb, nil: stpNil && cb === 0 };
}

// ---------------------------------------------------------------------------------------------------
// FileNode + FileNodeList
// ---------------------------------------------------------------------------------------------------

interface CompactId {
    n: number;
    guidIndex: number;
}

function readCompactId(r: Reader): CompactId {
    const v = r.u32();
    return { n: v & 0xff, guidIndex: v >>> 8 };
}

interface FileNode {
    id: number;
    baseType: number;
    /** BaseType 1/2 target reference. */
    ref?: Fcr;
    /** Raw reader positioned at the inline payload (after the header + ref). */
    payload: Reader;
    size: number;
}

/** Parse one FileNode starting at r.pos; leaves r.pos at nodeStart + size. */
function parseFileNode(r: Reader): FileNode | null {
    const nodeStart = r.pos;
    const header = r.u32();
    const id = header & 0x3ff;
    const size = (header >>> 10) & 0x1fff;
    const stpFormat = (header >>> 23) & 0x3;
    const cbFormat = (header >>> 25) & 0x3;
    const baseType = (header >>> 27) & 0xf;

    if (id === 0) {
        // Null node — the ChunkTerminator (0x0FF) has size 0 too, so guard on size.
        r.pos = nodeStart + Math.max(size, 4);
        return null;
    }

    let ref: Fcr | undefined;
    if (baseType === 1 || baseType === 2) {
        ref = readFileNodeChunkReference(r, stpFormat, cbFormat);
    }
    const payload = new Reader(r.bytes, r.pos);
    r.pos = nodeStart + size; // consume the exact declared node size
    return { id, baseType, ref, payload, size };
}

interface ParseCtx {
    file: Reader;
    /** FileNodeListID -> node count, from the transaction log. */
    nodeCounts: Map<number, number>;
}

/** Parse a (possibly multi-fragment) FileNodeList given the chunk reference to its first fragment. */
function parseFileNodeList(ctx: ParseCtx, fcr: Fcr): FileNode[] {
    const nodes: FileNode[] = [];
    let current: Fcr | null = fcr;
    let listId = -1;
    let remaining = Infinity;
    let expectedSeq = 0;

    while (current && !current.nil) {
        const r = ctx.file.at(current.stp, current.cb);
        const magicLo = r.u32();
        const magicHi = r.u32();
        if (magicLo !== FILE_NODE_LIST_MAGIC_LO || magicHi !== FILE_NODE_LIST_MAGIC_HI) {
            throw new Error(`Bad FileNodeListFragment magic at ${current.stp}: ${magicHi.toString(16)}${magicLo.toString(16)}`);
        }
        const fragListId = r.u32();
        const seq = r.u32();
        if (listId === -1) {
            listId = fragListId;
            remaining = ctx.nodeCounts.get(listId) ?? Infinity;
        }
        if (seq !== expectedSeq) {
            // Tolerate but stop if fragments are out of order.
            break;
        }
        expectedSeq++;

        // Nodes fill until 36 bytes (16 header + 12 nextFragment + 8 footer) before the end.
        const nodesEnd = current.cb - 12 - 8;
        while (r.pos + 4 <= nodesEnd && remaining > 0) {
            const before = r.pos;
            const node = parseFileNode(r);
            if (r.pos <= before) {
                break; // safety: no progress
            }
            if (node) {
                if (node.id === FN.ChunkTerminatorFND) {
                    break;
                }
                nodes.push(node);
                remaining--;
            }
        }

        r.pos = nodesEnd;
        const next = readFcr64x32(r);
        current = next.nil ? null : next;
    }

    return nodes;
}

// ---------------------------------------------------------------------------------------------------
// Header + transaction log
// ---------------------------------------------------------------------------------------------------

interface OneHeader {
    isOne: boolean;
    isTocorSection: boolean;
    fcrFileNodeListRoot: Fcr;
    fcrTransactionLog: Fcr;
}

function parseHeader(file: Reader): OneHeader {
    const r = new Reader(file.bytes, 0);
    const guidFileType = r.guid();
    r.guid(); // guidFile
    const guidLegacyFileVersion = r.guid();
    const guidFileFormat = r.guid();
    if (guidFileFormat !== GUID_FILE_FORMAT_REVISION_STORE) {
        throw new Error(`Not a revision-store OneNote file (guidFileFormat=${guidFileFormat})`);
    }
    if (guidLegacyFileVersion !== NIL_GUID) {
        throw new Error("FSSHTTPB/legacy OneNote files are not supported by this parser");
    }
    const isOne = guidFileType === GUID_FILE_TYPE_ONE;
    const isTocorSection = isOne || guidFileType === GUID_FILE_TYPE_ONETOC2;

    // fcrTransactionLog (FileChunkReference64x32) at offset 160; fcrFileNodeListRoot at 172.
    const rt = new Reader(file.bytes, 160);
    const fcrTransactionLog = readFcr64x32(rt);
    const fcrFileNodeListRoot = readFcr64x32(rt);
    return { isOne, isTocorSection, fcrFileNodeListRoot, fcrTransactionLog };
}

/** Parse the transaction log chain to learn each FileNodeList's node count. */
function parseTransactionLog(file: Reader, fcr: Fcr): Map<number, number> {
    const counts = new Map<number, number>();
    let current: Fcr | null = fcr;
    while (current && !current.nil) {
        const r = file.at(current.stp, current.cb);
        const entriesEnd = current.cb - 12; // trailing nextFragment (FileChunkReference64x32)
        while (r.pos + 8 <= entriesEnd) {
            const srcId = r.u32();
            const value = r.u32();
            if (srcId === 1) {
                continue; // transaction boundary sentinel (value is a CRC, not a count)
            }
            counts.set(srcId, value); // last transaction wins → current node count
        }
        r.pos = entriesEnd;
        const next = readFcr64x32(r);
        current = next.nil ? null : next;
    }
    return counts;
}

// ---------------------------------------------------------------------------------------------------
// Property sets
// ---------------------------------------------------------------------------------------------------

interface PropertyValue {
    type: number;
    // primitives
    num?: number;
    data?: Uint8Array;
    // nested
    props?: PropertySet;
    array?: PropertySet[];
    // array-count for object/object-space id references
    refCount?: number;
}

interface Property {
    id: number;
    type: number;
    bool: boolean;
    value: PropertyValue;
}

interface PropertySet {
    props: Property[];
}

interface ObjectPropSet {
    objectIds: string[]; // resolved ExGuid keys (guid:n)
    objectSpaceIds: string[];
    set: PropertySet;
}

function parsePropertyValue(r: Reader, type: number): PropertyValue {
    switch (type) {
        case PT.NoData:
        case PT.Bool:
            return { type };
        case PT.OneByte:
            return { type, num: r.u8() };
        case PT.TwoBytes:
            return { type, num: r.u16() };
        case PT.FourBytes:
            return { type, num: r.u32() };
        case PT.EightBytes:
            return { type, num: r.u64() };
        case PT.LengthPrefixedData: {
            const len = r.u32();
            return { type, data: r.bytesN(len) };
        }
        case PT.ObjectID:
            return { type, refCount: 1 };
        case PT.ArrayOfObjectIDs: {
            const count = r.u32();
            return { type, refCount: count };
        }
        case PT.ObjectSpaceID:
            return { type, refCount: 1 };
        case PT.ArrayOfObjectSpaceIDs: {
            const count = r.u32();
            return { type, refCount: count };
        }
        case PT.ContextID:
            return { type, refCount: 1 };
        case PT.ArrayOfContextIDs: {
            const count = r.u32();
            return { type, refCount: count };
        }
        case PT.ArrayOfPropertyValues: {
            const count = r.u32();
            if (count === 0) {
                return { type, array: [] };
            }
            const proto = readPropertyId(r);
            const array: PropertySet[] = [];
            for (let i = 0; i < count; i++) {
                array.push(parsePropertySetBody(r, [proto]));
            }
            return { type, array };
        }
        case PT.PropertySet:
            return { type, props: parsePropertySet(r) };
        default:
            throw new Error(`Unknown property value type 0x${type.toString(16)}`);
    }
}

interface PropId {
    id: number;
    type: number;
    bool: boolean;
}

function readPropertyId(r: Reader): PropId {
    const v = r.u32();
    return { id: v & 0x03ffffff, type: (v >>> 26) & 0x1f, bool: v >>> 31 === 1 };
}

/** Parse a PropertySet whose PropertyIDs are already known (used by ArrayOfPropertyValues). */
function parsePropertySetBody(r: Reader, ids: PropId[]): PropertySet {
    const props: Property[] = [];
    for (const pid of ids) {
        props.push({ id: pid.id, type: pid.type, bool: pid.bool, value: parsePropertyValue(r, pid.type) });
    }
    return { props };
}

/** Parse a full PropertySet: u16 count, then ids, then values. */
function parsePropertySet(r: Reader): PropertySet {
    const count = r.u16();
    const ids: PropId[] = [];
    for (let i = 0; i < count; i++) {
        ids.push(readPropertyId(r));
    }
    return parsePropertySetBody(r, ids);
}

interface StreamHeader {
    count: number;
    extended: boolean;
    osidNotPresent: boolean;
}

function readStreamHeader(r: Reader): StreamHeader {
    const v = r.u32();
    return { count: v & 0xffffff, extended: ((v >>> 30) & 1) === 1, osidNotPresent: v >>> 31 === 1 };
}

/** Parse an ObjectSpaceObjectPropSet from a chunk region, resolving CompactIds via the id table. */
function parseObjectPropSet(r: Reader, idTable: Map<number, string>): ObjectPropSet {
    const readIds = (h: StreamHeader): string[] => {
        const out: string[] = [];
        for (let i = 0; i < h.count; i++) {
            out.push(resolveCompact(readCompactId(r), idTable));
        }
        return out;
    };

    const oidHeader = readStreamHeader(r);
    const objectIds = readIds(oidHeader);
    let objectSpaceIds: string[] = [];
    if (!oidHeader.osidNotPresent) {
        const osidHeader = readStreamHeader(r);
        objectSpaceIds = readIds(osidHeader);
        if (osidHeader.extended) {
            const ctxHeader = readStreamHeader(r);
            readIds(ctxHeader); // context ids — parsed but unused
        }
    }
    const set = parsePropertySet(r);
    return { objectIds, objectSpaceIds, set };
}

function resolveCompact(cid: CompactId, idTable: Map<number, string>): string {
    if (cid.n === 0 && cid.guidIndex === 0) {
        return `${NIL_GUID}:0`;
    }
    const guid = idTable.get(cid.guidIndex);
    if (!guid) {
        return `<unresolved:${cid.guidIndex}>:${cid.n}`;
    }
    return `${guid}:${cid.n}`;
}

// ---------------------------------------------------------------------------------------------------
// Object graph
// ---------------------------------------------------------------------------------------------------

interface OneObject {
    jcid: number;
    propSet: ObjectPropSet;
    fileData?: Uint8Array;
    fileExt?: string;
}

interface ObjectSpace {
    id: string; // gsoid guid:n
    objects: Map<string, OneObject>;
    roots: Map<number, string>; // rootRole -> object ExGuid key
}

const XOR_SEED_GUID = "22A8C031-3600-42EE-B714-D7ACDA2435E8";

/** Reads an inline ExtendedGUID (20 bytes) from a payload reader. */
function readExGuid(r: Reader): string {
    const guid = r.guid();
    const value = r.u32();
    return `${guid}:${value}`;
}

/** StringInStorageBuffer: u32 char count (UTF-16), then that many UTF-16LE code units. */
function readStringInStorageBuffer(r: Reader): string {
    const cch = r.u32();
    const bytes = r.bytesN(cch * 2);
    return decodeUtf16(bytes);
}

function decodeUtf16(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = bytes[i] | (bytes[i + 1] << 8);
        if (code === 0) {
            break;
        }
        s += String.fromCharCode(code);
    }
    return s;
}

interface FileDataStore {
    byGuid: Map<string, Uint8Array>;
}

function parseFileDataStore(ctx: ParseCtx, rootNodes: FileNode[]): FileDataStore {
    const byGuid = new Map<string, Uint8Array>();
    for (const node of rootNodes) {
        if (node.id !== FN.FileDataStoreListReferenceFND || !node.ref) {
            continue;
        }
        const list = parseFileNodeList(ctx, node.ref);
        for (const entry of list) {
            if (entry.id !== FN.FileDataStoreObjectReferenceFND || !entry.ref) {
                continue;
            }
            const guid = entry.payload.guid(); // inline file GUID
            const obj = ctx.file.at(entry.ref.stp, entry.ref.cb);
            const headerGuid = obj.guid();
            if (headerGuid !== FDO_HEADER_GUID) {
                continue;
            }
            const cbLength = obj.u64();
            obj.u32(); // unused
            obj.u64(); // reserved
            const data = obj.bytesN(cbLength);
            byGuid.set(guid, data);
        }
    }
    return { byGuid };
}

/** Resolves a `<ifndf>{GUID}` file-data reference to bytes. */
function resolveFileData(dataRef: string, store: FileDataStore): Uint8Array | undefined {
    const m = dataRef.match(/\{([0-9A-Fa-f-]{36})\}/);
    if (!m) {
        return undefined;
    }
    return store.byGuid.get(m[1].toUpperCase());
}

/** Parse the whole store into a map of object-space id -> ObjectSpace. */
function parseObjectSpaces(ctx: ParseCtx, rootNodes: FileNode[], store: FileDataStore): { spaces: Map<string, ObjectSpace>; rootSpaceId: string } {
    let rootSpaceId = "";
    const spaces = new Map<string, ObjectSpace>();

    for (const node of rootNodes) {
        if (node.id === FN.ObjectSpaceManifestRootFND) {
            rootSpaceId = readExGuid(node.payload);
        }
    }

    for (const node of rootNodes) {
        if (node.id !== FN.ObjectSpaceManifestListReferenceFND || !node.ref) {
            continue;
        }
        const gosid = readExGuid(node.payload);
        const manifestList = parseFileNodeList(ctx, node.ref);

        // Take the LAST revision manifest list reference (current revision).
        let lastRevRef: Fcr | undefined;
        for (const m of manifestList) {
            if (m.id === FN.RevisionManifestListReferenceFND && m.ref) {
                lastRevRef = m.ref;
            }
        }
        if (!lastRevRef) {
            continue;
        }
        const space: ObjectSpace = { id: gosid, objects: new Map(), roots: new Map() };
        const revList = parseFileNodeList(ctx, lastRevRef);
        parseRevisionList(ctx, revList, space, store);
        spaces.set(gosid, space);
    }

    return { spaces, rootSpaceId };
}

function parseRevisionList(ctx: ParseCtx, nodes: FileNode[], space: ObjectSpace, store: FileDataStore): void {
    let idTable = new Map<number, string>();
    for (const node of nodes) {
        switch (node.id) {
            case FN.GlobalIdTableStartFNDX:
            case FN.GlobalIdTableStart2FND:
                idTable = new Map();
                break;
            case FN.GlobalIdTableEntryFNDX: {
                const index = node.payload.u32();
                const guid = node.payload.guid();
                idTable.set(index, guid);
                break;
            }
            case FN.ObjectGroupListReferenceFND:
                if (node.ref) {
                    parseObjectGroup(ctx, parseFileNodeList(ctx, node.ref), space, idTable, store);
                }
                break;
            case FN.RootObjectReference3FND: {
                const oid = readExGuid(node.payload);
                const role = node.payload.u32();
                if (!space.roots.has(role)) {
                    space.roots.set(role, oid);
                }
                break;
            }
            case FN.RootObjectReference2FNDX: {
                const oid = resolveCompact(readCompactId(node.payload), idTable);
                const role = node.payload.u32();
                if (!space.roots.has(role)) {
                    space.roots.set(role, oid);
                }
                break;
            }
            default:
                break;
        }
    }
}

function parseObjectGroup(ctx: ParseCtx, nodes: FileNode[], space: ObjectSpace, revIdTable: Map<number, string>, store: FileDataStore): void {
    let idTable = new Map(revIdTable);
    for (const node of nodes) {
        switch (node.id) {
            case FN.GlobalIdTableStartFNDX:
            case FN.GlobalIdTableStart2FND:
                idTable = new Map();
                break;
            case FN.GlobalIdTableEntryFNDX: {
                const index = node.payload.u32();
                const guid = node.payload.guid();
                idTable.set(index, guid);
                break;
            }
            case FN.ObjectDeclaration2RefCountFND:
            case FN.ObjectDeclaration2LargeRefCountFND:
            case FN.ReadOnlyObjectDeclaration2RefCountFND:
            case FN.ReadOnlyObjectDeclaration2LargeRefCountFND: {
                if (!node.ref) {
                    break;
                }
                const oid = resolveCompact(readCompactId(node.payload), idTable);
                const jcid = node.payload.u32();
                const propSet = parseObjectPropSet(ctx.file.at(node.ref.stp, node.ref.cb), idTable);
                space.objects.set(oid, { jcid, propSet });
                break;
            }
            case FN.ObjectDeclarationWithRefCountFNDX:
            case FN.ObjectDeclarationWithRefCount2FNDX: {
                if (!node.ref) {
                    break;
                }
                const oid = resolveCompact(readCompactId(node.payload), idTable);
                const packed = node.payload.u32();
                const jci = packed & 0x3ff;
                const jcid = jci | 0x20000;
                const propSet = parseObjectPropSet(ctx.file.at(node.ref.stp, node.ref.cb), idTable);
                space.objects.set(oid, { jcid, propSet });
                break;
            }
            case FN.ObjectRevisionWithRefCountFNDX:
            case FN.ObjectRevisionWithRefCount2FNDX: {
                if (!node.ref) {
                    break;
                }
                const oid = resolveCompact(readCompactId(node.payload), idTable);
                const propSet = parseObjectPropSet(ctx.file.at(node.ref.stp, node.ref.cb), idTable);
                const existing = space.objects.get(oid);
                if (existing) {
                    existing.propSet = propSet;
                } else {
                    space.objects.set(oid, { jcid: 0, propSet });
                }
                break;
            }
            case FN.ObjectDeclarationFileData3RefCountFND:
            case FN.ObjectDeclarationFileData3LargeRefCountFND: {
                const oid = resolveCompact(readCompactId(node.payload), idTable);
                const jcid = node.payload.u32();
                const isLarge = node.id === FN.ObjectDeclarationFileData3LargeRefCountFND;
                if (isLarge) {
                    node.payload.u32(); // cRef (u32)
                } else {
                    node.payload.u8(); // cRef (u8)
                }
                const dataRef = readStringInStorageBuffer(node.payload);
                const fileExt = readStringInStorageBuffer(node.payload);
                const fileData = resolveFileData(dataRef, store);
                space.objects.set(oid, { jcid, propSet: { objectIds: [], objectSpaceIds: [], set: { props: [] } }, fileData, fileExt });
                break;
            }
            default:
                break;
        }
    }
}

// ---------------------------------------------------------------------------------------------------
// High-level property accessors
// ---------------------------------------------------------------------------------------------------

function findProp(obj: OneObject, propId: number): Property | undefined {
    // Match on the id field (low 26 bits) so encoded-type differences don't matter.
    const wantId = propId & 0x03ffffff;
    return obj.propSet.set.props.find((p) => p.id === wantId);
}

function refCounts(value: PropertyValue): { oid: number; osid: number } {
    let oid = 0;
    let osid = 0;
    if (value.type === PT.ObjectID || value.type === PT.ArrayOfObjectIDs) {
        oid += value.refCount ?? 0;
    } else if (value.type === PT.ObjectSpaceID || value.type === PT.ArrayOfObjectSpaceIDs) {
        osid += value.refCount ?? 0;
    } else if (value.type === PT.PropertySet && value.props) {
        for (const p of value.props.props) {
            const c = refCounts(p.value);
            oid += c.oid;
            osid += c.osid;
        }
    } else if (value.type === PT.ArrayOfPropertyValues && value.array) {
        for (const ps of value.array) {
            for (const p of ps.props) {
                const c = refCounts(p.value);
                oid += c.oid;
                osid += c.osid;
            }
        }
    }
    return { oid, osid };
}

/** Resolve an object-id-reference property to the referenced object ExGuid keys. */
function objectRefs(obj: OneObject, propId: number): string[] {
    const wantId = propId & 0x03ffffff;
    let offset = 0;
    for (const p of obj.propSet.set.props) {
        if (p.id === wantId) {
            const count = p.value.refCount ?? 0;
            return obj.propSet.objectIds.slice(offset, offset + count);
        }
        offset += refCounts(p.value).oid;
    }
    return [];
}

/** Resolve an object-space-id-reference property to the referenced object-space ids. */
function objectSpaceRefs(obj: OneObject, propId: number): string[] {
    const wantId = propId & 0x03ffffff;
    let offset = 0;
    for (const p of obj.propSet.set.props) {
        if (p.id === wantId) {
            const count = p.value.refCount ?? 0;
            return obj.propSet.objectSpaceIds.slice(offset, offset + count);
        }
        offset += refCounts(p.value).osid;
    }
    return [];
}

function stringProp(obj: OneObject, propId: number, ascii = false): string | undefined {
    const p = findProp(obj, propId);
    if (!p || !p.value.data) {
        return undefined;
    }
    return ascii ? decodeLatin1(p.value.data) : decodeUtf16(p.value.data);
}

function decodeLatin1(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) {
        if (b === 0) {
            break;
        }
        s += String.fromCharCode(b);
    }
    return s;
}

function u32Prop(obj: OneObject, propId: number): number | undefined {
    return findProp(obj, propId)?.value.num;
}

// ---------------------------------------------------------------------------------------------------
// Page extraction
// ---------------------------------------------------------------------------------------------------

export interface OneContentText {
    kind: "text";
    text: string;
}

export interface OneContentFile {
    kind: "file";
    name: string;
    ext?: string;
    bytes: Uint8Array;
    /** True for ImageNode (render inline), false for EmbeddedFileNode (attach). */
    image: boolean;
}

export type OneContent = OneContentText | OneContentFile;

export interface OnePage {
    title: string;
    level: number;
    /** Text + media blocks in reading order. */
    content: OneContent[];
}

export interface OneSection {
    pages: OnePage[];
    /** Diagnostics for the spike. */
    diagnostics: string[];
}

const ROLE_DEFAULT_CONTENT = 1;

function textOfRichText(obj: OneObject): string {
    const uni = stringProp(obj, PROP.RichEditTextUnicode);
    if (uni !== undefined && uni.length > 0) {
        return stripHyperlinkMarker(uni);
    }
    const ascii = stringProp(obj, PROP.TextExtendedAscii, true);
    return ascii ? stripHyperlinkMarker(ascii) : "";
}

function stripHyperlinkMarker(s: string): string {
    // OneNote embeds hidden `﷟ HYPERLINK "url"` markers before linked text.
    return s.replace(/﷟ HYPERLINK "[^"]*"/g, "").replace(/﷟/g, "");
}

/** True once a text run is only ink/object-replacement placeholders (U+FFFC) or whitespace. */
function isPlaceholderText(text: string): boolean {
    return text.replace(/￼/g, "").trim().length === 0;
}

/** The best extension for a media block: the filename's own extension wins over the declaration's. */
function mediaExtension(name: string, declaredExt?: string): string | undefined {
    const fromName = name.match(/\.([A-Za-z0-9]{1,8})$/);
    if (fromName) {
        return `.${fromName[1].toLowerCase()}`;
    }
    return declaredExt && declaredExt.startsWith(".") ? declaredExt.toLowerCase() : declaredExt;
}

/** Walk an outline subtree, collecting text + media blocks in reading order. */
function collectOutline(objId: string, space: ObjectSpace, out: OneContent[], depth = 0): void {
    if (depth > 64) {
        return;
    }
    const obj = space.objects.get(objId);
    if (!obj) {
        return;
    }
    switch (obj.jcid) {
        case JCID.OutlineNode:
        case JCID.OutlineGroup:
            for (const child of objectRefs(obj, PROP.ElementChildNodes)) {
                collectOutline(child, space, out, depth + 1);
            }
            break;
        case JCID.OutlineElementNode:
            for (const content of objectRefs(obj, PROP.ContentChildNodes)) {
                collectOutline(content, space, out, depth + 1);
            }
            for (const child of objectRefs(obj, PROP.ElementChildNodes)) {
                collectOutline(child, space, out, depth + 1);
            }
            break;
        case JCID.RichTextNode: {
            const text = textOfRichText(obj);
            if (!isPlaceholderText(text)) {
                out.push({ kind: "text", text });
            }
            break;
        }
        case JCID.ImageNode: {
            const containerId = objectRefs(obj, PROP.PictureContainer)[0];
            const container = containerId ? space.objects.get(containerId) : undefined;
            if (container?.fileData) {
                const name = stringProp(obj, PROP.ImageFilename) ?? "image";
                out.push({ kind: "file", name, ext: mediaExtension(name, container.fileExt), bytes: container.fileData, image: true });
            }
            break;
        }
        case JCID.EmbeddedFileNode: {
            const containerId = objectRefs(obj, PROP.EmbeddedFileContainer)[0];
            const container = containerId ? space.objects.get(containerId) : undefined;
            if (container?.fileData) {
                const name = stringProp(obj, PROP.EmbeddedFileName) ?? "file";
                out.push({ kind: "file", name, ext: mediaExtension(name, container.fileExt), bytes: container.fileData, image: false });
            }
            break;
        }
        default:
            // Unknown content — try to descend via common child props.
            for (const child of objectRefs(obj, PROP.ElementChildNodes)) {
                collectOutline(child, space, out, depth + 1);
            }
            for (const content of objectRefs(obj, PROP.ContentChildNodes)) {
                collectOutline(content, space, out, depth + 1);
            }
            break;
    }
}

function extractPage(pageSpace: ObjectSpace, level: number): OnePage | null {
    const contentRootId = pageSpace.roots.get(ROLE_DEFAULT_CONTENT);
    if (!contentRootId) {
        return null;
    }
    const contentRoot = pageSpace.objects.get(contentRootId);
    if (!contentRoot) {
        return null;
    }
    // content root is a PageManifestNode -> ContentChildNodes[0] -> PageNode
    let pageNode = contentRoot;
    if (contentRoot.jcid === JCID.PageManifestNode) {
        const pageNodeId = objectRefs(contentRoot, PROP.ContentChildNodes)[0];
        const pn = pageNodeId ? pageSpace.objects.get(pageNodeId) : undefined;
        if (pn) {
            pageNode = pn;
        }
    }

    const content: OneContent[] = [];

    // Title: StructureElementChildNodes[0] -> TitleNode -> ElementChildNodes -> outlines
    let title = "";
    const titleId = objectRefs(pageNode, PROP.StructureElementChildNodes)[0];
    const titleNode = titleId ? pageSpace.objects.get(titleId) : undefined;
    if (titleNode && titleNode.jcid === JCID.TitleNode) {
        const titleContent: OneContent[] = [];
        for (const child of objectRefs(titleNode, PROP.ElementChildNodes)) {
            collectOutline(child, pageSpace, titleContent);
        }
        title = titleContent
            .filter((c): c is OneContentText => c.kind === "text")
            .map((c) => c.text)
            .join(" ")
            .trim();
    }
    if (!title) {
        title = stringProp(pageNode, PROP.CachedTitleString) ?? stringProp(contentRoot, PROP.CachedTitleStringFromPage) ?? "";
    }

    // Body: PageNode.ElementChildNodes -> outlines
    for (const child of objectRefs(pageNode, PROP.ElementChildNodes)) {
        collectOutline(child, pageSpace, content);
    }

    return { title: title || "Untitled", level, content };
}

export function parseOneSection(bytes: Uint8Array): OneSection {
    const diagnostics: string[] = [];
    const file = new Reader(bytes);
    const header = parseHeader(file);
    if (!header.isTocorSection) {
        diagnostics.push("File type is not a .one section or .onetoc2");
    }

    const nodeCounts = header.fcrTransactionLog.nil ? new Map<number, number>() : parseTransactionLog(file, header.fcrTransactionLog);
    const ctx: ParseCtx = { file, nodeCounts };

    const rootNodes = parseFileNodeList(ctx, header.fcrFileNodeListRoot);
    const store = parseFileDataStore(ctx, rootNodes);
    const { spaces, rootSpaceId } = parseObjectSpaces(ctx, rootNodes, store);
    diagnostics.push(`object spaces: ${spaces.size}, root space: ${rootSpaceId}`);

    const rootSpace = spaces.get(rootSpaceId);
    if (!rootSpace) {
        diagnostics.push("root object space not found");
        return { pages: [], diagnostics };
    }

    const sectionId = rootSpace.roots.get(ROLE_DEFAULT_CONTENT);
    const section = sectionId ? rootSpace.objects.get(sectionId) : undefined;
    if (!section) {
        diagnostics.push("section node not found");
        return { pages: [], diagnostics };
    }
    if (section.jcid === JCID.TocContainer) {
        diagnostics.push("this is a .onetoc2 table-of-contents, not a section");
    }

    const pages: OnePage[] = [];
    // SectionNode -> ElementChildNodes -> PageSeriesNodes
    for (const seriesId of objectRefs(section, PROP.ElementChildNodes)) {
        const series = rootSpace.objects.get(seriesId);
        if (!series || series.jcid !== JCID.PageSeriesNode) {
            continue;
        }
        const pageSpaceIds = objectSpaceRefs(series, PROP.ChildGraphSpaceElementNodes);
        // Page metadata objects (for level), XORed with the seed.
        const metaIds = objectRefs(series, PROP.MetaDataObjectsAboveGraphSpace).map((id) => xorExGuid(id, XOR_SEED_GUID));

        pageSpaceIds.forEach((spaceId, index) => {
            const pageSpace = spaces.get(spaceId);
            if (!pageSpace) {
                return;
            }
            let level = 0;
            const metaId = metaIds[index];
            const meta = metaId ? rootSpace.objects.get(metaId) : undefined;
            if (meta) {
                level = u32Prop(meta, PROP.PageLevel) ?? 0;
            }
            const page = extractPage(pageSpace, level);
            if (page) {
                pages.push(page);
            }
        });
    }

    diagnostics.push(`pages: ${pages.length}`);
    return { pages, diagnostics };
}

/** XOR the guid part of an ExGuid key with a seed guid (page-series metadata indirection). */
function xorExGuid(key: string, seedGuid: string): string {
    const [guid, n] = key.split(":");
    const a = guid.replace(/-/g, "");
    const b = seedGuid.replace(/-/g, "");
    let out = "";
    for (let i = 0; i < 32; i += 2) {
        const xa = parseInt(a.slice(i, i + 2), 16);
        const xb = parseInt(b.slice(i, i + 2), 16);
        out += (xa ^ xb).toString(16).padStart(2, "0");
    }
    const g = `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20, 32)}`.toUpperCase();
    return `${g}:${n}`;
}
