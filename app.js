/* Mis Finanzas — presupuestos por categoría, movimientos e importación desde banco/tarjetas. */
(function () {
  'use strict';
  const { esc } = Charts;
  const P = Parsers;
  const STORE_KEY = 'misFinanzas.v1';

  /* Colores categóricos en orden fijo (validados para daltonismo); la 9ª+ categoría usa gris. */
  const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
  const OTHER = 'var(--s-other)';

  const DEFAULT_CATEGORIES = [
    { key: 'supermercado', name: 'Supermercado', icon: '🛒', budget: 250000 },
    { key: 'comida', name: 'Comida y salidas', icon: '🍽️', budget: 120000 },
    { key: 'transporte', name: 'Transporte', icon: '🚗', budget: 90000 },
    { key: 'hogar', name: 'Hogar y servicios', icon: '🏠', budget: 180000 },
    { key: 'salud', name: 'Salud y deporte', icon: '💊', budget: 60000 },
    { key: 'entretenimiento', name: 'Entretenimiento', icon: '🎬', budget: 50000 },
    { key: 'compras', name: 'Compras', icon: '🛍️', budget: 80000 },
    { key: 'suscripciones', name: 'Suscripciones', icon: '📺', budget: 30000 },
    { key: 'educacion', name: 'Educación', icon: '📚', budget: 40000 },
    { key: 'otros', name: 'Otros', icon: '📦', budget: 50000 },
  ];

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const pad = n => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const monthOf = iso => iso.slice(0, 7);

  function freshState() {
    return {
      version: 1,
      settings: { currency: 'CLP', locale: 'es-CL', theme: 'auto' },
      categories: DEFAULT_CATEGORIES.map(c => ({ id: uid(), ...c })),
      budgetOverrides: {},            // { 'AAAA-MM': { categoryId: monto } }
      accounts: [{ id: uid(), name: 'Cuenta corriente', type: 'cuenta', last4: '' }],
      transactions: [],               // amount < 0 = gasto, > 0 = ingreso
      rules: [],                      // { id, pattern, categoryId }
    };
  }

  let state = load();
  let ui = { view: 'resumen', month: monthOf(todayISO()), filter: { q: '', cat: '', acc: '' }, importPreview: null };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(freshState(), JSON.parse(raw));
    } catch (e) { /* almacenamiento no disponible */ }
    return freshState();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('No se pudo guardar en este navegador. Exporta un respaldo desde Ajustes.'); }
  }

  /* ---------- Formatos ---------- */
  function money(v, compact) {
    const cur = state.settings.currency;
    const zeroDec = ['CLP', 'COP', 'PYG', 'JPY'].includes(cur);
    try {
      return new Intl.NumberFormat(state.settings.locale, {
        style: 'currency', currency: cur,
        maximumFractionDigits: zeroDec || compact ? 0 : 2,
        notation: compact && Math.abs(v) >= 1e6 ? 'compact' : 'standard',
      }).format(v);
    } catch (e) { return cur + ' ' + Math.round(v); }
  }
  const monthName = ym => {
    const [y, m] = ym.split('-').map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const shortMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es', { month: 'short' }).replace('.', ''); };
  const shiftMonth = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const fmtDate = iso => new Date(iso + 'T12:00').toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });

  /* ---------- Cálculos ---------- */
  const catById = id => state.categories.find(c => c.id === id);
  const accById = id => state.accounts.find(a => a.id === id);
  const catColor = c => { const i = state.categories.indexOf(c); return i > -1 && i < SLOTS.length ? SLOTS[i] : OTHER; };
  const budgetFor = (catId, ym) => {
    const o = state.budgetOverrides[ym];
    if (o && o[catId] != null) return o[catId];
    const c = catById(catId); return c ? c.budget || 0 : 0;
  };
  const txOfMonth = ym => state.transactions.filter(t => monthOf(t.date) === ym);

  function monthSummary(ym) {
    const txs = txOfMonth(ym);
    const byCat = new Map(state.categories.map(c => [c.id, 0]));
    let spent = 0, income = 0, uncategorized = 0;
    for (const t of txs) {
      if (t.amount < 0) {
        spent += -t.amount;
        if (t.categoryId && byCat.has(t.categoryId)) byCat.set(t.categoryId, byCat.get(t.categoryId) - t.amount);
        else uncategorized += -t.amount;
      } else income += t.amount;
    }
    const budget = state.categories.reduce((a, c) => a + budgetFor(c.id, ym), 0);
    return { txs, byCat, spent, income, uncategorized, budget };
  }

  function status(spent, budget) {
    if (!budget) return spent > 0 ? { cls: 'critical', icon: '✕', label: 'Sin presupuesto' } : { cls: 'muted', icon: '–', label: 'Sin uso' };
    const p = spent / budget;
    if (p > 1) return { cls: 'critical', icon: '✕', label: 'Excedido' };
    if (p >= 0.8) return { cls: 'warning', icon: '!', label: 'Cerca del límite' };
    return { cls: 'good', icon: '✓', label: 'En rango' };
  }

  /* ---------- Render principal ---------- */
  const app = document.getElementById('app');
  function render() {
    document.getElementById('monthLabel').textContent = monthName(ui.month);
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
    document.querySelector('.month-picker').style.visibility = ['resumen', 'presupuestos', 'movimientos'].includes(ui.view) ? 'visible' : 'hidden';
    ({ resumen: viewResumen, presupuestos: viewPresupuestos, movimientos: viewMovimientos, importar: viewImportar, ajustes: viewAjustes })[ui.view]();
  }

  /* ===== RESUMEN ===== */
  function viewResumen() {
    const s = monthSummary(ui.month);
    const left = s.budget - s.spent;
    const pct = s.budget ? s.spent / s.budget : 0;
    const st = status(s.spent, s.budget);
    const isCurrent = ui.month === monthOf(todayISO());
    const dayNow = isCurrent ? new Date().getDate() : daysIn(ui.month);
    const pace = s.budget * dayNow / daysIn(ui.month);
    const perDay = isCurrent && left > 0 ? left / (daysIn(ui.month) - dayNow + 1) : null;

    if (!state.transactions.length) {
      app.innerHTML = `<section class="card empty">
        <h2>¡Bienvenido! 👋</h2>
        <p>Aún no tienes movimientos. Puedes conectar tus tarjetas y cuenta (avisos del banco o cartolas) o ver la app con datos de ejemplo.</p>
        <div class="row"><button class="btn primary" data-go="importar">🏦 Conectar banco / tarjetas</button>
        <button class="btn ghost" id="loadDemo">✨ Ver con datos de ejemplo</button></div></section>`;
      app.querySelector('#loadDemo').onclick = () => { loadDemo(); render(); };
      return;
    }

    const catRows = state.categories.map(c => ({ c, spent: s.byCat.get(c.id) || 0, budget: budgetFor(c.id, ui.month) }))
      .filter(r => r.spent > 0 || r.budget > 0)
      .sort((a, b) => (b.budget ? b.spent / b.budget : 9) - (a.budget ? a.spent / a.budget : 9));

    app.innerHTML = `
    <section class="kpis">
      <div class="kpi"><span>Presupuesto</span><strong>${money(s.budget)}</strong></div>
      <div class="kpi"><span>Gastado</span><strong>${money(s.spent)}</strong></div>
      <div class="kpi"><span>${left >= 0 ? 'Disponible' : 'Sobregiro'}</span><strong class="${left < 0 ? 'neg' : ''}">${money(Math.abs(left))}</strong>${perDay ? `<small>${money(perDay)} por día restante</small>` : ''}</div>
      <div class="kpi"><span>Ingresos</span><strong>${money(s.income)}</strong><small>Balance ${money(s.income - s.spent)}</small></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Uso del presupuesto total</h2><span class="pill ${st.cls}">${st.icon} ${st.label} · ${Math.round(pct * 100)}%</span></div>
      <div class="meter big" data-tip="${esc(`Gastado ${money(s.spent)} de ${money(s.budget)}`)}">
        <div class="meter-fill ${st.cls}" style="width:${Math.min(100, pct * 100)}%"></div>
        ${isCurrent && s.budget ? `<div class="meter-mark" style="left:${Math.min(100, (pace / s.budget) * 100)}%" title="Ritmo ideal a hoy"></div>` : ''}
      </div>
      ${isCurrent && s.budget ? `<p class="hint">La marca vertical es lo que “deberías” llevar gastado al día ${dayNow} (${money(pace)}). ${s.spent > pace ? '⚠ Vas por encima del ritmo.' : '✓ Vas bajo el ritmo.'}</p>` : ''}
      ${s.uncategorized ? `<p class="hint">📌 ${money(s.uncategorized)} sin categoría. <a href="#" data-go="movimientos" data-filter-cat="__none">Clasificarlos</a></p>` : ''}
    </section>

    <div class="grid2">
      <section class="card">
        <div class="card-head"><h2>Presupuesto por categoría</h2><button class="btn small ghost" data-go="presupuestos">Editar</button></div>
        <div class="cat-bars">${catRows.map(r => catBarRow(r.c, r.spent, r.budget)).join('') || '<p class="hint">Sin datos este mes.</p>'}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>¿En qué se va el dinero?</h2></div>
        <div class="donut-wrap"><div id="donut" class="donut"></div><ul class="legend" id="donutLegend"></ul></div>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h2>Gasto acumulado del mes</h2>
        <ul class="legend inline"><li><i style="background:var(--s1)"></i>Gastado</li><li><i class="dash"></i>Ritmo del presupuesto</li></ul></div>
      <div id="lineChart" class="chart"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Últimos 6 meses</h2><span class="hint">Línea punteada: presupuesto de ${shortMonth(ui.month)}</span></div>
      <div id="barChart" class="chart"></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Movimientos recientes</h2><button class="btn small ghost" data-go="movimientos">Ver todos</button></div>
      ${txList(s.txs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8))}
    </section>`;

    // Dona: hasta 7 categorías + "Otras"
    const spentCats = state.categories.map(c => ({ c, v: s.byCat.get(c.id) || 0 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    let slices = spentCats.map(x => ({ label: `${x.c.icon} ${x.c.name}`, value: x.v, color: catColor(x.c) }));
    if (s.uncategorized) slices.push({ label: '❓ Sin categoría', value: s.uncategorized, color: OTHER });
    if (slices.length > 8) {
      const rest = slices.slice(7);
      slices = slices.slice(0, 7).concat({ label: `📦 Otras (${rest.length})`, value: rest.reduce((a, x) => a + x.value, 0), color: OTHER });
    }
    slices.forEach(x => { x.tip = `${x.label}: ${money(x.value)} (${Math.round((x.value / s.spent) * 100)}%)`; });
    Charts.donut(document.getElementById('donut'), slices, { centerTop: money(s.spent, true), centerBottom: 'gastado' });
    document.getElementById('donutLegend').innerHTML = slices.map(x =>
      `<li data-tip="${esc(x.tip)}"><i style="background:${x.color}"></i><span>${esc(x.label)}</span><b>${Math.round((x.value / s.spent) * 100)}%</b></li>`).join('');

    // Línea acumulada vs ritmo
    const n = daysIn(ui.month), daily = new Array(n + 1).fill(0);
    s.txs.forEach(t => { if (t.amount < 0) daily[+t.date.slice(8, 10)] += -t.amount; });
    const cum = []; let acc = 0;
    for (let d = 1; d <= dayNow; d++) { acc += daily[d]; cum.push({ x: d, y: acc }); }
    const ideal = [{ x: 1, y: s.budget / n }, { x: n, y: s.budget }];
    Charts.lines(document.getElementById('lineChart'), [
      { label: 'Ritmo', color: 'var(--text-muted)', points: ideal, dashed: true },
      { label: 'Gastado', color: 'var(--s1)', points: cum },
    ], {
      n, fmt: v => money(v, true),
      tipFor: i => {
        const c = cum[i - 1];
        return `Día ${i}` + (c ? ` · acumulado ${money(c.y)} · ese día ${money(daily[i])}` : '') + ` · ritmo ${money(s.budget * i / n)}`;
      },
    });

    // Barras últimos 6 meses
    const months = [-5, -4, -3, -2, -1, 0].map(k => shiftMonth(ui.month, k));
    Charts.bars(document.getElementById('barChart'), months.map(ym => {
      const ms = monthSummary(ym);
      return { label: shortMonth(ym), value: ms.spent, highlight: ym === ui.month, tip: `${monthName(ym)}: gastado ${money(ms.spent)} · presupuesto ${money(ms.budget)} · ingresos ${money(ms.income)}` };
    }), { fmt: v => money(v, true), color: 'var(--s1)', refValue: s.budget, refLabel: 'Presupuesto' });
  }

  function catBarRow(c, spent, budget) {
    const st = status(spent, budget);
    const pct = budget ? spent / budget : (spent ? 1 : 0);
    const over = budget && spent > budget;
    const fillW = over ? (budget / spent) * 100 : pct * 100;
    return `<div class="cat-row" data-tip="${esc(`${c.name}: ${money(spent)} de ${money(budget)} (${Math.round(pct * 100)}%)`)}">
      <div class="cat-name"><span class="swatch" style="background:${catColor(c)}"></span>${c.icon} ${esc(c.name)}</div>
      <div class="cat-vals">${money(spent)} <span class="muted">/ ${money(budget)}</span></div>
      <div class="meter"><div class="meter-fill ${st.cls}" style="width:${Math.min(100, fillW)}%"></div>${over ? `<div class="meter-over" style="left:${fillW}%;width:${100 - fillW}%"></div>` : ''}</div>
      <span class="pill ${st.cls}">${st.icon} ${over ? '+' + money(spent - budget) : budget ? Math.round(pct * 100) + '%' : st.label}</span>
    </div>`;
  }

  function gauge(pct, cls) {
    const r = 34, C = 2 * Math.PI * r, v = Math.min(1, pct);
    return `<svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--grid)" stroke-width="9"/>
      ${v > 0 ? `<circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--st-${cls})" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${C * v} ${C}" transform="rotate(-90 42 42)"/>` : ''}
      <text x="42" y="47" text-anchor="middle" class="gauge-txt">${Math.round(pct * 100)}%</text></svg>`;
  }

  /* ===== PRESUPUESTOS ===== */
  function viewPresupuestos() {
    const s = monthSummary(ui.month);
    const hasOverride = !!state.budgetOverrides[ui.month];
    app.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Presupuestos de ${monthName(ui.month)}</h2>
        <span class="pill ${status(s.spent, s.budget).cls}">Total ${money(s.budget)}</span></div>
      <p class="hint">Asigna cuánto quieres gastar como máximo en cada categoría. Los montos se guardan como <b>predeterminados</b> para todos los meses;
      marca “solo este mes” si quieres un ajuste puntual (ej. vacaciones en diciembre).</p>
      <label class="check"><input type="checkbox" id="onlyMonth" ${hasOverride ? 'checked' : ''}> Ajustar solo ${monthName(ui.month)}</label>
      ${s.income ? `<p class="hint">Ingresos del mes: ${money(s.income)} → presupuesto = ${Math.round(s.budget / s.income * 100)}% de tus ingresos.</p>` : ''}
    </section>
    <div class="budget-grid">
      ${state.categories.map(c => {
        const spent = s.byCat.get(c.id) || 0, b = budgetFor(c.id, ui.month), st = status(spent, b);
        return `<div class="card budget-card">
          <div class="bc-top">${gauge(b ? spent / b : spent ? 1 : 0, st.cls)}
            <div><div class="bc-name"><span class="swatch" style="background:${catColor(c)}"></span>${c.icon} ${esc(c.name)}</div>
            <div class="muted">Gastado ${money(spent)}</div>
            <span class="pill ${st.cls}">${st.icon} ${st.label}</span></div></div>
          <label class="bc-input">Presupuesto <input inputmode="decimal" data-budget="${c.id}" value="${b || ''}" placeholder="0"></label>
          <div class="muted small">${b ? (spent <= b ? `Te quedan ${money(b - spent)}` : `Te pasaste por ${money(spent - b)}`) : 'Sin límite asignado'}</div>
        </div>`;
      }).join('')}
      <div class="card budget-card add-card">
        <h3>Nueva categoría</h3>
        <div class="row"><input id="newCatIcon" value="🏷️" maxlength="4" class="icon-input" aria-label="Ícono">
        <input id="newCatName" placeholder="Nombre (ej: Mascotas)"></div>
        <input id="newCatBudget" inputmode="decimal" placeholder="Presupuesto mensual">
        <button class="btn primary" id="addCat">Agregar</button>
      </div>
    </div>`;

    app.querySelectorAll('[data-budget]').forEach(inp => inp.addEventListener('change', () => {
      const v = Math.max(0, P.parseAmount(inp.value) || 0);
      const only = document.getElementById('onlyMonth').checked;
      if (only) {
        const o = state.budgetOverrides[ui.month] || (state.budgetOverrides[ui.month] = Object.fromEntries(state.categories.map(c => [c.id, budgetFor(c.id, ui.month)])));
        o[inp.dataset.budget] = v;
      } else {
        catById(inp.dataset.budget).budget = v;
        delete state.budgetOverrides[ui.month];
      }
      save(); render(); toast('Presupuesto actualizado');
    }));
    document.getElementById('onlyMonth').onchange = e => {
      if (!e.target.checked) { delete state.budgetOverrides[ui.month]; save(); render(); }
    };
    document.getElementById('addCat').onclick = () => {
      const name = document.getElementById('newCatName').value.trim();
      if (!name) return toast('Escribe un nombre');
      state.categories.push({ id: uid(), key: '', name, icon: document.getElementById('newCatIcon').value || '🏷️', budget: P.parseAmount(document.getElementById('newCatBudget').value) || 0 });
      save(); render();
    };
  }

  /* ===== MOVIMIENTOS ===== */
  function txList(txs, editable) {
    if (!txs.length) return '<p class="hint">No hay movimientos.</p>';
    let html = '<ul class="tx-list">', lastDate = '';
    for (const t of txs) {
      if (editable && t.date !== lastDate) { html += `<li class="tx-date">${fmtDate(t.date)}</li>`; lastDate = t.date; }
      const c = catById(t.categoryId), a = accById(t.accountId);
      html += `<li class="tx" data-tx="${t.id}">
        <span class="tx-icon" style="--c:${c ? catColor(c) : t.amount > 0 ? 'var(--st-good)' : OTHER}">${c ? c.icon : t.amount > 0 ? '💵' : '❓'}</span>
        <div class="tx-main"><div class="tx-desc">${esc(t.desc)}</div>
          <div class="tx-meta">${editable ? '' : fmtDate(t.date) + ' · '}${a ? esc(a.name) : 'Sin cuenta'}${t.source && t.source !== 'manual' ? ` · <span class="src">${esc(t.source)}</span>` : ''}</div></div>
        ${editable ? `<select class="tx-cat" data-cat-for="${t.id}" aria-label="Categoría">${catOptions(t.categoryId, true)}</select>` : `<span class="tx-catname">${c ? esc(c.name) : t.amount > 0 ? 'Ingreso' : 'Sin categoría'}</span>`}
        <span class="tx-amt ${t.amount > 0 ? 'pos' : ''}">${t.amount > 0 ? '+' : '−'}${money(Math.abs(t.amount))}</span></li>`;
    }
    return html + '</ul>';
  }
  const catOptions = (sel, allowNone) => (allowNone ? `<option value="">❓ Sin categoría</option>` : '') +
    state.categories.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
  const accOptions = sel => `<option value="">— Sin cuenta —</option>` + state.accounts.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

  function viewMovimientos() {
    const f = ui.filter;
    let txs = txOfMonth(ui.month);
    if (f.cat === '__none') txs = txs.filter(t => !t.categoryId && t.amount < 0);
    else if (f.cat) txs = txs.filter(t => t.categoryId === f.cat);
    if (f.acc) txs = txs.filter(t => t.accountId === f.acc);
    if (f.q) txs = txs.filter(t => P.norm(t.desc).includes(P.norm(f.q)));
    txs.sort((a, b) => b.date.localeCompare(a.date));
    const out = txs.filter(t => t.amount < 0).reduce((a, t) => a - t.amount, 0);
    const inc = txs.filter(t => t.amount > 0).reduce((a, t) => a + t.amount, 0);
    app.innerHTML = `
    <section class="card">
      <div class="filters">
        <input type="search" id="fq" placeholder="🔎 Buscar comercio…" value="${esc(f.q)}">
        <select id="fcat"><option value="">Todas las categorías</option><option value="__none" ${f.cat === '__none' ? 'selected' : ''}>❓ Sin categoría</option>${catOptions(f.cat)}</select>
        <select id="facc"><option value="">Todas las cuentas</option>${state.accounts.map(a => `<option value="${a.id}" ${a.id === f.acc ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      </div>
      <p class="hint">${txs.length} movimientos · gastos ${money(out)} · ingresos ${money(inc)}. Cambia la categoría con el selector; la app puede recordarla para ese comercio.</p>
      ${txList(txs, true)}
    </section>`;
    const refilter = () => { ui.filter = { q: fq.value, cat: fcat.value, acc: facc.value }; render(); const el = document.getElementById('fq'); if (document.activeElement !== el && ui.filter.q) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };
    const fq = document.getElementById('fq'), fcat = document.getElementById('fcat'), facc = document.getElementById('facc');
    let tmr; fq.oninput = () => { clearTimeout(tmr); tmr = setTimeout(refilter, 250); };
    fcat.onchange = refilter; facc.onchange = refilter;
    app.querySelectorAll('[data-cat-for]').forEach(sel => {
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('change', () => {
        const t = state.transactions.find(x => x.id === sel.dataset.catFor);
        t.categoryId = sel.value || null; save();
        if (sel.value) offerRule(t);
        render();
      });
    });
  }

  function offerRule(t) {
    const kw = P.merchantKeyword(t.desc);
    if (!kw || state.rules.some(r => r.pattern === kw)) return;
    const c = catById(t.categoryId);
    toast(`¿Clasificar siempre “${kw}” como ${c.icon} ${c.name}?`, {
      action: 'Sí, recordar', onAction: () => {
        state.rules.push({ id: uid(), pattern: kw, categoryId: t.categoryId });
        let n = 0;
        state.transactions.forEach(x => { if (!x.categoryId && x.amount < 0 && P.norm(x.desc).includes(kw)) { x.categoryId = t.categoryId; n++; } });
        save(); render(); toast(`Regla creada${n ? `; ${n} movimientos más clasificados` : ''}`);
      },
    });
  }

  /* ===== IMPORTAR / CONECTAR ===== */
  function viewImportar() {
    const base = location.href.split('#')[0];
    app.innerHTML = `
    <section class="card">
      <h2>🏦 Conecta tus tarjetas y tu cuenta</h2>
      <p>Hay tres formas de que tus gastos lleguen solos a la app. Puedes combinarlas; los duplicados se detectan automáticamente.</p>
      <div class="methods">
        <div class="method"><b>1. Avisos de compra (recomendado)</b><p>Tu banco te envía un correo, SMS o notificación por cada compra con tarjeta o transferencia. Pégalos abajo o automatiza el envío (paso 2) y la app detecta monto, comercio, fecha y tarjeta.</p></div>
        <div class="method"><b>2. Cartola / estado de cuenta</b><p>Descarga desde la web de tu banco los movimientos en <b>CSV</b> (o Excel guardado como CSV) u <b>OFX/QFX</b> y súbelos aquí.</p></div>
        <div class="method"><b>3. Automático desde el celular</b><p>Con Atajos (iPhone) o MacroDroid/Tasker (Android) puedes reenviar cada SMS/notificación del banco a este enlace y se registra solo.</p></div>
      </div>
    </section>

    <div class="grid2">
      <section class="card">
        <h3>📩 Pegar avisos del banco</h3>
        <textarea id="notifText" rows="8" placeholder="Ej: Se ha realizado una compra por $23.450 con su Tarjeta de Crédito ****4521 en LIDER EXPRESS el 28/10/2026.&#10;&#10;Puedes pegar varios avisos a la vez, separados por una línea en blanco."></textarea>
        <button class="btn primary" id="parseNotif">Detectar movimientos</button>
      </section>
      <section class="card">
        <h3>📄 Subir cartola (CSV / OFX)</h3>
        <label class="drop" id="drop"><input type="file" id="fileIn" accept=".csv,.txt,.ofx,.qfx,text/csv" multiple hidden>
          <span>Arrastra el archivo aquí o <u>elige uno</u></span></label>
        <label>Asignar a cuenta/tarjeta <select id="fileAcc">${accOptions(state.accounts[0] && state.accounts[0].id)}</select></label>
        <label>Formato de fecha <select id="dateOrder"><option value="dmy">día/mes/año</option><option value="mdy">mes/día/año</option></select></label>
        <div id="csvMap"></div>
      </section>
    </div>

    <div id="preview"></div>

    <section class="card">
      <h3>📲 Registro automático desde el celular</h3>
      <p class="hint">Cualquier automatización que abra este enlace con el texto del aviso al final registra el gasto (queda guardado en el navegador del celular donde se abre):</p>
      <code class="codebox" id="autoUrl">${esc(base)}#aviso=TEXTO_DEL_AVISO</code>
      <button class="btn small ghost" id="copyUrl">Copiar enlace</button>
      <details><summary><b>iPhone — app Atajos</b></summary><ol>
        <li>Atajos → Automatización → Nueva → <b>Mensaje</b> → “Remitente” = el número/nombre de tu banco → Ejecutar inmediatamente.</li>
        <li>Acción <b>Codificar URL</b> con “Mensaje” (el contenido del SMS).</li>
        <li>Acción <b>Texto</b>: <code>${esc(base)}#aviso=</code> + resultado codificado.</li>
        <li>Acción <b>Abrir URL</b>. Para correos usa la automatización <b>Correo</b> con el remitente de tu banco.</li></ol></details>
      <details><summary><b>Android — MacroDroid / Tasker</b></summary><ol>
        <li>Disparador: <b>Notificación recibida</b> (app de tu banco o Mensajes) o <b>SMS recibido</b> del banco.</li>
        <li>Acción: <b>Abrir sitio web / URL</b> con <code>${esc(base)}#aviso=[notification_text]</code> (codificado como URL).</li></ol></details>
      <details><summary><b>Conexión directa con la API del banco (avanzado)</b></summary>
        <p>Una conexión 100% directa necesita un servicio “agregador” bancario con servidor propio y claves privadas — no puede hacerse de forma segura solo desde el navegador.
        Según tu país: <b>Fintoc</b> (Chile, México), <b>Belvo</b> (México, Brasil, Colombia), <b>Prometeo</b> (Latam) o <b>Plaid</b> (EE. UU., Europa).
        Esta app ya acepta movimientos en el formato que entregan (fecha, descripción, monto), así que se puede agregar un pequeño backend que los sincronice.</p></details>
    </section>`;

    document.getElementById('parseNotif').onclick = () => {
      const items = P.parseNotifications(document.getElementById('notifText').value);
      if (!items.length) return toast('No encontré montos en el texto. Revisa que incluya el monto con $.');
      showPreview(items.map(i => ({ ...i, source: 'aviso' })));
    };
    const fileIn = document.getElementById('fileIn'), drop = document.getElementById('drop');
    fileIn.onchange = () => handleFiles(fileIn.files);
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });
    document.getElementById('copyUrl').onclick = () => {
      try { navigator.clipboard.writeText(base + '#aviso='); toast('Enlace copiado'); } catch (e) { toast('Cópialo manualmente'); }
    };
    if (ui.importPreview) renderPreview();
  }

  async function handleFiles(files) {
    const all = [];
    const accId = document.getElementById('fileAcc').value || null;
    const order = document.getElementById('dateOrder').value;
    for (const f of files) {
      let text = await f.text();
      if (text.includes('\uFFFD')) { // probablemente Latin-1 (común en bancos)
        text = new TextDecoder('windows-1252').decode(await f.arrayBuffer());
      }
      if (/<OFX>|<STMTTRN>/i.test(text)) {
        all.push(...P.parseOFX(text).map(t => ({ ...t, accountId: accId, source: 'ofx' })));
      } else {
        const rows = P.parseCSV(text);
        const map = P.guessMapping(rows);
        csvMapper(rows, map, order, accId, f.name);
        return;
      }
    }
    if (!all.length) return toast('No se encontraron movimientos en el archivo');
    showPreview(all);
  }

  /** Permite corregir qué columna es qué antes de importar. */
  function csvMapper(rows, map, order, accId, name) {
    const hdr = rows[map.headerIdx] || [];
    const opt = (sel) => `<option value="-1">—</option>` + hdr.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h || 'Columna ' + (i + 1))}</option>`).join('');
    const box = document.getElementById('csvMap');
    box.innerHTML = `<div class="mapper"><p class="hint">📄 ${esc(name)}: ${rows.length - map.headerIdx - 1} filas. Confirma las columnas:</p>
      <label>Fecha <select data-k="date">${opt(map.date)}</select></label>
      <label>Descripción <select data-k="desc">${opt(map.desc)}</select></label>
      <label>Monto (con signo) <select data-k="amount">${opt(map.amount)}</select></label>
      <label>— o — Cargos / débitos <select data-k="debit">${opt(map.debit)}</select></label>
      <label>Abonos / créditos <select data-k="credit">${opt(map.credit)}</select></label>
      <label class="check"><input type="checkbox" id="invert"> Los gastos vienen como números positivos (tarjeta de crédito)</label>
      <button class="btn primary" id="mapGo">Ver movimientos</button></div>`;
    box.querySelector('#mapGo').onclick = () => {
      box.querySelectorAll('select[data-k]').forEach(s => { map[s.dataset.k] = +s.value; });
      const txs = P.rowsToTransactions(rows, map, { dateOrder: order, invertSign: box.querySelector('#invert').checked });
      if (!txs.length) return toast('No pude leer movimientos con esas columnas');
      showPreview(txs.map(t => ({ ...t, accountId: accId, source: 'cartola' })));
    };
  }

  function accountForLast4(last4) {
    if (!last4) return null;
    let a = state.accounts.find(x => x.last4 === last4);
    if (!a) { a = { id: uid(), name: `Tarjeta ****${last4}`, type: 'credito', last4 }; state.accounts.push(a); save(); }
    return a.id;
  }

  function showPreview(items) {
    const existing = new Set(state.transactions.map(P.txKey));
    ui.importPreview = items.map(i => {
      const accountId = i.accountId !== undefined && i.accountId !== null ? i.accountId : accountForLast4(i.last4);
      const dup = existing.has(P.txKey(i)) || (i.fitid && state.transactions.some(t => t.fitid === i.fitid));
      return { ...i, id: uid(), accountId, include: !dup, dup, categoryId: i.amount < 0 ? P.autoCategory(i.desc, state.rules, state.categories) : null };
    });
    renderPreview();
    document.getElementById('preview').scrollIntoView({ behavior: 'smooth' });
  }

  function renderPreview() {
    const box = document.getElementById('preview'), items = ui.importPreview;
    if (!box || !items) return;
    const n = items.filter(i => i.include).length;
    box.innerHTML = `<section class="card">
      <div class="card-head"><h2>Revisar antes de guardar</h2><span class="hint">${items.length} detectados · ${items.filter(i => i.dup).length} posibles duplicados</span></div>
      <div class="table-wrap"><table class="preview"><thead><tr><th></th><th>Fecha</th><th>Descripción</th><th>Monto</th><th>Categoría</th><th>Cuenta</th></tr></thead><tbody>
      ${items.map((i, k) => `<tr class="${i.dup ? 'dup' : ''}">
        <td><input type="checkbox" data-inc="${k}" ${i.include ? 'checked' : ''} aria-label="Incluir"></td>
        <td>${esc(i.date)}</td><td>${esc(i.desc)}${i.dup ? ' <span class="pill warning">! ya existe</span>' : ''}</td>
        <td class="num ${i.amount > 0 ? 'pos' : ''}">${i.amount > 0 ? '+' : '−'}${money(Math.abs(i.amount))}</td>
        <td><select data-pcat="${k}">${catOptions(i.categoryId, true)}</select></td>
        <td><select data-pacc="${k}">${accOptions(i.accountId)}</select></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row-end"><button class="btn ghost" id="cancelImp">Descartar</button><button class="btn primary" id="doImp">Guardar ${n} movimientos</button></div>
    </section>`;
    box.querySelectorAll('[data-inc]').forEach(c => c.onchange = () => { items[c.dataset.inc].include = c.checked; renderPreview(); });
    box.querySelectorAll('[data-pcat]').forEach(s => s.onchange = () => { items[s.dataset.pcat].categoryId = s.value || null; });
    box.querySelectorAll('[data-pacc]').forEach(s => s.onchange = () => { items[s.dataset.pacc].accountId = s.value || null; });
    box.querySelector('#cancelImp').onclick = () => { ui.importPreview = null; box.innerHTML = ''; };
    box.querySelector('#doImp').onclick = () => {
      const add = items.filter(i => i.include).map(({ include, dup, last4, raw, ...t }) => t);
      state.transactions.push(...add);
      ui.importPreview = null; save();
      if (add.length) ui.month = add.map(t => monthOf(t.date)).sort().pop();
      toast(`${add.length} movimientos guardados`);
      ui.view = 'resumen'; render();
    };
  }

  /** Registro vía enlace: index.html#aviso=<texto codificado> (para automatizaciones del celular). */
  function handleHash() {
    const m = location.hash.match(/^#aviso=(.*)$/s);
    if (!m) return;
    let text = '';
    try { text = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { text = m[1]; }
    history.replaceState(null, '', location.pathname + location.search);
    const items = P.parseNotifications(text);
    if (!items.length) { toast('El aviso recibido no tenía un monto reconocible'); return; }
    const existing = new Set(state.transactions.map(P.txKey));
    let added = 0;
    for (const i of items) {
      if (existing.has(P.txKey(i))) continue;
      state.transactions.push({ id: uid(), date: i.date, desc: i.desc, amount: i.amount, accountId: accountForLast4(i.last4),
        categoryId: i.amount < 0 ? P.autoCategory(i.desc, state.rules, state.categories) : null, source: 'aviso' });
      added++;
    }
    save();
    toast(added ? `✓ Registrado automáticamente: ${items.map(i => `${i.desc} ${money(Math.abs(i.amount))}`).join(', ')}` : 'Ese aviso ya estaba registrado');
  }

  /* ===== AJUSTES ===== */
  function viewAjustes() {
    const currencies = [['CLP', 'es-CL', 'Peso chileno'], ['MXN', 'es-MX', 'Peso mexicano'], ['COP', 'es-CO', 'Peso colombiano'], ['ARS', 'es-AR', 'Peso argentino'],
      ['PEN', 'es-PE', 'Sol peruano'], ['UYU', 'es-UY', 'Peso uruguayo'], ['USD', 'es-US', 'Dólar'], ['EUR', 'es-ES', 'Euro']];
    app.innerHTML = `
    <div class="grid2">
    <section class="card">
      <h3>💱 Moneda</h3>
      <select id="cur">${currencies.map(([c, l, n]) => `<option value="${c}|${l}" ${c === state.settings.currency ? 'selected' : ''}>${n} (${c})</option>`).join('')}</select>
      <h3>💳 Cuentas y tarjetas</h3>
      <p class="hint">Los últimos 4 dígitos permiten asignar automáticamente cada aviso a su tarjeta.</p>
      <ul class="simple-list">${state.accounts.map(a => `<li><span>${a.type === 'credito' ? '💳' : a.type === 'debito' ? '🏧' : '🏦'} ${esc(a.name)} ${a.last4 ? `<span class="muted">****${esc(a.last4)}</span>` : ''}</span>
        <span class="muted">${state.transactions.filter(t => t.accountId === a.id).length} mov.</span><button class="icon-btn" data-del-acc="${a.id}" aria-label="Eliminar">🗑</button></li>`).join('')}</ul>
      <div class="row wrap"><input id="accName" placeholder="Nombre (ej: Visa Banco Estado)"><select id="accType"><option value="credito">Crédito</option><option value="debito">Débito</option><option value="cuenta">Cuenta</option></select>
        <input id="accLast4" placeholder="Últimos 4" maxlength="4" inputmode="numeric" class="short"><button class="btn primary" id="addAcc">Agregar</button></div>
    </section>
    <section class="card">
      <h3>🧠 Reglas de categorización</h3>
      <p class="hint">Si la descripción contiene el texto, se asigna esa categoría. Se crean al reclasificar un movimiento.</p>
      <ul class="simple-list">${state.rules.map(r => { const c = catById(r.categoryId); return `<li><span>“${esc(r.pattern)}” → ${c ? c.icon + ' ' + esc(c.name) : '?'}</span><button class="icon-btn" data-del-rule="${r.id}" aria-label="Eliminar">🗑</button></li>`; }).join('') || '<li class="muted">Sin reglas aún (hay más de 200 comercios conocidos incluidos).</li>'}</ul>
      <div class="row wrap"><input id="rulePat" placeholder="Texto (ej: copec)"><select id="ruleCat">${catOptions()}</select><button class="btn primary" id="addRule">Agregar</button></div>
      <h3>🏷️ Categorías</h3>
      <ul class="simple-list">${state.categories.map(c => `<li><span><span class="swatch" style="background:${catColor(c)}"></span>${c.icon} ${esc(c.name)}</span><button class="icon-btn" data-del-cat="${c.id}" aria-label="Eliminar">🗑</button></li>`).join('')}</ul>
    </section>
    </div>
    <section class="card">
      <h3>💾 Tus datos</h3>
      <p class="hint">Todo se guarda solo en este navegador (nada se envía a internet). Exporta un respaldo de vez en cuando o para pasarlo a otro dispositivo.</p>
      <div class="row wrap">
        <button class="btn ghost" id="exportJson">⬇ Exportar respaldo</button>
        <label class="btn ghost">⬆ Importar respaldo<input type="file" id="importJson" accept=".json" hidden></label>
        <button class="btn ghost" id="exportCsv">⬇ Movimientos en CSV</button>
        <button class="btn ghost" id="demoBtn">✨ Cargar datos de ejemplo</button>
        <button class="btn danger" id="wipe">Borrar todo</button>
      </div>
    </section>`;

    document.getElementById('cur').onchange = e => { const [c, l] = e.target.value.split('|'); state.settings.currency = c; state.settings.locale = l; save(); render(); };
    document.getElementById('addAcc').onclick = () => {
      const name = accName.value.trim(); if (!name) return toast('Escribe un nombre');
      state.accounts.push({ id: uid(), name, type: accType.value, last4: accLast4.value.replace(/\D/g, '') }); save(); render();
    };
    const accName = document.getElementById('accName'), accType = document.getElementById('accType'), accLast4 = document.getElementById('accLast4');
    app.querySelectorAll('[data-del-acc]').forEach(b => b.onclick = () => {
      if (!confirm('¿Eliminar esta cuenta? Sus movimientos quedarán “sin cuenta”.')) return;
      state.accounts = state.accounts.filter(a => a.id !== b.dataset.delAcc);
      state.transactions.forEach(t => { if (t.accountId === b.dataset.delAcc) t.accountId = null; }); save(); render();
    });
    document.getElementById('addRule').onclick = () => {
      const p = P.norm(document.getElementById('rulePat').value); if (!p) return;
      state.rules.push({ id: uid(), pattern: p, categoryId: document.getElementById('ruleCat').value }); save(); render();
    };
    app.querySelectorAll('[data-del-rule]').forEach(b => b.onclick = () => { state.rules = state.rules.filter(r => r.id !== b.dataset.delRule); save(); render(); });
    app.querySelectorAll('[data-del-cat]').forEach(b => b.onclick = () => {
      if (!confirm('¿Eliminar la categoría? Sus movimientos quedarán sin categoría.')) return;
      const id = b.dataset.delCat;
      state.categories = state.categories.filter(c => c.id !== id);
      state.transactions.forEach(t => { if (t.categoryId === id) t.categoryId = null; });
      state.rules = state.rules.filter(r => r.categoryId !== id); save(); render();
    });
    document.getElementById('exportJson').onclick = () => download(`finanzas-respaldo-${todayISO()}.json`, JSON.stringify(state, null, 1), 'application/json');
    document.getElementById('exportCsv').onclick = () => {
      const rows = [['fecha', 'descripcion', 'monto', 'categoria', 'cuenta']].concat(state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date))
        .map(t => [t.date, t.desc, t.amount, (catById(t.categoryId) || {}).name || '', (accById(t.accountId) || {}).name || '']));
      download(`movimientos-${todayISO()}.csv`, '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
    };
    document.getElementById('importJson').onchange = async e => {
      try {
        const data = JSON.parse(await e.target.files[0].text());
        if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) throw new Error();
        state = Object.assign(freshState(), data); save(); toast('Respaldo importado'); render();
      } catch (err) { toast('El archivo no es un respaldo válido'); }
    };
    document.getElementById('demoBtn').onclick = () => { if (!state.transactions.length || confirm('Se agregarán movimientos de ejemplo a tus datos. ¿Continuar?')) { loadDemo(); ui.view = 'resumen'; render(); } };
    document.getElementById('wipe').onclick = () => { if (confirm('¿Borrar TODOS los datos? No se puede deshacer.')) { state = freshState(); save(); render(); } };
  }

  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Datos de ejemplo ---------- */
  function loadDemo() {
    const visa = { id: uid(), name: 'Visa ****4521', type: 'credito', last4: '4521' };
    const deb = { id: uid(), name: 'Débito ****9988', type: 'debito', last4: '9988' };
    state.accounts.push(visa, deb);
    const cta = state.accounts[0].id;
    const k = key => (state.categories.find(c => c.key === key) || {}).id || null;
    const sample = [
      ['supermercado', ['LIDER EXPRESS', 'JUMBO LA REINA', 'UNIMARC', 'TOTTUS'], 15000, 70000, 6],
      ['comida', ['STARBUCKS', 'RAPPI', 'PEDIDOSYA', 'SUSHI HOME', 'JUAN MAESTRO'], 4500, 28000, 7],
      ['transporte', ['UBER *TRIP', 'COPEC', 'METRO BIP', 'CABIFY'], 3000, 45000, 6],
      ['hogar', ['ENEL', 'AGUAS ANDINAS', 'VTR HOGAR', 'METROGAS'], 18000, 42000, 4],
      ['salud', ['CRUZ VERDE', 'SMARTFIT', 'SALCOBRAND'], 6000, 30000, 2],
      ['entretenimiento', ['CINEMARK', 'PUNTOTICKET', 'STEAM'], 6000, 25000, 2],
      ['compras', ['FALABELLA', 'MERCADOLIBRE', 'ZARA'], 12000, 55000, 2],
      ['suscripciones', ['NETFLIX.COM', 'SPOTIFY', 'GOOGLE ONE'], 3000, 12000, 3],
    ];
    const now = new Date();
    for (let mback = 5; mback >= 0; mback--) {
      const ym = shiftMonth(monthOf(todayISO()), -mback);
      const lastDay = mback === 0 ? now.getDate() : daysIn(ym);
      state.transactions.push({ id: uid(), date: `${ym}-01`, desc: 'SUELDO EMPRESA SPA', amount: 1450000, categoryId: null, accountId: cta, source: 'demo' });
      for (const [key, names, min, max, count] of sample) {
        const n = Math.max(1, Math.round(count * (0.7 + Math.random() * 0.6) * lastDay / daysIn(ym)));
        for (let i = 0; i < n; i++) {
          const day = 1 + Math.floor(Math.random() * lastDay);
          const amt = Math.round((min + Math.random() * (max - min)) / 10) * 10;
          state.transactions.push({ id: uid(), date: `${ym}-${pad(day)}`, desc: names[i % names.length], amount: -amt,
            categoryId: Math.random() < 0.05 ? null : k(key), accountId: Math.random() < 0.6 ? visa.id : deb.id, source: 'demo' });
        }
      }
    }
    save(); toast('Datos de ejemplo cargados — bórralos cuando quieras desde Ajustes');
  }

  /* ---------- Diálogo de movimiento ---------- */
  const dlg = document.getElementById('txDialog'), form = document.getElementById('txForm');
  let editing = null;
  function openTx(tx) {
    editing = tx || null;
    document.getElementById('txDialogTitle').textContent = tx ? 'Editar movimiento' : 'Nuevo movimiento';
    document.getElementById('txDelete').hidden = !tx;
    form.categoryId.innerHTML = catOptions(tx && tx.categoryId, true);
    form.accountId.innerHTML = accOptions(tx ? tx.accountId : (state.accounts[0] || {}).id);
    form.kind.value = tx && tx.amount > 0 ? 'ingreso' : 'gasto';
    form.amount.value = tx ? Math.abs(tx.amount) : '';
    form.desc.value = tx ? tx.desc : '';
    form.date.value = tx ? tx.date : (ui.month === monthOf(todayISO()) ? todayISO() : ui.month + '-01');
    dlg.showModal();
  }
  form.desc.addEventListener('change', () => {
    if (!form.categoryId.value) { const c = P.autoCategory(form.desc.value, state.rules, state.categories); if (c) form.categoryId.value = c; }
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const amt = Math.abs(P.parseAmount(form.amount.value));
    if (!isFinite(amt) || !amt) return toast('Monto inválido');
    const data = { date: form.date.value, desc: form.desc.value.trim(), amount: form.kind.value === 'ingreso' ? amt : -amt,
      categoryId: form.categoryId.value || null, accountId: form.accountId.value || null };
    if (editing) Object.assign(editing, data);
    else state.transactions.push({ id: uid(), source: 'manual', ...data });
    ui.month = monthOf(data.date);
    save(); render(); toast('Guardado');
  });
  document.getElementById('txDelete').onclick = () => {
    if (!editing || !confirm('¿Eliminar este movimiento?')) return;
    state.transactions = state.transactions.filter(t => t !== editing);
    dlg.close('deleted'); save(); render(); toast('Eliminado');
  };

  /* ---------- Tooltip y toast ---------- */
  const tip = document.getElementById('tooltip');
  document.addEventListener('pointerover', e => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) { tip.hidden = true; return; }
    tip.textContent = el.getAttribute('data-tip'); tip.hidden = false;
  });
  document.addEventListener('pointermove', e => {
    if (tip.hidden) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY - h - 12;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y < 8) y = e.clientY + 18;
    tip.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
  });
  document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  const toastEl = document.getElementById('toast'); let toastT;
  function toast(msg, opts = {}) {
    toastEl.innerHTML = `<span>${esc(msg)}</span>` + (opts.action ? `<button class="btn small primary">${esc(opts.action)}</button>` : '');
    if (opts.action) toastEl.querySelector('button').onclick = () => { toastEl.classList.remove('show'); opts.onAction(); };
    toastEl.classList.add('show'); clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), opts.action ? 8000 : 3500);
  }

  /* ---------- Eventos globales ---------- */
  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]'); if (!b) return;
    ui.view = b.dataset.view; render(); scrollTo(0, 0);
  });
  app.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) {
      e.preventDefault();
      if (go.dataset.filterCat) ui.filter = { q: '', cat: go.dataset.filterCat, acc: '' };
      ui.view = go.dataset.go; render(); scrollTo(0, 0); return;
    }
    const tx = e.target.closest('[data-tx]');
    if (tx && !e.target.closest('select')) openTx(state.transactions.find(t => t.id === tx.dataset.tx));
  });
  document.getElementById('prevMonth').onclick = () => { ui.month = shiftMonth(ui.month, -1); render(); };
  document.getElementById('nextMonth').onclick = () => { ui.month = shiftMonth(ui.month, 1); render(); };
  document.getElementById('fabAdd').onclick = () => openTx(null);

  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  document.getElementById('themeToggle').onclick = () => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const cur = state.settings.theme === 'auto' ? (dark ? 'dark' : 'light') : state.settings.theme;
    state.settings.theme = cur === 'dark' ? 'light' : 'dark'; save(); applyTheme(); render();
  };
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (ui.view === 'resumen') render(); }, 150); });
  addEventListener('hashchange', () => { handleHash(); render(); });

  applyTheme();
  handleHash();
  render();
})();
