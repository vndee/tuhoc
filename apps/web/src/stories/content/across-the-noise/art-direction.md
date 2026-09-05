# Across the Noise art pilot

The cover, opening diptych and return to the receiving room establish the approved maritime atlas/operator-notebook direction. Three original compositions were generated with the built-in imagegen tool. Diluted sea-blue watercolor, warm paper, graphite and fine engraved surface detail carry the material world. The frontend-design skill kept the review furniture quiet and grounded in the approved paper/ink/stage tokens. No new visual direction or typography was introduced.

The cover centers blank paper beside a harbor window and a small ship in mist. Scene 01 separates a writer and a waiting receiver into two coastal rooms. Its receiving-side anchors are the four-pane window, empty wooden table, copper lamp, ladder-back chair and blue-clad figure. Scene 12 uses that inspected original as a continuity reference for a new view from beside/behind the receiver. The paper now rests on the table in warmer light. A targeted imagegen edit removed a shelf, coat, chest and secondary lantern that had leaked from the sender's room into the initial scene 12 generation. The final prompt and actual edit prompt are recorded verbatim in `art-pilot.json`.

All paper is unmarked. Faces remain restrained; these are fictional illustrations, not historical portraits or claims about the learner's message. Functional-looking harbor rope is incidental to the cover and is not repeated as an ornamental motif. Algorithms, language-specific labels and diagrams belong in accessible HTML/SVG.

## Provenance and recovery

`art-pilot.json` is an explicit exporter manifest. Its `sourceOutput` fields preserve the actual tool-returned absolute paths. `createdAt` records the UTC observation immediately after initial generation, read with the clock tool; the image tool did not supply timestamps or a model field. Model is therefore recorded as “not reported by tool.” Scene 12 also records its edit observation, input/output and prompt. No generation license was reported; “Project-generated” is an internal provenance category, not a guarantee of exclusivity.

Recoverable byte-identical workspace copies are listed as `archivedSourceOutput` under ignored `.superpowers/sdd/2026-09-05-across-the-noise/art-originals/`. Original PNGs and review evidence are not shipped as runtime assets. Source SHA256 values were measured after copying. Both the tool originals and local archives are retained.

Reproduction requires the original paths in the manifest to exist. If working on another machine, recover the originals and make an explicit local manifest copy with `sourceOutput` pointing to those recovered files; keep the committed actual generation record intact. The exporter never silently substitutes files or manufactures provenance. Asset acceptance tests validate committed derivatives and metadata without depending on paths on the original author's machine.

## Mechanical export

Run from `apps/web`:

```sh
/opt/homebrew/bin/node scripts/export-story-plates.mjs --manifest src/stories/content/across-the-noise/art-pilot.json --out src/stories/content/across-the-noise/assets
```

Verified toolchain: Node v25.1.0, cwebp 1.6.0 (libsharpyuv 0.4.2), sips 316. No dependency was installed. The exporter uses argument-vector execFile calls, validates IDs and metadata, checks all source aspects before conversion, checks the exact output directory and rejects symlink destinations and source hardlinks. It stages all conversions before replacing generated derivatives and preserves source originals. Both widths use q85 → q80 → q75 → q70 until within their decimal byte budget; failure at q70 requires art/detail review.

| Export | Dimensions | Quality | Bytes | Budget |
|---|---|---|---|---|
| cover.webp | 1536×1024 | 85 | 223680 | 250000 |
| cover-768.webp | 768×512 | 85 | 61540 | 100000 |
| scene-01.webp | 1536×1024 | 85 | 301448 | 320000 |
| scene-01-768.webp | 768×512 | 85 | 73500 | 100000 |
| scene-12.webp | 1536×1024 | 85 | 249000 | 320000 |
| scene-12-768.webp | 768×512 | 85 | 63058 | 100000 |

Two actual exporter runs produced identical hashes for all six files. The tests cover real PNG-to-WebP conversion, dimensions, source preservation with shell metacharacters, duplicates, malformed IDs/metadata, missing/wrong-aspect sources, output-directory containment, symlinks/hardlinks, quality fallback and q70 failure.

## Pilot inspection

All six local WebPs were viewed individually. An owned HTML contact sheet presents real exports in both approved light/dark surroundings; it does not synthesize new art. Review layouts at 320/390/1024/1440px loaded every image and had no horizontal overflow. At 320px (288px image width), the blank page, ship, diptych and return-room anchors remain legible. Small derivatives have the expected softer fine grain, with no visible destructive block artifacts at reading size. Individual desktop review plates also use a 58vw stage with quiet borders.

This is an art acceptance review. Final reader integration, bilingual caption placement and production-layout/contrast checks remain the later integration tasks. The pilot stays at three plates; remaining scenes require the pilot checkpoint first. Full local inspection evidence is in the ignored Task 20 report and contact sheet.
