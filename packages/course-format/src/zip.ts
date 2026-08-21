/**
 * Reading and writing the `.zip` container a course package ships in.
 *
 * Three places call this: the packaging CLI (task 3), the server receiving an
 * upload (task 6), and the browser when a reader imports a file (task 8). Two
 * of those three hand it bytes that a stranger chose, so this module's job is
 * not "unzip" — it is "refuse to unzip things that are not a course package,
 * before refusing costs anything".
 *
 * ## The one thing this module exists for
 *
 * `MAX_UNCOMPRESSED_BYTES` lives in `validate.ts`, but `validatePackage` takes
 * a Map that is **already decompressed**: by the time that rule runs the zip
 * bomb has already been paid for. The rule cannot protect the thing it was
 * written to protect. The real fence is here, and it has to be *inside* the
 * decompression loop, not after it.
 *
 * So the archive is fed to `fflate`'s streaming reader in {@link FEED_BYTES}
 * slices and the decompressed total is added up as the slices come back. The
 * throw happens on the push that crosses the line, and nothing after that line
 * is ever inflated. Measured on a bomb built to decompress to 32, 64, 128 and
 * 256 MiB — the amount actually decompressed before the throw is the same every
 * time, because it does not depend on how big the archive claims to be:
 *
 * | bytes fed per push | decompressed before the throw | wall clock |
 * |--------------------|-------------------------------|------------|
 * | 4 KiB              | **23.77 MiB**                 | ~210 ms    |
 * | 16 KiB             | 31.71 MiB                     | ~275 ms    |
 * | 64 KiB             | 63.45 MiB                     | ~550 ms    |
 *
 * The overshoot is not slack, it is arithmetic: DEFLATE's maximum ratio is
 * ~1030:1, so one push of N compressed bytes can hand back ~1030N decompressed
 * bytes in a single callback, and there is no seam inside that callback to stop
 * at. 4 KiB was chosen because it makes the overshoot 3.8 MiB — a fifth of the
 * budget — and, measured on the real 46-file package, costs nothing (see
 * `zip.test.ts`). For contrast, the shape this module is NOT: `unzipSync` then
 * check the total, on that same 1 GiB bomb, was 9.5 s and 775 MiB of RSS.
 *
 * ## What is checked, and in what order
 *
 * Per entry, cheapest and most decisive first, all before a byte is inflated:
 *  1. the path — {@link escapesPackage}, the *same* function `validate.ts` uses,
 *     imported rather than copied. Two answers to "does this path leave the
 *     package" is one answer too many.
 *  2. a name already seen — a zip may legally carry two entries called
 *     `manifest.json`; `new Map()` would silently keep the second and any other
 *     reader might keep the first. Ambiguity gets refused, not resolved, and
 *     "the same name" is decided the way the file system the package lands on
 *     decides it (see {@link duplicateKey}), not the way `Map` does.
 *  3. the name the archive's own index gives that entry — see the third bullet
 *     under Deliberate non-goals.
 *  4. the size the local header *claims* — a cheap early exit for an honest
 *     bomb. It is a claim by whoever wrote the file, so it may only ever be used
 *     to REJECT. Accepting on it is pinned as a test.
 * Then, during inflation: the running total, which is the only number here that
 * an attacker does not write.
 *
 * ## Deliberate non-goals
 *
 * - **`packZip` does not validate.** Untrusted bytes arrive at the reading end,
 *   so the fence is at the reading end; the writer must be able to produce a
 *   hostile archive or the tests above could not exist. The CLI calls
 *   `validatePackage` before it calls `packZip`.
 * - **No CRC check.** `fflate`'s reader does not verify entry CRCs and neither
 *   does this. A CRC detects corruption, not malice — an attacker writes the
 *   CRC too — and every rule here has to hold against malice.
 * - **The central directory is read for names, not for contents.** `fflate`'s
 *   streaming reader walks local headers; `unzipSync`, `unzip(1)`, `python
 *   zipfile`, `java.util.zip` and `JSZip` walk the central directory. A zip
 *   whose two halves disagree is read differently by the two, which is how a
 *   scanner at one end of a pipeline and a reader at the other end are made to
 *   see different files. Three things are required to agree, all before a byte
 *   is inflated: the end-of-central-directory record must exist and reach
 *   exactly the end of the file, its entry count must equal the number of
 *   entries actually read, and **every name a local header announces must be a
 *   name the index lists**. The count half catches every truncation — including
 *   the one measured while writing this module, where a zip cut short inside a
 *   local header returned a *smaller package with no error at all*. The name
 *   half catches the archive measured in review, whose local header said
 *   `manifest.json` while its index said `../../evil.js`: this reader accepted
 *   it and the other four each listed the escape. The earlier note here that
 *   closing that needed "a second parser" was wrong by about twenty lines —
 *   see {@link centralDirectoryNames}. What is still NOT compared is entry
 *   *contents*: an index that agrees on every name but points at different
 *   bytes is not detected. Written down rather than handled — and narrower than
 *   it sounds, because the duplicate-name rule and the count cross-check
 *   together already refuse every "zip nested inside a zip" shape tried against
 *   them.
 * - **Nothing may sit outside the archive at either end.** A file that does not
 *   begin with a local header is refused, and so is one with bytes past its own
 *   index. Both ends of a polyglot are the same trick: give one reader a JPEG
 *   and the other a zip.
 */

import { type Zippable, Unzip, UnzipInflate, zipSync } from 'fflate';
import { MAX_UNCOMPRESSED_BYTES, escapesPackage } from './validate';

/** Why an archive was refused. */
export type UnsafeArchiveCode =
  /** An entry path could resolve outside the package root once joined. */
  | 'PATH_ESCAPE'
  /** Two entries share a name; which one is "the" file is not decidable. */
  | 'DUPLICATE_ENTRY'
  /** Decompressing would exceed `MAX_UNCOMPRESSED_BYTES`. */
  | 'TOO_LARGE'
  /**
   * Reading: not a zip, truncated, unknown compression method, or corrupt.
   * Writing: a name the container cannot carry — see {@link packZip}.
   */
  | 'MALFORMED';

/**
 * Thrown by {@link unpackZip}. One class, because a caller's question is always
 * "may I read this?" and the answer is always no; {@link code} says why.
 */
export class UnsafeArchiveError extends Error {
  readonly code: UnsafeArchiveCode;
  /** The offending entry name, or `'.'` when the archive as a whole is at fault. */
  readonly entry: string;
  /**
   * How many bytes had been decompressed when this was thrown.
   *
   * Not decoration: on a `TOO_LARGE` this is the evidence that the ceiling was
   * enforced *during* decompression. An implementation that inflated the whole
   * archive and checked afterwards reports the archive's full size here, and
   * `zip.test.ts` fails it on exactly that number.
   */
  readonly bytesRead: number;

  constructor(code: UnsafeArchiveCode, entry: string, detail: string, bytesRead = 0) {
    super(`${code} (${entry}): ${detail}`);
    this.name = 'UnsafeArchiveError';
    this.code = code;
    this.entry = entry;
    this.bytesRead = bytesRead;
  }
}

/**
 * Compressed bytes handed to the reader per push. See the table in the module
 * comment: this is the knob that bounds how far past the budget one callback can
 * take us, because a single callback cannot be interrupted.
 */
const FEED_BYTES = 4096;

/**
 * A fixed modification time for every entry, so that packing the same files
 * twice produces the same bytes. `fflate` defaults to `Date.now()`, which would
 * make every hash of a package — registry identity, browser cache key, "did
 * this change?" — differ from the last one for no reason.
 *
 * `new Date(1985, 0, 1)` and not `Date.UTC(...)` on purpose: zip stores a
 * *local* DOS timestamp and `fflate` reads the fields with `getFullYear()` and
 * friends, so a fixed instant would still write different bytes in different
 * time zones. A fixed local wall-clock writes `00 00 21 0A` everywhere. 1985
 * rather than 1980 because DOS cannot represent a year before 1980 and no zone
 * offset is 5 years wide.
 */
const ZIP_MTIME = new Date(1985, 0, 1).getTime();

/** `PK\x03\x04` — a local file header, i.e. an archive with something in it. */
const LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04] as const;
/** `PK\x05\x06` — the end-of-central-directory record of an empty archive. */
const EMPTY_ARCHIVE = [0x50, 0x4b, 0x05, 0x06] as const;

function startsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

/** `PK\x05\x06`, the end-of-central-directory signature, as a little-endian u32. */
const EOCD_SIG = 0x06054b50;
/** An end-of-central-directory record without its comment. */
const EOCD_SIZE = 22;

function u16(b: Uint8Array, at: number): number {
  return (b[at] as number) | ((b[at + 1] as number) << 8);
}

function u32(b: Uint8Array, at: number): number {
  return (
    ((b[at] as number) |
      ((b[at + 1] as number) << 8) |
      ((b[at + 2] as number) << 16) |
      ((b[at + 3] as number) << 24)) >>>
    0
  );
}

/**
 * Where the archive's own index ends, or `null` if it has no index.
 *
 * The record is at the end, but a zip may carry a trailing comment of up to
 * 65,535 bytes, so it has to be searched for backwards. A candidate only counts
 * if its declared comment length reaches exactly the end of the file — without
 * that, arbitrary bytes that happen to spell `PK\x05\x06` would be accepted as
 * the index.
 *
 * What the record says is written by whoever wrote the file, so it is not
 * *trust*. It is a consistency check: an archive whose two halves agree is at
 * least one archive rather than two, and truncation makes them disagree for
 * free.
 */
function findEndOfCentralDirectory(zip: Uint8Array): number | null {
  const lowest = Math.max(0, zip.length - EOCD_SIZE - 0xffff);
  for (let at = zip.length - EOCD_SIZE; at >= lowest; at--) {
    if (u32(zip, at) !== EOCD_SIG) continue;
    if (u16(zip, at + 20) !== zip.length - at - EOCD_SIZE) continue;
    return at;
  }
  return null;
}

/** `PK\x01\x02` — a central directory record, as a little-endian u32. */
const CENTRAL_SIG = 0x02014b50;
/** A central directory record without its name, extra field and comment. */
const CENTRAL_SIZE = 46;
/** Bit 11 of the general purpose flag: the entry name is UTF-8. */
const UTF8_NAME_FLAG = 0x800;

const utf8 = new TextDecoder('utf-8');

/**
 * An entry name, decoded the way `fflate` decodes the one in the local header.
 *
 * This has to match `fflate`'s `strFromU8(bytes, !(flag & 2048))` byte for
 * byte, or the two halves of a perfectly ordinary Vietnamese package would
 * "disagree" and every such package would be refused — a gate that is safe
 * because it says no to everything. Latin-1 is one `String.fromCharCode` per
 * byte, not `windows-1252`, because that is what `fflate` does.
 */
function decodeEntryName(bytes: Uint8Array, isUtf8: boolean): string {
  if (isUtf8) return utf8.decode(bytes);
  let name = '';
  for (const b of bytes) name += String.fromCharCode(b);
  return name;
}

/**
 * Every name the archive's index claims, or `null` if the index is unreadable.
 *
 * `count` records are walked from the offset the end-of-central-directory
 * record gives, and they must end exactly where that record begins: a gap
 * between the last index entry and the index's own footer is the same trick as
 * bytes before the first local header, one reader's padding being another
 * reader's file.
 *
 * Not a general zip64 parser and not trying to be — an archive whose index does
 * not sit plainly in front of its footer is refused rather than guessed at, and
 * this module already refuses zip64 entry counts a few lines up.
 */
function centralDirectoryNames(zip: Uint8Array, eocd: number, count: number): Set<string> | null {
  const start = u32(zip, eocd + 16);
  const names = new Set<string>();
  let at = start;
  for (let i = 0; i < count; i++) {
    if (at < 0 || at + CENTRAL_SIZE > eocd) return null;
    if (u32(zip, at) !== CENTRAL_SIG) return null;
    const nameLength = u16(zip, at + 28);
    const nameAt = at + CENTRAL_SIZE;
    if (nameAt + nameLength > eocd) return null;
    names.add(
      decodeEntryName(zip.subarray(nameAt, nameAt + nameLength), (u16(zip, at + 8) & UTF8_NAME_FLAG) !== 0),
    );
    at = nameAt + nameLength + u16(zip, at + 30) + u16(zip, at + 32);
  }
  return at === eocd ? names : null;
}

/**
 * The key two entry names are "the same file" under.
 *
 * `Map` compares strings; the file systems a package is extracted onto do not.
 * APFS (macOS default) and NTFS both fold case, and macOS also folds Unicode
 * normalization, so `manifest.json`/`MANIFEST.JSON` and NFC/NFD `café.txt` are
 * each ONE file there — the very ambiguity `DUPLICATE_ENTRY` exists to refuse,
 * arriving in a spelling the plain string comparison could not see. The
 * refusal still names the entry as it was written.
 */
function duplicateKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * Writes `files` into a zip.
 *
 * Deterministic: entries are ordered by name and stamped with a fixed time, so
 * the same Map always produces the same bytes regardless of insertion order or
 * of when it ran.
 *
 * Does **not** validate. See the module comment. The one name it refuses is
 * `__proto__`, and that is a limit rather than a rule — read on.
 */
export function packZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  for (const name of files.keys()) {
    // `fflate` addresses entries by object key while packing (`zipSync` builds
    // a `{}` and assigns `r[name]`), and `obj['__proto__'] = v` sets the
    // prototype instead of storing anything. The archive that comes out is not
    // the archive that was asked for. Measured, not assumed: fflate 0.8.2 then
    // enumerates the Uint8Array through the prototype chain and dies with
    // `Cannot read properties of undefined (reading 'level')` — loud today,
    // but loud by luck. Refuse the name and the outcome stops depending on
    // which version of the library is installed.
    //
    // Only the exact string matters: `chapters/__proto__` is an ordinary key.
    if (name === '__proto__') {
      throw new UnsafeArchiveError('MALFORMED', name, 'a zip entry cannot be named "__proto__"');
    }
  }
  // Second fence, and free: with `{}` here, the assignment below would corrupt
  // this dictionary too, and silently. `Object.create(null)` has no prototype
  // setter to trip, so if the guard above is ever deleted the failure stays
  // where it can be seen.
  const zippable: Zippable = Object.create(null) as Zippable;
  const names = [...files.keys()].sort();
  for (const name of names) zippable[name] = files.get(name) as Uint8Array;
  return zipSync(zippable, { level: 9, mtime: ZIP_MTIME });
}

/**
 * Reads a zip into a Map of package-relative path → contents.
 *
 * Throws {@link UnsafeArchiveError} rather than skipping anything: a caller that
 * receives a Map has to be able to treat it as the whole archive.
 *
 * Zero-length entries whose name ends in `/` are directory markers and are
 * dropped. An entry ending in `/` that has *contents* is kept as a file — the
 * marker is recognised by being empty, not by being named a certain way.
 */
export function unpackZip(zip: Uint8Array): Map<string, Uint8Array> {
  // Reject anything that does not begin with a zip signature. A course package
  // is produced by this repo's own CLI and always starts with a local header;
  // accepting a prefix would accept the file that is both a JPEG and a zip,
  // which is how a scanner at one end of a pipeline and a reader at the other
  // end are made to disagree about what a file is.
  if (!startsWith(zip, LOCAL_HEADER) && !startsWith(zip, EMPTY_ARCHIVE)) {
    throw new UnsafeArchiveError('MALFORMED', '.', 'does not begin with a zip signature');
  }

  // Read the archive's own index up front, so a file with no index at all — or
  // with one that does not agree with its own contents — is refused before any
  // inflation rather than after.
  const eocd = findEndOfCentralDirectory(zip);
  if (eocd === null) {
    throw new UnsafeArchiveError('MALFORMED', '.', 'archive has no end-of-central-directory record');
  }
  const declared = u16(zip, eocd + 10);
  if (declared === 0xffff) {
    // 0xFFFF is zip64's "look in the zip64 record instead" sentinel, and this
    // module does not read that record. Refusing beats quietly skipping the
    // cross-check — and a course package with 65,535 entries is not a thing.
    throw new UnsafeArchiveError('MALFORMED', '.', 'zip64 entry counts are not supported');
  }
  const indexed = centralDirectoryNames(zip, eocd, declared);
  if (indexed === null) {
    throw new UnsafeArchiveError('MALFORMED', '.', 'archive index is not readable');
  }

  const out = new Map<string, Uint8Array>();
  /** Case- and normalization-folded names seen so far — the duplicate check's memory. */
  const announced = new Set<string>();
  /** Directory markers, dropped from `out` but still entries as far as the index is concerned. */
  let dropped = 0;
  let total = 0;
  let failure: UnsafeArchiveError | null = null;

  const fail = (code: UnsafeArchiveCode, entry: string, detail: string): void => {
    // First refusal wins. Later callbacks in the same push must not overwrite
    // the reason with a downstream symptom of it.
    if (!failure) failure = new UnsafeArchiveError(code, entry, detail, total);
  };

  const reader = new Unzip();
  reader.register(UnzipInflate);

  reader.onfile = (file) => {
    if (failure) return;
    const name = file.name;

    if (escapesPackage(name)) {
      fail('PATH_ESCAPE', name, 'entry path escapes the package root');
      return;
    }
    const key = duplicateKey(name);
    if (announced.has(key)) {
      fail('DUPLICATE_ENTRY', name, 'two entries share this name');
      return;
    }
    announced.add(key);

    // The name in the local header must be a name the index lists. `fflate`'s
    // streaming reader — this one — walks local headers; `unzipSync`,
    // `python zipfile`, `java.util.zip`, `JSZip` and `unzip(1)` all walk the
    // index. Measured on an archive whose local header said `manifest.json`
    // while its index said `../../evil.js`: this gate accepted it and reported
    // `manifest.json`, and the other four all reported `../../evil.js`. Whether
    // any of them then WRITES outside the destination is their business and
    // mostly they do not; the part that is this module's business is that the
    // file which passed the gate and the file everyone else sees are not the
    // same file. Names, not just how many of them, and it costs one Set lookup.
    if (!indexed.has(name)) {
      fail('MALFORMED', name, 'a local header announces a name the archive index does not list');
      return;
    }

    // The header's own claim about the decompressed size. Only ever a reason to
    // stop early — an entry that lies low here is caught by the running total
    // below, which is pinned by its own test.
    const claimed = file.originalSize;
    if (claimed !== undefined && claimed > MAX_UNCOMPRESSED_BYTES - total) {
      fail('TOO_LARGE', name, `entry declares ${claimed} bytes, over the ${MAX_UNCOMPRESSED_BYTES} byte budget`);
      return;
    }

    const chunks: Uint8Array[] = [];
    let size = 0;

    file.ondata = (err, data, final) => {
      if (failure) return;
      if (err) {
        fail('MALFORMED', name, err.message);
        return;
      }
      total += data.length;
      if (total > MAX_UNCOMPRESSED_BYTES) {
        // THE fence. Reached mid-archive; the push loop throws before feeding
        // another byte, so nothing past here is inflated.
        fail('TOO_LARGE', name, `decompressed size passed the ${MAX_UNCOMPRESSED_BYTES} byte budget`);
        return;
      }
      size += data.length;
      chunks.push(data);
      if (!final) return;

      // A directory marker: empty AND named like one. Testing only the name
      // would drop a real file that happens to end in a slash.
      if (size === 0 && name.endsWith('/')) {
        dropped++;
        return;
      }
      // Always copy. An entry stored without compression is handed back by
      // fflate as a subarray of `zip` itself, so the Map would alias the
      // caller's buffer and change under them if they reuse or zero it.
      const joined = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        joined.set(c, at);
        at += c.length;
      }
      out.set(name, joined);
    };

    file.start();
  };

  for (let off = 0; off < zip.length; off += FEED_BYTES) {
    const end = Math.min(off + FEED_BYTES, zip.length);
    try {
      reader.push(zip.subarray(off, end), end === zip.length);
    } catch (e) {
      // fflate signals a malformed archive by throwing. If we already have a
      // reason of our own, it is the better one — the throw is downstream of it.
      throw failure ?? new UnsafeArchiveError('MALFORMED', '.', (e as Error).message, total);
    }
    if (failure) throw failure;
  }

  // The archive said how many entries it had; this is how many came out. A
  // mismatch is the *silent* failure this whole module is built to refuse, and
  // it is not hypothetical: measured on fflate 0.8.2, a zip cut short inside a
  // local file header returns the earlier entries and no error whatsoever —
  // a smaller package than the one that was handed in, with nothing to say so.
  //
  // Counting `dropped` back in matters: directory markers are entries in the
  // index but not files in the Map, so leaving them out would fail every
  // archive a normal zip tool produced.
  const read = out.size + dropped;
  if (read !== declared) {
    throw new UnsafeArchiveError(
      'MALFORMED',
      '.',
      `archive index lists ${declared} entries but ${read} were readable`,
      total,
    );
  }
  return out;
}
