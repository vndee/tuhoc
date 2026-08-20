/* =====================================================================
   CORE UTILITIES
   ===================================================================== */
const $ = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
function el(tag, attrs, kids){
  const e = document.createElement(tag);
  if(attrs) for(const k in attrs){
    if(k==='class') e.className = attrs[k];
    else if(k==='html') e.innerHTML = attrs[k];
    else if(k==='text') e.textContent = attrs[k];
    else if(k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  if(kids) (Array.isArray(kids)?kids:[kids]).forEach(k=> e.appendChild(typeof k==='string'? document.createTextNode(k): k));
  return e;
}
function cssv(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
const PAL = ()=> ['--s1','--s2','--s3','--s4','--s5','--s6','--s7','--s8'].map(cssv);
function seqRamp(){ return ['--seq-100','--seq-150','--seq-200','--seq-250','--seq-300','--seq-350','--seq-400',
  '--seq-450','--seq-500','--seq-550','--seq-600','--seq-650','--seq-700'].map(cssv); }
function seqColor(t){ const r = seqRamp(); t = Math.max(0,Math.min(1,t)); const i = t*(r.length-1);
  return r[Math.round(i)]; }
function mix(hex, a){ // hex -> rgba
  const h = hex.replace('#',''); const n = h.length===3 ? h.split('').map(c=>c+c).join('') : h;
  const v = parseInt(n,16); return `rgba(${(v>>16)&255},${(v>>8)&255},${v&255},${a})`;
}
const fmt = (v,d=3)=> (v===undefined||v===null||!isFinite(v)) ? '—' : (Math.abs(v)<1e-12?0:v).toFixed(d);
const fmt2 = v=> fmt(v,2);
const clamp = (v,a,b)=> Math.max(a,Math.min(b,v));
const lerp = (a,b,t)=> a+(b-a)*t;
const range = n=> Array.from({length:n},(_,i)=>i);
const sum = a=> a.reduce((x,y)=>x+y,0);
const norm = a=> { const s = sum(a); return s>0 ? a.map(x=>x/s) : a.map(()=>1/a.length); };

/* seeded RNG */
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; } }
function gaussRng(rng){ let u=0,v=0; while(!u)u=rng(); while(!v)v=rng();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

/* =====================================================================
   INFORMATION-THEORY MATH
   ===================================================================== */
const LN2 = Math.LN2;
const log2 = x=> Math.log(x)/LN2;
const plogp = p=> p>0 ? p*log2(p) : 0;
function H(p){ return -p.reduce((s,x)=> s+plogp(x), 0); }            // bits
function Hnat(p){ return H(p)*LN2; }
function Hb(p){ return (p<=0||p>=1)?0: -(p*log2(p)+(1-p)*log2(1-p)); }
function KL(p,q){ let s=0; for(let i=0;i<p.length;i++){ if(p[i]>0){ if(q[i]<=0) return Infinity;
  s += p[i]*log2(p[i]/q[i]); } } return s; }
function JS(p,q){ const m = p.map((x,i)=>0.5*(x+q[i])); return 0.5*KL(p,m)+0.5*KL(q,m); }
function CE(p,q){ let s=0; for(let i=0;i<p.length;i++){ if(p[i]>0) s -= p[i]*log2(Math.max(q[i],1e-300)); } return s; }
function renyi(p, a){
  if(Math.abs(a-1)<1e-9) return H(p);
  if(a===0) return log2(p.filter(x=>x>1e-12).length);
  if(!isFinite(a)) return -log2(Math.max(...p));
  return log2(p.reduce((s,x)=> s + (x>0?Math.pow(x,a):0),0))/(1-a);
}
function tsallis(p,q){ if(Math.abs(q-1)<1e-9) return Hnat(p);
  return (1 - p.reduce((s,x)=>s+(x>0?Math.pow(x,q):0),0))/(q-1); }
function renyiDiv(p,q,a){
  if(Math.abs(a-1)<1e-9) return KL(p,q);
  let s=0; for(let i=0;i<p.length;i++){ if(p[i]>0) s += Math.pow(p[i],a)*Math.pow(Math.max(q[i],1e-300),1-a); }
  return log2(s)/(a-1);
}
/* joint distribution helpers: J is 2-D array J[i][j] */
function jMarginalX(J){ return J.map(r=> sum(r)); }
function jMarginalY(J){ const n=J[0].length; return range(n).map(j=> sum(J.map(r=>r[j]))); }
function jH(J){ return H(J.flat()); }
function jMI(J){ const px=jMarginalX(J), py=jMarginalY(J);
  let s=0; for(let i=0;i<J.length;i++) for(let j=0;j<J[0].length;j++){
    if(J[i][j]>0) s += J[i][j]*log2(J[i][j]/(px[i]*py[j])); } return s; }
function jNormalize(J){ const t = sum(J.flat()); return J.map(r=> r.map(v=> t>0? v/t : 0)); }

/* Gaussian */
const gpdf = (x,mu,s)=> Math.exp(-0.5*((x-mu)/s)**2)/(s*Math.sqrt(2*Math.PI));
function erf(x){ const s=Math.sign(x); x=Math.abs(x);
  const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911;
  const t=1/(1+p*x); const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x); return s*y; }
const gcdf = (x,mu,s)=> 0.5*(1+erf((x-mu)/(s*Math.SQRT2)));

/* Blahut–Arimoto: channel capacity. W[x][y] */
function blahutCapacity(W, iters=400){
  const nx=W.length, ny=W[0].length; let r = new Array(nx).fill(1/nx); const hist=[];
  for(let t=0;t<iters;t++){
    const q = []; // q[y][x]
    for(let y=0;y<ny;y++){ let d=0; for(let x=0;x<nx;x++) d += r[x]*W[x][y];
      q.push(range(nx).map(x=> d>0 ? r[x]*W[x][y]/d : 0)); }
    const lr = range(nx).map(x=>{ let s=0; for(let y=0;y<ny;y++) if(W[x][y]>0 && q[y][x]>0) s += W[x][y]*Math.log(q[y][x]); return s; });
    const m = Math.max(...lr); const e = lr.map(v=> Math.exp(v-m)); const Z = sum(e);
    r = e.map(v=> v/Z);
    // current I
    const J = W.map((row,x)=> row.map(v=> r[x]*v));
    hist.push(jMI(J));
  }
  return {p:r, C:hist[hist.length-1], hist};
}
/* Blahut–Arimoto for rate–distortion. d[x][y], p source */
function blahutRD(p, d, beta, iters=300){
  const nx=p.length, ny=d[0].length; let q = new Array(ny).fill(1/ny);
  let Q=null;
  for(let t=0;t<iters;t++){
    Q = []; // Q[x][y]
    for(let x=0;x<nx;x++){
      const w = range(ny).map(y=> q[y]*Math.exp(-beta*d[x][y]));
      const Z = sum(w); Q.push(w.map(v=> Z>0? v/Z : 0));
    }
    q = range(ny).map(y=> sum(range(nx).map(x=> p[x]*Q[x][y])));
  }
  const J = Q.map((row,x)=> row.map(v=> p[x]*v));
  const R = jMI(J);
  let D=0; for(let x=0;x<nx;x++) for(let y=0;y<ny;y++) D += p[x]*Q[x][y]*d[x][y];
  return {R, D, Q, q};
}
/* Huffman */
function huffman(probs, syms){
  syms = syms || probs.map((_,i)=>String.fromCharCode(65+i));
  let nodes = probs.map((p,i)=> ({p, sym:syms[i], leaf:true, id:i}));
  const steps=[]; let nid = probs.length;
  const live = nodes.slice();
  while(live.length>1){
    live.sort((a,b)=> a.p-b.p || a.id-b.id);
    const a=live.shift(), b=live.shift();
    const m = {p:a.p+b.p, leaf:false, l:a, r:b, id:nid++};
    steps.push({a,b,m, remaining: live.map(n=>n.p)});
    live.push(m);
  }
  const root = live[0];
  const codes={}; const depths={};
  (function walk(n, code){ if(!n) return; if(n.leaf){ codes[n.sym]= code||'0'; depths[n.sym]=(code||'0').length; return; }
    walk(n.l, code+'0'); walk(n.r, code+'1'); })(root,'');
  const L = probs.reduce((s,p,i)=> s + p*codes[syms[i]].length, 0);
  return {root, codes, L, steps};
}
function kraftSum(lens){ return lens.reduce((s,l)=> s + Math.pow(2,-l), 0); }

/* =====================================================================
   PLOT ENGINE  (canvas, retina, hover)
   ===================================================================== */
const REDRAWS = [];
class Plot{
  constructor(host, o){
    this.o = Object.assign({h:280, padL:54, padR:18, padT:16, padB:38, xlab:'', ylab:'', ar:null}, o||{});
    this.wrap = el('div',{class:'relwrap'});
    this.cv = el('canvas'); this.wrap.appendChild(this.cv);
    this.tipEl = el('div',{class:'tip'}); this.wrap.appendChild(this.tipEl);
    host.appendChild(this.wrap);
    this.ctx = this.cv.getContext('2d');
    this.dom = {x0:0,x1:1,y0:0,y1:1};
    this._hover = null;
    this.cv.addEventListener('mousemove', e=>{ if(this.onhover){ const r=this.cv.getBoundingClientRect();
      this.onhover(e.clientX-r.left, e.clientY-r.top, e); } });
    this.cv.addEventListener('mouseleave', ()=>{ if(this.onleave) this.onleave(); this.hideTip(); });
    this.cv.addEventListener('touchmove', e=>{ if(this.onhover && e.touches[0]){ const r=this.cv.getBoundingClientRect();
      this.onhover(e.touches[0].clientX-r.left, e.touches[0].clientY-r.top, e); e.preventDefault(); } }, {passive:false});
    const ro = new ResizeObserver(()=> this.resize());
    ro.observe(host);
    this._ro = ro;
    REDRAWS.push(()=> this.resize());
    requestAnimationFrame(()=> this.resize());
  }
  resize(){
    const w = this.wrap.clientWidth || 640;
    const h = this.o.ar ? Math.round(w*this.o.ar) : this.o.h;
    const dpr = Math.min(window.devicePixelRatio||1, 2.5);
    this.W = w; this.Hh = h;
    this.cv.width = Math.round(w*dpr); this.cv.height = Math.round(h*dpr);
    this.cv.style.width = w+'px'; this.cv.style.height = h+'px';
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    if(this.render) this.render();
  }
  setDom(x0,x1,y0,y1){ this.dom={x0,x1,y0,y1}; }
  get L(){ return this.o.padL } get R(){ return this.W-this.o.padR }
  get T(){ return this.o.padT } get B(){ return this.Hh-this.o.padB }
  X(v){ const d=this.dom; return this.L + (v-d.x0)/(d.x1-d.x0)*(this.R-this.L); }
  Y(v){ const d=this.dom; return this.B - (v-d.y0)/(d.y1-d.y0)*(this.B-this.T); }
  iX(px){ const d=this.dom; return d.x0 + (px-this.L)/(this.R-this.L)*(d.x1-d.x0); }
  iY(py){ const d=this.dom; return d.y0 + (this.B-py)/(this.B-this.T)*(d.y1-d.y0); }
  clear(){ const c=this.ctx; c.clearRect(0,0,this.W,this.Hh); }
  axes(o){
    o = Object.assign({xt:null, yt:null, xf:v=>fmt(v,1), yf:v=>fmt(v,1), grid:true, xlab:this.o.xlab, ylab:this.o.ylab, zeroline:false}, o||{});
    const c=this.ctx, d=this.dom;
    const xt = o.xt || niceTicks(d.x0,d.x1,6), yt = o.yt || niceTicks(d.y0,d.y1,5);
    c.save();
    c.font = '11px '+cssv('--sans').replace(/"/g,'"');
    c.textBaseline='middle';
    if(o.grid){ c.strokeStyle=cssv('--grid'); c.lineWidth=1;
      yt.forEach(v=>{ const y=Math.round(this.Y(v))+.5; c.beginPath(); c.moveTo(this.L,y); c.lineTo(this.R,y); c.stroke(); });
    }
    c.strokeStyle=cssv('--axis'); c.lineWidth=1;
    c.beginPath(); c.moveTo(this.L, this.B+.5); c.lineTo(this.R, this.B+.5); c.stroke();
    c.fillStyle=cssv('--ink-3'); c.textAlign='center';
    xt.forEach(v=>{ const x=this.X(v); if(x<this.L-1||x>this.R+1) return;
      c.beginPath(); c.moveTo(x, this.B); c.lineTo(x, this.B+4); c.stroke();
      c.fillText(o.xf(v), x, this.B+14); });
    c.textAlign='right';
    yt.forEach(v=>{ const y=this.Y(v); if(y<this.T-1||y>this.B+1) return; c.fillText(o.yf(v), this.L-8, y); });
    if(o.zeroline && d.y0<0 && d.y1>0){ c.strokeStyle=cssv('--axis'); c.setLineDash([3,3]);
      const y=Math.round(this.Y(0))+.5; c.beginPath(); c.moveTo(this.L,y); c.lineTo(this.R,y); c.stroke(); c.setLineDash([]); }
    if(o.xlab){ c.textAlign='center'; c.fillStyle=cssv('--ink-2'); c.font='11.5px '+cssv('--sans');
      c.fillText(o.xlab, (this.L+this.R)/2, this.Hh-6); }
    if(o.ylab){ c.save(); c.translate(11, (this.T+this.B)/2); c.rotate(-Math.PI/2); c.textAlign='center';
      c.fillStyle=cssv('--ink-2'); c.font='11.5px '+cssv('--sans'); c.fillText(o.ylab,0,0); c.restore(); }
    c.restore();
  }
  clipPlot(fn){ const c=this.ctx; c.save(); c.beginPath();
    c.rect(this.L-1,this.T-1,this.R-this.L+2,this.B-this.T+2); c.clip(); fn(); c.restore(); }
  line(pts, color, lw=2, dash=null){
    const c=this.ctx; if(!pts.length) return; c.save(); c.strokeStyle=color; c.lineWidth=lw;
    c.lineJoin='round'; c.lineCap='round'; if(dash) c.setLineDash(dash);
    c.beginPath(); let started=false;
    pts.forEach(p=>{ if(p===null||!isFinite(p[1])){ started=false; return; }
      const x=this.X(p[0]), y=this.Y(p[1]); if(!started){ c.moveTo(x,y); started=true; } else c.lineTo(x,y); });
    c.stroke(); c.restore();
  }
  area(pts, color, base=null){
    const c=this.ctx; if(!pts.length) return; const b = base===null? this.dom.y0 : base;
    c.save(); c.fillStyle=color; c.beginPath();
    c.moveTo(this.X(pts[0][0]), this.Y(b));
    pts.forEach(p=> c.lineTo(this.X(p[0]), this.Y(p[1])));
    c.lineTo(this.X(pts[pts.length-1][0]), this.Y(b)); c.closePath(); c.fill(); c.restore();
  }
  bars(items, o){ // items: {x, y, color, label}
    o = Object.assign({w:null, r:4, gap:2}, o||{});
    const c=this.ctx; const n=items.length;
    const bw = o.w || ((this.R-this.L)/n - o.gap);
    items.forEach((it,i)=>{
      const cx = o.w? this.X(it.x) : this.L + (i+0.5)*((this.R-this.L)/n);
      const x = cx-bw/2, y=this.Y(it.y), h=this.Y(this.dom.y0)-y;
      c.fillStyle = it.color; roundRectTop(c, x, y, bw, Math.max(h,0), Math.min(o.r, bw/2));
      c.fill();
    });
  }
  dot(x,y,color,r=4,ring=true){ const c=this.ctx; c.save();
    if(ring){ c.beginPath(); c.arc(this.X(x),this.Y(y),r+2,0,7); c.fillStyle=cssv('--surface-1'); c.fill(); }
    c.beginPath(); c.arc(this.X(x),this.Y(y),r,0,7); c.fillStyle=color; c.fill(); c.restore(); }
  vline(x,color,dash=[4,4],lw=1.5){ const c=this.ctx; c.save(); c.strokeStyle=color; c.lineWidth=lw; c.setLineDash(dash);
    c.beginPath(); c.moveTo(this.X(x),this.T); c.lineTo(this.X(x),this.B); c.stroke(); c.restore(); }
  hline(y,color,dash=[4,4],lw=1.5){ const c=this.ctx; c.save(); c.strokeStyle=color; c.lineWidth=lw; c.setLineDash(dash);
    c.beginPath(); c.moveTo(this.L,this.Y(y)); c.lineTo(this.R,this.Y(y)); c.stroke(); c.restore(); }
  label(x,y,txt,color,o){ o=Object.assign({align:'left', baseline:'middle', dx:6, dy:0, size:11.5, weight:600, bg:false},o||{});
    const c=this.ctx; c.save(); c.font=`${o.weight} ${o.size}px ${cssv('--sans')}`; c.textAlign=o.align; c.textBaseline=o.baseline;
    const px=this.X(x)+o.dx, py=this.Y(y)+o.dy;
    if(o.bg){ const m=c.measureText(txt); c.fillStyle=mix(cssv('--surface-1').replace('#','#'),0.86);
      c.fillStyle=cssv('--surface-1'); c.globalAlpha=.86;
      c.fillRect(px-(o.align==='right'?m.width+3:3), py-8, m.width+6, 16); c.globalAlpha=1; }
    c.fillStyle=color; c.fillText(txt,px,py); c.restore(); }
  showTip(px,py,html){ this.tipEl.innerHTML=html; this.tipEl.classList.add('on');
    const w=this.tipEl.offsetWidth, h=this.tipEl.offsetHeight;
    let x=px+12, y=py-h-10; if(x+w>this.W-4) x=px-w-12; if(y<2) y=py+14;
    this.tipEl.style.left=x+'px'; this.tipEl.style.top=y+'px'; }
  hideTip(){ this.tipEl.classList.remove('on'); }
}
function roundRectTop(c,x,y,w,h,r){ r=Math.min(r,w/2,h); c.beginPath();
  c.moveTo(x,y+h); c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y); c.lineTo(x+w-r,y);
  c.quadraticCurveTo(x+w,y,x+w,y+r); c.lineTo(x+w,y+h); c.closePath(); }
function niceTicks(a,b,n){
  if(!(isFinite(a)&&isFinite(b))||a===b) return [a];
  const span=(b-a)/n; const mag=Math.pow(10,Math.floor(Math.log10(span)));
  const err=span/mag; let step = mag*(err>=7.5?10:err>=3.5?5:err>=1.5?2:1);
  const out=[]; for(let v=Math.ceil(a/step)*step; v<=b+step*1e-9; v+=step) out.push(Math.abs(v)<step*1e-9?0:v);
  return out;
}
function fn2pts(f, x0, x1, n=280){ const out=[]; for(let i=0;i<=n;i++){ const x=x0+(x1-x0)*i/n; out.push([x,f(x)]); } return out; }

/* ---- UI helpers ---- */
function slider(host, o){
  o = Object.assign({label:'', min:0, max:1, step:.01, value:.5, fmt:v=>fmt(v,2), oninput:()=>{}}, o);
  const val = el('b',{text:o.fmt(o.value)});
  const lab = el('label',null,[document.createTextNode(o.label), val]);
  const inp = el('input',{type:'range', min:o.min, max:o.max, step:o.step, value:o.value});
  const c = el('div',{class:'ctrl'},[lab,inp]);
  inp.addEventListener('input', ()=>{ val.textContent=o.fmt(+inp.value); o.oninput(+inp.value); });
  host.appendChild(c);
  return {input:inp, get value(){return +inp.value}, set value(v){ inp.value=v; val.textContent=o.fmt(v); },
          setLabel:t=>{ val.textContent=t; }, el:c};
}
function seg(host, o){
  const w = el('div',{class:'ctrl'});
  if(o.label) w.appendChild(el('label',{text:o.label}));
  const g = el('div',{class:'seg'}); let cur=o.value;
  const btns = o.options.map(op=>{
    const b = el('button',{text:op.label, class: op.value===cur?'on':''});
    b.addEventListener('click', ()=>{ cur=op.value; btns.forEach(x=>x.classList.remove('on')); b.classList.add('on'); o.onchange(op.value); });
    g.appendChild(b); return b; });
  w.appendChild(g); host.appendChild(w);
  return {get value(){return cur}, set(v){ const i=o.options.findIndex(x=>x.value===v); if(i>=0) btns[i].click(); }, el:w};
}
function checkbox(host, o){
  const inp = el('input',{type:'checkbox'}); inp.checked=!!o.value;
  const l = el('label',{class:'chk'},[inp, document.createTextNode(' '+o.label)]);
  const w = el('div',{class:'ctrl'},[l]); host.appendChild(w);
  inp.addEventListener('change',()=>o.onchange(inp.checked));
  return {get value(){return inp.checked}, el:w};
}
function button(host, label, fn, cls){ const b=el('button',{class:'btn '+(cls||''), text:label}); b.addEventListener('click',fn);
  const w=el('div',{class:'ctrl'},[el('label',{html:'&nbsp;'}), b]); host.appendChild(w); return b; }
function ctrlRow(host){ const d=el('div',{class:'ctrls'}); host.appendChild(d); return d; }
function readout(host, keys){
  const r = el('div',{class:'readout'});
  const cells={};
  keys.forEach(k=>{ const v=el('div',{class:'v',text:'—'}); const c=el('div',{class:'cell'},[el('div',{class:'k',html:k.label}), v]);
    r.appendChild(c); cells[k.id]=v; });
  host.appendChild(r);
  return {set(id,txt,color){ if(cells[id]){ cells[id].textContent=txt; if(color) cells[id].style.color=color; } }, el:r};
}
function legendRow(host, items){
  const d = el('div',{class:'legend'});
  items.forEach(it=> d.appendChild(el('span',{class:'k'},[el('i',{class: it.line?'ln':'', style:`background:${it.color}`}), document.createTextNode(it.label)])));
  host.appendChild(d); return d;
}

/* viz registry */
const VIZ = {};
function defineViz(name, fn){ VIZ[name] = fn; }

function renderKatex(root){
  if(!window.renderMathInElement) return;
  try{
    renderMathInElement(root, {
      delimiters:[
        {left:'$$', right:'$$', display:true},
        {left:'\\[', right:'\\]', display:true},
        {left:'$', right:'$', display:false},
        {left:'\\(', right:'\\)', display:false}
      ],
      throwOnError:false, strict:false,
      macros:{'\\Pr':'\\operatorname{Pr}','\\Var':'\\operatorname{Var}'}
    });
  }catch(e){ console.warn('katex', e); }
}

function initViz(root){
  $$('[data-viz]', root).forEach(node=>{
    const name = node.dataset.viz;
    if(node.dataset.done) return;
    const fn = VIZ[name];
    if(!fn){ node.innerHTML = '<div class="small muted" style="padding:20px;font-family:var(--sans)">[mô phỏng "'+name+'" chưa sẵn sàng]</div>'; return; }
    node.dataset.done='1';
    try{ fn(node); }
    catch(e){ console.error('viz '+name, e);
      node.innerHTML = '<div class="small" style="padding:16px;font-family:var(--sans);color:var(--ink-3)">Không dựng được mô phỏng này trong trình duyệt hiện tại.</div>'; }
  });
}

window.CourseKit = { initViz, renderKatex, REDRAWS, VIZ };
