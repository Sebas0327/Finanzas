/* Gráficos SVG sin dependencias. Cada marca lleva data-tip para el tooltip al pasar el cursor. */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  /** Dona: slices = [{label, value, color, tip}] */
  function donut(el, slices, { centerTop = '', centerBottom = '' } = {}) {
    const size = Math.min(el.clientWidth || 260, 260);
    const r = size / 2, inner = r * 0.64, total = slices.reduce((a, s) => a + s.value, 0);
    let html = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Gasto por categoría">`;
    if (!total) {
      html += `<circle cx="${r}" cy="${r}" r="${(r + inner) / 2}" fill="none" stroke="var(--grid)" stroke-width="${r - inner}"/>`;
    } else {
      let a0 = -Math.PI / 2;
      const gap = slices.length > 1 ? 0.012 : 0;
      for (const s of slices) {
        const ang = (s.value / total) * Math.PI * 2;
        const a1 = a0 + ang;
        if (slices.length === 1) {
          html += `<circle cx="${r}" cy="${r}" r="${(r + inner) / 2}" fill="none" stroke="${s.color}" stroke-width="${r - inner}" data-tip="${esc(s.tip)}" class="mark"/>`;
        } else {
          const s0 = a0 + gap, s1 = Math.max(a1 - gap, s0 + 0.001);
          const large = s1 - s0 > Math.PI ? 1 : 0;
          const p = (rad, a) => `${r + rad * Math.cos(a)} ${r + rad * Math.sin(a)}`;
          html += `<path class="mark" fill="${s.color}" data-tip="${esc(s.tip)}" d="M${p(r - 1, s0)} A${r - 1} ${r - 1} 0 ${large} 1 ${p(r - 1, s1)} L${p(inner, s1)} A${inner} ${inner} 0 ${large} 0 ${p(inner, s0)}Z"/>`;
        }
        a0 = a1;
      }
    }
    html += `<text x="${r}" y="${r - 4}" text-anchor="middle" class="donut-top">${esc(centerTop)}</text>`;
    html += `<text x="${r}" y="${r + 18}" text-anchor="middle" class="donut-bottom">${esc(centerBottom)}</text></svg>`;
    el.innerHTML = html;
  }

  /**
   * Líneas sobre un eje: series = [{label, color, points:[{x, y}], dashed}], x de 1..n.
   * tipFor(i) -> texto del tooltip para la columna i.
   */
  function lines(el, series, { n, tipFor, fmt, xLabel = i => i }) {
    const W = el.clientWidth || 600, H = 240, m = { t: 12, r: 16, b: 28, l: 64 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = niceMax(Math.max(1, ...series.flatMap(s => s.points.map(p => p.y))));
    const X = i => m.l + ((i - 1) / Math.max(1, n - 1)) * iw;
    const Y = v => m.t + ih - (v / max) * ih;
    let h = `<svg width="${W}" height="${H}" role="img" aria-label="Gasto acumulado del mes">`;
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k, y = Y(v);
      h += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="grid"/>`;
      h += `<text x="${m.l - 8}" y="${y + 4}" text-anchor="end" class="axis">${esc(fmt(v))}</text>`;
    }
    const step = n > 20 ? 5 : n > 10 ? 2 : 1;
    for (let i = 1; i <= n; i += step) h += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" class="axis">${esc(xLabel(i))}</text>`;
    for (const s of series) {
      if (!s.points.length) continue;
      const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
      h += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="5 5"' : ''}/>`;
      const last = s.points[s.points.length - 1];
      if (!s.dashed) h += `<circle cx="${X(last.x)}" cy="${Y(last.y)}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
    }
    h += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
    const colW = iw / Math.max(1, n - 1);
    for (let i = 1; i <= n; i++) {
      h += `<rect class="hit" x="${X(i) - colW / 2}" y="${m.t}" width="${colW}" height="${ih}" fill="transparent" data-x="${X(i)}" data-tip="${esc(tipFor(i))}"/>`;
    }
    h += '</svg>';
    el.innerHTML = h;
    const svg = el.querySelector('svg'), ch = svg.querySelector('.crosshair');
    svg.addEventListener('pointerover', e => {
      const x = e.target.getAttribute && e.target.getAttribute('data-x');
      if (x) { ch.setAttribute('x1', x); ch.setAttribute('x2', x); ch.setAttribute('visibility', 'visible'); }
    });
    svg.addEventListener('pointerleave', () => ch.setAttribute('visibility', 'hidden'));
  }

  /** Barras verticales: bars = [{label, value, tip, highlight}] con línea de referencia opcional. */
  function bars(el, data, { fmt, color, refValue, refLabel }) {
    const W = el.clientWidth || 600, H = 220, m = { t: 14, r: 16, b: 28, l: 64 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = niceMax(Math.max(1, refValue || 0, ...data.map(d => d.value)));
    const Y = v => m.t + ih - (v / max) * ih;
    const slot = iw / data.length, bw = Math.min(40, slot * 0.6);
    let h = `<svg width="${W}" height="${H}" role="img" aria-label="Gasto por mes">`;
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k, y = Y(v);
      h += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="grid"/>`;
      h += `<text x="${m.l - 8}" y="${y + 4}" text-anchor="end" class="axis">${esc(fmt(v))}</text>`;
    }
    data.forEach((d, i) => {
      const cx = m.l + slot * i + slot / 2, y = Y(d.value), bh = m.t + ih - y;
      if (bh > 0) {
        const rr = Math.min(4, bh, bw / 2);
        h += `<path class="mark" fill="${color}" opacity="${d.highlight ? 1 : 0.55}" d="M${cx - bw / 2} ${m.t + ih} V${y + rr} Q${cx - bw / 2} ${y} ${cx - bw / 2 + rr} ${y} H${cx + bw / 2 - rr} Q${cx + bw / 2} ${y} ${cx + bw / 2} ${y + rr} V${m.t + ih}Z"/>`;
      }
      h += `<rect class="hit" x="${cx - slot / 2}" y="${m.t}" width="${slot}" height="${ih}" fill="transparent" data-tip="${esc(d.tip)}"/>`;
      h += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="axis${d.highlight ? ' strong' : ''}">${esc(d.label)}</text>`;
    });
    if (refValue) {
      const y = Y(refValue);
      h += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="ref"/>`;
      h += `<text x="${W - m.r}" y="${y - 6}" text-anchor="end" class="axis">${esc(refLabel || '')}</text>`;
    }
    el.innerHTML = h + '</svg>';
  }

  global.Charts = { donut, lines, bars, esc };
})(window);
