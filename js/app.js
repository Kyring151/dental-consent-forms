/* ============================================================
 * 主逻辑：模板选择 → 条款编辑（勾选/微调/增删）→ 物理分页 A4 预览 → 打印 / 导出 PDF
 * 草稿自动保存 localStorage，键名 draft:<templateId>
 * ============================================================ */

const $tplList = document.getElementById('tplList');
const $editor = document.getElementById('editor');
const $doc = document.getElementById('doc');
const $btnPrint = document.getElementById('btnPrint');
const $btnPdf = document.getElementById('btnPdf');
const $btnReset = document.getElementById('btnReset');
const $btnLogo = document.getElementById('btnLogo');
const $logoInput = document.getElementById('logoInput');
const $logoWrap = document.getElementById('logoWrap');
const $logoThumb = document.getElementById('logoThumb');
const $logoDel = document.getElementById('logoDel');
document.getElementById('toolVer').textContent = TOOL_VERSION;

/* ---------- 轻提示 ---------- */
const toastEl = document.createElement('div');
toastEl.className = 'toast';
document.body.appendChild(toastEl);
let toastTimer = null;
function toast(msg, isErr) {
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* 每个模板的项目缩略图（本地生成，assets/icons/ 目录） */
const TPL_ICONS = {
  'resin-filling': 'assets/icons/resin_s.jpg',
  'root-canal': 'assets/icons/endo_s.jpg',
  'extraction': 'assets/icons/forceps_s.jpg',
  'crown': 'assets/icons/bridge_s.jpg'
};

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/* 患者信息栏默认字段（w = 行内宽度占比 %，同一行合计 100） */
const DEFAULT_META_FIELDS = [
  { label: '患者姓名', w: 30 }, { label: '性别', w: 12 }, { label: '年龄', w: 12 }, { label: '病历号', w: 46 },
  { label: '科室', w: 16 }, { label: '诊断', w: 30 }, { label: '治疗牙位', w: 28 }, { label: '联系电话', w: 26 }
];

let currentId = null;
let activeTpl = null;   // 当前编辑中的完整模板（含注入的共用声明）

/* 全文排版设置（全局，所有项目共用） */
const FONT_KEY = 'cb_font';
let fontCfg = { size: 14, color: '#111111' };
try {
  const saved = JSON.parse(localStorage.getItem(FONT_KEY) || 'null');
  if (saved && saved.size >= 10 && saved.size <= 24) fontCfg = saved;
} catch { /* 用默认 */ }

/* ---------- 草稿读写 ---------- */
function draftKey(id) { return 'draft:' + id; }

function loadDraft(id) {
  try { return JSON.parse(localStorage.getItem(draftKey(id))) || null; }
  catch { return null; }
}

function saveDraft() {
  if (!currentId) return;
  const state = { edits: {}, customs: {}, layout: collectLayout() };
  document.querySelectorAll('#editor .clause').forEach(el => {
    const sec = el.dataset.sec, idx = el.dataset.idx;
    const text = el.querySelector('.text').textContent;
    const on = el.querySelector('input[type=checkbox]').checked;
    let style = null;
    try { style = JSON.parse(el.dataset.style || 'null'); } catch { style = null; }
    if (!on || el.dataset.custom === '1' || text !== el.dataset.orig || style) {
      state.edits[`${sec}:${idx}`] = { on, text, style };
    }
    if (el.dataset.custom === '1') {
      (state.customs[sec] = state.customs[sec] || []).push({ idx, text });
    }
  });
  localStorage.setItem(draftKey(currentId), JSON.stringify(state));
}

/* ---------- 版式设置（患者信息栏 + 签字区） ---------- */
function collectLayout() {
  const meta = [];
  document.querySelectorAll('.ls-meta .ls-row').forEach(row => {
    meta.push({
      label: row.querySelector('.ls-text').textContent,
      on: row.querySelector('input[type=checkbox]').checked,
      w: parseFloat(row.dataset.w) || 0
    });
  });
  const sign = [];
  document.querySelectorAll('.ls-sign .ls-row').forEach(row => {
    sign.push({
      label: row.querySelector('.ls-text').textContent,
      on: row.querySelector('input[type=checkbox]').checked,
      line: Math.max(0, parseInt(row.querySelector('.ls-line').value) || 0)
    });
  });
  return { meta, sign };
}

function buildLayoutSettings(tpl) {
  const draft = loadDraft(tpl.id);
  const meta = (draft && draft.layout && Array.isArray(draft.layout.meta) && draft.layout.meta.length)
    ? draft.layout.meta
    : DEFAULT_META_FIELDS.map(f => ({ label: f.label, on: true, w: f.w }));
  const sign = (draft && draft.layout && Array.isArray(draft.layout.sign) && draft.layout.sign.length)
    ? draft.layout.sign
    : SIGN_BLOCK.map(s => ({ label: s.label, on: true, line: s.line * 5 })); // 换算为 mm

  const wrap = document.createElement('div');
  wrap.className = 'layout-settings';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.innerHTML = '版式设置<span class="hint-inline">信息栏 / 签字区可在线改；列宽在预览中拖拽边线调整</span>';
  wrap.appendChild(title);

  const mkRow = (cls, label, on, extra) => {
    const row = document.createElement('div');
    row.className = 'ls-row';
    if (cls === 'meta' && extra != null) row.dataset.w = extra; // 列宽占比
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = on;
    cb.onchange = () => { saveDraft(); renderDoc(activeTpl); };
    const txt = document.createElement('span');
    txt.className = 'ls-text';
    txt.contentEditable = 'true';
    txt.textContent = label;
    txt.oninput = () => { saveDraft(); renderDoc(activeTpl); };
    row.appendChild(cb); row.appendChild(txt);
    if (cls === 'sign') {
      const num = document.createElement('input');
      num.type = 'number'; num.min = 0; num.max = 100; num.value = extra;
      num.className = 'ls-line'; num.title = '签名横线长度（mm），0 = 无横线';
      num.onchange = () => { saveDraft(); renderDoc(activeTpl); };
      const unit = document.createElement('span');
      unit.className = 'ls-unit'; unit.textContent = 'mm';
      row.appendChild(num); row.appendChild(unit);
    }
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕'; del.title = '删除该行';
    del.onclick = () => { row.remove(); saveDraft(); renderDoc(activeTpl); };
    row.appendChild(del);
    return row;
  };

  const g1 = document.createElement('div');
  g1.className = 'ls-group';
  g1.innerHTML = '<div class="ls-head">患者信息栏字段</div>';
  const metaBox = document.createElement('div');
  metaBox.className = 'ls-meta';
  meta.forEach(m => metaBox.appendChild(mkRow('meta', m.label, m.on, m.w)));
  const addMeta = document.createElement('button');
  addMeta.className = 'add-clause';
  addMeta.textContent = '＋ 添加字段';
  addMeta.onclick = () => {
    metaBox.appendChild(mkRow('meta', '新字段', true, 20));
    saveDraft(); renderDoc(activeTpl);
  };
  g1.appendChild(metaBox); g1.appendChild(addMeta);

  const g2 = document.createElement('div');
  g2.className = 'ls-group';
  g2.innerHTML = '<div class="ls-head">签字区</div>';
  const signBox = document.createElement('div');
  signBox.className = 'ls-sign';
  sign.forEach(s => signBox.appendChild(mkRow('sign', s.label, s.on, s.line)));
  const addSign = document.createElement('button');
  addSign.className = 'add-clause';
  addSign.textContent = '＋ 添加签字行';
  addSign.onclick = () => {
    signBox.appendChild(mkRow('sign', '新签字项：', true, 40));
    saveDraft(); renderDoc(activeTpl);
  };
  g2.appendChild(signBox); g2.appendChild(addSign);

  /* 全文排版：字号 + 字色（全局生效） */
  const g3 = document.createElement('div');
  g3.className = 'ls-group';
  g3.innerHTML = '<div class="ls-head">全文排版</div>';
  const frow = document.createElement('div');
  frow.className = 'ls-row';
  frow.innerHTML = '<span style="font-size:12px;color:var(--muted)">字号</span>';
  const fsize = document.createElement('input');
  fsize.type = 'number'; fsize.min = 10; fsize.max = 24; fsize.value = fontCfg.size;
  fsize.className = 'ls-line'; fsize.title = '正文字号（px）';
  fsize.onchange = () => {
    fontCfg.size = Math.min(24, Math.max(10, parseInt(fsize.value) || 14));
    fsize.value = fontCfg.size;
    localStorage.setItem(FONT_KEY, JSON.stringify(fontCfg));
    renderDoc(activeTpl);
  };
  const fcolor = document.createElement('input');
  fcolor.type = 'color'; fcolor.value = fontCfg.color; fcolor.className = 'ls-color';
  fcolor.title = '全文颜色（关键风险条款保持红色不变）';
  fcolor.oninput = () => {
    fontCfg.color = fcolor.value;
    localStorage.setItem(FONT_KEY, JSON.stringify(fontCfg));
    renderDoc(activeTpl);
  };
  const funit = document.createElement('span');
  funit.className = 'ls-unit'; funit.textContent = 'px';
  frow.appendChild(fsize); frow.appendChild(funit); frow.appendChild(fcolor);
  g3.appendChild(frow);

  wrap.appendChild(g1); wrap.appendChild(g2); wrap.appendChild(g3);
  return wrap;
}

function applyDraft(tpl) {
  const draft = loadDraft(tpl.id);
  tpl.sections.forEach((sec, si) => {
    sec.clauses.forEach((c, ci) => {
      const d = draft && draft.edits[`${si}:${ci}`];
      if (d) { c._on = d.on; c._text = d.text; c._style = d.style; }
      else if (c.opt) c._on = false;   // 可选条款默认不勾选
    });
    if (draft && draft.customs && draft.customs[si]) {
      draft.customs[si].forEach(({ text }) => {
        sec.clauses.push({ text, custom: true });
      });
    }
  });
}

/* ---------- 模板列表 ---------- */
function renderTplList() {
  $tplList.innerHTML = '';
  TEMPLATES.forEach(tpl => {
    const el = document.createElement('div');
    el.className = 'tpl-item' + (tpl.id === currentId ? ' active' : '');
    el.innerHTML = `<span class="tpl-name"><img class="tpl-icon" src="${TPL_ICONS[tpl.id] || ''}" alt="" onerror="this.style.display='none'"><span>${tpl.name}</span></span><span class="tpl-ver">${tpl.version}</span>`;
    el.onclick = () => selectTemplate(tpl.id);
    $tplList.appendChild(el);
  });
}

/* ---------- 模板选择 ---------- */
function selectTemplate(id) {
  currentId = id;
  const tpl = structuredClone(TEMPLATES.find(t => t.id === id));
  // 注入共用「患者声明」章节（编号在渲染时顺延）
  tpl.sections.push({ ...structuredClone(SHARED_STATEMENT), shared: true });
  applyDraft(tpl);
  activeTpl = tpl;
  renderTplList();
  renderEditor(tpl);
  renderDoc(tpl);
}

/* ---------- 编辑器 ---------- */
function renderEditor(tpl) {
  $editor.innerHTML = '';

  const based = document.createElement('div');
  based.className = 'based-on';
  based.textContent = '📚 ' + tpl.basedOn;
  $editor.appendChild(based);

  tpl.sections.forEach((sec, si) => {
    const secEl = document.createElement('section');
    secEl.dataset.shared = sec.shared ? '1' : '0';
    const h = document.createElement('h3');
    h.dataset.title = sec.title;
    h.textContent = sec.shared ? sec.title + '（各项目共用）' : sec.title;
    secEl.appendChild(h);
    sec.clauses.forEach((c, ci) => addClauseRow(secEl, tpl, si, ci, c));
    const addBtn = document.createElement('button');
    addBtn.className = 'add-clause';
    addBtn.textContent = '＋ 添加自定义条款';
    addBtn.onclick = () => {
      const nc = { text: '（在此输入自定义条款内容）', custom: true };
      tpl.sections[si].clauses.push(nc);
      addClauseRow(secEl, tpl, si, tpl.sections[si].clauses.length - 1, nc);
      const rows = secEl.querySelectorAll('.clause');
      const last = rows[rows.length - 1];
      const t = last.querySelector('.text');
      t.focus();
      const range = document.createRange(); range.selectNodeContents(t);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      saveDraft();
    };
    secEl.appendChild(addBtn);
    $editor.appendChild(secEl);
  });

  /* 版式设置（患者信息栏 / 签字区）——用 div 而非 section，避免混入条款收集逻辑 */
  $editor.appendChild(buildLayoutSettings(tpl));
}

function addClauseRow(secEl, tpl, si, ci, c) {
  const row = document.createElement('div');
  row.className = 'clause' + (c.key ? ' key' : '') + (c._on === false ? ' off' : '');
  row.dataset.sec = si; row.dataset.idx = ci;
  if (c.custom) row.dataset.custom = '1';
  row.dataset.orig = c.text;
  if (c._style) row.dataset.style = JSON.stringify(c._style);

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = c._on !== false;
  cb.onchange = () => {
    if (c.key && !cb.checked) {
      if (!confirm('这是一条关键风险条款，涉及医疗纠纷常见争议点。\n确定不放入文书吗？')) {
        cb.checked = true; return;
      }
    }
    row.classList.toggle('off', !cb.checked);
    saveDraft(); renderDoc(tpl);
  };

  const text = document.createElement('div');
  text.className = 'text';
  text.contentEditable = 'true';
  text.textContent = c._text || c.text;
  text.oninput = () => { saveDraft(); renderDoc(tpl); };
  text.onpaste = () => setTimeout(() => { saveDraft(); renderDoc(tpl); }, 0);

  row.appendChild(cb);
  row.appendChild(text);

  /* 逐句字体：A 按钮弹出小面板（字号 / 颜色 / 清除） */
  const getStyle = () => { try { return JSON.parse(row.dataset.style || 'null'); } catch { return null; } };
  const fontBtn = document.createElement('button');
  fontBtn.className = 'fbtn';
  fontBtn.textContent = 'A';
  fontBtn.title = '本条字体设置';
  const panel = document.createElement('div');
  panel.className = 'font-panel';
  panel.hidden = true;
  const sizeInput = document.createElement('input');
  sizeInput.type = 'number'; sizeInput.min = 10; sizeInput.max = 30; sizeInput.placeholder = '字号';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  const clearBtn = document.createElement('button');
  clearBtn.textContent = '清除';
  const syncPanel = () => {
    const st = getStyle();
    sizeInput.value = st && st.size ? st.size : '';
    if (st && st.color) colorInput.value = st.color;
    fontBtn.classList.toggle('on', !!st);
  };
  const applyStyle = () => {
    const size = parseInt(sizeInput.value) || 0;
    const color = colorInput.value;
    const st = (size || color) ? { ...(size ? { size } : {}), ...(color ? { color } : {}) } : null;
    if (st) row.dataset.style = JSON.stringify(st); else delete row.dataset.style;
    syncPanel(); saveDraft(); renderDoc(tpl);
  };
  sizeInput.onchange = applyStyle;
  colorInput.oninput = applyStyle;
  clearBtn.onclick = () => { sizeInput.value = ''; applyStyle(); };
  panel.appendChild(sizeInput); panel.appendChild(colorInput); panel.appendChild(clearBtn);
  fontBtn.onclick = (e) => { e.stopPropagation(); syncPanel(); panel.hidden = !panel.hidden; };
  row.appendChild(fontBtn);
  row.appendChild(panel);
  syncPanel();

  /* 回退：恢复模板默认文字 + 清除本条字体设置 */
  const undoBtn = document.createElement('button');
  undoBtn.className = 'undo';
  undoBtn.textContent = '↺';
  undoBtn.title = '恢复该条款为模板默认';
  undoBtn.onclick = () => {
    if (!confirm('恢复该条款为模板默认文字，并清除其字体设置？')) return;
    text.textContent = c.text;
    delete row.dataset.style;
    delete c._text; delete c._style;
    syncPanel(); undoBtn.style.visibility = 'hidden';
    saveDraft(); renderDoc(tpl);
  };
  row.appendChild(undoBtn);
  const syncUndo = () => {
    undoBtn.style.visibility =
      (text.textContent !== c.text || row.dataset.style) ? 'visible' : 'hidden';
  };
  text.addEventListener('input', syncUndo);
  syncUndo();

  if (c.key) {
    const b = document.createElement('span');
    b.className = 'key-badge'; b.textContent = '关键';
    b.title = '关键风险条款：取消勾选需二次确认';
    row.appendChild(b);
  }
  if (c.custom) {
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕'; del.title = '删除该条款';
    del.onclick = () => {
      tpl.sections[si].clauses.splice(ci, 1);
      row.remove();
      saveDraft(); renderDoc(tpl);
    };
    row.appendChild(del);
  }
  secEl.appendChild(row);
}

/* ---------- 从编辑器收集数据 ---------- */
function collectDocData() {
  const sections = [];
  document.querySelectorAll('#editor section').forEach(secEl => {
    const title = secEl.querySelector('h3').dataset.title || secEl.querySelector('h3').textContent;
    const clauses = [];
    secEl.querySelectorAll('.clause').forEach((row, ri) => {
      const on = row.querySelector('input[type=checkbox]').checked;
      if (!on) return;
      let style = null;
      try { style = JSON.parse(row.dataset.style || 'null'); } catch { style = null; }
      clauses.push({ text: row.querySelector('.text').textContent, key: row.classList.contains('key'), row: ri, style });
    });
    if (clauses.length) sections.push({ title, clauses, shared: secEl.dataset.shared === '1' });
  });
  return sections;
}

/* ============================================================
 * A4 物理分页渲染管线
 * 1) 内容组织为线性块（h2/meta/h3/li/sign/foot）
 * 2) 隐藏量尺测量每个块的高度
 * 3) 按 297mm 页高贪心分页（整块不拆，跨页列表补「（续）」标题）
 * 4) 每页渲染为一张独立的白纸，页脚带「第 X 页 ◆ 共 Y 页」
 * ============================================================ */

/* 患者信息栏：按启用字段流动分排（每排 4 格），列宽支持预览中拖拽调整 */
function metaGridHtml() {
  const fields = collectLayout().meta.filter(m => m.on);
  if (!fields.length) return '';
  const cell = (f, withHandle) =>
    `<div class="mcell" style="width:${f._pw}%"><span class="mlbl">${escapeHtml(f.label)}</span>` +
    `<span class="mline"></span>${withHandle ? '<div class="col-handle"></div>' : ''}</div>`;
  let html = '<div class="meta-grid">';
  for (let i = 0; i < fields.length; i += 4) {
    const row = fields.slice(i, i + 4);
    // 归一化行内宽度：默认按字符数智能分配，已有拖拽宽度则按比例缩放
    const sumW = row.reduce((s, f) => s + (f.w || 0), 0);
    row.forEach(f => {
      f._pw = sumW > 0 ? (f.w / sumW * 100) : (100 / row.length);
    });
    html += `<div class="mrow">${row.map((f, j) => cell(f, j < row.length - 1)).join('')}</div>`;
  }
  return html + '</div>';
}

/* 预览中拖拽信息栏列宽：拖动单元格右边线，松手后持久化 */
$doc.addEventListener('pointerdown', e => {
  const handle = e.target.closest('.col-handle');
  if (!handle) return;
  e.preventDefault();
  const cellEl = handle.parentElement;
  const rowEl = cellEl.parentElement;
  const cells = [...rowEl.children];
  const idx = cells.indexOf(cellEl);
  if (idx < 0 || idx >= cells.length - 1) return;
  handle.setPointerCapture(e.pointerId);

  const startX = e.clientX;
  const rowW = rowEl.getBoundingClientRect().width;
  const totalW = cells[idx].getBoundingClientRect().width + cells[idx + 1].getBoundingClientRect().width;
  const MIN = 30; // 最小列宽 px

  const onMove = ev => {
    const dx = ev.clientX - startX;
    const w = Math.min(Math.max(totalW / 2 + dx, MIN), totalW - MIN);
    cells[idx].style.width = (w / rowW * 100) + '%';
    cells[idx + 1].style.width = ((totalW - w) / rowW * 100) + '%';
  };
  const onUp = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    // 写回版式设置（按可见字段顺序定位本行的两个格子）
    const lsRows = [...document.querySelectorAll('.ls-meta .ls-row')];
    const visibleIdx = lsRows.filter(r => r.querySelector('input[type=checkbox]').checked);
    const gridRowIdx = [...rowEl.parentElement.children].indexOf(rowEl);
    const a = gridRowIdx * 4 + idx, b = a + 1;
    if (visibleIdx[a]) visibleIdx[a].dataset.w = (cells[idx].getBoundingClientRect().width / rowW * 100).toFixed(2);
    if (visibleIdx[b]) visibleIdx[b].dataset.w = (cells[idx + 1].getBoundingClientRect().width / rowW * 100).toFixed(2);
    saveDraft();
    renderDoc(activeTpl);
    toast('列宽已调整并保存');
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
});

function signHtml() {
  const rows = collectLayout().sign.filter(s => s.on);
  if (!rows.length) return '';
  let html = '<div class="sign">';
  rows.forEach(s => {
    html += s.line > 0
      ? `<div class="row"><span>${escapeHtml(s.label)}</span><span class="line" style="width:${s.line}mm"></span></div>`
      : `<div class="row"><span>${escapeHtml(s.label)}</span></div>`;
  });
  return html + '</div>';
}

/* li 连续同组时合并为 <ol start=原始序号>，保证跨页编号连续；
   条款在预览中可直接编辑（contenteditable），回车换行以 \n 存回草稿 */
function flowHtml(items) {
  let html = '', i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.kind === 'li') {
      let j = i;
      while (j < items.length && items[j].kind === 'li' && items[j].olKey === it.olKey) j++;
      html += `<ol class="clauses" start="${it.seq}">`;
      for (let k = i; k < j; k++) {
        const c = items[k];
        const body = escapeHtml(c.text).replace(/\n/g, '<br>');
        const st = c.style ? ` style="${c.style.size ? `font-size:${c.style.size}px;` : ''}${c.style.color ? `color:${c.style.color};` : ''}"` : '';
        html += `<li${c.key ? ' class="key"' : ''}${st} data-sec="${c.olKey}" data-row="${c.row}" contenteditable="true">${body}</li>`;
      }
      html += '</ol>';
      i = j;
    } else if (it.kind === 'h3' || it.kind === 'h3cont') {
      html += `<h3${it.kind === 'h3cont' ? ' class="cont"' : ''}>${escapeHtml(it.title)}</h3>`;
      i++;
    } else if (it.kind === 'sign') {
      html += signHtml(); i++;
    } else if (it.kind === 'foot') {
      html += `<div class="foot-note">${escapeHtml(it.text)}</div>`; i++;
    } else {
      i++; // h2 / meta 只在整卷头部出现一次
    }
  }
  return html;
}

function renderDoc(tpl) {
  const sections = collectDocData();
  if (!sections.length) {
    $doc.innerHTML = '<div class="sheet"><p style="padding:30mm;text-align:center">请至少勾选一条条款</p></div>';
    return;
  }

  const footText = `模板 ${tpl.version} ・ 依据 2024–2025 年公开指南与专家共识整理，仅供本机构内部参考，正式使用前请由医务负责人审核`;

  // 1) 线性块
  const items = [{ kind: 'h2' }, { kind: 'meta' }];
  sections.forEach((sec, i) => {
    const title = sec.shared ? `${CN_NUM[i]}、患者声明` : sec.title;
    items.push({ kind: 'h3', title, olKey: i });
    sec.clauses.forEach((c, n) => items.push({ kind: 'li', olKey: i, row: c.row, seq: n + 1, key: !!c.key, text: c.text, style: c.style }));
  });
  items.push({ kind: 'sign' }, { kind: 'foot', text: footText });

  const fontStyle = `font-size:${fontCfg.size}px;color:${fontCfg.color};`;

  // 2) 测量
  const meas = document.createElement('div');
  meas.className = 'sheet measurer';
  meas.style.cssText = `position:absolute;left:-99999px;top:0;visibility:hidden;${fontStyle}`;
  meas.innerHTML = `<h2>${tpl.docTitle}</h2><div class="title-rule"></div>` + metaGridHtml() + flowHtml(items);
  document.body.appendChild(meas);

  const cs = getComputedStyle(meas);
  const padTop = parseFloat(cs.paddingTop), padBottom = parseFloat(cs.paddingBottom);
  const pxPerMm = meas.clientWidth / 210;
  const innerH = 297 * pxPerMm - padTop - padBottom;

  const heights = new Array(items.length);
  const expectList = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'li') {
      if (i === 0 || items[i - 1].kind !== 'li' || items[i - 1].olKey !== it.olKey) {
        expectList.push({ type: 'ol', start: i });
      }
    } else {
      expectList.push({ type: 'el', index: i });
    }
    if (i === 0) expectList.push({ type: 'rule' });
  }

  const els = [...meas.children];
  let ok = els.length === expectList.length;
  if (ok) {
    for (let e = 0; e < expectList.length; e++) {
      const ex = expectList[e], el = els[e];
      if (ex.type === 'ol') {
        const lis = [...el.children];
        let cnt = 0;
        while (ex.start + cnt < items.length && items[ex.start + cnt].kind === 'li') cnt++;
        if (lis.length !== cnt) { ok = false; break; }
        for (let k = 0; k < cnt; k++) heights[ex.start + k] = lis[k].offsetHeight;
      } else if (ex.type === 'el') {
        heights[ex.index] = el.offsetHeight;
      }
    }
  }
  // 续页标题高度
  const probe = document.createElement('h3');
  probe.className = 'cont'; probe.textContent = '测（续）';
  meas.appendChild(probe);
  const contH = probe.offsetHeight;
  probe.remove();
  meas.remove();

  // 3) 分页
  let pages, heightsUsed = ok;
  if (heightsUsed) {
    const TOL = 8; // 安全余量（px），宁可早翻页也不挤爆
    const secTitle = {};
    items.forEach(it => { if (it.kind === 'h3') secTitle[it.olKey] = it.title; });

    pages = [[]];
    let pg = [], curH = 0;
    const headerOf = key => x => (x.kind === 'h3' || x.kind === 'h3cont') && x.olKey === key;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      let cont = null;
      if (it.kind === 'li' && !pg.some(headerOf(it.olKey))) {
        cont = { kind: 'h3cont', title: secTitle[it.olKey] + '（续）', olKey: it.olKey };
      }
      if (pg.length > 0 && curH + (cont ? contH : 0) + heights[i] > innerH - TOL) {
        pages.push(pg); pg = []; curH = 0;
        if (cont && !pg.some(headerOf(it.olKey))) {
          pg.push(cont); curH += contH;
        }
      } else if (cont) {
        pg.push(cont); curH += contH;
      }
      pg.push(it); curH += heights[i];
      if (heights[i] > innerH - TOL) { pages.push(pg); pg = []; curH = 0; }
    }
    if (pg.length) pages.push(pg);
    pages = pages.filter(p => p.length);
  }

  // 4) 渲染：每页一张白纸
  if (!heightsUsed || pages.length === 0) {
    // 测量失败兜底：整卷一张
    $doc.innerHTML = `<div class="sheet" style="${fontStyle}">${`<h2>${tpl.docTitle}</h2><div class="title-rule"></div>` +
      (logoData ? `<img class="doc-logo" src="${logoData}" alt="" onerror="this.remove()">` : '') + metaGridHtml() + flowHtml(items)}</div>`;
    return;
  }

  const total = pages.length;
  let out = '';
  pages.forEach((pgItems, pi) => {
    out += `<div class="sheet" style="${fontStyle}">`;
    if (pi === 0) {
      out += `<h2>${tpl.docTitle}</h2><div class="title-rule"></div>`;
      if (logoData) out += `<img class="doc-logo" src="${logoData}" alt="" onerror="this.remove()">`;
      out += metaGridHtml();
    }
    out += flowHtml(pgItems);
    if (total > 1) {
      out += `<div class="page-mark">第 <span class="pm-num">${pi + 1}</span> 页` +
             `<span class="pm-dot">◆</span>共 <span class="pm-num">${total}</span> 页</div>`;
    }
    out += '</div>';
  });
  $doc.innerHTML = out;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* 预览条款直编：回车在条款内换行（不拆分条款），输入实时同步回左侧草稿 */
$doc.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.closest && e.target.closest('li[data-row]')) {
    e.preventDefault();
    document.execCommand('insertLineBreak');
  }
});
$doc.addEventListener('input', e => {
  const li = e.target.closest && e.target.closest('li[data-row]');
  if (!li) return;
  const row = document.querySelector(
    `#editor .clause[data-sec="${li.dataset.sec}"][data-idx="${li.dataset.row}"] .text`);
  if (row) {
    row.textContent = li.innerText;
    saveDraft();   // 不在输入过程中重渲染，避免打断光标
  }
});

/* ---------- Logo 上传 ----------
 * 限制：仅 PNG/JPEG，原图 ≤ 2MB；上传后等比缩至最长边 400px 再存 localStorage，
 * 存储体积约 200KB 以内，避免撑爆 ~5MB 的本地配额。
 * ------------------------------------------------------------ */
const LOGO_KEY = 'cb_logo';
const LOGO_MAX_RAW = 2 * 1024 * 1024;   // 原图 2MB
const LOGO_MAX_SIDE = 400;              // 存储尺寸上限（px）
let logoData = localStorage.getItem(LOGO_KEY) || null;
/* 启动校验：格式不符直接丢弃；格式符合但解码失败的（损坏的 dataURL）异步探测后清除 */
if (logoData && !logoData.startsWith('data:image/')) {
  logoData = null;
  localStorage.removeItem(LOGO_KEY);
} else if (logoData) {
  const probe = new Image();
  probe.onerror = () => {
    logoData = null;
    localStorage.removeItem(LOGO_KEY);
    renderLogoUI();
    if (activeTpl) renderDoc(activeTpl);
    toast('检测到损坏的 Logo 数据，已自动清理', true);
  };
  probe.src = logoData;
}

function renderLogoUI() {
  if (logoData) {
    $logoWrap.hidden = false;
    $logoThumb.src = logoData;
    $btnLogo.textContent = '🏷 更换 Logo';
  } else {
    $logoWrap.hidden = true;
    $logoThumb.src = '';
    $btnLogo.textContent = '🏷 上传 Logo';
  }
}

$btnLogo.onclick = () => $logoInput.click();

$logoInput.onchange = () => {
  const file = $logoInput.files[0];
  $logoInput.value = '';
  if (!file) return;
  if (!/^image\/(png|jpeg)$/.test(file.type)) { toast('仅支持 PNG / JPG 格式', true); return; }
  if (file.size > LOGO_MAX_RAW) { toast('图片超过 2MB，请压缩后再上传', true); return; }

  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    logoData = cv.toDataURL('image/png');
    try {
      localStorage.setItem(LOGO_KEY, logoData);
    } catch {
      logoData = null;
      toast('本地存储空间不足，Logo 未保存（可换更小的图）', true);
      renderLogoUI(); return;
    }
    renderLogoUI();
    renderDoc(activeTpl);
    toast('Logo 已上传，显示在文书首页左上角');
  };
  img.onerror = () => toast('图片解析失败，请换一张试试', true);
  img.src = URL.createObjectURL(file);
};

$logoDel.onclick = () => {
  logoData = null;
  localStorage.removeItem(LOGO_KEY);
  renderLogoUI();
  renderDoc(activeTpl);
  toast('Logo 已移除');
};

/* ---------- 顶部按钮 ---------- */
$btnPrint.onclick = () => window.print();

$btnPdf.onclick = async () => {
  const tpl = TEMPLATES.find(t => t.id === currentId);
  if (typeof html2canvas === 'undefined' || !window.jspdf) {
    toast('PDF 组件未加载，请检查 lib 目录', true); return;
  }
  const old = $btnPdf.textContent;
  $btnPdf.disabled = true;
  $btnPdf.textContent = '⏳ 正在生成…';
  /* 逐张纸渲染：每张 .sheet 本身就是一张 A4（210×297mm），
     直接整页贴入 PDF，彻底避免"整卷切片"导致的错位与空白页 */
  const marks = [...$doc.querySelectorAll('.page-mark, .col-handle')];
  marks.forEach(m => m.style.visibility = 'hidden');
  try {
    const sheets = [...$doc.querySelectorAll('.sheet')];
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    for (let i = 0; i < sheets.length; i++) {
      const canvas = await html2canvas(sheets[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const img = canvas.toDataURL('image/jpeg', 0.96);
      if (i > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
    }
    pdf.save(`${tpl.docTitle}.pdf`);
    toast('PDF 已开始下载');
  } catch (e) {
    console.error(e);
    toast('导出失败：' + (e.message || e), true);
  } finally {
    marks.forEach(m => m.style.visibility = '');
    $btnPdf.disabled = false;
    $btnPdf.textContent = old;
  }
};

$btnReset.onclick = () => {
  if (!currentId) return;
  if (!confirm('放弃当前修改，恢复该模板默认条款？')) return;
  localStorage.removeItem(draftKey(currentId));
  selectTemplate(currentId);
};

/* ---------- 启动：默认选中第一个模板 ---------- */
renderLogoUI();
renderTplList();
selectTemplate(TEMPLATES[0].id);
