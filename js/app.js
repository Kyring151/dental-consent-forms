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
  'crown': 'assets/icons/bridge_s.jpg',
  'ortho': 'assets/icons/ortho_s.jpg',
  'implant': 'assets/icons/implant_s.jpg',
  'whitening': 'assets/icons/white_s.jpg',
  'peds': 'assets/icons/peds_s.jpg',
  'xray': 'assets/icons/xray_s.jpg',
  'perio': 'assets/icons/perio_s.jpg',
  'rpd': 'assets/icons/rpd_s.jpg',
  'aligner': 'assets/icons/aligner_s.jpg',
  'veneer': 'assets/icons/veneer_s.jpg',
  'rootsurg': 'assets/icons/rootsurg_s.jpg',
  'prevention': 'assets/icons/prevention_s.jpg',
  'oral-surgery': 'assets/icons/oralsurg_s.jpg'
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

/* 「我的默认版式」（全局）：信息栏字段/列宽、签字区、信息栏字号，存为默认后新模板沿用 */
const LAYOUT_KEY = 'cb_layout';
function loadMyLayout() {
  try {
    const d = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    return (d && Array.isArray(d.meta) && d.meta.length) ? d : null;
  } catch { return null; }
}

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
    const htmlRaw = el.dataset.html || '';
    const hasHtml = /<\w+[ >]/.test(htmlRaw);
    const blanks = parseInt(el.dataset.blanks) || 0;   // 条款前空行数（预览中回车插行）
    if (!on || el.dataset.custom === '1' || text !== el.dataset.orig || style || hasHtml || blanks > 0) {
      state.edits[`${sec}:${idx}`] = { on, text, style, blanks: blanks || undefined, html: hasHtml ? htmlRaw : undefined };
    }
    if (el.dataset.custom === '1') {
      (state.customs[sec] = state.customs[sec] || []).push({ idx, text });
    }
  });
  /* 自定义标题：文书大标题 + 各节标题（与模板默认不同时入草稿）；
     标题前的空行（预览中在标题里回车插入）一并入草稿 */
  const dtEl = document.querySelector('#editor .dt-row');
  if (dtEl) {
    const cur = dtEl.querySelector('.dt-text').textContent;
    if (cur !== dtEl.dataset.origTitle) state.docTitle = cur;
    const tg = parseInt(dtEl.dataset.gap) || 0;
    if (tg > 0) state.titleGap = tg;
  }
  const titles = {};
  document.querySelectorAll('#editor section').forEach((secEl, si) => {
    const h = secEl.querySelector('h3');
    const gap = parseInt(secEl.dataset.gap) || 0;
    if (h && (h.textContent !== h.dataset.origText || gap > 0)) titles[si] = { t: h.textContent, g: gap };
  });
  if (Object.keys(titles).length) state.titles = titles;
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
  // 信息栏独立字号（px），与正文字号互不影响
  const mfInput = document.querySelector('.ls-meta-font input');
  const metaFont = Math.min(18, Math.max(9, parseInt(mfInput && mfInput.value) || 12));
  return { meta, sign, metaFont };
}

function buildLayoutSettings(tpl) {
  const draft = loadDraft(tpl.id);
  const myLayout = loadMyLayout();
  const meta = (draft && draft.layout && Array.isArray(draft.layout.meta) && draft.layout.meta.length)
    ? draft.layout.meta
    : (myLayout && Array.isArray(myLayout.meta) && myLayout.meta.length)
      ? myLayout.meta
      : (tpl.meta || DEFAULT_META_FIELDS).map(f => ({ label: f.label, on: true, w: f.w }));
  const sign = (draft && draft.layout && Array.isArray(draft.layout.sign) && draft.layout.sign.length)
    ? draft.layout.sign
    : (myLayout && Array.isArray(myLayout.sign) && myLayout.sign.length)
      ? myLayout.sign
      : SIGN_BLOCK.map(s => ({ label: s.label, on: true, line: s.line * 5 })); // 换算为 mm
  const metaFontSaved = (draft && draft.layout && draft.layout.metaFont)
    || (myLayout && myLayout.metaFont) || 12;

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

  /* 信息栏独立字号：只影响表头患者信息栏，不动正文字号（默认 12px） */
  const mfRow = document.createElement('div');
  mfRow.className = 'ls-row ls-meta-font';
  mfRow.innerHTML = '<span style="font-size:12px;color:var(--muted)">信息栏字号</span>';
  const mfInput2 = document.createElement('input');
  mfInput2.type = 'number'; mfInput2.min = 9; mfInput2.max = 18; mfInput2.value = metaFontSaved;
  mfInput2.className = 'ls-line'; mfInput2.title = '信息栏标签字号（px），与正文「全文排版」字号互不影响';
  mfInput2.onchange = () => {
    mfInput2.value = Math.min(18, Math.max(9, parseInt(mfInput2.value) || 12));
    saveDraft(); renderDoc(activeTpl);
  };
  const mfUnit = document.createElement('span');
  mfUnit.className = 'ls-unit'; mfUnit.textContent = 'px';
  mfRow.appendChild(mfInput2); mfRow.appendChild(mfUnit);
  g1.appendChild(mfRow);

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

  /* 诊所抬头：三项都留空则不显示；填写后在文书首页标题上方成信头 */
  const g5 = document.createElement('div');
  g5.className = 'ls-group';
  g5.innerHTML = '<div class="ls-head">诊所抬头<span class="hint-inline">留空则不显示，填写后印在文书首页顶部</span></div>';
  const mkClinic = (key, label, ph) => {
    const row = document.createElement('div');
    row.className = 'ls-row ls-clinic';
    const lab = document.createElement('span');
    lab.className = 'ls-cspan'; lab.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = clinicCfg[key]; inp.placeholder = ph;
    inp.className = 'ls-text-input';
    inp.oninput = () => { clinicCfg[key] = inp.value; saveClinic(); };
    row.appendChild(lab); row.appendChild(inp);
    return row;
  };
  g5.appendChild(mkClinic('name', '名称', '如：××口腔诊所'));
  g5.appendChild(mkClinic('addr', '地址', '诊所地址（留空不显示）'));
  g5.appendChild(mkClinic('tel', '电话', '联系电话（留空不显示）'));
  wrap.appendChild(g5);

  /* 默认版式与重置 */
  const g4 = document.createElement('div');
  g4.className = 'ls-group';
  g4.innerHTML = '<div class="ls-head">默认版式与重置</div>';
  const brow = document.createElement('div');
  brow.className = 'ls-btns';

  const saveDefaultBtn = document.createElement('button');
  saveDefaultBtn.className = 'add-clause';
  saveDefaultBtn.textContent = '存为默认版式';
  saveDefaultBtn.title = '把当前信息栏 / 签字区 / 信息栏字号存为默认，之后切换模板自动沿用';
  saveDefaultBtn.onclick = () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(collectLayout()));
    toast('已存为默认版式，其他模板将沿用');
  };

  const restoreDefaultBtn = document.createElement('button');
  restoreDefaultBtn.className = 'add-clause';
  restoreDefaultBtn.textContent = '恢复内置版式';
  restoreDefaultBtn.title = '信息栏、签字区、信息栏字号恢复初始默认（不影响条款改动）';
  restoreDefaultBtn.onclick = () => {
    if (!confirm('恢复内置版式：信息栏字段、签字区、信息栏字号全部恢复初始默认？\n（条款的勾选与改字不受影响）')) return;
    localStorage.removeItem(LAYOUT_KEY);
    const d = loadDraft(tpl.id);
    if (d) { delete d.layout; localStorage.setItem(draftKey(tpl.id), JSON.stringify(d)); }
    selectTemplate(tpl.id);
    toast('已恢复内置版式');
  };

  brow.appendChild(saveDefaultBtn); brow.appendChild(restoreDefaultBtn);
  g4.appendChild(brow);

  wrap.appendChild(g1); wrap.appendChild(g2); wrap.appendChild(g3); wrap.appendChild(g4);
  return wrap;
}

function applyDraft(tpl) {
  const draft = loadDraft(tpl.id);
  if (draft && draft.docTitle) tpl.docTitle = draft.docTitle;
  tpl._titleGap = (draft && draft.titleGap) || 0;   // 文书大标题前的空行
  tpl.sections.forEach((sec, si) => {
    if (draft && draft.titles && draft.titles[si] != null) {
      const e = draft.titles[si];
      if (typeof e === 'string') { sec._title = e; sec._gap = 0; }   // 兼容 v17–v19 的纯文本格式
      else { sec._title = e.t; sec._gap = e.g || 0; }
    }
    sec.clauses.forEach((c, ci) => {
      const d = draft && draft.edits && draft.edits[`${si}:${ci}`];
      if (d) { c._on = d.on; c._text = d.text; c._style = d.style; c._html = d.html; c._blanks = d.blanks || 0; }
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
    el.innerHTML = `<span class="tpl-name"><img class="tpl-icon" src="${TPL_ICONS[tpl.id] ? TPL_ICONS[tpl.id] + '?v=26' : ''}" alt="" onerror="this.style.display='none'"><span>${tpl.name}</span></span><span class="tpl-ver">${tpl.version}</span>`;
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

  /* 文书大标题：可直接改字，存草稿（dataset.origTitle 记录模板原标题用于对比） */
  const origTitle = (TEMPLATES.find(t => t.id === tpl.id) || {}).docTitle || tpl.docTitle;
  const dtRow = document.createElement('div');
  dtRow.className = 'dt-row';
  dtRow.dataset.origTitle = origTitle;
  if (tpl._titleGap) dtRow.dataset.gap = tpl._titleGap;
  const dtLabel = document.createElement('span');
  dtLabel.className = 'dt-label';
  dtLabel.textContent = '文书标题';
  const dtText = document.createElement('span');
  dtText.className = 'dt-text';
  dtText.contentEditable = 'true';
  dtText.textContent = tpl.docTitle;
  dtText.oninput = () => { tpl.docTitle = dtText.textContent; saveDraft(); renderDoc(tpl); };
  dtRow.appendChild(dtLabel); dtRow.appendChild(dtText);
  $editor.appendChild(dtRow);

  const based = document.createElement('div');
  based.className = 'based-on';
  based.textContent = '📚 ' + tpl.basedOn;
  $editor.appendChild(based);

  tpl.sections.forEach((sec, si) => {
    const secEl = document.createElement('section');
    secEl.dataset.shared = sec.shared ? '1' : '0';
    if (sec._gap) secEl.dataset.gap = sec._gap;
    const h = document.createElement('h3');
    h.dataset.title = sec.title;
    const initText = sec._title || (sec.shared ? sec.title + '（各项目共用）' : sec.title);
    h.textContent = initText;
    h.dataset.origText = initText;
    h.contentEditable = 'true';
    h.title = '点击可修改本节标题';
    h.oninput = () => { saveDraft(); renderDoc(tpl); };
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
  if (c._html) row.dataset.html = c._html;
  if (c._blanks) row.dataset.blanks = c._blanks;

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
  text.oninput = () => {
    delete row.dataset.html;   // 左侧纯文本编辑会丢行内格式，以预览中的格式为准
    saveDraft(); renderDoc(tpl);
  };
  text.onpaste = () => setTimeout(() => { delete row.dataset.html; saveDraft(); renderDoc(tpl); }, 0);

  row.appendChild(cb);
  row.appendChild(text);

  /* 逐句字体：A 按钮弹出小面板（字号 / 颜色 / 回退箭头） */
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
  clearBtn.textContent = '↺';
  clearBtn.title = '清除本条字号 / 颜色设置';
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
    if (!confirm('恢复该条款为模板默认文字，并清除其字体设置与行内格式？')) return;
    text.textContent = c.text;
    delete row.dataset.style;
    delete row.dataset.html;
    delete row.dataset.blanks;
    delete c._text; delete c._style; delete c._html;
    syncPanel(); undoBtn.style.visibility = 'hidden';
    saveDraft(); renderDoc(tpl);
  };
  row.appendChild(undoBtn);
  const syncUndo = () => {
    undoBtn.style.visibility =
      (text.textContent !== c.text || row.dataset.style || row.dataset.html) ? 'visible' : 'hidden';
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
    let title = secEl.querySelector('h3').textContent;   // 左侧栏可改节标题，以当前文字为准
    if (secEl.dataset.shared === '1') title = title.replace(/（各项目共用）$/, '');
    const clauses = [];
    secEl.querySelectorAll('.clause').forEach((row, ri) => {
      const on = row.querySelector('input[type=checkbox]').checked;
      if (!on) return;
      let style = null;
      try { style = JSON.parse(row.dataset.style || 'null'); } catch { style = null; }
      clauses.push({
        text: row.querySelector('.text').textContent,
        key: row.classList.contains('key'),
        row: ri, style,
        blanks: parseInt(row.dataset.blanks) || 0,
        html: /<\w+[ >]/.test(row.dataset.html || '') ? row.dataset.html : null
      });
    });
    if (clauses.length) sections.push({ title, clauses, shared: secEl.dataset.shared === '1', gap: parseInt(secEl.dataset.gap) || 0 });
  });
  return sections;
}

/* ============================================================
 * 文档渲染管线（v20 起无物理分页：预览为连续长卷，打印走浏览器
 * 自然分页，导出为 Word 由 WPS/Word 自行分页）
 * 内容组织为线性块（h2/meta/h3/li/sign/foot）→ sheetHtml 一张白纸
 * ============================================================ */

/* 患者信息栏：按启用字段流动分排（每排 4 格），列宽支持预览中拖拽调整 */
function metaGridHtml() {
  const layout = collectLayout();
  const fields = layout.meta.filter(m => m.on);
  if (!fields.length) return '';
  const mf = layout.metaFont || 12;
  const cell = (f, withHandle) =>
    `<div class="mcell" style="width:${f._pw}%"><span class="mlbl" style="font-size:${mf}px">${escapeHtml(f.label)}</span>` +
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

/* li 连续同组渲染为一个 <ol>，序号手动生成（.num span，跨页随 seq 连续）：
   条款前可带空行（blank li，不编号、不耗序号），预览中光标在序号前回车 = 整条下移一行 */
function flowHtml(items) {
  let html = '', i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.kind === 'li') {
      let j = i, n = it.seq;
      while (j < items.length && items[j].kind === 'li' && items[j].olKey === it.olKey) j++;
      html += `<ol class="clauses">`;
      for (let k = i; k < j; k++) {
        const c = items[k];
        for (let b = 0; b < (c.blanks || 0); b++)
          html += '<li class="blank" contenteditable="false"></li>';
        const body = c.html ? stripInlineFontSize(c.html) : escapeHtml(c.text).replace(/\n/g, '<br>');
        const st = c.style ? ` style="${c.style.size ? `font-size:${c.style.size}px;` : ''}${c.style.color ? `color:${c.style.color};` : ''}"` : '';
        html += `<li${c.key ? ' class="key"' : ''}${st} data-sec="${c.olKey}" data-row="${c.row}" contenteditable="true"><span class="num" contenteditable="false">${n}.</span>${body}</li>`;
        n++;
      }
      html += '</ol>';
      i = j;
    } else if (it.kind === 'h3' || it.kind === 'h3cont') {
      for (let g = 0; g < (it.gap || 0); g++)
        html += '<div class="tgap" contenteditable="false"></div>';
      html += `<h3${it.kind === 'h3cont' ? ' class="cont"' : ''} data-sec="${it.olKey}" contenteditable="true">${escapeHtml(it.title)}</h3>`;
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

/* 把勾选的章节组织为线性块（h2/meta 占位 + 每节 h3 + li + sign + foot） */
function buildItems(tpl, sections) {
  const footText = `依据 2025–2026 年公开指南与专家共识整理，仅供本机构内部参考，正式使用前请由医务负责人审核`;
  const items = [{ kind: 'h2', gap: tpl._titleGap || 0 }, { kind: 'meta' }];
  sections.forEach((sec, i) => {
    let title = sec.title;
    /* 共用声明节模板原文不带编号，保持与常规节一致的自动编号（用户自带编号则不重复加） */
    if (sec.shared && !/^[一二三四五六七八九十]+、/.test(title)) title = `${CN_NUM[i]}、${title}`;
    items.push({ kind: 'h3', title, olKey: i, gap: sec.gap || 0 });
    sec.clauses.forEach((c, n) => items.push({ kind: 'li', olKey: i, row: c.row, seq: n + 1, key: !!c.key, text: c.text, style: c.style, html: c.html, blanks: c.blanks || 0 }));
  });
  items.push({ kind: 'sign' }, { kind: 'foot', text: footText });
  return items;
}

/* 单张纸的 HTML（连续预览与导出分页共用）；pi===0 带页眉，total>1 带页脚页码 */
function sheetHtml(pgItems, pi, total, fontStyle) {
  let out = `<div class="sheet" style="${fontStyle}">`;
  if (pi === 0) {
    out += clinicHeadHtml();
    for (let g = 0; g < ((pgItems[0] && pgItems[0].kind === 'h2' && pgItems[0].gap) || 0); g++)
      out += '<div class="tgap" contenteditable="false"></div>';
    out += `<h2 data-role="doctitle" contenteditable="true">${escapeHtml(activeTpl.docTitle)}</h2><div class="title-rule"></div>`;
    if (logoData) out += `<img class="doc-logo" src="${logoData}" alt="" onerror="this.remove()">`;
    out += metaGridHtml();
  }
  out += flowHtml(pgItems);
  if (total > 1) {
    out += `<div class="page-mark">第 <span class="pm-num">${pi + 1}</span> 页` +
           `<span class="pm-dot">◆</span>共 <span class="pm-num">${total}</span> 页</div>`;
  }
  return out + '</div>';
}

/* 预览 = 连续长卷：不切页、不裁剪，空格与回车自由排版（white-space: pre-wrap） */
function renderDoc(tpl) {
  const sections = collectDocData();
  if (!sections.length) {
    $doc.innerHTML = '<div class="sheet"><p style="padding:30mm;text-align:center">请至少勾选一条条款</p></div>';
    return;
  }
  const items = buildItems(tpl, sections);
  const fontStyle = `font-size:${fontCfg.size}px;color:${fontCfg.color};`;
  $doc.innerHTML = sheetHtml(items, 0, 1, fontStyle);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* 预览回车 / 退格的场景 —
   ・光标在条款最开头（序号之前 / 序号与正文之间）：序号+正文整体下移一行，
     即在本条前插一个无编号空行；不触发重渲染，可连续回车插多行
   ・光标掉在 ol 上（点到序号左侧等不可编区域，Chrome 会把光标放在 ol 层）：
     按光标位置找到对应条款，整条下移
   ・光标在条款最开头按 Backspace：删掉本条前面的一个空行（往回上退一行），无空行则不动
   ・选中一段文字（非折叠选区）后回车：选中所在条款整体下移一行
   ・光标在标题（文书大标题 / 各节标题）里：回车 = 在标题上方插一空行（标题不内部换行），
     Backspace = 删掉标题上方一个空行
   其余位置：条款内换行（不拆分条款），以 \n 存回草稿 */
function insertBlankBefore(li) {
  const blank = document.createElement('li');
  blank.className = 'blank';
  blank.contentEditable = 'false';
  li.parentElement.insertBefore(blank, li);
  const row = document.querySelector(
    `#editor .clause[data-sec="${li.dataset.sec}"][data-idx="${li.dataset.row}"]`);
  if (row) row.dataset.blanks = (parseInt(row.dataset.blanks) || 0) + 1;
  saveDraft();
}

function removeBlankBefore(li) {
  const prev = li.previousElementSibling;
  if (!prev || !prev.classList.contains('blank')) return false;
  prev.remove();
  const row = document.querySelector(
    `#editor .clause[data-sec="${li.dataset.sec}"][data-idx="${li.dataset.row}"]`);
  if (row) {
    const n = (parseInt(row.dataset.blanks) || 0) - 1;
    if (n > 0) row.dataset.blanks = n; else delete row.dataset.blanks;
  }
  saveDraft();
  return true;
}

/* 光标是否在本条内容的最开头：取 li 开头到光标的片段，除自动序号外不允许有任何内容
   （用内容判定而非光标坐标判定——Chrome 对 contenteditable=false 的序号有多种光标表示法） */
function caretAtClauseStart(li) {
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  try {
    pre.selectNodeContents(li);
    pre.setEnd(r.endContainer, r.endOffset);
  } catch { return false; }
  let onlyNum = true;
  pre.cloneContents().childNodes.forEach(n => {
    if (n.nodeType === 3) { if (n.textContent.trim() !== '') onlyNum = false; }
    else if (!(n.nodeType === 1 && n.classList && n.classList.contains('num'))) onlyNum = false;
  });
  return onlyNum;
}

$doc.addEventListener('keydown', e => {
  if (!e.target.closest) return;
  const isEnter = e.key === 'Enter';
  const isBk = e.key === 'Backspace';
  if (!isEnter && !isBk) return;
  const li = e.target.closest('li[data-row]');
  const title = e.target.closest('h2[data-role], h3[data-sec]');
  const ol = e.target.closest('ol.clauses');
  if (!li && !title && !ol) return;

  /* Backspace：条款 / 标题最开头 → 往回上退一行（删一个空行）；无空行则不动 */
  if (isBk) {
    if (li && caretAtClauseStart(li) && removeBlankBefore(li)) e.preventDefault();
    else if (title) {
      const prev = title.previousElementSibling;
      if (prev && prev.classList.contains('tgap')) {
        e.preventDefault();
        prev.remove();
        if (title.dataset.sec != null) {
          const secEl = document.querySelectorAll('#editor section')[parseInt(title.dataset.sec)];
          if (secEl) {
            const n = (parseInt(secEl.dataset.gap) || 0) - 1;
            if (n > 0) secEl.dataset.gap = n; else delete secEl.dataset.gap;
          }
        } else {
          const dtEl = document.querySelector('#editor .dt-row');
          if (dtEl) {
            const n = (parseInt(dtEl.dataset.gap) || 0) - 1;
            if (n > 0) dtEl.dataset.gap = n; else delete dtEl.dataset.gap;
          }
        }
        saveDraft();
      }
    }
    return;
  }

  /* Enter */
  e.preventDefault();

  if (title) {
    const gap = document.createElement('div');
    gap.className = 'tgap';
    gap.contentEditable = 'false';
    title.parentElement.insertBefore(gap, title);
    if (title.dataset.sec != null) {
      const secEl = document.querySelectorAll('#editor section')[parseInt(title.dataset.sec)];
      if (secEl) secEl.dataset.gap = (parseInt(secEl.dataset.gap) || 0) + 1;
    } else {
      const dtEl = document.querySelector('#editor .dt-row');
      if (dtEl) dtEl.dataset.gap = (parseInt(dtEl.dataset.gap) || 0) + 1;
    }
    saveDraft();
    return;
  }

  /* 选中一段文字（非折叠选区）后回车：选中所在条款整体下移一行 */
  const sel = getSelection();
  if (li && sel.rangeCount && !sel.isCollapsed) {
    insertBlankBefore(li);
    return;
  }

  if (!li) {
    /* 光标在 ol 层：按 childNode 偏移找到它指向的条款，在其前面插空行 */
    const off = sel.rangeCount ? sel.getRangeAt(0).startOffset : 0;
    const kids = [...ol.children];
    let target = null;
    for (let k = Math.min(off, kids.length - 1); k >= 0 && k < kids.length; k++) {
      if (kids[k].matches && kids[k].matches('li[data-row]')) { target = kids[k]; break; }
    }
    if (!target) {
      const lis = ol.querySelectorAll('li[data-row]');
      target = lis.length ? (off <= 0 ? lis[0] : lis[lis.length - 1]) : null;
    }
    if (target) insertBlankBefore(target);
    return;
  }

  if (caretAtClauseStart(li)) insertBlankBefore(li);
  else document.execCommand('insertLineBreak');
});

/* 行内格式净化：只保留 b/i/u/br 和带白名单样式的 span，其余剥壳或丢弃
 * 注意：span 一律不收 font-size —— 粘贴自 Word/网页的残留小字号会让该句脱离全文排版，
 * 统一由 li 级 style.size（A 面板）控制逐句字号；div/p 剥壳时补 <br> 保住段落换行 */
function sanitizeHtml(html) {
  const d = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
  const proc = el => {
    let out = '';
    el.childNodes.forEach(n => {
      if (n.nodeType === 3) {
        out += n.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return;
      }
      if (n.nodeType !== 1) return;
      const t = n.tagName, inner = proc(n);
      if (t === 'B' || t === 'STRONG') out += `<b>${inner}</b>`;
      else if (t === 'I' || t === 'EM') out += `<i>${inner}</i>`;
      else if (t === 'U') out += `<u>${inner}</u>`;
      else if (t === 'BR') out += '<br>';
      else if (t === 'DIV' || t === 'P') out += inner + '<br>';   // 段落剥壳但保留换行
      else if (t === 'SPAN') {
        const st = [];
        if (n.style.fontWeight && n.style.fontWeight !== 'normal') st.push('font-weight:' + n.style.fontWeight);
        if (n.style.fontStyle && n.style.fontStyle !== 'normal') st.push('font-style:' + n.style.fontStyle);
        if (n.style.color) st.push('color:' + n.style.color);
        out += st.length ? `<span style="${st.join(';')}">${inner}</span>` : inner;
      } else if (t === 'FONT') {   // 兼容未开 styleWithCSS 的旧格式（只留颜色，字号一律丢弃）
        const st = [];
        if (n.getAttribute('color')) st.push('color:' + n.getAttribute('color'));
        out += st.length ? `<span style="${st.join(';')}">${inner}</span>` : inner;
      } else out += inner;         // 其他标签：剥壳保留文字
    });
    return out;
  };
  /* 3 个及以上连续 <br> 收敛为 2 个，避免粘贴残留的空行撑乱版心 */
  return proc(d.body.firstChild).replace(/(<br>){3,}/g, '<br><br>');
}

/* 渲染前兜底：剥掉历史草稿 html 里残留的 span 行内字号（旧版 sanitize 放过 font-size） */
function stripInlineFontSize(html) {
  return html.replace(/font-size\s*:[^;"']+;?/gi, '');
}

/* 预览 li ↔ 编辑器同步（含行内格式）；序号是自动生成的，同步时排除 */
function syncFromLi(li) {
  const t = document.querySelector(
    `#editor .clause[data-sec="${li.dataset.sec}"][data-idx="${li.dataset.row}"] .text`);
  if (!t) return;
  const num = li.querySelector('.num');
  if (num) num.style.display = 'none';
  const text = li.innerText;
  const html = li.innerHTML;
  if (num) num.style.display = '';
  t.textContent = text;
  t.parentElement.dataset.html = sanitizeHtml(html.replace(/<span class="num"[^>]*>[\s\S]*?<\/span>/, ''));
  saveDraft();   // 不在输入过程中重渲染，避免打断光标
}
$doc.addEventListener('input', e => {
  const li = e.target.closest && e.target.closest('li[data-row]');
  if (li) { syncFromLi(li); return; }
  /* 预览标题直编 → 同步回左侧栏与草稿（不重渲染，避免打断光标） */
  const h2 = e.target.closest && e.target.closest('h2[data-role]');
  if (h2) {
    const dt = document.querySelector('#editor .dt-row .dt-text');
    if (dt) dt.textContent = h2.textContent;
    saveDraft();
    return;
  }
  const h3 = e.target.closest && e.target.closest('h3[data-sec]');
  if (h3) {
    const secEl = document.querySelectorAll('#editor section')[parseInt(h3.dataset.sec)];
    if (secEl) {
      let txt = h3.textContent;
      if (secEl.dataset.shared === '1') {
        /* 共用声明节左侧栏保存无编号原标题 + 共用后缀，编号由渲染层自动补 */
        txt = txt.replace(/^[一二三四五六七八九十]+、/, '');
        if (!/（各项目共用）$/.test(txt)) txt += '（各项目共用）';
      }
      const h = secEl.querySelector('h3');
      if (h && h.textContent !== txt) h.textContent = txt;
    }
    saveDraft();
  }
});

/* 选中浮动工具栏：B / I / U / 颜色 / 清除格式 */
const selBar = document.createElement('div');
selBar.className = 'selbar';
selBar.hidden = true;
selBar.innerHTML = `
  <button data-cmd="bold" title="加粗"><b>B</b></button>
  <button data-cmd="italic" title="斜体"><i>I</i></button>
  <button data-cmd="underline" title="下划线"><u>U</u></button>
  <input type="color" title="文字颜色">
  <button data-clear="1" title="清除格式">⌫</button>`;
document.body.appendChild(selBar);
try { document.execCommand('styleWithCSS', false, true); } catch { /* 忽略 */ }
selBar.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (btn && btn.dataset.cmd) {
    document.execCommand(btn.dataset.cmd, false, null);
  } else if (btn && btn.dataset.clear) {
    document.execCommand('removeFormat', false, null);
  } else return;
  const li = getSelection().anchorNode && getSelection().anchorNode.parentElement &&
             getSelection().anchorNode.parentElement.closest('li[data-row]');
  if (li) syncFromLi(li);
});
selBar.querySelector('input[type=color]').addEventListener('input', e => {
  document.execCommand('foreColor', false, e.target.value);
  const li = getSelection().anchorNode && getSelection().anchorNode.parentElement &&
             getSelection().anchorNode.parentElement.closest('li[data-row]');
  if (li) syncFromLi(li);
});
document.addEventListener('selectionchange', () => {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) { selBar.hidden = true; return; }
  const li = sel.anchorNode && sel.anchorNode.parentElement &&
             sel.anchorNode.parentElement.closest('li[data-row]');
  if (!li || !$doc.contains(li)) { selBar.hidden = true; return; }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  selBar.hidden = false;
  selBar.style.left = Math.max(8, r.left + r.width / 2 - selBar.offsetWidth / 2) + 'px';
  selBar.style.top = Math.max(8, r.top - selBar.offsetHeight - 8) + 'px';
});

/* ---------- Logo 上传 ----------
 * 限制：仅 PNG/JPEG，原图 ≤ 2MB；上传后等比缩至最长边 400px 再存 localStorage，
 * 存储体积约 200KB 以内，避免撑爆 ~5MB 的本地配额。
 * ------------------------------------------------------------ */
/* 诊所抬头信息（全局）：填写名称/地址/电话后在文书首页标题上方成信头显示，留空则不显示 */
const CLINIC_KEY = 'cb_clinic';
let clinicCfg = { name: '', addr: '', tel: '' };
try {
  const saved = JSON.parse(localStorage.getItem(CLINIC_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    clinicCfg = { name: String(saved.name || ''), addr: String(saved.addr || ''), tel: String(saved.tel || '') };
  }
} catch { /* 用默认 */ }
function saveClinic() {
  localStorage.setItem(CLINIC_KEY, JSON.stringify(clinicCfg));
  renderDoc(activeTpl);
}
/* 诊所信头：三项都空则不渲染；只填了哪几项就显示哪几项 */
function clinicHeadHtml() {
  if (!clinicCfg.name && !clinicCfg.addr && !clinicCfg.tel) return '';
  let out = '<div class="clinic-head">';
  if (clinicCfg.name) out += `<div class="clinic-name">${escapeHtml(clinicCfg.name)}</div>`;
  const sub = [];
  if (clinicCfg.addr) sub.push(`<span>${escapeHtml(clinicCfg.addr)}</span>`);
  if (clinicCfg.tel) sub.push(`<span>${escapeHtml(clinicCfg.tel)}</span>`);
  if (sub.length) out += `<div class="clinic-sub">${sub.join('')}</div>`;
  return out + '</div>';
}

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
/* 打印走与导出一致的固定分页：先生成 A4 整页到 #printWrap，
   页脚精确贴到最后一页底部（连续长卷自然分页无法定位「末页底」） */
const $printWrap = document.getElementById('printWrap');
$btnPrint.onclick = () => {
  const tpl = TEMPLATES.find(t => t.id === currentId);
  if (!tpl) { toast('请先选择模板', true); return; }
  const sections = collectDocData();
  if (!sections.length) { toast('请先至少勾选一条条款', true); return; }
  const items = buildItems(tpl, sections);
  const fontStyle = `font-size:${fontCfg.size}px;color:${fontCfg.color};`;
  const pages = paginateItems(items, fontStyle);
  const total = pages.length;
  $printWrap.innerHTML = pages.map((pg, pi) => sheetHtml(pg, pi, total, fontStyle)).join('');
  window.print();
};

/* ---------- 物理分页（仅导出 PDF 用） ----------
 * 预览是连续长卷；导出时离屏量尺测高 → 297mm 贪心分页 → 每页一个条目数组。
 * 量尺只装 flowHtml(items)（h2/meta 不占位），按标签+数量逐个核对，避免错位 */
function paginateItems(items, fontStyle) {
  const offscreen = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
  // 页眉块（h2+rule+信息栏）单独测高，对应 items[0]/[1]
  const head = document.createElement('div');
  head.className = 'sheet measurer';
  head.style.cssText = offscreen + fontStyle;
  head.innerHTML = clinicHeadHtml() + `<h2>${escapeHtml(activeTpl.docTitle)}</h2><div class="title-rule"></div>` + metaGridHtml();
  document.body.appendChild(head);
  const heights = new Array(items.length);
  heights[0] = [...head.children].reduce((sum, el) => sum + el.offsetHeight, 0);
  heights[1] = 0;
  head.remove();

  // 正文量尺：只装 flowHtml 的输出，子元素与条目一一对应
  const meas = document.createElement('div');
  meas.className = 'sheet measurer';
  meas.style.cssText = offscreen + fontStyle;
  meas.innerHTML = flowHtml(items);
  document.body.appendChild(meas);

  const expectList = [];
  for (let i = 2; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'li') {
      if (items[i - 1].kind !== 'li' || items[i - 1].olKey !== it.olKey) {
        expectList.push({ type: 'ol', start: i });
      }
    } else {
      expectList.push({ type: 'el', index: i });
    }
  }

  const cs = getComputedStyle(meas);
  const pxPerMm = meas.clientWidth / 210;
  const pageH = 297 * pxPerMm - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const els = [...meas.children];
  let pos = 0, ok = true;
  for (const ex of expectList) {
    if (ex.type === 'ol') {
      const el = els[pos++];
      if (!el || el.tagName !== 'OL') { ok = false; break; }
      const lis = [...el.children];
      let cnt = 0;
      while (ex.start + cnt < items.length && items[ex.start + cnt].kind === 'li') cnt++;
      let need = 0;
      for (let k = 0; k < cnt; k++) need += 1 + (items[ex.start + k].blanks || 0);
      if (lis.length !== need) { ok = false; break; }
      let p = 0;
      for (let k = 0; k < cnt; k++) {
        heights[ex.start + k] = lis[p++].offsetHeight;
        for (let b = 0; b < (items[ex.start + k].blanks || 0); b++) {
          heights[ex.start + k] += lis[p++].offsetHeight;
        }
      }
    } else {
      const it = items[ex.index];
      const need = 1 + (it.kind === 'h3' || it.kind === 'h3cont' ? (it.gap || 0) : 0);
      if (pos + need > els.length) { ok = false; break; }
      let h = 0;
      for (let k = 0; k < need; k++) h += els[pos + k].offsetHeight;
      pos += need;
      heights[ex.index] = h;
    }
  }
  if (ok && pos !== els.length) ok = false;
  // 续页标题高度
  const probe = document.createElement('h3');
  probe.className = 'cont'; probe.textContent = '测（续）';
  meas.appendChild(probe);
  const contH = probe.offsetHeight;
  probe.remove();
  meas.remove();

  if (!ok) return [items];   // 测量失败兜底：整卷一页

  const TOL = 8; // 安全余量（px），宁可早翻页也不挤爆
  const secTitle = {};
  items.forEach(it => { if (it.kind === 'h3') secTitle[it.olKey] = it.title; });

  const pages = [];
  let pg = [], curH = 0;
  const headerOf = key => x => (x.kind === 'h3' || x.kind === 'h3cont') && x.olKey === key;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    /* h3 与其首条 li 视为一个整体：都放不下就先翻页，避免「标题孤立页底、内容跑下一页」 */
    if (it.kind === 'h3' && i + 1 < items.length &&
        items[i + 1].kind === 'li' && items[i + 1].olKey === it.olKey) {
      if (pg.length > 0 && curH + heights[i] + heights[i + 1] > pageH - TOL) {
        pages.push(pg); pg = []; curH = 0;
      }
    }
    if (it.kind === 'li') {
      /* 先按「本页是否已有该节标题」决定翻页时机，再在（可能全新的）页面上补标题 —
         顺序不能反：先补标题再翻页会把标题插到条款后面 */
      const need = pg.some(headerOf(it.olKey)) ? 0 : contH;
      if (pg.length > 0 && curH + need + heights[i] > pageH - TOL) {
        pages.push(pg); pg = []; curH = 0;
      }
      if (!pg.some(headerOf(it.olKey))) {
        pg.push({ kind: 'h3cont', title: secTitle[it.olKey] + '（续）', olKey: it.olKey });
        curH += contH;
      }
    } else if (pg.length > 0 && curH + heights[i] > pageH - TOL) {
      pages.push(pg); pg = []; curH = 0;
    }
    pg.push(it); curH += heights[i];
    if (heights[i] > pageH - TOL) { pages.push(pg); pg = []; curH = 0; }
  }
  if (pg.length) pages.push(pg);
  return pages.filter(p => p.length);

}

$btnPdf.onclick = async () => {
  const tpl = TEMPLATES.find(t => t.id === currentId);
  if (typeof html2canvas === 'undefined' || !window.jspdf) {
    toast('PDF 组件未加载，请检查 lib 目录', true); return;
  }
  const old = $btnPdf.textContent;
  $btnPdf.disabled = true;
  $btnPdf.textContent = '⏳ 正在生成…';
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const sections = collectDocData();
  if (!sections.length) {
    $btnPdf.disabled = false; $btnPdf.textContent = old;
    toast('请先至少勾选一条条款', true); return;
  }
  const items = buildItems(tpl, sections);
  const fontStyle = `font-size:${fontCfg.size}px;color:${fontCfg.color};`;
  const pages = paginateItems(items, fontStyle);
  const wrap = document.createElement('div');
  wrap.className = 'pdf-doc';
  wrap.style.cssText = 'position:absolute;left:-99999px;top:0;';
  const total = pages.length;
  wrap.innerHTML = pages.map((pg, pi) => sheetHtml(pg, pi, total, fontStyle)).join('');
  document.body.appendChild(wrap);
  try {
    const sheets = [...wrap.querySelectorAll('.sheet')];
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
    wrap.remove();
    $btnPdf.disabled = false;
    $btnPdf.textContent = old;
  }
};

$btnReset.onclick = () => {
  if (!currentId) return;
  const tplName = (TEMPLATES.find(t => t.id === currentId) || {}).name || '当前模板';
  if (!confirm('将「' + tplName + '」一键重置为初始预制状态：\n・清除所有条款勾选 / 改字 / 自定义条款\n・清除字体设置与行内格式\n・信息栏、签字区、信息栏字号恢复默认\n\n此操作不可撤销，确定重置？')) return;
  localStorage.removeItem(draftKey(currentId));
  selectTemplate(currentId);
  toast('已重置为模板初始状态');
};

/* ---------- 启动：默认选中第一个模板 ---------- */
renderLogoUI();
renderTplList();
selectTemplate(TEMPLATES[0].id);
