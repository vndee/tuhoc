import { describe, expect, it, vi } from 'vitest';
import { injectExerciseCheckboxes } from './injectExerciseCheckboxes';

function twoExerciseBoxesFragment(): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="box ex"><div class="box-h">Bài 1 · Đề bài đầu tiên</div><p>Nội dung 1</p></div>
    <p>Đoạn văn xen giữa, không phải bài tập.</p>
    <div class="box ex"><div class="box-h">Bài 2 · Đề bài thứ hai</div><p>Nội dung 2</p></div>
  `;
  return container;
}

describe('injectExerciseCheckboxes', () => {
  it('injects exactly one checkbox into each .box.ex .box-h, in DOM order', () => {
    const container = twoExerciseBoxesFragment();
    injectExerciseCheckboxes(container, { isDone: () => false, toggle: vi.fn() });

    const checkboxes = container.querySelectorAll('.box.ex .box-h input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
  });

  it('is idempotent: calling it a second time on the same DOM does not add a second checkbox per box', () => {
    const container = twoExerciseBoxesFragment();
    const callbacks = { isDone: () => false, toggle: vi.fn() };

    injectExerciseCheckboxes(container, callbacks);
    injectExerciseCheckboxes(container, callbacks);
    injectExerciseCheckboxes(container, callbacks);

    const checkboxes = container.querySelectorAll('.box.ex .box-h input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
  });

  it('sets initial checked state from callbacks.isDone(index) — 0-based DOM order, not parsed from "Bài N" text', () => {
    const container = twoExerciseBoxesFragment();
    // Only the SECOND box (index 1) is done — proves index is DOM-order based,
    // since the original app has exercise boxes with no numeral at all
    // (e.g. "Danh mục cần thuộc lòng"), so parsing "Bài N" text would be unreliable.
    injectExerciseCheckboxes(container, { isDone: (n) => n === 1, toggle: vi.fn() });

    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>('.box.ex .box-h input[type="checkbox"]'));
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
  });

  it('re-syncs checked state on a later call without recreating the checkbox element', () => {
    const container = twoExerciseBoxesFragment();
    let doneState = [false, false];
    const callbacks = { isDone: (n: number) => doneState[n], toggle: vi.fn() };

    injectExerciseCheckboxes(container, callbacks);
    const firstPassInput = container.querySelectorAll<HTMLInputElement>('.box.ex .box-h input[type="checkbox"]')[0];

    doneState = [true, false];
    injectExerciseCheckboxes(container, callbacks);
    const secondPassInput = container.querySelectorAll<HTMLInputElement>('.box.ex .box-h input[type="checkbox"]')[0];

    expect(secondPassInput).toBe(firstPassInput); // same node, not recreated
    expect(secondPassInput.checked).toBe(true);
  });

  it('calls callbacks.toggle(index) with the box\'s DOM-order index when its checkbox is changed', () => {
    const container = twoExerciseBoxesFragment();
    const toggle = vi.fn();
    injectExerciseCheckboxes(container, { isDone: () => false, toggle });

    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>('.box.ex .box-h input[type="checkbox"]'));
    checkboxes[1].checked = true;
    checkboxes[1].dispatchEvent(new Event('change', { bubbles: true }));

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith(1);
  });

  it('does nothing (no throw) when a .box.ex is missing its .box-h', () => {
    const container = document.createElement('div');
    container.innerHTML = `<div class="box ex"><p>Không có box-h</p></div>`;

    expect(() => injectExerciseCheckboxes(container, { isDone: () => false, toggle: vi.fn() })).not.toThrow();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it('does nothing when there are no .box.ex elements at all', () => {
    const container = document.createElement('div');
    container.innerHTML = `<div class="box def"><div class="box-h">Định nghĩa</div></div>`;

    injectExerciseCheckboxes(container, { isDone: () => false, toggle: vi.fn() });
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });
});
