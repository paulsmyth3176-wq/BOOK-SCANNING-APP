/* ShelfScan — personal book inventory. All data stays on this device (localStorage). */
{
const VERSION = '1.0.0';
const KEY = 'shelfscan.books.v1';
const META = 'shelfscan.meta.v1';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- storage ---------- */
let books = load(KEY, {});
let meta = load(META, {});
function load(k, d){ try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } }
function save(){
  try { localStorage.setItem(KEY, JSON.stringify(books)); }
  catch(e){ toast('Could not save — storage full?'); }
  refreshCounts();
}
function saveMeta(){ try { localStorage.setItem(META, JSON.stringify(meta)); } catch {} }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(()=>{});

/* ---------- ISBN helpers ---------- */
function digits(s){ return String(s||'').toUpperCase().replace(/[^0-9X]/g,''); }
function valid13(c){
  if (!/^\d{13}$/.test(c)) return false;
  let s = 0; for (let i=0;i<12;i++) s += (+c[i]) * (i%2 ? 3 : 1);
  return (10 - s%10) % 10 === +c[12];
}
function valid10(c){
  if (!/^\d{9}[\dX]$/.test(c)) return false;
  let s = 0; for (let i=0;i<10;i++) s += (c[i]==='X'?10:+c[i]) * (10-i);
  return s % 11 === 0;
}
function to13(c){
  const b = '978' + c.slice(0,9);
  let s = 0; for (let i=0;i<12;i++) s += (+b[i]) * (i%2 ? 3 : 1);
  return b + ((10 - s%10) % 10);
}
/* returns {isbn} or {error} */
function normalize(raw){
  const c = digits(raw);
  if (c.length === 10 && valid10(c)) return {isbn: to13(c)};
  if (c.length === 13 && valid13(c)){
    if (/^97[89]/.test(c)) return {isbn: c};
    return {error: 'That barcode isn’t an ISBN (it’s a store/UPC code). Look for the barcode starting with 978 or 979 — on mass-market paperbacks it’s often inside the front cover.'};
  }
  if (c.length === 12) return {error: 'That’s a UPC price barcode, not the ISBN. Try the other barcode — often inside the front cover on paperbacks.'};
  if (c.length === 5) return {error: 'That’s the small price add-on. Aim at the larger barcode to its left.'};
  return {error: 'That doesn’t look like a valid ISBN. Check the digits and try again.'};
}
const normTitle = t => String(t||'').toLowerCase().replace(/^(the|a|an)\s+/,'').replace(/[^a-z0-9]+/g,' ').trim();

/* ---------- lookup ---------- */
const lookupCache = {};
async function lookup(isbn){
  if (lookupCache[isbn]) return lookupCache[isbn];
  let info = null;
  try { info = await fromOpenLibrary(isbn); } catch {}
  if (!info || !info.title) { try { info = await fromGoogle(isbn) || info; } catch {} }
  if (info && info.title){
    if (!info.cover) info.cover = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
    lookupCache[isbn] = info;
  }
  return info;
}
async function getJSON(url, ms=8000){
  const ctl = new AbortController(); const t = setTimeout(()=>ctl.abort(), ms);
  try { const r = await fetch(url, {signal: ctl.signal}); if (!r.ok) throw 0; return await r.json(); }
  finally { clearTimeout(t); }
}
async function fromOpenLibrary(isbn){
  const j = await getJSON(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const d = j[`ISBN:${isbn}`]; if (!d) return null;
  return {
    title: d.title, subtitle: d.subtitle || '',
    authors: (d.authors||[]).map(a=>a.name),
    publisher: (d.publishers||[])[0]?.name || '',
    year: (String(d.publish_date||'').match(/\d{4}/)||[''])[0],
    pages: d.number_of_pages || '',
    cover: d.cover?.medium || ''
  };
}
async function fromGoogle(isbn){
  const j = await getJSON(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const v = j.items?.[0]?.volumeInfo; if (!v) return null;
  return {
    title: v.title, subtitle: v.subtitle || '',
    authors: v.authors || [],
    publisher: v.publisher || '',
    year: (String(v.publishedDate||'').match(/\d{4}/)||[''])[0],
    pages: v.pageCount || '',
    cover: (v.imageLinks?.thumbnail || '').replace(/^http:/,'https:')
  };
}

/* ---------- book ops ---------- */
function addBook(isbn, info, status){
  const id = isbn || ('m-' + Date.now());
  const prev = books[id];
  books[id] = Object.assign({
    id, isbn: isbn||'', title: 'Untitled', subtitle:'', authors: [], publisher:'', year:'', pages:'',
    cover:'', shelf:'', notes:'', added: Date.now()
  }, prev||{}, info||{}, {status});
  save();
  return books[id];
}
function otherEdition(isbn, title){
  const n = normTitle(title); if (!n) return null;
  return Object.values(books).find(b => b.id !== isbn && normTitle(b.title) === n) || null;
}

/* ---------- UI: tabs ---------- */
let view = 'scan';
function show(v){
  view = v;
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-'+v));
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v !== 'scan') stopCam();
  if (v === 'lib') renderList();
  if (v === 'more') renderMore();
  window.scrollTo(0,0);
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(b.dataset.v); });

/* ---------- toast ---------- */
let toastT;
function toast(msg){
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(()=>t.classList.remove('on'), 2200);
}
function buzz(p){ try { navigator.vibrate && navigator.vibrate(p); } catch {} }

/* ---------- scan mode ---------- */
let mode = 'check';
const hints = {
  check: 'At the store: scan a book to see if you already have it.',
  own: 'At home: scan your books one after another — each is added to your library automatically.',
  wish: 'Scan books you want to remember to buy later.'
};
function setMode(m){
  mode = m;
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#modeHint').textContent = hints[m];
  meta.mode = m; saveMeta();
}
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
setMode(meta.mode || 'check');

/* ---------- camera + barcode ---------- */
const video = $('#video'), cam = $('#cam');
let stream = null, detector = null, zx = null, scanning = false, lastCode = '', lastSeen = 0, confirmCode = '', paused = false;
const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', {willReadFrequently: true});

async function getDetector(){
  if ('BarcodeDetector' in window){
    try {
      const fm = await BarcodeDetector.getSupportedFormats();
      if (fm.includes('ean_13')) return {kind:'native', d: new BarcodeDetector({formats: ['ean_13','ean_8','upc_a','upc_e'].filter(f=>fm.includes(f))})};
    } catch {}
  }
  // Fallback: ZXing (cached by the service worker for offline use)
  if (!window.ZXing){
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  const Z = window.ZXing;
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const r = new Z.MultiFormatReader(); r.setHints(hints);
  return {kind:'zxing', d: r};
}

async function startCam(){
  if (!navigator.mediaDevices?.getUserMedia){ toast('Camera needs HTTPS — open the app from its https:// address.'); return; }
  $('#startBtn').textContent = 'Starting…';
  try {
    detector = detector || await getDetector();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 720}, focusMode: 'continuous' }
    });
    video.srcObject = stream; await video.play();
    // try continuous autofocus where supported
    const track = stream.getVideoTracks()[0];
    try { const caps = track.getCapabilities?.(); if (caps?.focusMode?.includes('continuous')) await track.applyConstraints({advanced:[{focusMode:'continuous'}]}); } catch {}
    cam.classList.add('live'); scanning = true; paused = false;
    loop();
  } catch(e){
    console.warn(e);
    toast(e && e.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow it in browser site settings.' : 'Could not start the camera.');
  } finally { $('#startBtn').textContent = 'Start camera'; }
}
function stopCam(){
  scanning = false; cam.classList.remove('live');
  if (stream){ stream.getTracks().forEach(t=>t.stop()); stream = null; }
  video.srcObject = null;
}
$('#startBtn').addEventListener('click', startCam);
$('#stopBtn').addEventListener('click', stopCam);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCam(); });

let busy = false, lastTick = 0;
async function loop(ts){
  if (!scanning) return;
  requestAnimationFrame(loop);
  if (busy || paused || !video.videoWidth || (ts && ts - lastTick < 120)) return;
  lastTick = ts || 0; busy = true;
  try {
    let code = null;
    if (detector.kind === 'native'){
      const r = await detector.d.detect(video);
      code = r[0]?.rawValue || null;
    } else {
      // crop the middle band where the guide box is
      const vw = video.videoWidth, vh = video.videoHeight;
      const sy = Math.round(vh*0.3), sh = Math.round(vh*0.4);
      canvas.width = vw; canvas.height = sh;
      ctx.drawImage(video, 0, sy, vw, sh, 0, 0, vw, sh);
      try {
        const Z = window.ZXing;
        const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
        code = detector.d.decode(bmp).getText();
      } catch { code = null; }
    }
    if (code) onCode(code);
  } catch {}
  busy = false;
}
function onCode(code){
  // require two matching reads in a row to avoid misreads
  if (code !== confirmCode){ confirmCode = code; return; }
  confirmCode = '';
  const now = Date.now();
  if (code === lastCode && now - lastSeen < 4000) return; // same book still in view
  lastCode = code; lastSeen = now;
  handle(code, true);
}

$('#manualForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#manualIsbn').value.trim(); if (!v) return;
  $('#manualIsbn').blur();
  handle(v, false);
});

/* ---------- handle a scanned / typed ISBN ---------- */
let seq = 0;
async function handle(raw, fromCam){
  const n = normalize(raw);
  const out = $('#result');
  if (n.error){ buzz(200); out.innerHTML = `<div class="card"><div class="verdict v-no">Not an ISBN<span class="v-sub">${esc(n.error)}</span></div></div>`; return; }
  const isbn = n.isbn, my = ++seq, have = books[isbn];
  if (fromCam) paused = mode === 'check'; // in check mode, freeze on result; add modes keep rolling

  if (mode === 'check'){
    if (have){ buzz([60,60,60]); renderResult(have, have.status); return; }
    buzz(120);
    out.innerHTML = `<div class="card"><div class="verdict v-no">Not in your library<span class="v-sub">ISBN ${esc(isbn)}</span></div><div class="meta"><span class="spin"></span>Looking up the book…</div></div>`;
    const info = await lookup(isbn); if (my !== seq) return;
    renderResult(Object.assign({isbn, id: isbn}, info||{title:''}), null);
    return;
  }

  // add modes
  const status = mode;
  if (have && have.status === status){
    buzz(200);
    renderResult(have, have.status, `Already ${status==='own'?'in your library':'on your wishlist'}`);
    toast('Already have it: ' + (have.title||isbn));
    return;
  }
  buzz(60);
  out.innerHTML = `<div class="card"><div class="meta"><span class="spin"></span>Adding ${esc(isbn)}…</div></div>`;
  let info = have ? null : await lookup(isbn);
  if (my !== seq && !fromCam) return;
  const b = addBook(isbn, info || (have ? null : {title: 'ISBN ' + isbn, needsInfo: true}), status);
  toast((status==='own' ? 'Added: ' : 'Wishlisted: ') + b.title);
  if (my === seq) renderResult(b, status, status==='own' ? 'Added to your library' : 'Added to your wishlist');
}

function coverHTML(b){
  const letter = esc((b.title||'?').trim()[0]||'?');
  return b.cover ? `<div class="cover"><img src="${esc(b.cover)}" alt="" loading="lazy" onerror="this.parentNode.textContent='${letter}'"></div>` : `<div class="cover">${letter}</div>`;
}
function bookBlock(b){
  const by = (b.authors||[]).join(', ');
  const bits = [b.publisher, b.year, b.pages ? b.pages + ' pp' : ''].filter(Boolean).join(' · ');
  return `<div class="book">${coverHTML(b)}<div>
    <h3>${esc(b.title || 'Unknown title')}${b.subtitle ? `<span class="meta" style="display:block;font:400 14px system-ui">${esc(b.subtitle)}</span>`:''}</h3>
    ${by ? `<div>${esc(by)}</div>`:''}
    <div class="meta">${esc(bits)}</div>
    <div class="meta">ISBN ${esc(b.isbn||'—')}${b.shelf ? ' · Shelf: '+esc(b.shelf):''}</div>
  </div></div>`;
}
function renderResult(b, status, headline){
  const out = $('#result');
  let v;
  if (status === 'own') v = `<div class="verdict v-own">${esc(headline || 'You already own this')}<span class="v-sub">Added ${new Date(b.added).toLocaleDateString()}</span></div>`;
  else if (status === 'wish') v = `<div class="verdict v-wish">${esc(headline || 'On your wishlist')}<span class="v-sub">You don’t own it yet</span></div>`;
  else {
    const oe = b.title ? otherEdition(b.isbn, b.title) : null;
    v = `<div class="verdict v-no">Not in your library<span class="v-sub">${oe ? 'But you have another edition: “'+esc(oe.title)+'” ('+(oe.status==='own'?'owned':'wishlist')+')' : (b.title ? 'Safe to buy' : 'Book details not found online')}</span></div>`;
  }
  let actions = '';
  if (!status) actions = `<div class="row actions"><button class="btn-p" data-act="own">I bought it</button><button class="btn-w" data-act="wish">Wishlist</button></div>`;
  else if (status === 'wish') actions = `<div class="row actions"><button class="btn-p" data-act="own">I bought it</button><button class="btn" data-act="edit">Details</button></div>`;
  else actions = `<div class="row actions"><button class="btn" data-act="edit">Details</button></div>`;
  if (paused) actions += `<button class="btn" data-act="next" style="width:100%;margin-top:10px">Scan next book</button>`;
  out.innerHTML = `<div class="card">${v}${b.title ? bookBlock(b) : `<div class="meta">ISBN ${esc(b.isbn)}</div>`}${actions}</div>`;
  out.onclick = e => {
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    if (a === 'next'){ paused = false; lastCode = ''; out.innerHTML = ''; return; }
    if (a === 'edit'){ openEditor(b.id); return; }
    const info = b.title ? b : {title: 'ISBN ' + b.isbn, needsInfo: true};
    const nb = addBook(b.isbn, books[b.isbn] ? null : info, a);
    toast(a === 'own' ? 'Added to your library' : 'Added to wishlist');
    renderResult(nb, a);
    if (!b.title) openEditor(nb.id);
  };
  out.scrollIntoView({behavior:'smooth', block:'nearest'});
}

/* ---------- library list ---------- */
let filter = 'all';
$('#filterChips').addEventListener('click', e => {
  const b = e.target.closest('button[data-f]'); if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('#filterChips button').forEach(x => x.classList.toggle('on', x === b));
  renderList();
});
$('#search').addEventListener('input', renderList);
$('#sort').addEventListener('change', () => { meta.sort = $('#sort').value; saveMeta(); renderList(); });
if (meta.sort) $('#sort').value = meta.sort;

function renderList(){
  const q = $('#search').value.trim().toLowerCase();
  const qd = digits(q);
  let arr = Object.values(books).filter(b => filter === 'all' || b.status === filter);
  if (q) arr = arr.filter(b => [b.title, b.subtitle, (b.authors||[]).join(' '), b.shelf, b.notes, b.publisher].join(' ').toLowerCase().includes(q) || (qd.length >= 4 && (b.isbn||'').includes(qd)));
  const s = $('#sort').value;
  const lastName = b => ((b.authors||[])[0]||'').trim().split(/\s+/).pop().toLowerCase();
  arr.sort(s === 'title' ? (a,b) => normTitle(a.title).localeCompare(normTitle(b.title))
         : s === 'author' ? (a,b) => lastName(a).localeCompare(lastName(b)) || normTitle(a.title).localeCompare(normTitle(b.title))
         : (a,b) => b.added - a.added);
  const list = $('#list');
  if (!arr.length){
    list.innerHTML = `<li class="empty" style="display:block;cursor:default">${Object.keys(books).length ? 'No books match.' : 'No books yet.<br>Go to <b>Scan</b>, choose <b>Add to library</b>, and scan your shelves.'}</li>`;
    return;
  }
  list.innerHTML = arr.map(b => `<li data-id="${esc(b.id)}">${coverHTML(b)}<div>
      <div class="t">${esc(b.title)}${b.status==='wish'?'<span class="tag">Wishlist</span>':''}</div>
      <div class="a">${esc((b.authors||[]).join(', ') || '—')}${b.shelf ? ' · '+esc(b.shelf):''}</div>
    </div></li>`).join('');
}
$('#list').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) openEditor(li.dataset.id); });

/* ---------- editor sheet ---------- */
const sheetBg = $('#sheetBg'), sheet = $('#sheet');
function closeSheet(){ sheetBg.classList.remove('on'); }
sheetBg.addEventListener('click', e => { if (e.target === sheetBg) closeSheet(); });

function openEditor(id){
  const isNew = !id;
  const b = isNew ? {id:'', isbn:'', title:'', subtitle:'', authors:[], publisher:'', year:'', shelf:'', notes:'', status:'own', added: Date.now()} : books[id];
  if (!b) return;
  sheet.innerHTML = `
    <h2>${isNew ? 'Add a book' : 'Book details'}</h2>
    ${isNew ? '' : bookBlock(b)}
    <form id="edForm">
      <label for="edTitle">Title</label><input id="edTitle" required value="${esc(b.needsInfo ? '' : b.title)}" placeholder="Title">
      <label for="edAuth">Author(s) — separate with commas</label><input id="edAuth" value="${esc((b.authors||[]).join(', '))}">
      <div class="row">
        <div><label for="edIsbn">ISBN</label><input id="edIsbn" inputmode="numeric" value="${esc(b.isbn)}" ${isNew?'':'readonly'}></div>
        <div><label for="edYear">Year</label><input id="edYear" inputmode="numeric" value="${esc(b.year)}"></div>
      </div>
      <div class="row">
        <div><label for="edStatus">Status</label><select id="edStatus"><option value="own">Owned</option><option value="wish">Wishlist</option></select></div>
        <div><label for="edShelf">Shelf / location</label><input id="edShelf" value="${esc(b.shelf)}" placeholder="e.g. Office, top"></div>
      </div>
      <label for="edNotes">Notes</label><textarea id="edNotes" rows="2" placeholder="Signed copy, lent to…, read 2025">${esc(b.notes)}</textarea>
      <div class="row actions"><button class="btn-p" type="submit">Save</button><button class="btn" type="button" id="edCancel">Cancel</button></div>
      ${isNew ? '' : `<div class="row actions">${b.isbn ? '<button class="btn" type="button" id="edRefresh">Re-fetch details</button>':''}<button class="btn btn-d" type="button" id="edDel">Delete</button></div>`}
    </form>`;
  $('#edStatus').value = b.status || 'own';
  sheetBg.classList.add('on');
  $('#edCancel').onclick = closeSheet;
  $('#edForm').onsubmit = async e => {
    e.preventDefault();
    const fields = {
      title: $('#edTitle').value.trim(), authors: $('#edAuth').value.split(',').map(s=>s.trim()).filter(Boolean),
      year: $('#edYear').value.trim(), shelf: $('#edShelf').value.trim(), notes: $('#edNotes').value.trim(), needsInfo: false
    };
    const status = $('#edStatus').value;
    if (isNew){
      const raw = $('#edIsbn').value.trim(); let isbn = '';
      if (raw){ const n = normalize(raw); if (n.error){ toast('ISBN looks invalid'); return; } isbn = n.isbn; }
      if (isbn && books[isbn]){ toast('Already in your list'); openEditor(isbn); return; }
      addBook(isbn, fields, status);
    } else {
      Object.assign(books[id], fields, {status}); save();
    }
    closeSheet(); toast('Saved'); if (view === 'lib') renderList();
  };
  const del = $('#edDel');
  if (del) del.onclick = () => {
    if (del.dataset.sure){ delete books[id]; save(); closeSheet(); toast('Deleted'); $('#result').innerHTML=''; if (view==='lib') renderList(); }
    else { del.dataset.sure = 1; del.textContent = 'Tap again to delete'; }
  };
  const rf = $('#edRefresh');
  if (rf) rf.onclick = async () => {
    rf.textContent = 'Fetching…'; delete lookupCache[b.isbn];
    const info = await lookup(b.isbn);
    if (info){ Object.assign(books[id], info, {needsInfo:false}); save(); toast('Updated'); openEditor(id); if (view==='lib') renderList(); }
    else { rf.textContent = 'Not found online'; }
  };
}
$('#addManualBtn').addEventListener('click', () => openEditor(null));

/* ---------- more: stats, backup, import ---------- */
function refreshCounts(){
  const all = Object.values(books);
  const own = all.filter(b=>b.status==='own').length;
  $('#hdrCount').textContent = own ? own + (own===1?' book':' books') : '';
}
function renderMore(){
  const all = Object.values(books);
  $('#stOwn').textContent = all.filter(b=>b.status==='own').length;
  $('#stWish').textContent = all.filter(b=>b.status==='wish').length;
  $('#stAuth').textContent = new Set(all.flatMap(b=>b.authors||[]).map(a=>a.toLowerCase())).size;
  $('#backupInfo').textContent = 'Your list is stored on this phone only. ' + (meta.lastBackup ? 'Last backup: ' + new Date(meta.lastBackup).toLocaleDateString() + '.' : 'You haven’t saved a backup yet.') + ' Save one now and then (to Google Drive, email, etc.).';
  $('#ver').textContent = 'Version ' + VERSION + '.';
  const missing = all.filter(b => b.needsInfo && b.isbn).length;
  let fb = $('#fillBtn');
  if (missing && !fb){
    fb = document.createElement('button'); fb.id = 'fillBtn'; fb.className = 'btn'; fb.style.cssText = 'width:100%;margin-top:10px';
    $('#importFile').parentNode.appendChild(fb); fb.onclick = fillMissing;
  }
  if (fb){ fb.textContent = missing ? `Fetch details for ${missing} book${missing>1?'s':''}` : 'All details filled in'; fb.disabled = !missing; }
}
async function fillMissing(){
  const fb = $('#fillBtn'); const todo = Object.values(books).filter(b => b.needsInfo && b.isbn);
  let done = 0;
  for (const b of todo){
    fb.textContent = `Fetching ${++done} of ${todo.length}…`;
    const info = await lookup(b.isbn);
    if (info){ Object.assign(books[b.id], info, {needsInfo:false}); }
    await new Promise(r=>setTimeout(r, 350));
  }
  save(); renderMore(); toast('Done');
}

function download(name, text, type){
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1000);
}
const stamp = () => new Date().toISOString().slice(0,10);
$('#exportJson').addEventListener('click', () => {
  download(`shelfscan-backup-${stamp()}.json`, JSON.stringify({app:'ShelfScan', version: VERSION, exported: new Date().toISOString(), books: Object.values(books)}, null, 1), 'application/json');
  meta.lastBackup = Date.now(); saveMeta(); renderMore();
});
$('#exportCsv').addEventListener('click', () => {
  const cols = ['isbn','title','subtitle','authors','publisher','year','pages','status','shelf','notes','added'];
  const q = v => '"' + String(v ?? '').replace(/"/g,'""') + '"';
  const rows = Object.values(books).map(b => cols.map(c => q(c==='authors' ? (b.authors||[]).join('; ') : c==='added' ? new Date(b.added).toISOString().slice(0,10) : c==='status' ? (b.status==='own'?'owned':'wishlist') : b[c])).join(','));
  download(`shelfscan-${stamp()}.csv`, '﻿' + cols.join(',') + '\n' + rows.join('\n'), 'text/csv');
});

function parseCSV(text){
  const rows = []; let row = [], f = '', q = false;
  const head = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : 500);
  const delim = head.includes(',') ? ',' : head.includes('\t') ? '\t' : ';';
  for (let i=0;i<text.length;i++){
    const c = text[i];
    if (q){ if (c === '"'){ if (text[i+1] === '"'){ f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim){ row.push(f); f=''; }
    else if (c === '\n'){ row.push(f); rows.push(row); row=[]; f=''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length){ row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function importCSV(text){
  const rows = parseCSV(text.replace(/^﻿/,'')); if (rows.length < 2) return [];
  const h = rows[0].map(x => x.trim().toLowerCase());
  const find = (...names) => { for (const n of names){ const i = h.findIndex(x => x === n); if (i>=0) return i; } for (const n of names){ const i = h.findIndex(x => x.includes(n)); if (i>=0) return i; } return -1; };
  const iI13 = find('isbn13','isbn_13','isbn-13','ean_isbn13','ean'), iI = find('isbn','upc_isbn10','isbn10'),
        iT = find('title'), iA = find('author','authors','creators','primary author'),
        iY = find('year published','year','publication year','publish_date','date published'),
        iP = find('publisher'), iS = find('exclusive shelf','status','read status'), iSh = h.findIndex(x => ['shelf','location','collection','room'].includes(x)),
        iN = find('notes','private notes','comments');
  const out = [];
  for (const r of rows.slice(1)){
    const g = i => i>=0 ? (r[i]||'').replace(/^="?|"$/g,'').trim() : '';
    let isbn = '';
    for (const cand of [g(iI13), g(iI)]) { const n = cand && normalize(cand); if (n && n.isbn){ isbn = n.isbn; break; } }
    const title = g(iT);
    if (!isbn && !title) continue;
    const st = g(iS).toLowerCase();
    out.push({
      isbn, title: title || ('ISBN ' + isbn), needsInfo: !title,
      authors: g(iA) ? g(iA).split(/;|\s&\s|\|/).map(s=>s.trim()).filter(Boolean) : [],
      year: (g(iY).match(/\d{4}/)||[''])[0], publisher: g(iP),
      status: /to-read|want|wish|planned/.test(st) ? 'wish' : 'own',
      shelf: iSh !== iS ? g(iSh) : '', notes: g(iN)
    });
  }
  return out;
}
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const text = await file.text(); let list = [];
  try {
    if (/^\s*[\[{]/.test(text)){ const j = JSON.parse(text); list = Array.isArray(j) ? j : (j.books || Object.values(j)); }
    else list = importCSV(text);
  } catch { toast('Could not read that file'); return; }
  let added = 0, skipped = 0;
  for (const b of list){
    if (!b || !b.title && !b.isbn) continue;
    let isbn = '';
    if (b.isbn){ const n = normalize(b.isbn); if (n.isbn) isbn = n.isbn; }
    const id = isbn || b.id || ('m-' + Date.now() + '-' + added);
    if (books[id] || (!isbn && Object.values(books).some(x => normTitle(x.title) === normTitle(b.title)))){ skipped++; continue; }
    books[id] = Object.assign({shelf:'', notes:'', authors:[], cover:'', subtitle:'', publisher:'', year:'', pages:'', added: Date.now()}, b, {id, isbn, status: b.status === 'wish' ? 'wish' : 'own'});
    added++;
  }
  save(); e.target.value = '';
  toast(`Imported ${added} book${added===1?'':'s'}${skipped ? `, skipped ${skipped} duplicate${skipped===1?'':'s'}` : ''}`);
  renderMore();
});

$('#wipeBtn').addEventListener('click', e => {
  const b = e.currentTarget;
  if (!b.dataset.sure){ b.dataset.sure = 1; b.textContent = 'Tap again to delete ALL ' + Object.keys(books).length + ' books'; setTimeout(()=>{ delete b.dataset.sure; b.textContent = 'Delete all books'; }, 4000); return; }
  books = {}; save(); renderMore(); $('#result').innerHTML=''; toast('All books deleted'); delete b.dataset.sure; b.textContent = 'Delete all books';
});

/* ---------- boot ---------- */
refreshCounts();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(()=>{});
window.ShelfScan = { normalize, importCSV, get books(){ return books; } }; // for testing
}
