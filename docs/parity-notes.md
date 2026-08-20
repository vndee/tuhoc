# Parity check: v1 (single-file) vs. the platform's served chapters

Task 17's own check, per the task-17 brief. Compares three chapters —
`p0-1`, `p2-10`, `p4-4` — between the original single-file textbook at
`/Users/vndee/Documents/claude/Research/***REMOVED***.html` (read-only;
not modified) and what this platform actually serves and renders at
`/c/***REMOVED***/<chapterId>`.

**Bar for "acceptable":** minor spacing differences only. **Not
acceptable:** a missing visualization, broken mathematics, or a missing
content box. Both checks below came back clean against that bar.

## What was checked, and how

Two independent passes, both real, neither a substitute for the other:

1. **Structural diff (scripted, exhaustive for these 3 chapters)** — a
   throwaway script (not committed; logic below) parsed
   `***REMOVED***.html`'s own `<script type="text/html"
   id="tpl-<id>">…</script>` templates (the exact extraction pattern
   `tools/extract.py`'s `TPL_RE` already uses to build the course package)
   and compared each of the three chapters' template body against the
   corresponding served file at
   `courses/***REMOVED***/chapters/<id>.html`, byte for byte, plus
   four derived structural signals: the set of `data-viz="…"` names, the
   h2/h3 heading sequence (id + text), the count of each `.box <variant>`
   class (`intu`, `thm`, `def`, `res`, `warn`, `pitfall`, `ex`, …), and the
   count of KaTeX delimiter spans (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`).
2. **Visual verification, in a real browser (Claude_Browser MCP)** — both
   sides were actually rendered and screenshotted, side by side, scrolled
   to the same content:
   - v1 served (read-only) via `python3 -m http.server` from the Research
     repo root and opened at `http://127.0.0.1:8999/***REMOVED***.html#<id>`
     — the real single-file app, its own KaTeX/viz JS, unmodified.
   - The platform's own served chapter opened at
     `http://localhost:5183/c/***REMOVED***/<id>` — the real Vite
     dev server, the real API+Postgres stack (via
     `apps/api/compose.e2e.yml`, migrated, same as `make test-e2e` brings
     up), a real registered/logged-in session, the real `ChapterView` /
     `useCourseKit` / `CourseKit.renderKatex` / `CourseKit.initViz`
     pipeline — not a static file open.

   For each chapter, at least one interactive visualization was left at
   its **default control state on both sides** and compared, including
   the **computed numeric readouts**, not just the chart shape — this
   catches a viz whose canvas draws something but the underlying math
   drifted from v1's (a class of bug the structural diff, which only
   looks at markup/JS source, cannot catch on its own).

What this does **not** claim to have checked: every one of the 40
chapters (only the three named in the brief), every viz within the three
chapters checked (one representative viz per chapter was driven and
read back numerically; the others were confirmed present via the
structural diff's `data-viz` set match, not individually driven), or
mobile/narrow viewports (both sides were viewed at the same desktop
viewport only).

## Results

### p0-1 — "Thông tin là gì, và tại sao nó đo được?"

- Structural diff: **byte-identical** template body. `data-viz`:
  `{surprisal, twenty-q}` on both sides. Headings: 6/6 match, same
  sequence. Box variants: `{ex: 4, intu: 1, res: 1, thm: 1, warn: 1}` on
  both sides. Math expressions: 295/295.
- Visual: opened both at the top of the chapter (title, eyebrow,
  breadcrumb, lede — identical) and scrolled to the `surprisal` viz
  (`ι(p) = -log₂ p` curve with p(A)/p(B) sliders). Default state
  (`p(A)=0.250`, `p(B)=0.400`) rendered pixel-identical curves, slider
  positions, and point labels (A, B, A·B) on both sides.
- **Verdict: matches. No differences observed.**

### p2-10 — "Kênh Gaussian: dung lượng, water-filling và giới hạn cuối cùng"

- Structural diff: **byte-identical** template body. `data-viz`:
  `{shannon-limit, waterfill}` on both sides. Headings: 7/7 match. Box
  variants: `{def: 1, ex: 5, intu: 3, res: 1, thm: 5}` on both sides.
  Math expressions: 295/295.
- Visual: scrolled to the `waterfill` viz ("Water-filling: đổ công suất
  vào phổ nhiễu"). Left both at their default control state (đáy bể =
  "Dốc", tổng công suất P = 6.0) and compared the full readout row, not
  just the bar chart shape:

  | | v1 | platform |
  |---|---|---|
  | mực nước ν | 4.333 | 4.333 |
  | dung lượng C (bit) | 1.673 | 1.673 |
  | kênh hoạt động | 3 / 6 | 3 / 6 |
  | chế độ | chọn lọc một phần | chọn lọc một phần |

  Bar chart (6 subcarriers, "khô" labels on f4–f6, filled "nước" portion
  on f1–f3) pixel-identical between the two screenshots.
- **Verdict: matches. No differences observed.** This is also the exact
  chapter/selector (`data-viz="waterfill"`) the task-17 brief names as
  contractual, and the one `apps/web/e2e/p1.spec.ts` exercises live on
  every `make test-e2e` run.

### p4-4 — "Semantic entropy"

- Structural diff: **byte-identical** template body. `data-viz`:
  `{semantic-entropy}` on both sides. Headings: 5/5 match. Box variants:
  `{def: 2, ex: 5, intu: 1, pitfall: 1, res: 1, thm: 1}` on both sides.
  Math expressions: 261/261.
- Visual: scrolled to the `semantic-entropy` viz. Default clustering
  (the "I am not sure. / No idea, sorry." bubble pair and the "Marseille
  / It could be Marseille." bubble pair) and the two entropy bars matched
  exactly:

  | | v1 | platform |
  |---|---|---|
  | Naive entropy (trên chuỗi) | 2.962 bit | 2.962 bit |
  | Semantic entropy (trên nghĩa) | 1.418 bit | 1.418 bit |

- **Verdict: matches. No differences observed.**

## Why the structural diff came back byte-identical

Not a coincidence worth treating as a weaker check: `courses/***REMOVED***/chapters/*.html`
is produced by `tools/extract.py`'s `extract_chapters()`, which pulls each
`tpl-<id>` body out of `***REMOVED***.html` with the exact regex
this task's own comparison script also used, and — per `tools/test_extract.py`
— that extraction step already has its own dedicated test coverage from
the task that built it. What Task 17 adds on top is independent
confirmation that (a) the byte-identity actually still holds against the
live source file for these three chapters specifically, and (b), more
importantly, that **the served bytes survive the full new rendering
pipeline** (fetch → `innerHTML` → `CourseKit.renderKatex` →
`CourseKit.initViz`) with the same visual and numeric output as v1's own
renderer — which the structural diff alone cannot prove, and is exactly
what the visual pass above checked.
