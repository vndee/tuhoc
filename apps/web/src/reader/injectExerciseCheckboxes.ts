/**
 * Injects a "done" checkbox into every `.box.ex .box-h` under `root` —
 * one per exercise box, mapped to `useProgress`'s `exDone(chapterId, n)` /
 * `toggleEx(chapterId, n)` by `n`, the box's 0-based position among ALL
 * `.box.ex` elements in DOM order (`querySelectorAll` order === source
 * order). Deliberately NOT parsed from the box's own heading text (e.g.
 * "Bài 1 · …"): the course content has exercise boxes with no numeral at
 * all (see `courses/***REMOVED***/chapters/*.html`'s "Danh mục cần
 * thuộc lòng" box) and any renumbering of exercises in the source content
 * would silently break a text-parsed index; DOM order over the fragment
 * `ChapterView` just set via `innerHTML` is stable and always present.
 *
 * `ChapterView` owns `root` (the `<div>` it sets `innerHTML` on) via a
 * plain ref, never through React's vdom — see that module's own doc
 * comment on why. This function is written to the same discipline: it
 * only ever touches nodes inside `.box.ex .box-h`, the same way `initViz`
 * only ever touches `[data-viz]` nodes, so the two can never fight over
 * the same element even though both mutate the same subtree.
 *
 * Idempotent by construction, not by a separate "already ran" flag: each
 * `.box-h` is checked for an existing checkbox first, and the element is
 * created only if missing. This means the function is SAFE — cheap, not
 * merely non-broken — to call on every render pass that might need to
 * resync checked state (e.g. after a remote sync pull changes exercise
 * progress while the chapter is on screen), not just the one render pass
 * that first sets `innerHTML`. The `checked` property is always written
 * on every call (create-if-missing, then always sync), so an existing
 * checkbox never goes stale even when this function is called many times
 * across the life of one chapter view.
 */

const CHECKBOX_WRAPPER_CLASS = 'ex-check';

export interface ExerciseCheckboxCallbacks {
  /** Whether exercise box `n` (0-based, DOM order) is marked done. */
  isDone: (n: number) => boolean;
  /** Called when the learner (un)checks exercise box `n`. */
  toggle: (n: number) => void;
}

export function injectExerciseCheckboxes(root: ParentNode, callbacks: ExerciseCheckboxCallbacks): void {
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('.box.ex'));

  boxes.forEach((box, index) => {
    const boxHeading = box.querySelector<HTMLElement>('.box-h');
    if (!boxHeading) return;

    let input = boxHeading.querySelector<HTMLInputElement>(`.${CHECKBOX_WRAPPER_CLASS} input[type="checkbox"]`);
    if (!input) {
      const label = document.createElement('label');
      label.className = CHECKBOX_WRAPPER_CLASS;

      input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('aria-label', `Đánh dấu đã làm bài tập ${index + 1}`);
      input.addEventListener('change', () => callbacks.toggle(index));

      const text = document.createElement('span');
      text.textContent = 'Đã làm';

      label.appendChild(input);
      label.appendChild(text);
      boxHeading.appendChild(label);
    }

    input.checked = callbacks.isDone(index);
  });
}
