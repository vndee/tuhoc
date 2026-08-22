/**
 * Injects a "done" checkbox into every `.box.ex .box-h` under `root` —
 * one per exercise box, mapped to `useProgress`'s `exDone(chapterId, n)` /
 * `toggleEx(chapterId, n)` by `n`, the box's 0-based position among ALL
 * `.box.ex` elements in DOM order (`querySelectorAll` order === source
 * order). Deliberately NOT parsed from the box's own heading text (e.g.
 * "Bài 1 · …"): real course content has exercise boxes with no numeral at
 * all (measured on the v1 textbook this reader was ported from — its
 * "Danh mục cần thuộc lòng" box) and any renumbering of exercises
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

import type { Translate } from '../i18n';

const CHECKBOX_WRAPPER_CLASS = 'ex-check';

export interface ExerciseCheckboxCallbacks {
  /** Whether exercise box `n` (0-based, DOM order) is marked done. */
  isDone: (n: number) => boolean;
  /** Called when the learner (un)checks exercise box `n`. */
  toggle: (n: number) => void;
}

/**
 * `t` là THAM SỐ, không phải một `t` gắn sẵn ngôn ngữ nhập từ đâu đó: hàm này
 * dựng DOM ngoài cây React (`ChapterView` sở hữu `root` qua một ref), nên nó
 * không có context nào để đọc — và một biến toàn cục ở đây là bản sao THỨ HAI
 * của trạng thái mà `<LanguageProvider>` đã giữ.
 */
export function injectExerciseCheckboxes(
  root: ParentNode,
  callbacks: ExerciseCheckboxCallbacks,
  t: Translate,
): void {
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
      input.setAttribute('aria-label', t('reader.exerciseCheckbox', String(index + 1)));
      input.addEventListener('change', () => callbacks.toggle(index));

      const text = document.createElement('span');
      text.textContent = t('reader.exerciseDone');

      label.appendChild(input);
      label.appendChild(text);
      boxHeading.appendChild(label);
    }

    input.checked = callbacks.isDone(index);
  });
}
