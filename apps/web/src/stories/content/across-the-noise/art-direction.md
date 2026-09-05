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

This was the three-plate art acceptance checkpoint. Final reader integration, bilingual caption placement and production-layout/contrast checks remain the later integration tasks. Full pilot inspection evidence is in the ignored Task 20 report and contact sheet. The accepted pilot records and six exports remain unchanged.

## Completed thirteen-plate suite

After the pilot checkpoint, ten distinct compositions completed the approved map: 02 shared codebook/cards/roll; 03 hand, key and paper intervals; 04 collective cable-deck work and open sea; 05 shore instrument and material cable sample; 06 parallel comparison desks; 07 overhead card sorting; 08 oblique translucent-paper grouping; 09 three paper copies on one table; 10 lamplit overlapping checks; 11 three equipment options and an unmarked resource ledger. They remain fictional material illustrations, not exact historical reconstructions or technical diagrams. The card piles do not claim a numerical correspondence to the lab. Physical tabs represent checking gestures; precise symbols and algorithms remain in accessible HTML/SVG.

The inspected scene01 original provided style continuity for all ten new compositions. Three targeted built-in edits corrected concrete issues: 04 removed a buoy-supported surface line and made the cable descend over the ship's side; 10 cleared an unwanted landscape from the underlying card; 11 removed a wall map and numeral-like dial marks. Original and edited paths, verbatim prompts, tool output hints and clock observations are preserved in `provenance.json`. Original pilot evidence stays in `art-pilot.json` without changes. All thirteen final source PNGs have byte-identical ignored recovery copies; sourceOutput always names the actual tool-returned path, separately from archivedSourceOutput.

The built-in tool returned image_url and output_hint, with no model, generation timestamp, license or provider reuse terms. No model or terms have been inferred. createdAt is explicitly a UTC clock observation immediately following initial generation, and editRecords carry their own clock observations. `license: 'project-generated'` is the internal project category, not a third-party license or exclusivity claim. Pilot license notes are retained separately in the complete provenance.

Every source measured 1536×1024. The existing source-preserving exporter produced 1536×1024 and 768×512 derivatives. Large02/06 required the authorized q80 fallback; all others and every small derivative fit at q85. No source PNG enters the runtime inventory or git. To regenerate the suite with restored originals available at their recorded paths, use the existing exporter with `--manifest src/stories/content/across-the-noise/provenance.json` and the same output directory shown above.

| Plate | Large bytes | Large quality | Small bytes | Small quality |
|---|---:|---:|---:|---:|
| cover | 223680 | 85 | 61540 | 85 |
| scene-01 | 301448 | 85 | 73500 | 85 |
| scene-02 | 263924 | 80 | 93494 | 85 |
| scene-03 | 258196 | 85 | 69878 | 85 |
| scene-04 | 231138 | 85 | 70108 | 85 |
| scene-05 | 317970 | 85 | 92610 | 85 |
| scene-06 | 249460 | 80 | 89656 | 85 |
| scene-07 | 244110 | 85 | 63500 | 85 |
| scene-08 | 259870 | 85 | 74106 | 85 |
| scene-09 | 204304 | 85 | 54766 | 85 |
| scene-10 | 217032 | 85 | 57634 | 85 |
| scene-11 | 310642 | 85 | 90954 | 85 |
| scene-12 | 249000 | 85 | 63058 | 85 |

The full light/dark contact sheet and individual mobile captures retain distinct narrative subjects, paper surfaces, hands and instruments. Review layouts at 320/390/1024/1440px loaded all images with no horizontal overflow. The thirteen plates were each inspected at source and mobile sizes; q80 exports were additionally inspected directly. No duplicated crop or remaining text/diagram artifact was found. These captures are an art review on approved surrounds, not the later integrated reader QA.

Scene dominantColor values are measured from the most populous 32-level RGB bin of a 96×64 canvas sample of each large WebP, using the average RGB within that bin, then checked visually against the real plates. Dark values in02/06/07/10 reflect substantial clothing/wood/shadow regions; this is a loading color, not a contrast-certified control or text color. `cover.ts` carries only two explicit cover imports, small literal bilingual text and measured dimensions/bytes. `assets.ts` explicitly imports both variants for each scene and uses the approved image text.
