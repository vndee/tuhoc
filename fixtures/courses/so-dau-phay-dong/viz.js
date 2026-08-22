/* =====================================================================
   "Số dấu phẩy động" — mô phỏng của course.

   Chạy trong cùng phạm vi toàn cục với packages/course-kit/runtime.js, nên
   `defineViz`, `Plot`, `el`, `slider`, `seg`, `button`, `readout`,
   `ctrlRow`, `legendRow`, `PAL`, `seqColor`, `cssv`, `mix`, `fmt`, `clamp`,
   `fn2pts` đã có sẵn. Không nạp thêm gì từ bên ngoài.

   Mỗi `defineViz(...)` mở đầu một dòng — cổng e2e đọc danh sách tên bằng
   biểu thức chính quy neo đầu dòng, nên đừng thụt lề chúng vào.
   ===================================================================== */

/* ---------- số học binary64 THẬT, không mô phỏng ---------- */
const _f64 = new Float64Array(1);
const _u64 = new BigUint64Array(_f64.buffer);

/** Số biểu diễn được kề `x` theo hướng `dir` (±1) — đúng nghĩa nextafter. */
function nextAfter(x, dir) {
  if (Number.isNaN(x)) return x;
  if (x === 0) return dir > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  _f64[0] = x;
  const away = (x > 0) === (dir > 0);
  _u64[0] += away ? 1n : -1n;
  return _f64[0];
}

/** ULP(x): khoảng cách tới số kề sau, đo về phía xa gốc. */
function ulpOf(x) {
  const a = Math.abs(x);
  if (a === 0) return Number.MIN_VALUE;
  if (!isFinite(a)) return NaN;
  return nextAfter(a, 1) - a;
}

/** 64 bit của `x` thành chuỗi nhị phân. */
function bits64(x) {
  _f64[0] = x;
  return _u64[0].toString(2).padStart(64, '0');
}

/**
 * Tổng ĐÚNG của một mảng double, làm tròn đúng một lần ở cuối (Shewchuk).
 * Đây là mốc để đo sai số của ba cách cộng ở Chương 2.2; một mốc tính bằng
 * chính phép cộng đang bị đo thì không đo được gì.
 */
function exactSum(xs) {
  const partials = [];
  let k = 0;
  for (let i = 0; i < xs.length; i++) {
    let x = xs[i];
    k = 0;
    for (let j = 0; j < partials.length; j++) {
      let y = partials[j];
      if (Math.abs(x) < Math.abs(y)) { const t = x; x = y; y = t; }
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) partials[k++] = lo;
      x = hi;
    }
    partials.length = k;
    partials.push(x);
  }
  let s = 0;
  for (let j = partials.length - 1; j >= 0; j--) s += partials[j];
  return s;
}

/* ---------- một định dạng ĐỒ CHƠI, để nhìn thấy toàn bộ tập số ---------- */
/**
 * Mọi giá trị hữu hạn không âm của định dạng `(e bit mũ, p bit định trị)`,
 * theo đúng luật IEEE 754: dưới chuẩn ở số mũ nhỏ nhất, bit ẩn 1 ở phần còn
 * lại. binary64 có hơn 2^63 giá trị nên không vẽ được; (3, 2) có 25.
 */
function toyValues(e, p) {
  const bias = (1 << (e - 1)) - 1;
  const seen = new Set();
  for (let E = 0; E < (1 << e) - 1; E++) {
    for (let m = 0; m < (1 << p); m++) {
      const frac = m / (1 << p);
      seen.add(E === 0 ? frac * Math.pow(2, 1 - bias) : (1 + frac) * Math.pow(2, E - bias));
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/* ---------- ba cách cộng của Chương 2.2 ---------- */
function sumNaive(xs, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += xs[i];
  return s;
}
function sumKahan(xs, n) {
  let s = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const y = xs[i] - c;
    const t = s + y;
    c = (t - s) - y;
    s = t;
  }
  return s;
}
function sumPairwise(xs, lo, hi) {
  if (hi - lo <= 8) {
    let s = 0;
    for (let i = lo; i < hi; i++) s += xs[i];
    return s;
  }
  const mid = (lo + hi) >> 1;
  return sumPairwise(xs, lo, mid) + sumPairwise(xs, mid, hi);
}

/**
 * Dãy của Chương 2.2: một số lớn rồi rất nhiều số 1.
 *
 * `1e16` nằm trong binade $[2^{53}, 2^{54})$, nơi ULP đúng bằng 2 — nên
 * `1e16 + 1` hoà đúng giữa hai số máy và làm tròn về chính `1e16`. Cộng
 * xuôi từ trái sang phải mất TRỌN từng số hạng một; sai số cuối bằng đúng
 * số số hạng đã cộng, và đó là con số học viên đọc thẳng trên trục tung.
 */
const BIG = 1e16;
function driftSeries(n) {
  const xs = new Array(n).fill(1);
  xs[0] = BIG;
  return xs;
}

/* ======================= COVER HERO =======================
   Không chương nào tham chiếu tên này — nó thuộc trang bìa của một bản dựng
   khác. Nó vẫn phải chạy được, nên cổng e2e nạp thẳng nó qua
   CourseKit.initViz thay vì miễn trừ.
   ========================================================= */
defineViz('cover-hero', host => {
  const p = new Plot(host, { h: 250, padL: 64, padR: 20, padT: 20, padB: 38, xlab: 'x', ylab: 'khoảng cách tới số máy kế tiếp' });
  p.render = () => {
    const C = PAL();
    p.clear();
    p.setDom(0, 16, 0, 2.6);
    p.axes({ xf: v => fmt(v, 0), yf: v => fmt(v, 1) });
    p.clipPlot(() => {
      const step = x => (x <= 0 ? 0 : Math.pow(2, Math.floor(Math.log2(x))) / 4);
      const pts = fn2pts(step, 0.02, 16, 600);
      p.area(pts, mix(C[0], 0.14));
      p.line(pts, C[0], 2.4);
      for (let k = 0; k <= 4; k++) p.vline(Math.pow(2, k), cssv('--axis'), [3, 3], 1);
      p.label(1.2, 2.34, 'x gấp đôi thì lưới cũng gấp đôi', C[0], { size: 12.5 });
    });
  };
});

/* ======================= 0.1 — SỐ THẬP PHÂN ĐÁP XUỐNG ĐÂU ======================= */
defineViz('decimal-landing', host => {
  const ctrls = ctrlRow(host);
  let target = 0.1;
  const out = readout(host, [
    { id: 'stored', label: 'giá trị THỰC SỰ được lưu (20 chữ số)' },
    { id: 'ulp', label: 'ULP tại đây' },
    { id: 'rel', label: 'sai lệch tương đối tối đa' },
  ]);
  const p = new Plot(host, { h: 220, padL: 62, padR: 20, padT: 20, padB: 42, xlab: 'lệch khỏi số máy được chọn, tính bằng ULP', ylab: '' });

  seg(ctrls, {
    label: 'số thập phân',
    value: 0.1,
    options: [
      { label: '0,1', value: 0.1 },
      { label: '0,2', value: 0.2 },
      { label: '0,3', value: 0.3 },
      { label: '0,5', value: 0.5 },
      { label: '1,1', value: 1.1 },
    ],
    onchange: v => { target = v; p.render(); },
  });

  p.render = () => {
    const C = PAL();
    p.clear();
    p.setDom(-3.2, 3.2, 0, 1);
    p.axes({ yt: [], xf: v => fmt(v, 0), grid: false });
    p.clipPlot(() => {
      const c = p.ctx;
      c.save();
      c.strokeStyle = cssv('--axis');
      c.lineWidth = 1.5;
      for (let k = -3; k <= 3; k++) {
        const x = p.X(k);
        c.beginPath();
        c.moveTo(x, p.Y(0.18));
        c.lineTo(x, p.Y(0.62));
        c.stroke();
      }
      c.restore();
      p.area([[-0.5, 0], [-0.5, 0.9], [0.5, 0.9], [0.5, 0]], mix(C[2], 0.18), 0);
      p.dot(0, 0.4, C[1], 6);
      p.label(0, 0.78, 'mọi số thực trong dải này đều lưu thành cùng một số máy', C[2], { align: 'center', dx: 0, size: 11.5 });
      p.label(0.14, 0.4, 'số máy được chọn', C[1], { size: 12 });
    });
    out.set('stored', target.toPrecision(20).replace('.', ','));
    out.set('ulp', ulpOf(target).toExponential(3));
    out.set('rel', (0.5 * ulpOf(target) / target).toExponential(2));
  };
});

/* ======================= 0.2 — TOÀN BỘ TẬP SỐ CỦA MỘT ĐỊNH DẠNG ======================= */
defineViz('spacing-ruler', host => {
  const ctrls = ctrlRow(host);
  let pbits = 2;
  const p = new Plot(host, { h: 215, padL: 40, padR: 22, padT: 24, padB: 42, xlab: 'giá trị', ylab: '' });
  slider(ctrls, {
    label: 'số bit định trị p = ',
    min: 1, max: 4, step: 1, value: 2,
    fmt: v => fmt(v, 0),
    oninput: v => { pbits = v; p.render(); },
  });
  p.render = () => {
    const C = PAL();
    p.clear();
    const vals = toyValues(3, pbits).filter(v => v <= 8.5);
    p.setDom(0, 8.5, 0, 1);
    p.axes({ yt: [], xf: v => fmt(v, 1), grid: false });
    p.clipPlot(() => {
      const c = p.ctx;
      vals.forEach((v, i) => {
        c.save();
        c.strokeStyle = seqColor(v === 0 ? 0 : clamp(Math.log2(v + 1) / 3.2, 0, 1));
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(p.X(v), p.Y(0.16));
        c.lineTo(p.X(v), p.Y(i % 2 ? 0.72 : 0.86));
        c.stroke();
        c.restore();
      });
      for (let k = 0; k <= 2; k++) {
        const a = Math.pow(2, k), b = Math.pow(2, k + 1);
        p.area([[a, 0], [a, 0.11], [b, 0.11], [b, 0]], mix(C[k % 4], 0.24), 0);
        p.label((a + b) / 2, 0.05, '[2^' + k + ', 2^' + (k + 1) + ')', cssv('--ink-2'), { align: 'center', dx: 0, size: 10.5 });
      }
      p.label(0.1, 0.95, vals.length + ' giá trị — mỗi binade có đúng ' + (1 << pbits) + ' cái', cssv('--ink-2'), { size: 11.5 });
    });
  };
});

/* ======================= 1.1 — BA TRƯỜNG ======================= */
defineViz('bit-lab', host => {
  const ctrls = ctrlRow(host);
  let sgn = 0, E = 127, M = 0;
  const out = readout(host, [
    { id: 'val', label: 'giá trị' },
    { id: 'form', label: 'dạng' },
    { id: 'ulp', label: 'ULP tại đây' },
  ]);
  // Hai Plot trong CÙNG một host: dải bit ở trên, vị trí trên trục số ở dưới.
  const pb = new Plot(host, { h: 98, padL: 30, padR: 20, padT: 26, padB: 26, xlab: '', ylab: '' });
  const pl = new Plot(host, { h: 172, padL: 54, padR: 22, padT: 18, padB: 40, xlab: 'giá trị (thang log2)', ylab: '' });

  const redraw = () => { pb.render(); pl.render(); };
  seg(ctrls, {
    label: 'dấu s',
    value: 0,
    options: [{ label: '+', value: 0 }, { label: '−', value: 1 }],
    onchange: v => { sgn = v; redraw(); },
  });
  slider(ctrls, { label: 'số mũ E = ', min: 1, max: 254, step: 1, value: 127, fmt: v => fmt(v, 0), oninput: v => { E = v; redraw(); } });
  slider(ctrls, { label: 'định trị M = ', min: 0, max: 7, step: 1, value: 0, fmt: v => fmt(v, 0), oninput: v => { M = v; redraw(); } });

  const value = () => Math.pow(-1, sgn) * (1 + M / 8) * Math.pow(2, E - 127);

  pb.render = () => {
    const C = PAL();
    pb.clear();
    const c = pb.ctx;
    const w = (pb.R - pb.L) / 32;
    const all = String(sgn) + E.toString(2).padStart(8, '0') + (M << 20).toString(2).padStart(23, '0');
    for (let i = 0; i < 32; i++) {
      const col = i === 0 ? C[1] : i <= 8 ? C[0] : C[2];
      c.fillStyle = all[i] === '1' ? col : mix(col, 0.16);
      c.fillRect(pb.L + i * w + 0.6, pb.T, w - 1.2, pb.B - pb.T);
    }
    c.save();
    c.font = '10px ' + cssv('--sans');
    c.textAlign = 'center';
    c.fillStyle = cssv('--ink-3');
    c.fillText('s', pb.L + 0.5 * w, pb.T - 9);
    c.fillText('số mũ (8 bit)', pb.L + 5 * w, pb.T - 9);
    c.fillText('phần định trị (23 bit)', pb.L + 20.5 * w, pb.T - 9);
    c.restore();
  };

  pl.render = () => {
    const C = PAL();
    pl.clear();
    pl.setDom(-40, 40, 0, 1);
    pl.axes({ yt: [], xf: v => '2^' + fmt(v, 0), grid: false });
    const v = value();
    const lg = clamp(Math.log2(Math.abs(v)), -40, 40);
    pl.clipPlot(() => {
      pl.area([[-40, 0], [-40, 0.5], [40, 0.5], [40, 0]], mix(C[0], 0.12), 0);
      for (let k = -36; k <= 36; k += 4) pl.vline(k, cssv('--grid'), [2, 4], 1);
      // `[]` chứ KHÔNG phải `null`: `Plot.vline` khai `dash = [4,4]` làm tham
      // số mặc định, mà mặc định chỉ áp cho `undefined` — truyền `null` đi
      // thẳng vào `setLineDash(null)` và ném TypeError. Đúng lỗi mà cổng
      // viz.spec.ts bắt được ở lượt chạy đầu của gói này.
      pl.vline(lg, C[1], [], 2);
      pl.dot(lg, 0.5, C[1], 5);
      pl.label(lg, 0.8, fmt(v, 6), C[1], { align: 'center', dx: 0, size: 12, bg: true });
    });
    out.set('val', String(v));
    out.set('form', '(−1)^' + sgn + ' · (1 + ' + M + '/8) · 2^(' + E + '−127)');
    out.set('ulp', ulpOf(v).toExponential(3));
  };
});

/* ======================= 1.2 — ĐƯỜNG ULP ======================= */
defineViz('ulp-curve', host => {
  const p = new Plot(host, { h: 250, padL: 66, padR: 22, padT: 18, padB: 42, xlab: 'x (thang log2)', ylab: 'log2 của ULP(x)' });
  p.render = () => {
    const C = PAL();
    p.clear();
    p.setDom(-8, 8, -61, -43);
    p.axes({ xf: v => '2^' + fmt(v, 0), yf: v => fmt(v, 0) });
    p.clipPlot(() => {
      const pts = [];
      for (let i = 0; i <= 600; i++) {
        const lg = -8 + 16 * i / 600;
        pts.push([lg, Math.log2(ulpOf(Math.pow(2, lg)))]);
      }
      p.area(pts, mix(C[0], 0.13), -61);
      p.line(pts, C[0], 2.4);
      p.line(fn2pts(lg => lg - 52, -8, 8, 200), mix(C[1], 0.85), 1.6, [5, 4]);
      p.label(-7.6, -45.4, 'ULP(x) — bậc thang, nhảy ở mỗi luỹ thừa của 2', C[0], { size: 12 });
      p.label(-7.6, -47.4, 'x · 2^−52 — đường liên tục nó bám theo', mix(C[1], 0.95), { size: 12 });
    });
  };
});

/* ======================= 1.2 — ĐI BỘ QUA CÁC SỐ KỀ NHAU =======================
   Cố ý KHÔNG có canvas: đây là một widget DOM. Trình đọc phải chạy được cả
   hai loại mô phỏng, nên course này giữ đúng một cái thuộc loại kia.
   ============================================================================ */
defineViz('nextafter-walk', host => {
  let x = 1;
  const ctrls = ctrlRow(host);
  const box = el('div', { class: 'readout' });
  const cells = {};
  [['v', 'giá trị (18 chữ số)'], ['b', '64 bit: dấu · mũ · …đuôi định trị'], ['u', 'ULP tại đây']].forEach(pair => {
    const v = el('div', { class: 'v', text: '—' });
    box.appendChild(el('div', { class: 'cell' }, [el('div', { class: 'k', text: pair[1] }), v]));
    cells[pair[0]] = v;
  });
  host.appendChild(box);

  const upd = () => {
    cells.v.textContent = x.toPrecision(18);
    const b = bits64(x);
    cells.b.textContent = b[0] + ' ' + b.slice(1, 12) + ' …' + b.slice(-14);
    cells.u.textContent = ulpOf(x).toExponential(3);
  };
  seg(ctrls, {
    label: 'điểm xuất phát',
    value: 1,
    options: [
      { label: '1', value: 1 },
      { label: '0,1', value: 0.1 },
      { label: '2²⁰', value: 1048576 },
    ],
    onchange: v => { x = v; upd(); },
  });
  button(ctrls, '← số kề trước', () => { x = nextAfter(x, -1); upd(); });
  button(ctrls, 'số kề sau →', () => { x = nextAfter(x, 1); upd(); });
  upd();
});

/* ======================= 1.3 — BỐN CHẾ ĐỘ LÀM TRÒN ======================= */
defineViz('rounding-modes', host => {
  const ctrls = ctrlRow(host);
  let t = 0.5;
  let mode = 'even';
  const p = new Plot(host, { h: 235, padL: 44, padR: 22, padT: 26, padB: 44, xlab: 'vị trí của x giữa hai số máy kề nhau (đơn vị ULP)', ylab: '' });
  slider(ctrls, { label: 'x nằm ở ', min: 0, max: 1, step: 0.01, value: 0.5, oninput: v => { t = v; p.render(); } });
  seg(ctrls, {
    label: 'chế độ',
    value: 'even',
    options: [
      { label: 'gần nhất, hoà→chẵn', value: 'even' },
      { label: 'về 0', value: 'zero' },
      { label: 'lên +∞', value: 'up' },
      { label: 'xuống −∞', value: 'down' },
    ],
    onchange: v => { mode = v; p.render(); },
  });
  p.render = () => {
    const C = PAL();
    p.clear();
    p.setDom(-0.16, 1.16, 0, 1);
    p.axes({ yt: [], xt: [0, 0.5, 1], xf: v => fmt(v, 1), grid: false });
    // Số máy bên trái mang định trị chẵn, nên "hoà → chẵn" chọn nó.
    const pick = mode === 'zero' || mode === 'down' ? 0
      : mode === 'up' ? 1
        : t < 0.5 ? 0 : t > 0.5 ? 1 : 0;
    p.clipPlot(() => {
      p.area([[0, 0], [0, 0.62], [1, 0.62], [1, 0]], mix(C[0], 0.12), 0);
      const c = p.ctx;
      [0, 1].forEach(v => {
        c.save();
        c.strokeStyle = v === pick ? C[2] : cssv('--axis');
        c.lineWidth = v === pick ? 3.5 : 1.5;
        c.beginPath();
        c.moveTo(p.X(v), p.Y(0.08));
        c.lineTo(p.X(v), p.Y(0.74));
        c.stroke();
        c.restore();
      });
      p.dot(t, 0.42, C[1], 6);
      p.label(t, 0.55, 'x', C[1], { align: 'center', dx: 0, size: 13 });
      p.label(pick, 0.84, 'kết quả', C[2], { align: 'center', dx: 0, size: 12 });
      p.label(0.5, 0.96, 'sai số = ' + fmt(Math.abs(t - pick), 3) + ' ULP', cssv('--ink-2'), { align: 'center', dx: 0, size: 12 });
      p.vline(0.5, cssv('--axis'), [3, 3], 1);
    });
  };
});

/* ======================= 2.1 — TRIỆT TIÊU ======================= */
defineViz('cancellation', host => {
  const p = new Plot(host, { h: 250, padL: 72, padR: 22, padT: 20, padB: 42, xlab: 'log2 của khoảng cách tương đối giữa a và b', ylab: 'số bit đúng còn lại trong hiệu' });
  p.render = () => {
    const C = PAL();
    p.clear();
    p.setDom(-52, 0, 0, 56);
    p.axes({ xf: v => fmt(v, 0), yf: v => fmt(v, 0) });
    p.clipPlot(() => {
      const pts = fn2pts(d => clamp(53 + d, 0, 53), -52, 0, 300);
      p.area(pts, mix(C[1], 0.14));
      p.line(pts, C[1], 2.4);
      p.hline(53, mix(C[0], 0.85), [5, 4], 1.6);
      p.label(-51, 54.4, '53 bit — độ chính xác đầy đủ của binary64', mix(C[0], 0.95), { size: 12 });
      p.area([[-52, 0], [-52, 10], [-43, 10], [-43, 0]], mix(C[1], 0.26), 0);
      p.label(-47.5, 14, 'vùng vô nghĩa', C[1], { align: 'center', dx: 0, size: 12 });
      p.label(-27, 34, 'mỗi bit đầu trùng nhau là một bit đúng bị mất', cssv('--ink-2'), { size: 11.5 });
    });
  };
});

/* ======================= 2.2 — SAI SỐ DỒN KHI CỘNG ======================= */
defineViz('sum-drift', host => {
  const ctrls = ctrlRow(host);
  let n = 2000;
  let legendDone = false;
  const out = readout(host, [
    { id: 'naive', label: 'cộng xuôi' },
    { id: 'pair', label: 'chia đôi' },
    { id: 'kahan', label: 'Kahan' },
    { id: 'exact', label: 'đúng' },
  ]);
  // Hai Plot trong CÙNG một host: sai số tích luỹ ở trên, sai số cuối theo n
  // ở dưới. Cái dưới là thứ trả lời "sai số lớn theo n như thế nào".
  const pa = new Plot(host, { h: 215, padL: 74, padR: 22, padT: 18, padB: 40, xlab: 'số số hạng đã cộng', ylab: 'sai số tuyệt đối' });
  const pb = new Plot(host, { h: 180, padL: 74, padR: 22, padT: 18, padB: 40, xlab: 'n', ylab: 'sai số cuối' });

  slider(ctrls, {
    label: 'n = ', min: 500, max: 6000, step: 500, value: 2000, fmt: v => fmt(v, 0),
    oninput: v => { n = v; pa.render(); pb.render(); },
  });

  const XS = driftSeries(6000);
  const truth = k => exactSum(XS.slice(0, k));
  const running = algo => {
    const pts = [];
    const step = Math.max(1, Math.floor(n / 140));
    for (let i = step; i <= n; i += step) pts.push([i, Math.abs(algo(i) - truth(i))]);
    return pts;
  };

  pa.render = () => {
    const C = PAL();
    pa.clear();
    const a = running(k => sumNaive(XS, k));
    const b = running(k => sumPairwise(XS, 0, k));
    const kh = running(k => sumKahan(XS, k));
    const top = Math.max(1, ...a.map(q => q[1])) * 1.18;
    pa.setDom(0, n, 0, top);
    pa.axes({ xf: v => fmt(v, 0), yf: v => fmt(v, 0) });
    pa.clipPlot(() => {
      pa.area(a, mix(C[1], 0.14));
      pa.line(a, C[1], 2.4);
      pa.line(b, C[3], 2.2, [5, 4]);
      pa.line(kh, C[2], 2.4);
    });
    if (!legendDone) {
      legendDone = true;
      legendRow(host, [
        { label: 'cộng xuôi', color: C[1] },
        { label: 'chia đôi', color: C[3] },
        { label: 'Kahan', color: C[2] },
      ]);
    }
    out.set('naive', String(sumNaive(XS, n)));
    out.set('pair', String(sumPairwise(XS, 0, n)));
    out.set('kahan', String(sumKahan(XS, n)));
    out.set('exact', String(truth(n)));
  };

  pb.render = () => {
    const C = PAL();
    pb.clear();
    const pts = [];
    for (let k = 250; k <= 6000; k += 250) pts.push([k, Math.abs(sumNaive(XS, k) - truth(k))]);
    const top = Math.max(1, ...pts.map(q => q[1])) * 1.18;
    pb.setDom(0, 6000, 0, top);
    pb.axes({ xf: v => fmt(v, 0), yf: v => fmt(v, 0) });
    pb.clipPlot(() => {
      pb.area(pts, mix(C[1], 0.17));
      pb.line(pts, C[1], 2.2);
      pb.vline(n, cssv('--axis'), [4, 4], 1.5);
      pb.label(n, top * 0.86, 'n hiện tại', cssv('--ink-2'), { size: 11.5, bg: true });
    });
  };
});
