#!/usr/bin/env python3
"""Writes `nested-archive.zip` — a VALID course package that tuhoc refuses.

Run from this directory:  python3 nested-archive.py

Two properties, both taken from the archive measured in review (ruling
S1-F26), and both of which ordinary tools produce without being asked:

1. **Every entry carries a data descriptor** (`flag_bits = 0x8`). That is what
   any zip writer does when it is streaming into a socket or a pipe and does
   not know an entry's size in advance — here, a non-seekable output stream.
2. **Two entries are themselves zip files, STORED**, so their own
   `PK\\x03\\x04` local headers survive intact inside the outer archive's byte
   stream. `.docx` and `.xlsx` are zip files; a course that ships a worksheet
   ships one.

The result passes `unzip -t` and `python -m zipfile --test`, and every other
tool opens it. `unpackZip` refuses it, on purpose: it walks LOCAL HEADERS
while the index lists names, so the nested archives' headers make the two
halves disagree — the same disagreement a polyglot archive is built out of.
The refusal is not the bug. Telling the reader "this is not a readable .zip"
and quoting `[Content_Types].xml`, a path that exists only inside their own
Word document, was.
"""

import io
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
COURSE = os.path.join(HERE, "..", "..", "..", "fixtures", "courses", "bat-bien-vong-lap")


def word_document() -> bytes:
    """A minimal .docx: a zip whose first entry is named `[Content_Types].xml`."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        z.writestr("word/document.xml", '<?xml version="1.0"?><w:document/>')
    return buf.getvalue()


class NonSeekable(io.RawIOBase):
    """A sink that cannot seek — which is what makes zipfile write descriptors."""

    def __init__(self, sink):
        self.sink = sink

    def writable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return False

    def write(self, data):
        return self.sink.write(data)


def main() -> None:
    nested = word_document()
    with open(os.path.join(HERE, "nested-archive.zip"), "wb") as sink:
        with zipfile.ZipFile(NonSeekable(sink), "w") as z:
            for name in ("manifest.json", "chapters/c1.html", "chapters/c2.html", "chapters/c3.html"):
                with open(os.path.join(COURSE, name), "rb") as f:
                    z.writestr(zipfile.ZipInfo(name), f.read(), zipfile.ZIP_DEFLATED)
            z.writestr(zipfile.ZipInfo("tai-lieu/bai-tap.docx"), nested, zipfile.ZIP_STORED)
            z.writestr(zipfile.ZipInfo("tai-lieu/bang-diem.xlsx"), nested, zipfile.ZIP_STORED)


if __name__ == "__main__":
    main()
