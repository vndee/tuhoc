/**
 * Right-rail chrome. On chapter pages this becomes an in-page TOC
 * (Task 11's job, built from the chapter's own h2/h3s). Here it is a static
 * placeholder so `aside#rail` exists in the DOM skeleton from day one.
 */
export function Rail() {
  return (
    <>
      <p className="rail-h">Trong chương</p>
      <p className="muted">Chưa có nội dung.</p>
    </>
  );
}
