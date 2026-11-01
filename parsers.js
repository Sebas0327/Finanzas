/* Parsers: montos, fechas, CSV/OFX de cartolas y avisos de compra (correo / SMS / push). */
(function (global) {
  'use strict';

  /** Convierte "12.345", "$ 12.345,67", "-1,234.50", "(1.000)" en número. */
  function parseAmount(raw) {
    if (raw == null) return NaN;
    if (typeof raw === 'number') return raw;
    let s = String(raw).trim();
    if (!s) return NaN;
    let neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-\s*$/.test(s);
    s = s.replace(/[^\d.,]/g, '');
    if (!s) return NaN;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1) {
      const dec = lastDot > lastComma ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      s = s.split(thou).join('').replace(dec, '.');
    } else if (lastDot > -1 || lastComma > -1) {
      const sep = lastDot > -1 ? '.' : ',';
      const parts = s.split(sep);
      const tail = parts[parts.length - 1];
      // Varios separadores o exactamente 3 dígitos al final => separador de miles
      if (parts.length > 2 || tail.length === 3) s = parts.join('');
      else s = parts.join('.');
    }
    const n = parseFloat(s);
    return neg ? -n : n;
  }

  const MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
    jan: 1, apr: 4, aug: 8, dec: 12 };

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(y, m, d) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /** Acepta dd/mm/aaaa, dd-mm-aa, aaaa-mm-dd, aaaammdd, "05 nov 2026", "05-Nov". order: 'dmy' | 'mdy' */
  function parseDate(raw, order = 'dmy', fallbackYear = new Date().getFullYear()) {
    if (!raw) return null;
    const s = String(raw).trim().toLowerCase();
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
      return order === 'mdy' ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
    }
    if ((m = s.match(/(\d{1,2})[\s\-/.]*(?:de\s+)?([a-zá]{3})[a-zá]*\.?[\s\-/.]*(?:de\s+)?(\d{2,4})?/))) {
      const mon = MONTHS[m[2].normalize('NFD').replace(/[̀-ͯ]/g, '')];
      if (mon) return iso(m[3] ? +m[3] : fallbackYear, mon, +m[1]);
    }
    if ((m = s.match(/(\d{1,2})[-/.](\d{1,2})(?!\d)/))) {
      return order === 'mdy' ? iso(fallbackYear, +m[1], +m[2]) : iso(fallbackYear, +m[2], +m[1]);
    }
    return null;
  }

  /* ---------- CSV ---------- */
  function detectDelimiter(text) {
    const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
    const counts = [';', ',', '\t', '|'].map(d => [d, sample.split(d).length]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][0];
  }

  function parseCSV(text, delimiter) {
    delimiter = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === delimiter) { row.push(field.trim()); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field.trim()); field = '';
        if (row.some(f => f !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field.trim());
    if (row.some(f => f !== '')) rows.push(row);
    return rows;
  }

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  /** Busca la fila de encabezados y adivina qué columna es cada cosa. */
  function guessMapping(rows) {
    let headerIdx = rows.findIndex(r => r.some(c => /fecha|date/.test(norm(c))) &&
      r.some(c => /monto|importe|cargo|abono|amount|valor|debito|credito|descrip|detalle/.test(norm(c))));
    if (headerIdx < 0) headerIdx = 0;
    const h = rows[headerIdx].map(norm);
    const find = re => h.findIndex(c => re.test(c));
    const map = {
      headerIdx,
      date: find(/^fecha|date|fecha/),
      desc: find(/descrip|detalle|glosa|concepto|comercio|movimiento|description|memo|narrativa/),
      amount: find(/^monto|importe|^amount|^valor|monto/),
      debit: find(/cargo|debito|retiro|egreso|debit|withdraw|gasto/),
      credit: find(/abono|credito|deposito|ingreso|credit/),
    };
    if (map.amount > -1 && (map.amount === map.debit || map.amount === map.credit)) map.amount = -1;
    if (map.amount < 0 && map.debit < 0 && map.credit < 0) {
      // sin pistas: la primera columna que parezca numérica en la fila siguiente
      const sample = rows[headerIdx + 1] || [];
      map.amount = sample.findIndex((c, i) => i !== map.date && /^[-($\s]*[\d.,]+\)?$/.test(c));
    }
    return map;
  }

  /** Devuelve [{date, desc, amount}] con amount negativo = gasto. */
  function rowsToTransactions(rows, map, opts = {}) {
    const out = [];
    const invert = !!opts.invertSign;
    for (let i = map.headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const date = parseDate(r[map.date], opts.dateOrder);
      if (!date) continue;
      let amount;
      if (map.amount > -1) {
        amount = parseAmount(r[map.amount]);
        if (invert) amount = -amount;
      } else {
        const d = map.debit > -1 ? Math.abs(parseAmount(r[map.debit]) || 0) : 0;
        const c = map.credit > -1 ? Math.abs(parseAmount(r[map.credit]) || 0) : 0;
        amount = c - d;
      }
      if (!isFinite(amount) || amount === 0) continue;
      const desc = (map.desc > -1 ? r[map.desc] : '') || r.filter((_, j) => j !== map.date).join(' ');
      out.push({ date, desc: cleanDesc(desc), amount });
    }
    return out;
  }

  /* ---------- OFX / QFX ---------- */
  function parseOFX(text) {
    const out = [];
    const blocks = text.split(/<STMTTRN>/i).slice(1);
    const tag = (b, t) => { const m = b.match(new RegExp('<' + t + '>([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; };
    for (const b of blocks) {
      const date = parseDate(tag(b, 'DTPOSTED').slice(0, 8));
      const amount = parseFloat(tag(b, 'TRNAMT').replace(',', '.'));
      const desc = tag(b, 'NAME') || tag(b, 'MEMO');
      if (date && isFinite(amount)) out.push({ date, desc: cleanDesc(desc), amount, fitid: tag(b, 'FITID') });
    }
    return out;
  }

  /* ---------- Avisos de compra (correo, SMS, notificación del banco) ---------- */
  const INCOME_RE = /(abono|dep[oó]sito|transferencia recibida|te transfiri[oó]|recibiste|has recibido|reembolso|devoluci[oó]n|pago recibido)/i;
  const SKIP_RE = /(rechazad|no aprobad|denegad|fallid)/i;

  function parseNotification(text, today = new Date()) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t || SKIP_RE.test(t)) return null;
    const amt = t.match(/(?:\$|CLP|MXN|COP|USD|US\$|PEN|S\/|ARS|€|EUR)\s?(-?[\d.,]+\d)/i) ||
      t.match(/(?:monto|importe|valor|compra|cargo)(?:\s+de|\s+por)?:?\s*(-?[\d.,]+\d)/i);
    if (!amt) return null;
    const amount = Math.abs(parseAmount(amt[1]));
    if (!isFinite(amount) || amount === 0) return null;

    let merchant = '';
    const mm = t.match(/\b(?:en|comercio:?|establecimiento:?|at)\s+([A-Za-z0-9ÁÉÍÓÚÑáéíóúñ*&'.\- ]{2,40}?)(?=\s+(?:el|a las|con|por|fecha|del|ubicad|\d{1,2}[/-])\b|[.,;]|$)/i);
    if (mm) merchant = mm[1].trim();
    if (!merchant) {
      const tr = t.match(/(?:transferencia (?:a|de)|destinatario:?)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ ]{2,40}?)(?=[.,;]|\s+por|$)/i);
      if (tr) merchant = 'Transferencia ' + tr[1].trim();
    }
    const card = t.match(/(?:\*{2,}|x{2,}|terminad[ao] en|t[eé]rmino|final(?:izada)? en|n[°º.]?\s?\*+)\s?(\d{4})/i);
    const dm = t.match(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}/);
    const date = (dm && parseDate(dm[0])) ||
      `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const income = INCOME_RE.test(t) && !/compra|cargo|pago en/i.test(t);
    return {
      date,
      desc: cleanDesc(merchant || (income ? 'Abono' : 'Compra')),
      amount: income ? amount : -amount,
      last4: card ? card[1] : null,
      raw: t,
    };
  }

  /** Varios avisos pegados, separados por línea en blanco o por cada "Estimado/Hola/Se ha realizado…". */
  function parseNotifications(text) {
    const chunks = text.split(/\n\s*\n|(?=^\s*(?:Estimad[oa]|Hola|Se ha realizado|Se realiz[oó]|Compra|Realizaste|Has realizado|Cargo|Transferencia|Abono)\b)/im);
    return chunks.map(c => parseNotification(c)).filter(Boolean);
  }

  function cleanDesc(s) {
    return String(s || '').replace(/\s+/g, ' ').replace(/^[\s*\-]+|[\s*\-]+$/g, '').slice(0, 80) || 'Sin descripción';
  }

  /* ---------- Categorización automática ---------- */
  const KEYWORDS = {
    supermercado: ['lider', 'jumbo', 'unimarc', 'tottus', 'santa isabel', 'walmart', 'acuenta', 'oxxo', 'soriana', 'chedraui', 'exito', 'carulla', 'olimpica', 'd1', 'ara ', 'coto', 'dia ', 'carrefour', 'mercado', 'supermerc', 'minimarket', 'ok market', 'big john', 'costco', 'sams', 'aldi', 'lidl', 'mercadona'],
    comida: ['restaurant', 'rest ', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'burger', 'kfc', 'subway', 'pizza', 'sushi', 'rappi', 'pedidosya', 'pedidos ya', 'uber eats', 'ubereats', 'didi food', 'juan maestro', 'dominos', 'domino', 'papa john', 'bar ', 'pub', 'panaderia', 'pasteleria', 'comida', 'food', 'doggis', 'tarragona'],
    transporte: ['uber', 'cabify', 'didi', 'beat', 'metro', 'bip', 'copec', 'shell', 'petrobras', 'aramco', 'enex', 'esso', 'pemex', 'terpel', 'primax', 'repsol', 'ypf', 'peaje', 'autopista', 'tag', 'estacionamiento', 'parking', 'taxi', 'bus', 'turbus', 'pullman', 'latam', 'sky airline', 'jetsmart', 'avianca', 'aeromexico', 'volaris', 'combustible', 'gasolin'],
    hogar: ['enel', 'cge', 'chilquinta', 'aguas', 'esval', 'metrogas', 'abastible', 'lipigas', 'gasco', 'cfe', 'epm', 'codensa', 'arriendo', 'renta', 'dividendo', 'condominio', 'gastos comunes', 'sodimac', 'easy', 'homecenter', 'home depot', 'ikea', 'vtr', 'entel', 'movistar', 'claro', 'wom', 'telmex', 'izzi', 'totalplay', 'mundo pacifico', 'internet', 'luz', 'electricidad'],
    salud: ['farmacia', 'cruz verde', 'salcobrand', 'ahumada', 'similares', 'benavides', 'guadalajara', 'clinica', 'hospital', 'medic', 'dental', 'isapre', 'fonasa', 'laboratorio', 'optica', 'doctor', 'dr ', 'consulta', 'gimnasio', 'gym', 'smartfit', 'smart fit', 'sportlife', 'pacific fitness'],
    entretenimiento: ['cine', 'cinemark', 'cinepolis', 'cineplanet', 'hoyts', 'ticketmaster', 'puntoticket', 'passline', 'steam', 'playstation', 'xbox', 'nintendo', 'teatro', 'concierto', 'museo', 'bowling', 'juegos', 'casino'],
    compras: ['falabella', 'ripley', 'paris', 'hites', 'la polar', 'liverpool', 'palacio de hierro', 'coppel', 'mercadolibre', 'mercado libre', 'mercadopago', 'amazon', 'aliexpress', 'shein', 'temu', 'zara', 'h&m', 'adidas', 'nike', 'decathlon', 'pc factory', 'abcdin', 'mall', 'tienda', 'store'],
    suscripciones: ['netflix', 'spotify', 'disney', 'hbo', 'max ', 'prime video', 'amazon prime', 'youtube', 'google', 'apple.com', 'icloud', 'microsoft', 'adobe', 'chatgpt', 'openai', 'claude', 'anthropic', 'paramount', 'star+', 'crunchyroll', 'dropbox', 'canva', 'patreon'],
    educacion: ['universidad', 'colegio', 'escuela', 'instituto', 'udemy', 'coursera', 'platzi', 'domestika', 'libreria', 'libro', 'matricula', 'arancel', 'mensualidad colegio', 'duolingo'],
  };

  function autoCategory(desc, rules, categories) {
    const d = ' ' + norm(desc) + ' ';
    for (const r of rules || []) {
      if (r.pattern && d.includes(norm(r.pattern))) return r.categoryId;
    }
    for (const [key, words] of Object.entries(KEYWORDS)) {
      if (words.some(w => d.includes(w))) {
        const cat = (categories || []).find(c => c.key === key);
        if (cat) return cat.id;
      }
    }
    return null;
  }

  /** Clave para detectar duplicados al importar el mismo movimiento dos veces. */
  function txKey(tx) {
    return `${tx.date}|${Math.round(tx.amount * 100)}|${norm(tx.desc).replace(/[^a-z0-9]/g, '').slice(0, 20)}`;
  }

  /** Palabra representativa de un comercio para crear reglas ("UBER *TRIP 1234" -> "uber"). */
  function merchantKeyword(desc) {
    const words = norm(desc).replace(/[^a-z0-9& ]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !/^\d+$/.test(w) && !['compra', 'pago', 'cargo', 'www', 'com', 'spa', 'ltda', 'pos', 'web', 'the'].includes(w));
    return words[0] || norm(desc).slice(0, 12);
  }

  global.Parsers = { parseAmount, parseDate, parseCSV, guessMapping, rowsToTransactions, parseOFX,
    parseNotification, parseNotifications, autoCategory, txKey, merchantKeyword, norm, KEYWORDS };
})(typeof window !== 'undefined' ? window : globalThis);
