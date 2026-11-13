/* =====================================================================
 * interfaz.js — Interfaz interactiva del simulador sísmico
 * ===================================================================== */
(function () {
  'use strict';
  const S = window.Sismica, X = window.Exportar;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // ------------------------------------------------------------------
  // Configuraciones predefinidas por tipo de estudio
  // ------------------------------------------------------------------
  const BASE = {
    tendido: 'fijo', nch: 24, dx: 5, x1: 0, disparos: 'estandar', nInternos: 3, offExt: 15, listaDisparos: '',
    configuracion: 'split', offMin: 2.5, nDisparos: 10, dxDisparo: 10, xDisparo0: 0,
    tipoFuente: 'martillo', fp: 60, f1: 10, f2: 100, fase: 'min', stacks: 4,
    f0: 14, zeta: 0.7, dtms: 0.25, trec: 250, pretrig: 10,
    evDirecta: true, evRefractadas: true, evReflexiones: true, evMultiples: false, evGroundRoll: true, evAerea: true,
    ampGR: 1, fgr: 18, ampAerea: 0.3,
    ruidoAmb: 10, ruidoRed: 5, freqRed: 60, ruidoTrans: 20, estaticas: 0.8, jitter: 0.2,
    probMuerta: 2, probInvertida: 1, varAcople: 15, probPicos: 1, semilla: 2026
  };
  const PRESETS = {
    refraccion: {
      nombre: 'Refracción sísmica',
      P: {},
      capas: [
        { h: 4, vp: 450, vs: 220, rho: 1.7, q: 20 },
        { h: 10, vp: 1600, vs: 550, rho: 1.95, q: 40 },
        { h: 0, vp: 3400, vs: 1700, rho: 2.35, q: 100 }
      ],
      vis: { tmax: 150, ganancia: 'agc', agc: 40, escala: 0.8, modo: 'wva', teoricos: false, primeros: false, tab: 'dromo' }
    },
    reflexion: {
      nombre: 'Reflexión sísmica',
      P: {
        tendido: 'rodante', nch: 96, dx: 5, configuracion: 'split', offMin: 2.5, nDisparos: 24, dxDisparo: 10, xDisparo0: 250,
        tipoFuente: 'explosivo', fp: 45, stacks: 1, f0: 10, dtms: 1, trec: 1000, pretrig: 0,
        evMultiples: true, ampGR: 2, fgr: 12, ampAerea: 0.6, ruidoAmb: 10, ruidoTrans: 15, estaticas: 2, jitter: 0, probMuerta: 1
      },
      capas: [
        { h: 15, vp: 650, vs: 260, rho: 1.8, q: 30 },
        { h: 120, vp: 1800, vs: 700, rho: 2.05, q: 80 },
        { h: 200, vp: 2400, vs: 1100, rho: 2.2, q: 120 },
        { h: 260, vp: 2900, vs: 1450, rho: 2.35, q: 150 },
        { h: 0, vp: 4000, vs: 2200, rho: 2.55, q: 200 }
      ],
      vis: { tmax: 1000, ganancia: 'agc', agc: 150, escala: 1.0, modo: 'dg', teoricos: false, primeros: false, tab: 'resumen' }
    },
    masw: {
      nombre: 'MASW',
      P: {
        nch: 24, dx: 1, x1: 0, disparos: 'lista', listaDisparos: '-10, 33', tipoFuente: 'martillo', fp: 40, stacks: 5,
        f0: 4.5, dtms: 0.5, trec: 1000, pretrig: 0, ampGR: 4, fgr: 28, ampAerea: 0.2, ruidoAmb: 12, ruidoTrans: 25,
        estaticas: 0.2, jitter: 0.1
      },
      capas: [
        { h: 3, vp: 500, vs: 180, rho: 1.8, q: 20 },
        { h: 7, vp: 900, vs: 300, rho: 1.9, q: 30 },
        { h: 10, vp: 1600, vs: 450, rho: 2.0, q: 40 },
        { h: 0, vp: 2500, vs: 750, rho: 2.15, q: 60 }
      ],
      vis: { tmax: 600, ganancia: 'traza', agc: 60, escala: 1.0, modo: 'wva', teoricos: false, primeros: false, tab: 'dispersion' }
    }
  };

  // ------------------------------------------------------------------
  // Estado
  // ------------------------------------------------------------------
  let P = {};
  let capas = [];
  let presetActual = 'refraccion';
  let ctx = null;                 // contexto de simulación preparado
  const cache = new Map();        // iDisparo → disparo simulado
  let picks = new Map();          // iDisparo → Float64Array (s)
  let firmaGeom = '';
  let disparoActual = 0;
  let hover = null;               // { i, t }
  let pestaña = 'resumen';
  const vis = { modo: 'wva', ganancia: 'agc', agc: 40, escala: 1.2, tmax: 150, teoricos: false, primeros: false, picks: true, picado: false };
  let marco = null;               // geometría de dibujo del registro
  let tiempoCalculo = 0;

  const COLOR = {
    directa: '#16a34a', aire: '#64748b', gr: '#db2777', primer: '#dc2626', pick: '#f97316',
    refr: ['#ea580c', '#b45309', '#d97706', '#9a3412', '#f59e0b', '#c2410c'],
    refl: ['#2563eb', '#0891b2', '#4f46e5', '#0369a1', '#7c3aed', '#1d4ed8'],
    mult: '#9333ea'
  };

  // ------------------------------------------------------------------
  // Parámetros ↔ formulario
  // ------------------------------------------------------------------
  function leerParametros() {
    $$('[data-p]').forEach(el => {
      const k = el.dataset.p;
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'number' || el.type === 'range' || el.hasAttribute('data-num')) {
        v = parseFloat(el.value);
        if (!isFinite(v)) v = BASE[k];
      } else v = el.value;
      P[k] = v;
    });
    $$('[data-val]').forEach(el => { el.textContent = P[el.dataset.val]; });
  }
  function escribirParametros() {
    $$('[data-p]').forEach(el => {
      const k = el.dataset.p;
      if (!(k in P)) return;
      if (el.type === 'checkbox') el.checked = !!P[k];
      else el.value = P[k];
      if (el.tagName === 'SELECT' && el.value !== String(P[k])) {
        // valores numéricos con distinta representación
        const op = Array.from(el.options).find(o => parseFloat(o.value) === parseFloat(P[k]));
        if (op) el.value = op.value;
      }
    });
    $$('[data-val]').forEach(el => { el.textContent = P[el.dataset.val]; });
  }
  function actualizarVisibilidad() {
    $$('[data-mostrar]').forEach(el => {
      const cond = el.dataset.mostrar;
      const neg = cond.includes('!=');
      const [k, v] = cond.split(neg ? '!=' : '=');
      const ok = neg ? String(P[k]) !== v : String(P[k]) === v;
      el.style.display = ok ? '' : 'none';
    });
  }
  function escribirVis() {
    $('#visModo').value = vis.modo; $('#visGanancia').value = vis.ganancia;
    $('#visAgc').value = vis.agc; $('#visEscala').value = vis.escala; $('#visTmax').value = vis.tmax;
    $('#visTeoricos').checked = vis.teoricos; $('#visPrimeros').checked = vis.primeros; $('#visPicks').checked = vis.picks;
  }
  function leerVis() {
    vis.modo = $('#visModo').value; vis.ganancia = $('#visGanancia').value;
    vis.agc = Math.max(2, parseFloat($('#visAgc').value) || 40);
    vis.escala = parseFloat($('#visEscala').value) || 1;
    vis.tmax = parseFloat($('#visTmax').value) || P.trec;
    vis.teoricos = $('#visTeoricos').checked; vis.primeros = $('#visPrimeros').checked; vis.picks = $('#visPicks').checked;
  }

  // ---------------- Tabla de capas ----------------
  function colorVelocidad(vp) {
    const t = Math.min(1, Math.max(0, (Math.log(vp) - Math.log(250)) / (Math.log(5500) - Math.log(250))));
    const pal = [[243, 227, 181], [222, 186, 122], [176, 160, 118], [120, 140, 150], [70, 88, 112]];
    const u = t * (pal.length - 1), i = Math.min(pal.length - 2, Math.floor(u)), w = u - i;
    const c = pal[i].map((v, j) => Math.round(v * (1 - w) + pal[i + 1][j] * w));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function dibujarTablaCapas() {
    const tb = $('#tablaCapas tbody');
    tb.innerHTML = '';
    capas.forEach((c, i) => {
      const ult = i === capas.length - 1;
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td><span class="muestra" style="background:${colorVelocidad(c.vp)}"></span></td>` +
        (ult ? '<td class="semi">∞</td>' : `<td><input type="number" data-c="h" value="${c.h}" min="0.1" step="0.5"></td>`) +
        `<td><input type="number" data-c="vp" value="${c.vp}" min="100" step="50"></td>` +
        `<td><input type="number" data-c="vs" value="${c.vs}" min="30" step="20"></td>` +
        `<td><input type="number" data-c="rho" value="${c.rho}" min="1" max="3.5" step="0.05"></td>` +
        `<td><input type="number" data-c="q" value="${c.q}" min="2" step="5"></td>` +
        `<td>${capas.length > 1 ? '<button title="Eliminar capa" data-borrar>×</button>' : ''}</td>`;
      tr.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('input', () => {
          const v = parseFloat(inp.value);
          if (isFinite(v) && v > 0) { c[inp.dataset.c] = v; tr.querySelector('.muestra').style.background = colorVelocidad(c.vp); invalidar(); }
        });
      });
      const b = tr.querySelector('[data-borrar]');
      if (b) b.addEventListener('click', () => { capas.splice(i, 1); dibujarTablaCapas(); invalidar(); });
      tb.appendChild(tr);
    });
  }

  function modeloAleatorio() {
    const r = Math.random;
    const u = (a, b) => a + (b - a) * r();
    const red = (v, p) => Math.round(v / p) * p;
    const vsDe = (vp, k) => red(vp / k, 10);
    let m;
    if (presetActual === 'reflexion') {
      const n = 4 + Math.floor(r() * 3);
      let vp = u(500, 800);
      m = [];
      for (let i = 0; i < n; i++) {
        const h = i === 0 ? u(8, 25) : u(60, 260);
        m.push({ h: red(h, 1), vp: red(vp, 10), vs: vsDe(vp, u(1.8, 2.4)), rho: +(0.31 * Math.pow(vp, 0.25)).toFixed(2), q: red(20 + vp / 25, 5) });
        vp = vp * u(1.12, 1.45);
        if (i > 1 && r() < 0.15) vp *= 0.8; // capa de baja velocidad ocasional
      }
    } else if (presetActual === 'masw') {
      let vs = u(140, 220);
      m = [];
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        m.push({ h: red(u(2, 9), 0.5), vp: red(vs * u(1.9, 3.2), 10), vs: red(vs, 5), rho: +u(1.7, 2.15).toFixed(2), q: red(15 + vs / 15, 5) });
        vs *= r() < 0.12 ? 0.75 : u(1.15, 1.6);
      }
    } else {
      const n = 3 + (r() < 0.3 ? 1 : 0);
      const vps = [u(300, 650), u(1200, 2000)];
      if (n === 4) vps.push(u(2200, 2700));
      vps.push(u(2800, 5000));
      m = vps.map((vp, i) => ({
        h: i === 0 ? red(u(1.5, 6), 0.5) : red(u(4, 16), 0.5),
        vp: red(vp, 10), vs: vsDe(vp, i === 0 ? u(1.6, 2.2) : u(1.8, 3)), rho: +(0.31 * Math.pow(vp, 0.25)).toFixed(2), q: red(15 + vp / 30, 5)
      }));
    }
    m[m.length - 1].h = 0;
    capas = m;
    dibujarTablaCapas();
    invalidar();
  }

  // ------------------------------------------------------------------
  // Simulación y caché
  // ------------------------------------------------------------------
  let temporizador = null;
  function invalidar(inmediato) {
    leerParametros();
    actualizarVisibilidad();
    ctx = null;
    cache.clear();
    clearTimeout(temporizador);
    $('#estado').textContent = 'Calculando…';
    temporizador = setTimeout(renderizar, inmediato ? 0 : 260);
  }

  function asegurarContexto() {
    if (ctx) return ctx;
    const t = performance.now();
    ctx = S.preparar(P, capas);
    tiempoCalculo = performance.now() - t;
    const firma = JSON.stringify(ctx.disparos.map(d => [d.x, d.rx.length, d.rx[0]]));
    if (firma !== firmaGeom) { picks = new Map(); firmaGeom = firma; }
    disparoActual = Math.min(disparoActual, ctx.disparos.length - 1);
    const sel = $('#selDisparo');
    sel.innerHTML = ctx.disparos.map((d, i) => `<option value="${i}">Disparo ${d.id} · x = ${fmt(d.x)} m</option>`).join('');
    sel.value = disparoActual;
    return ctx;
  }

  function obtenerDisparo(i) {
    asegurarContexto();
    if (!cache.has(i)) {
      const t = performance.now();
      cache.set(i, S.simularDisparo(ctx, i));
      tiempoCalculo = performance.now() - t;
    }
    return cache.get(i);
  }

  async function obtenerTodos(conProgreso) {
    asegurarContexto();
    const barra = $('#progreso');
    if (conProgreso) { barra.hidden = false; barra.firstElementChild.style.width = '0%'; }
    const out = [];
    for (let i = 0; i < ctx.disparos.length; i++) {
      out.push(obtenerDisparo(i));
      if (conProgreso) {
        barra.firstElementChild.style.width = (100 * (i + 1) / ctx.disparos.length) + '%';
        await new Promise(r => setTimeout(r, 0));
      }
    }
    if (conProgreso) setTimeout(() => { barra.hidden = true; }, 600);
    return out;
  }

  function renderizar() {
    try {
      asegurarContexto();
      obtenerDisparo(disparoActual);
      dibujarTodo();
      const g = cache.get(disparoActual);
      $('#estado').textContent = `Disparo ${g.id} · ${g.trazas.length} trazas · ${ctx.ns} muestras · dt = ${P.dtms} ms · FFT ${ctx.N} · cálculo ${tiempoCalculo.toFixed(0)} ms`;
    } catch (e) {
      console.error(e);
      $('#estado').textContent = 'Error: ' + e.message;
    }
  }

  function dibujarTodo() {
    dibujarRegistro();
    dibujarSuperposicion();
    dibujarModelo();
    dibujarAnalisis();
    actualizarLeyenda();
  }

  // ------------------------------------------------------------------
  // Utilidades de dibujo
  // ------------------------------------------------------------------
  const fmt = (v, d) => {
    if (!isFinite(v)) return '—';
    if (d === undefined) d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
    return Number(v.toFixed(d)).toLocaleString('es', { maximumFractionDigits: d });
  };
  function prepararLienzo(cv) {
    const r = cv.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(50, Math.floor(r.width)), h = Math.max(50, Math.floor(r.height));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h, dpr };
  }
  function pasoEje(rango, nObjetivo) {
    const bruto = rango / Math.max(1, nObjetivo);
    const p = Math.pow(10, Math.floor(Math.log10(bruto)));
    const m = bruto / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  function estrella(g, x, y, r, color) {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r;
      g.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    g.closePath(); g.fillStyle = color; g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
  }

  // ------------------------------------------------------------------
  // Ganancias de visualización
  // ------------------------------------------------------------------
  function datosVisual(d) {
    const clave = [vis.ganancia, vis.agc].join('|');
    if (d._vis && d._visClave === clave) return d._vis;
    const ns = d.ns, dt = d.dt;
    const out = [];
    if (vis.ganancia === 'agc') {
      const w = Math.max(2, Math.round(vis.agc / 1000 / dt));
      for (const tr of d.trazas) {
        const cs = new Float64Array(ns + 1);
        for (let n = 0; n < ns; n++) cs[n + 1] = cs[n] + tr[n] * tr[n];
        const o = new Float32Array(ns);
        for (let n = 0; n < ns; n++) {
          const a = Math.max(0, n - (w >> 1)), b = Math.min(ns, n + (w >> 1) + 1);
          const rms = Math.sqrt((cs[b] - cs[a]) / (b - a));
          o[n] = tr[n] / (rms + 1e-20) / 3;
        }
        out.push(o);
      }
    } else if (vis.ganancia === 'traza') {
      for (const tr of d.trazas) {
        let m = 0; for (let n = 0; n < ns; n++) m = Math.max(m, Math.abs(tr[n]));
        out.push(tr.map(v => v / (m || 1)));
      }
    } else {
      const t2 = vis.ganancia === 't2';
      let m = 0;
      const tmp = d.trazas.map(tr => {
        const o = new Float32Array(ns);
        for (let n = 0; n < ns; n++) {
          const t = Math.max(0, d.t0 + n * dt);
          o[n] = t2 ? tr[n] * t * t : tr[n];
          m = Math.max(m, Math.abs(o[n]));
        }
        return o;
      });
      tmp.forEach(o => { for (let n = 0; n < ns; n++) o[n] /= (m || 1); out.push(o); });
    }
    d._vis = out; d._visClave = clave;
    return out;
  }

  // ------------------------------------------------------------------
  // Curvas teóricas (tiempos de viaje) sobre el registro
  // ------------------------------------------------------------------
  function curvasTeoricas(d) {
    if (d._curvas) return d._curvas;
    const op = { directa: P.evDirecta, refractadas: P.evRefractadas, reflexiones: P.evReflexiones, multiples: P.evMultiples, fp: ctx.fpEf };
    const cGR = P.evGroundRoll ? S.velocidadRayleigh(capas, P.fgr) : 0;
    const curvas = {};
    const poner = (clave, i, t, color, guion) => {
      if (!curvas[clave]) curvas[clave] = { color, guion, t: new Float64Array(d.meta.length).fill(NaN) };
      curvas[clave].t[i] = t;
    };
    d.meta.forEach((m, i) => {
      const off = Math.abs(m.off), corr = m.estatica + d.jitterMedio;
      for (const e of S.eventos(capas, off, op)) {
        if (e.tipo === 'directa') poner('directa', i, e.t + corr, COLOR.directa);
        else if (e.tipo === 'refractada') poner('refr' + e.idx, i, e.t + corr, COLOR.refr[(e.idx - 1) % 6]);
        else if (e.tipo === 'reflexion') poner('refl' + e.idx, i, e.t + corr, COLOR.refl[e.idx % 6]);
        else poner('mult' + e.idx, i, e.t + corr, COLOR.mult, [5, 4]);
      }
      if (P.evGroundRoll) poner('gr', i, off / cGR + corr, COLOR.gr, [8, 4]);
      if (P.evAerea) poner('aire', i, off / S.V_AIRE + d.jitterMedio, COLOR.aire, [3, 3]);
    });
    d._curvas = curvas;
    return curvas;
  }

  function actualizarLeyenda() {
    const L = $('#leyenda');
    if (!vis.teoricos && !vis.primeros) { L.innerHTML = ''; return; }
    const it = [];
    if (vis.primeros) it.push([COLOR.primer, '1er arribo verdadero']);
    if (vis.teoricos) {
      if (P.evDirecta) it.push([COLOR.directa, 'Directa']);
      if (P.evRefractadas) it.push([COLOR.refr[0], 'Refractadas']);
      if (P.evReflexiones) it.push([COLOR.refl[0], 'Reflexiones']);
      if (P.evMultiples) it.push([COLOR.mult, 'Múltiples']);
      if (P.evGroundRoll) it.push([COLOR.gr, `Ground roll (c a ${P.fgr} Hz)`]);
      if (P.evAerea) it.push([COLOR.aire, 'Onda aérea']);
    }
    L.innerHTML = it.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
  }

  // ------------------------------------------------------------------
  // Registro de campo (sismograma del disparo)
  // ------------------------------------------------------------------
  function dibujarRegistro() {
    const d = cache.get(disparoActual);
    if (!d) return;
    const cv = $('#cvRegistro');
    const { g, w, h, dpr } = prepararLienzo(cv);
    const ntr = d.trazas.length;
    const M = { l: 52, r: 12, t: 44, b: 10 };
    const tA = d.t0, tB = Math.max(tA + 5 * d.dt, Math.min(vis.tmax / 1000, d.t0 + (d.ns - 1) * d.dt));
    const ancho = w - M.l - M.r, alto = h - M.t - M.b;
    const esp = ancho / ntr;
    const X = i => M.l + (i + 0.5) * esp;
    const Y = t => M.t + (t - tA) / (tB - tA) * alto;
    marco = { M, tA, tB, esp, X, Y, ntr, w, h };
    const datos = datosVisual(d);
    const n1 = 0, n2 = Math.min(d.ns - 1, Math.ceil((tB - d.t0) / d.dt));
    const esc = vis.escala;

    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);

    if (vis.modo === 'dg' || vis.modo === 'drb') {
      const pw = Math.round(ancho * dpr), ph = Math.round(alto * dpr);
      const img = g.createImageData(pw, ph);
      const px = img.data;
      const rb = vis.modo === 'drb';
      for (let yy = 0; yy < ph; yy++) {
        const t = tA + (yy + 0.5) / ph * (tB - tA);
        const u = (t - d.t0) / d.dt;
        const n0 = Math.min(d.ns - 2, Math.max(0, Math.floor(u))), fr = u - n0;
        for (let xx = 0; xx < pw; xx++) {
          const i = Math.min(ntr - 1, Math.floor(xx / (pw / ntr)));
          const tr = datos[i];
          let v = (tr[n0] * (1 - fr) + tr[n0 + 1] * fr) * esc;
          v = Math.max(-1, Math.min(1, v));
          const o = 4 * (yy * pw + xx);
          if (rb) {
            if (v >= 0) { px[o] = 255; px[o + 1] = Math.round(255 * (1 - v)); px[o + 2] = Math.round(255 * (1 - v)); }
            else { px[o] = Math.round(255 * (1 + v)); px[o + 1] = Math.round(255 * (1 + v)); px[o + 2] = 255; }
          } else {
            const c = Math.round(127.5 * (1 - v));
            px[o] = px[o + 1] = px[o + 2] = c;
          }
          px[o + 3] = 255;
        }
      }
      g.putImageData(img, Math.round(M.l * dpr), Math.round(M.t * dpr));
    } else {
      const clip = 1.6 * esp;
      const va = vis.modo === 'wva';
      g.save();
      g.beginPath(); g.rect(M.l, M.t, ancho, alto); g.clip();
      for (let i = 0; i < ntr; i++) {
        const tr = datos[i], cx = X(i);
        const desplaz = n => Math.max(-clip, Math.min(clip, tr[n] * esc * esp));
        if (va) {
          g.beginPath();
          g.moveTo(cx, Y(d.t0 + n1 * d.dt));
          for (let n = n1; n <= n2; n++) g.lineTo(cx + Math.max(0, desplaz(n)), Y(d.t0 + n * d.dt));
          g.lineTo(cx, Y(d.t0 + n2 * d.dt));
          g.closePath();
          g.fillStyle = d.meta[i].muerta ? '#9ca3af' : '#111827';
          g.fill();
        }
        g.beginPath();
        for (let n = n1; n <= n2; n++) {
          const x = cx + desplaz(n), y = Y(d.t0 + n * d.dt);
          if (n === n1) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokeStyle = '#111827'; g.lineWidth = 0.7; g.stroke();
      }
      g.restore();
    }

    // Línea de tiempo cero
    if (d.t0 < 0) {
      g.strokeStyle = 'rgba(220,38,38,.5)'; g.setLineDash([4, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(M.l, Y(0)); g.lineTo(w - M.r, Y(0)); g.stroke(); g.setLineDash([]);
    }

    // Curvas teóricas y primeros arribos
    g.save();
    g.beginPath(); g.rect(M.l, M.t, ancho, alto); g.clip();
    const trazarCurva = (t, color, ancho, guion) => {
      g.strokeStyle = color; g.lineWidth = ancho; g.setLineDash(guion || []);
      g.beginPath();
      let abierto = false;
      for (let i = 0; i < ntr; i++) {
        const ok = isFinite(t[i]);
        const mismoLado = i > 0 && Math.sign(d.meta[i].off) === Math.sign(d.meta[i - 1].off);
        if (!ok) { abierto = false; continue; }
        if (abierto && mismoLado) g.lineTo(X(i), Y(t[i])); else g.moveTo(X(i), Y(t[i]));
        abierto = true;
      }
      g.stroke(); g.setLineDash([]);
    };
    if (vis.teoricos) {
      const cs = curvasTeoricas(d);
      for (const k in cs) trazarCurva(cs[k].t, cs[k].color, 1.6, cs[k].guion);
    }
    if (vis.primeros) trazarCurva(d.meta.map(m => m.tPrimer), COLOR.primer, 2.2);
    g.restore();

    // Ejes
    g.fillStyle = '#374151'; g.strokeStyle = '#9ca3af'; g.lineWidth = 1;
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    const paso = pasoEje((tB - tA) * 1000, alto / 45);
    for (let tm = Math.ceil(tA * 1000 / paso) * paso; tm <= tB * 1000 + 1e-9; tm += paso) {
      const y = Y(tm / 1000);
      g.beginPath(); g.moveTo(M.l - 4, y); g.lineTo(M.l, y); g.stroke();
      g.fillText(fmt(tm, paso < 1 ? 2 : 0), M.l - 6, y);
      g.strokeStyle = 'rgba(0,0,0,.06)'; g.beginPath(); g.moveTo(M.l, y); g.lineTo(w - M.r, y); g.stroke(); g.strokeStyle = '#9ca3af';
    }
    g.save(); g.translate(13, M.t + alto / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('Tiempo (ms)', 0, 0); g.restore();

    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const cada = Math.max(1, Math.ceil(46 / esp));
    for (let i = 0; i < ntr; i += cada) {
      g.fillText(fmt(d.meta[i].xr, 1), X(i), M.t - 15);
      g.beginPath(); g.moveTo(X(i), M.t - 4); g.lineTo(X(i), M.t); g.stroke();
    }
    g.fillStyle = '#6b7280'; g.textAlign = 'left';
    g.fillText('x receptor (m)', 6, 13);
    g.textAlign = 'right';
    g.fillText(`Disparo ${d.id} · fuente x = ${fmt(d.xs)} m · ${vis.ganancia === 'agc' ? 'AGC ' + vis.agc + ' ms' : vis.ganancia === 'traza' ? 'normalizado por traza' : vis.ganancia === 't2' ? 'ganancia t²' : 'amplitud real'}`, w - M.r, 13);
    // posición de la fuente sobre el eje superior
    const rx = d.meta.map(m => m.xr);
    let fi = null;
    if (d.xs <= rx[0]) fi = -0.5 - (rx[0] - d.xs) / (P.dx || 1);
    else if (d.xs >= rx[ntr - 1]) fi = ntr - 0.5 + (d.xs - rx[ntr - 1]) / (P.dx || 1);
    else for (let i = 0; i < ntr - 1; i++) if (d.xs >= rx[i] && d.xs <= rx[i + 1]) { fi = i + (d.xs - rx[i]) / (rx[i + 1] - rx[i]); break; }
    if (fi !== null) {
      const xs = Math.max(M.l - 6, Math.min(w - M.r + 4, X(fi)));
      estrella(g, xs, M.t - 7, 6, '#dc2626');
    }
  }

  // Capa superior: cursor y picks (se redibuja sin recalcular el registro)
  let cvSup = null;
  function dibujarSuperposicion() {
    if (!cvSup) {
      cvSup = document.createElement('canvas');
      cvSup.style.pointerEvents = 'none';
      $('#envRegistro').appendChild(cvSup);
    }
    const { g } = prepararLienzo(cvSup);
    const d = cache.get(disparoActual);
    if (!d || !marco) return;
    const { M, X, Y, tA, tB, esp, w, h } = marco;
    if (vis.picks) {
      const pk = picks.get(disparoActual);
      if (pk) {
        g.strokeStyle = COLOR.pick; g.fillStyle = COLOR.pick; g.lineWidth = 2;
        for (let i = 0; i < pk.length; i++) {
          if (!isFinite(pk[i]) || pk[i] < tA || pk[i] > tB) continue;
          const x = X(i), y = Y(pk[i]);
          g.beginPath(); g.moveTo(x - Math.min(10, esp * 0.45), y); g.lineTo(x + Math.min(10, esp * 0.45), y); g.stroke();
          g.beginPath(); g.arc(x, y, 2.4, 0, 2 * Math.PI); g.fill();
        }
      }
    }
    if (hover && hover.i >= 0) {
      g.fillStyle = 'rgba(20,184,166,.12)';
      g.fillRect(X(hover.i) - esp / 2, M.t, esp, h - M.t - M.b);
      if (hover.t >= tA && hover.t <= tB) {
        g.strokeStyle = 'rgba(15,118,110,.7)'; g.lineWidth = 1; g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(M.l, Y(hover.t)); g.lineTo(w - M.r, Y(hover.t)); g.stroke(); g.setLineDash([]);
      }
    }
  }

  // ------------------------------------------------------------------
  // Modelo geológico con geometría y trayectorias de rayos
  // ------------------------------------------------------------------
  function dibujarModelo() {
    const cv = $('#cvModelo');
    const { g, w, h } = prepararLienzo(cv);
    if (!ctx) return;
    const d = cache.get(disparoActual);
    const z = S.profundidades(capas);
    const zFondo = Math.max(5, z[z.length - 1] * 1.35);
    let xmin = Infinity, xmax = -Infinity;
    ctx.disparos.forEach(s => { xmin = Math.min(xmin, s.x, ...s.rx); xmax = Math.max(xmax, s.x, ...s.rx); });
    const pad = 0.04 * (xmax - xmin || 10);
    xmin -= pad; xmax += pad;
    const M = { l: 48, r: 12, t: 36, b: 30 };
    const X = x => M.l + (x - xmin) / (xmax - xmin) * (w - M.l - M.r);
    const Y = zz => M.t + zz / zFondo * (h - M.t - M.b);

    // capas
    capas.forEach((c, i) => {
      const y1 = Y(z[i]), y2 = i === capas.length - 1 ? h - M.b : Y(z[i + 1]);
      g.fillStyle = colorVelocidad(c.vp);
      g.fillRect(M.l, y1, w - M.l - M.r, y2 - y1);
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
      if (i > 0) { g.beginPath(); g.moveTo(M.l, y1); g.lineTo(w - M.r, y1); g.stroke(); }
      if (y2 - y1 > 13) {
        g.fillStyle = c.vp > 2600 ? '#f8fafc' : '#1f2937';
        g.font = '11px system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
        g.fillText(`Vp ${c.vp} · Vs ${c.vs} m/s · ρ ${c.rho}`, w - M.r - 6, Math.min(y1 + 10, (y1 + y2) / 2));
      }
    });

    // rayos de la traza bajo el cursor
    if (d && hover && hover.i >= 0 && hover.i < d.meta.length) {
      const m = d.meta[hover.i];
      const xs = d.xs, xr = m.xr, sgn = Math.sign(xr - xs) || 1;
      const off = Math.abs(xr - xs);
      g.save();
      g.beginPath(); g.rect(M.l, M.t - 2, w - M.l - M.r, h - M.t - M.b + 2); g.clip();
      if (P.evReflexiones) {
        for (let i = 0; i < capas.length - 1; i++) {
          const ray = S.trazarReflexion(capas, i, off, 1);
          const pts = [[xs, 0]];
          let x = xs;
          for (let j = 0; j <= i; j++) { const pv = ray.p * capas[j].vp; x += sgn * capas[j].h * pv / Math.sqrt(1 - pv * pv); pts.push([x, z[j + 1]]); }
          for (let j = i; j >= 0; j--) { const pv = ray.p * capas[j].vp; x += sgn * capas[j].h * pv / Math.sqrt(1 - pv * pv); pts.push([x, z[j]]); }
          g.strokeStyle = COLOR.refl[i % 6]; g.globalAlpha = 0.75; g.lineWidth = 1.3;
          g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke();
        }
      }
      g.globalAlpha = 1;
      if (m.tipoPrimer === 'refractada') {
        const n = m.idxPrimer, vn = capas[n].vp;
        const bajada = [[xs, 0]];
        let x = xs;
        for (let j = 0; j < n; j++) { const s = capas[j].vp / vn; x += sgn * capas[j].h * s / Math.sqrt(1 - s * s); bajada.push([x, z[j + 1]]); }
        const subida = [[xr, 0]];
        let x2 = xr;
        for (let j = 0; j < n; j++) { const s = capas[j].vp / vn; x2 -= sgn * capas[j].h * s / Math.sqrt(1 - s * s); subida.push([x2, z[j + 1]]); }
        const pts = bajada.concat(subida.reverse());
        g.strokeStyle = COLOR.primer; g.lineWidth = 2.4;
        g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke();
      } else {
        g.strokeStyle = COLOR.primer; g.lineWidth = 3;
        g.beginPath(); g.moveTo(X(xs), Y(0) + 1.5); g.lineTo(X(xr), Y(0) + 1.5); g.stroke();
      }
      g.restore();
    }

    // superficie, geófonos y disparos
    g.strokeStyle = '#1f2937'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(M.l, Y(0)); g.lineTo(w - M.r, Y(0)); g.stroke();
    if (d) {
      g.fillStyle = '#0f766e';
      d.meta.forEach((m, i) => {
        const x = X(m.xr);
        g.fillStyle = m.muerta ? '#9ca3af' : (hover && hover.i === i ? '#f97316' : '#0f766e');
        g.beginPath(); g.moveTo(x, Y(0)); g.lineTo(x - 3.5, Y(0) - 7); g.lineTo(x + 3.5, Y(0) - 7); g.closePath(); g.fill();
      });
    }
    ctx.disparos.forEach((s, i) => { if (i !== disparoActual) estrella(g, X(s.x), Y(0) - 14, 4, '#94a3b8'); });
    if (d) estrella(g, X(d.xs), Y(0) - 14, 6.5, '#dc2626');

    // ejes
    g.fillStyle = '#374151'; g.strokeStyle = '#9ca3af'; g.font = '11px system-ui, sans-serif'; g.lineWidth = 1;
    g.textAlign = 'center'; g.textBaseline = 'top';
    const px = pasoEje(xmax - xmin, (w - M.l - M.r) / 70);
    for (let x = Math.ceil(xmin / px) * px; x <= xmax; x += px) {
      g.beginPath(); g.moveTo(X(x), h - M.b); g.lineTo(X(x), h - M.b + 4); g.stroke();
      g.fillText(fmt(x), X(x), h - M.b + 6);
    }
    g.textAlign = 'right'; g.textBaseline = 'middle';
    const pz = pasoEje(zFondo, (h - M.t - M.b) / 35);
    for (let zz = 0; zz <= zFondo; zz += pz) {
      g.beginPath(); g.moveTo(M.l - 4, Y(zz)); g.lineTo(M.l, Y(zz)); g.stroke();
      g.fillText(fmt(zz), M.l - 6, Y(zz));
    }
    g.save(); g.translate(11, M.t + (h - M.t - M.b) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('Profundidad (m)', 0, 0); g.restore();
    const exag = ((w - M.l - M.r) / (xmax - xmin)) / ((h - M.t - M.b) / zFondo);
    g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillStyle = '#6b7280';
    g.fillText(`Exageración vertical ×${fmt(1 / exag, 1)}`, w - M.r, 12);
  }

  // ------------------------------------------------------------------
  // Panel de análisis
  // ------------------------------------------------------------------
  function dibujarAnalisis() {
    const cv = $('#cvAnalisis'), res = $('#resumen');
    $$('.pestaña').forEach(b => b.classList.toggle('activa', b.dataset.tab === pestaña));
    if (pestaña === 'resumen') { cv.hidden = true; res.hidden = false; res.innerHTML = htmlResumen(); return; }
    cv.hidden = false; res.hidden = true;
    const { g, w, h } = prepararLienzo(cv);
    if (!ctx) return;
    if (pestaña === 'dromo') dibujarDromocronas(g, w, h);
    else if (pestaña === 'espectro') dibujarEspectro(g, w, h);
    else if (pestaña === 'dispersion') dibujarDispersion(g, w, h);
    else if (pestaña === 'ondicula') dibujarOndicula(g, w, h);
  }

  function ejes(g, w, h, M, xr, yr, etqX, etqY, invertirY, opciones) {
    opciones = opciones || {};
    const X = x => M.l + (x - xr[0]) / (xr[1] - xr[0]) * (w - M.l - M.r);
    const Y = invertirY ? y => M.t + (y - yr[0]) / (yr[1] - yr[0]) * (h - M.t - M.b)
                        : y => h - M.b - (y - yr[0]) / (yr[1] - yr[0]) * (h - M.t - M.b);
    g.fillStyle = opciones.fondo || '#fff'; g.fillRect(M.l, M.t, w - M.l - M.r, h - M.t - M.b);
    g.strokeStyle = '#d1d5db'; g.lineWidth = 1; g.strokeRect(M.l, M.t, w - M.l - M.r, h - M.t - M.b);
    g.fillStyle = '#374151'; g.font = '11px system-ui, sans-serif';
    const px = pasoEje(xr[1] - xr[0], (w - M.l - M.r) / 70);
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let x = Math.ceil(xr[0] / px) * px; x <= xr[1] + 1e-9; x += px) {
      g.strokeStyle = 'rgba(0,0,0,.07)'; g.beginPath(); g.moveTo(X(x), M.t); g.lineTo(X(x), h - M.b); g.stroke();
      g.fillText(fmt(x), X(x), h - M.b + 4);
    }
    const py = pasoEje(yr[1] - yr[0], (h - M.t - M.b) / 35);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let y = Math.ceil(yr[0] / py) * py; y <= yr[1] + 1e-9; y += py) {
      g.strokeStyle = 'rgba(0,0,0,.07)'; g.beginPath(); g.moveTo(M.l, Y(y)); g.lineTo(w - M.r, Y(y)); g.stroke();
      g.fillText(fmt(y), M.l - 5, Y(y));
    }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#6b7280';
    g.fillText(etqX, M.l + (w - M.l - M.r) / 2, h - 4);
    g.save(); g.translate(11, M.t + (h - M.t - M.b) / 2); g.rotate(-Math.PI / 2); g.fillText(etqY, 0, 0); g.restore();
    return { X, Y };
  }

  function dibujarDromocronas(g, w, h) {
    let xmin = Infinity, xmax = -Infinity, tmax = 0;
    const curvas = ctx.disparos.map(s => {
      xmin = Math.min(xmin, s.x, ...s.rx); xmax = Math.max(xmax, s.x, ...s.rx);
      const pts = s.rx.map(xr => { const t = S.primerArribo(capas, Math.abs(xr - s.x)).t; tmax = Math.max(tmax, t); return [xr, t]; });
      return { s, pts };
    });
    tmax = Math.min(tmax * 1.15, (P.trec) / 1000) * 1000;
    const M = { l: 46, r: 10, t: 22, b: 30 };
    const { X, Y } = ejes(g, w, h, M, [xmin, xmax], [0, tmax], 'Distancia x (m)', 'Tiempo (ms)', false);
    const n = curvas.length;
    curvas.forEach(({ s, pts }, k) => {
      const col = `hsl(${(k * 360 / n + 200) % 360} 70% 42%)`;
      const actual = k === disparoActual;
      g.strokeStyle = col; g.lineWidth = actual ? 2.6 : 1.1; g.globalAlpha = actual ? 1 : 0.55;
      const izq = pts.filter(p => p[0] <= s.x), der = pts.filter(p => p[0] >= s.x);
      [izq, der].forEach(rama => {
        if (!rama.length) return;
        const r = rama.slice(); r.push([s.x, 0]); r.sort((a, b) => a[0] - b[0]);
        g.beginPath(); r.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1] * 1000)) : g.moveTo(X(p[0]), Y(p[1] * 1000))); g.stroke();
      });
      g.globalAlpha = 1;
      const pk = picks.get(k);
      if (pk) {
        g.fillStyle = col;
        s.rx.forEach((xr, i) => { if (isFinite(pk[i])) { g.beginPath(); g.arc(X(xr), Y(pk[i] * 1000), actual ? 3 : 2.2, 0, 7); g.fill(); } });
      }
      estrella(g, X(s.x), Y(0), actual ? 5 : 3.5, col);
    });
    g.fillStyle = '#374151'; g.textAlign = 'left'; g.font = '11.5px system-ui, sans-serif';
    g.fillText('Líneas: primeros arribos teóricos (sin estáticas) · puntos: picks', M.l, 14);
  }

  function espectroTraza(tr, dt) {
    const N = S.siguientePot2(tr.length * 2);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let n = 0; n < tr.length; n++) {
      const v = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (tr.length - 1)); // ventana Hann
      re[n] = tr[n] * v;
    }
    S.fft(re, im, false);
    const A = new Float64Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) A[k] = Math.hypot(re[k], im[k]);
    return { A, df: 1 / (N * dt) };
  }

  function dibujarEspectro(g, w, h) {
    const d = cache.get(disparoActual);
    if (!d) return;
    const fNyq = 0.5 / d.dt;
    const fmaxP = Math.min(fNyq, Math.max(120, 4 * ctx.fpEf, P.tipoFuente === 'vibro' ? P.f2 * 1.4 : 0));
    let A, df, titulo;
    if (hover && hover.i >= 0) {
      ({ A, df } = espectroTraza(d.trazas[hover.i], d.dt));
      titulo = `Traza ${hover.i + 1} (x = ${fmt(d.meta[hover.i].xr)} m)`;
    } else {
      let suma = null;
      d.trazas.forEach(tr => { const e = espectroTraza(tr, d.dt); df = e.df; if (!suma) suma = new Float64Array(e.A.length); e.A.forEach((v, k) => { suma[k] += v * v; }); });
      A = suma.map(v => Math.sqrt(v)); titulo = 'Promedio del disparo (pase el cursor sobre una traza)';
    }
    let amax = 0; for (let k = 1; k < A.length; k++) if (k * df <= fmaxP) amax = Math.max(amax, A[k]);
    const M = { l: 46, r: 10, t: 22, b: 30 };
    const { X, Y } = ejes(g, w, h, M, [0, fmaxP], [-60, 2], 'Frecuencia (Hz)', 'Amplitud (dB)', false);
    g.save(); g.beginPath(); g.rect(M.l, M.t, w - M.l - M.r, h - M.t - M.b); g.clip();
    // respuesta del geófono
    g.strokeStyle = '#0f766e'; g.setLineDash([5, 4]); g.lineWidth = 1.3; g.beginPath();
    for (let i = 0; i <= 300; i++) {
      const f = Math.max(0.1, fmaxP * i / 300);
      const r = S.respuestaGeofono(f, P.f0, P.zeta);
      const db = 20 * Math.log10(Math.hypot(r.re, r.im) + 1e-12);
      i ? g.lineTo(X(f), Y(db)) : g.moveTo(X(f), Y(db));
    }
    g.stroke(); g.setLineDash([]);
    if (P.freqRed && P.ruidoRed > 0) {
      g.strokeStyle = 'rgba(220,38,38,.35)'; g.beginPath(); g.moveTo(X(P.freqRed), M.t); g.lineTo(X(P.freqRed), h - M.b); g.stroke();
    }
    g.strokeStyle = '#1d4ed8'; g.lineWidth = 1.5; g.beginPath();
    let inicio = true;
    for (let k = 0; k < A.length && k * df <= fmaxP; k++) {
      const db = Math.max(-80, 20 * Math.log10(A[k] / (amax || 1) + 1e-12));
      if (inicio) { g.moveTo(X(k * df), Y(db)); inicio = false; } else g.lineTo(X(k * df), Y(db));
    }
    g.stroke(); g.restore();
    g.fillStyle = '#374151'; g.textAlign = 'left'; g.font = '11.5px system-ui, sans-serif';
    g.fillText(titulo, M.l, 14);
    g.textAlign = 'right'; g.fillStyle = '#0f766e';
    g.fillText(`--- respuesta geófono ${P.f0} Hz`, w - M.r, 14);
  }

  function imagenDispersion(d) {
    if (d._disp) return d._disp;
    // Traza del lado con más receptores
    const izq = d.meta.map((m, i) => i).filter(i => d.meta[i].off < 0);
    const der = d.meta.map((m, i) => i).filter(i => d.meta[i].off > 0);
    const lado = (der.length >= izq.length ? der : izq).filter(i => !d.meta[i].muerta);
    if (lado.length < 4) return (d._disp = { error: 'Se necesitan al menos 4 trazas a un mismo lado de la fuente.' });
    const N = S.siguientePot2(d.ns);
    const df = 1 / (N * d.dt);
    const fNyq = 0.5 / d.dt;
    const fmax = Math.min(fNyq * 0.9, Math.max(60, 3.5 * P.fgr));
    const fmin = Math.max(1, 0.5 * Math.min(P.f0, 5));
    const vsMax = Math.max(...capas.map(c => c.vs));
    const cmin = 40, cmax = Math.min(3000, 1.15 * vsMax);
    const U = lado.map(i => {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let n = 0; n < d.ns; n++) re[n] = d.trazas[i][n];
      S.fft(re, im, false);
      return { re, im, x: Math.abs(d.meta[i].off) };
    });
    const nf = Math.min(260, Math.ceil((fmax - fmin) / df)), nc = 220;
    const img = new Float32Array(nf * nc);
    for (let a = 0; a < nf; a++) {
      const f = fmin + (fmax - fmin) * a / (nf - 1);
      const k = Math.round(f / df);
      const fr = k * df;
      const nr = U.map(u => { const m = Math.hypot(u.re[k], u.im[k]) || 1; return [u.re[k] / m, u.im[k] / m]; });
      let mx = 0;
      for (let b = 0; b < nc; b++) {
        const c = cmin + (cmax - cmin) * b / (nc - 1);
        let sr = 0, si = 0;
        for (let j = 0; j < U.length; j++) {
          const ph = 2 * Math.PI * fr * U[j].x / c;
          const cr = Math.cos(ph), ci = Math.sin(ph);
          sr += nr[j][0] * cr - nr[j][1] * ci;
          si += nr[j][0] * ci + nr[j][1] * cr;
        }
        const v = Math.hypot(sr, si);
        img[b * nf + a] = v; mx = Math.max(mx, v);
      }
      for (let b = 0; b < nc; b++) img[b * nf + a] /= (mx || 1);
    }
    return (d._disp = { img, nf, nc, fmin, fmax, cmin, cmax, n: lado.length });
  }

  const VIRIDIS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  function mapaViridis(v) {
    const u = Math.max(0, Math.min(1, v)) * 4, i = Math.min(3, Math.floor(u)), w = u - i;
    return VIRIDIS[i].map((c, j) => Math.round(c * (1 - w) + VIRIDIS[i + 1][j] * w));
  }

  function dibujarDispersion(g, w, h) {
    const d = cache.get(disparoActual);
    if (!d) return;
    const D = imagenDispersion(d);
    const M = { l: 50, r: 10, t: 22, b: 30 };
    if (D.error) { g.fillStyle = '#6b7280'; g.font = '13px system-ui'; g.fillText(D.error, 16, 30); return; }
    const { X, Y } = ejes(g, w, h, M, [D.fmin, D.fmax], [D.cmin, D.cmax], 'Frecuencia (Hz)', 'Velocidad de fase (m/s)', false);
    const off = document.createElement('canvas');
    off.width = D.nf; off.height = D.nc;
    const og = off.getContext('2d');
    const id = og.createImageData(D.nf, D.nc);
    for (let b = 0; b < D.nc; b++) for (let a = 0; a < D.nf; a++) {
      const c = mapaViridis(Math.pow(D.img[b * D.nf + a], 1.5));
      const o = 4 * ((D.nc - 1 - b) * D.nf + a);
      id.data[o] = c[0]; id.data[o + 1] = c[1]; id.data[o + 2] = c[2]; id.data[o + 3] = 255;
    }
    og.putImageData(id, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(off, M.l, M.t, w - M.l - M.r, h - M.t - M.b);
    // curva teórica
    g.save(); g.beginPath(); g.rect(M.l, M.t, w - M.l - M.r, h - M.t - M.b); g.clip();
    g.strokeStyle = '#fff'; g.setLineDash([6, 4]); g.lineWidth = 1.6; g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const f = D.fmin + (D.fmax - D.fmin) * i / 120;
      const c = S.velocidadRayleigh(capas, f);
      i ? g.lineTo(X(f), Y(c)) : g.moveTo(X(f), Y(c));
    }
    g.stroke(); g.setLineDash([]); g.restore();
    g.fillStyle = '#374151'; g.font = '11.5px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText(`Transformada de desplazamiento de fase (${D.n} trazas) · --- curva teórica (modo fundamental aprox.)`, M.l, 14);
  }

  function dibujarOndicula(g, w, h) {
    const W = ctx.W, N = ctx.N, dt = ctx.dt;
    const durPre = 2 / ctx.fpEf, durPost = 5 / ctx.fpEf;
    const M = { l: 46, r: 10, t: 22, b: 30 };
    const mitadW = w / 2;
    // dominio del tiempo
    const pts = [];
    for (let n = -Math.round(durPre / dt); n <= Math.round(durPost / dt); n++) pts.push([n * dt * 1000, W.tiempo[(n + N) % N]]);
    const e1 = ejes(g, mitadW, h, M, [pts[0][0], pts[pts.length - 1][0]], [-1.05, 1.05], 'Tiempo (ms)', 'Amplitud', false);
    g.strokeStyle = '#111827'; g.lineWidth = 1.6; g.beginPath();
    pts.forEach((p, i) => i ? g.lineTo(e1.X(p[0]), e1.Y(p[1])) : g.moveTo(e1.X(p[0]), e1.Y(p[1]))); g.stroke();
    g.strokeStyle = 'rgba(220,38,38,.6)'; g.beginPath(); g.moveTo(e1.X(0), M.t); g.lineTo(e1.X(0), h - M.b); g.stroke();
    g.fillStyle = '#374151'; g.font = '11.5px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText(`Ondícula de la fuente (fase ${P.fase === 'min' ? 'mínima' : 'cero'})`, M.l, 14);
    // espectro
    g.save(); g.translate(mitadW, 0);
    const fmax = Math.min(0.5 / dt, P.tipoFuente === 'vibro' ? P.f2 * 1.5 : 4 * ctx.fpEf);
    const e2 = ejes(g, w - mitadW, h, M, [0, fmax], [0, 1.05], 'Frecuencia (Hz)', 'Amplitud normalizada', false);
    const df = 1 / (N * dt);
    let amax = 0; const am = [];
    for (let k = 0; k * df <= fmax; k++) { const a = Math.hypot(W.re[k], W.im[k]); am.push(a); amax = Math.max(amax, a); }
    g.strokeStyle = '#1d4ed8'; g.lineWidth = 1.6; g.beginPath();
    am.forEach((a, k) => k ? g.lineTo(e2.X(k * df), e2.Y(a / amax)) : g.moveTo(e2.X(0), e2.Y(a / amax))); g.stroke();
    g.strokeStyle = '#0f766e'; g.setLineDash([5, 4]); g.beginPath();
    am.forEach((a, k) => {
      const f = Math.max(0.01, k * df), r = S.respuestaGeofono(f, P.f0, P.zeta), v = a / amax * Math.hypot(r.re, r.im);
      k ? g.lineTo(e2.X(f), e2.Y(v)) : g.moveTo(e2.X(f), e2.Y(v));
    });
    g.stroke(); g.setLineDash([]);
    g.fillStyle = '#374151'; g.textAlign = 'left';
    g.fillText('Espectro: — fuente  --- fuente × geófono', M.l, 14);
    g.restore();
  }

  // ------------------------------------------------------------------
  // Resumen de la adquisición y consejos
  // ------------------------------------------------------------------
  function htmlResumen() {
    if (!ctx) return '';
    const avisos = ctx.avisos.slice();
    const z = S.profundidades(capas);
    const L = (P.nch - 1) * P.dx;
    const fNyq = 0.5 / ctx.dt;
    const fmaxF = P.tipoFuente === 'vibro' ? P.f2 : 2.5 * P.fp;
    let minOff = Infinity;
    ctx.disparos.forEach(s => s.rx.forEach(x => { minOff = Math.min(minOff, Math.abs(x - s.x)); }));
    const ntr = ctx.disparos.reduce((s, d) => s + d.rx.length, 0);
    const mb = (3600 + ntr * (240 + 4 * ctx.ns)) / 1048576;
    let h = '<h3>Adquisición</h3><table>';
    h += `<tr><th>Disparos / trazas totales</th><td>${ctx.disparos.length} / ${ntr}</td></tr>`;
    h += `<tr><th>Longitud del tendido</th><td>${fmt(L)} m (${P.nch} canales × ${P.dx} m)</td></tr>`;
    h += `<tr><th>Offset mínimo / máximo</th><td>${fmt(minOff)} / ${fmt(ctx.maxOff)} m</td></tr>`;
    h += `<tr><th>Frecuencia de Nyquist</th><td>${fmt(fNyq)} Hz</td></tr>`;
    h += `<tr><th>Tamaño SEG-Y estimado</th><td>${fmt(mb, 2)} MB</td></tr>`;
    if (P.tendido === 'rodante') {
      const fold = P.nch * P.dx / (2 * P.dxDisparo);
      h += `<tr><th>Cobertura CMP nominal</th><td>${fmt(fold, 1)} (intervalo CMP ${fmt(P.dx / 2)} m)</td></tr>`;
    }
    h += '</table>';

    if (fNyq < fmaxF) avisos.push(`Aliasing temporal: la fuente tiene energía hasta ~${fmt(fmaxF)} Hz pero Nyquist es ${fmt(fNyq)} Hz. Reduzca el intervalo de muestreo.`);
    if (P.tipoFuente !== 'vibro' && P.f0 > 0.6 * P.fp) avisos.push(`El geófono de ${P.f0} Hz atenúa fuertemente la señal de ${P.fp} Hz.`);
    const tUltimo = S.primerArribo(capas, ctx.maxOff).t * 1000;
    if (tUltimo + 20 > P.trec) avisos.push(`Registro corto: el primer arribo al offset máximo llega a ${fmt(tUltimo)} ms (registro de ${P.trec} ms).`);

    // Refracción
    if (capas.length > 1) {
      h += '<h3>Refracción (ondas cónicas)</h3><table><tr><th>Techo de capa</th><th>z (m)</th><th>V (m/s)</th><th>t<sub>i</sub> (ms)</th><th>x<sub>crít</sub> (m)</th><th>x<sub>cruce</sub> (m)</th><th>¿1er arribo?</th></tr>';
      const esPrimero = new Set();
      for (let x = 0; x <= ctx.maxOff; x += Math.max(0.05, P.dx / 8)) { const pa = S.primerArribo(capas, x); if (pa.tipo === 'refractada') esPrimero.add(pa.idx); }
      for (let n = 1; n < capas.length; n++) {
        const r = S.ondaRefractada(capas, n, 0);
        if (!r) {
          h += `<tr><td>${n + 1}</td><td>${fmt(z[n])}</td><td>${capas[n].vp}</td><td colspan="4">Inversión de velocidad: no hay refracción crítica</td></tr>`;
          avisos.push(`La capa ${n + 1} es más lenta que alguna capa superior (capa de baja velocidad): es invisible para la refracción y provoca sobreestimar profundidades.`);
          continue;
        }
        // cruce con la rama anterior que es primer arribo
        let xc = NaN;
        for (let x = 0; x <= 20 * (z[n] + 10) + ctx.maxOff; x += 0.05) {
          const pa = S.primerArribo(capas, x);
          if (pa.tipo === 'refractada' && pa.idx === n) { xc = x; break; }
        }
        const visible = esPrimero.has(n);
        h += `<tr><td>${n + 1}</td><td>${fmt(z[n])}</td><td>${capas[n].vp}</td><td>${fmt(r.ti * 1000)}</td><td>${fmt(r.xc)}</td><td>${fmt(xc)}</td><td>${visible ? '✔' : '✘'}</td></tr>`;
        if (!visible) avisos.push(isFinite(xc)
          ? `El refractor de la capa ${n + 1} sólo es primer arribo a partir de ${fmt(xc)} m de offset (offset máximo ${fmt(ctx.maxOff)} m): alargue el tendido o use disparos externos.`
          : `La capa ${n + 1} es una capa oculta (hidden layer): nunca llega como primer arribo.`);
      }
      h += '</table>';
      h += `<p class="ayuda" style="color:var(--tenue)">Regla práctica: profundidad de investigación ≈ L/3 – L/5 = ${fmt(L / 5)}–${fmt(L / 3)} m.</p>`;
    }

    // Reflexión
    if (capas.length > 1 && (P.evReflexiones || presetActual === 'reflexion')) {
      h += '<h3>Reflexión (incidencia normal)</h3><table><tr><th>Interfaz</th><th>z (m)</th><th>t<sub>0</sub> (ms)</th><th>R<sub>0</sub></th><th>V<sub>rms</sub> (m/s)</th><th>Resol. λ/4 (m)</th></tr>';
      for (let i = 0; i < capas.length - 1; i++) {
        const ray = S.trazarReflexion(capas, i, 0, 1);
        const z1 = capas[i].rho * capas[i].vp, z2 = capas[i + 1].rho * capas[i + 1].vp;
        const R0 = (z2 - z1) / (z2 + z1);
        h += `<tr><td>${i + 1}|${i + 2}</td><td>${fmt(z[i + 1])}</td><td>${fmt(ray.t * 1000)}</td><td>${R0.toFixed(3)}</td><td>${fmt(ray.vrms, 0)}</td><td>${fmt(capas[i].vp / (4 * ctx.fpEf))}</td></tr>`;
        if (ray.t * 1000 > P.trec && presetActual === 'reflexion') avisos.push(`La reflexión de la interfaz ${i + 1}|${i + 2} (t0 = ${fmt(ray.t * 1000)} ms) cae fuera del registro.`);
      }
      h += '</table>';
    }

    // Ondas superficiales
    if (P.evGroundRoll) {
      const fA = Math.max(P.f0 * 0.8, 2), fB = Math.min(fNyq, 3 * P.fgr);
      const cA = S.velocidadRayleigh(capas, fA), cB = S.velocidadRayleigh(capas, fB);
      const lmax = cA / fA, lmin = cB / fB;
      h += '<h3>Ondas superficiales (Rayleigh)</h3><table>';
      h += `<tr><th>c(${fmt(fA)} Hz) / c(${fmt(fB)} Hz)</th><td>${fmt(cA)} / ${fmt(cB)} m/s</td></tr>`;
      h += `<tr><th>λ máx / λ mín</th><td>${fmt(lmax)} / ${fmt(lmin)} m</td></tr>`;
      h += `<tr><th>Profundidad MASW ≈ min(λmáx/2, L)</th><td>${fmt(Math.min(lmax / 2, L))} m</td></tr>`;
      h += '</table>';
      if (P.dx > lmin / 2) avisos.push(`Aliasing espacial del ground roll: Δx = ${P.dx} m > λmín/2 = ${fmt(lmin / 2)} m.`);
      if (presetActual === 'masw' && lmax / 2 > L) avisos.push(`Para resolver λmáx = ${fmt(lmax)} m conviene un tendido ≥ ${fmt(lmax / 2)} m (actual ${fmt(L)} m).`);
    }

    h += '<h3>Control de calidad</h3>';
    h += avisos.length ? avisos.map(a => `<div class="aviso">${a}</div>`).join('') : '<div class="ok">Sin advertencias: parámetros de adquisición coherentes con el modelo.</div>';
    if (P.stacks > 1) h += `<div class="ok">Apilamiento ×${P.stacks}: el ruido aleatorio se reduce ${fmt(Math.sqrt(P.stacks), 2)} veces (${fmt(10 * Math.log10(P.stacks), 1)} dB).</div>`;
    return h;
  }

  // ------------------------------------------------------------------
  // Interacción con el registro: cursor y picado
  // ------------------------------------------------------------------
  function posicionRegistro(ev) {
    if (!marco) return null;
    const r = $('#envRegistro').getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const { M, tA, tB, esp, ntr, h } = marco;
    const i = Math.floor((x - M.l) / esp);
    if (i < 0 || i >= ntr || y < M.t || y > h - M.b) return null;
    const t = tA + (y - M.t) / (h - M.t - M.b) * (tB - tA);
    return { i, t };
  }
  let arrastrando = false;
  function aplicarPick(p, borrar) {
    const d = cache.get(disparoActual);
    if (!picks.has(disparoActual)) picks.set(disparoActual, new Float64Array(d.trazas.length).fill(NaN));
    picks.get(disparoActual)[p.i] = borrar ? NaN : p.t;
  }
  function eventosRegistro() {
    const env = $('#envRegistro');
    env.addEventListener('mousemove', ev => {
      const p = posicionRegistro(ev);
      hover = p;
      const d = cache.get(disparoActual);
      if (p && d) {
        if (arrastrando && vis.picado) aplicarPick(p, ev.shiftKey);
        const m = d.meta[p.i];
        const n = Math.round((p.t - d.t0) / d.dt);
        const a = n >= 0 && n < d.ns ? d.trazas[p.i][n] : NaN;
        const pk = picks.get(disparoActual);
        $('#estado').textContent = `Canal ${m.canal} · x = ${fmt(m.xr)} m · offset ${fmt(m.off)} m · t = ${fmt(p.t * 1000, 2)} ms · amplitud ${isFinite(a) ? a.toExponential(3) : '—'}` +
          ` · 1er arribo real ${fmt(m.tPrimer * 1000, 2)} ms (${m.tipoPrimer === 'directa' ? 'directa' : 'refractada capa ' + (m.idxPrimer + 1)})` +
          (pk && isFinite(pk[p.i]) ? ` · pick ${fmt(pk[p.i] * 1000, 2)} ms` : '') +
          (m.muerta ? ' · TRAZA MUERTA' : m.invertida ? ' · POLARIDAD INVERTIDA' : '') + ` · estática ${fmt(m.estatica * 1000, 2)} ms`;
      }
      dibujarSuperposicion();
      dibujarModelo();
      if (pestaña === 'espectro') dibujarAnalisis();
    });
    env.addEventListener('mouseleave', () => { hover = null; arrastrando = false; dibujarSuperposicion(); dibujarModelo(); if (pestaña === 'espectro') dibujarAnalisis(); });
    env.addEventListener('mousedown', ev => {
      if (!vis.picado) return;
      const p = posicionRegistro(ev);
      if (!p) return;
      arrastrando = true;
      aplicarPick(p, ev.shiftKey);
      dibujarSuperposicion();
      ev.preventDefault();
    });
    window.addEventListener('mouseup', () => {
      if (arrastrando) { arrastrando = false; if (pestaña === 'dromo') dibujarAnalisis(); }
    });
  }

  function autoPicar(i) {
    const d = obtenerDisparo(i);
    const pk = new Float64Array(d.trazas.length).fill(NaN);
    d.trazas.forEach((tr, j) => {
      let e = 0; for (let n = 0; n < tr.length; n++) e += tr[n] * tr[n];
      if (Math.sqrt(e / tr.length) < 1e-5) return; // traza muerta
      pk[j] = S.picadoAutomatico(tr, d.dt, d.t0, ctx.fpEf);
    });
    picks.set(i, pk);
  }

  // ------------------------------------------------------------------
  // Exportación
  // ------------------------------------------------------------------
  function infoEstudio() {
    return { estudio: PRESETS[presetActual].nombre, fuente: S.FUENTES[P.tipoFuente].nombre };
  }
  const sello = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  function eventosExportar() {
    $('#expSEGY').addEventListener('click', async () => {
      const ds = await obtenerTodos(true);
      X.descargar(X.segy(ds, ctx, infoEstudio()), `sismica_${presetActual}_${sello()}.sgy`);
    });
    $('#expSEG2').addEventListener('click', async () => {
      const ds = await obtenerTodos(true);
      const arch = ds.map(d => ({ nombre: `${1000 + d.id}.sg2`, datos: X.seg2(d, ctx, infoEstudio()) }));
      arch.push({ nombre: 'geometria.csv', datos: new TextEncoder().encode(X.csvGeometria(ctx)) });
      arch.push({ nombre: 'proyecto.json', datos: new TextEncoder().encode(JSON.stringify(proyecto(), null, 2)) });
      X.descargar(X.zip(arch), `sismica_${presetActual}_${sello()}_seg2.zip`);
    });
    $('#expCSV').addEventListener('click', () => {
      const d = obtenerDisparo(disparoActual);
      X.descargar(X.csvTrazas(d, ctx), `disparo_${d.id}.csv`, 'text/csv');
    });
    $('#expGeom').addEventListener('click', () => { asegurarContexto(); X.descargar(X.csvGeometria(ctx), 'geometria.csv', 'text/csv'); });
    $('#expPicks').addEventListener('click', () => {
      const metas = new Map();
      picks.forEach((v, i) => metas.set(i, obtenerDisparo(i).meta));
      X.descargar(X.csvPicks(ctx, picks, metas), `picks_${presetActual}.csv`, 'text/csv');
    });
    $('#expPNG').addEventListener('click', () => {
      const a = $('#cvRegistro'), b = cvSup;
      const c = document.createElement('canvas'); c.width = a.width; c.height = a.height;
      const g = c.getContext('2d'); g.drawImage(a, 0, 0); if (b) g.drawImage(b, 0, 0);
      c.toBlob(bl => X.descargar(bl, `disparo_${cache.get(disparoActual).id}.png`));
    });
    $('#expProyecto').addEventListener('click', () => X.descargar(JSON.stringify(proyecto(), null, 2), `proyecto_${presetActual}.json`, 'application/json'));
    $('#impProyecto').addEventListener('change', ev => {
      const f = ev.target.files[0];
      if (!f) return;
      f.text().then(txt => {
        const o = JSON.parse(txt);
        if (!o.P || !o.capas) throw new Error('Archivo de proyecto no válido');
        presetActual = o.preset || 'refraccion';
        $('#preset').value = presetActual;
        P = Object.assign({}, BASE, o.P); capas = o.capas;
        if (o.vis) Object.assign(vis, o.vis);
        escribirParametros(); escribirVis(); dibujarTablaCapas(); invalidar(true);
      }).catch(e => alert('No se pudo cargar el proyecto: ' + e.message));
      ev.target.value = '';
    });
  }
  function proyecto() {
    return { formato: 'simulador-sismico', version: 1, preset: presetActual, P, capas, vis: Object.assign({}, vis, { picado: false }) };
  }

  // ------------------------------------------------------------------
  // Inicialización
  // ------------------------------------------------------------------
  function aplicarPreset(nombre) {
    presetActual = nombre;
    const pr = PRESETS[nombre];
    P = Object.assign({}, BASE, pr.P, { semilla: P.semilla || BASE.semilla });
    capas = pr.capas.map(c => Object.assign({}, c));
    Object.assign(vis, pr.vis);
    pestaña = pr.vis.tab || pestaña;
    disparoActual = nombre === 'reflexion' ? 11 : nombre === 'refraccion' ? 1 : 0;
    escribirParametros(); escribirVis(); dibujarTablaCapas();
    invalidar(true);
  }

  function iniciar() {
    $$('[data-p]').forEach(el => {
      el.addEventListener('input', () => invalidar());
      el.addEventListener('change', () => invalidar());
    });
    $('#preset').addEventListener('change', e => aplicarPreset(e.target.value));
    $('#btnAgregarCapa').addEventListener('click', () => {
      const ult = capas[capas.length - 1];
      capas.splice(capas.length - 1, 0, { h: 10, vp: Math.round(ult.vp * 0.85), vs: Math.round(ult.vs * 0.85), rho: ult.rho, q: ult.q });
      dibujarTablaCapas(); invalidar();
    });
    $('#btnModeloAleatorio').addEventListener('click', modeloAleatorio);
    $('#btnNuevaRealizacion').addEventListener('click', () => {
      P.semilla = Math.floor(Math.random() * 1e6);
      $('[data-p=semilla]').value = P.semilla;
      invalidar(true);
    });
    const cambiarDisparo = i => {
      if (!ctx) return;
      disparoActual = (i + ctx.disparos.length) % ctx.disparos.length;
      $('#selDisparo').value = disparoActual;
      renderizar();
    };
    $('#selDisparo').addEventListener('change', e => cambiarDisparo(+e.target.value));
    $('#dispAnt').addEventListener('click', () => cambiarDisparo(disparoActual - 1));
    $('#dispSig').addEventListener('click', () => cambiarDisparo(disparoActual + 1));
    window.addEventListener('keydown', e => {
      if (e.target.closest('input, select, textarea')) return;
      if (e.key === 'ArrowLeft') cambiarDisparo(disparoActual - 1);
      if (e.key === 'ArrowRight') cambiarDisparo(disparoActual + 1);
    });
    ['#visModo', '#visGanancia', '#visAgc', '#visEscala', '#visTmax', '#visTeoricos', '#visPrimeros', '#visPicks'].forEach(s => {
      $(s).addEventListener('input', () => { leerVis(); if (ctx) dibujarTodo(); });
    });
    $('#btnPicado').addEventListener('click', e => {
      vis.picado = !vis.picado;
      e.currentTarget.setAttribute('aria-pressed', vis.picado);
      $('#envRegistro').classList.toggle('picando', vis.picado);
    });
    $('#btnAutoPick').addEventListener('click', () => { autoPicar(disparoActual); vis.picks = true; escribirVis(); dibujarTodo(); });
    $('#btnAutoPickTodos').addEventListener('click', async () => {
      await obtenerTodos(true);
      ctx.disparos.forEach((_, i) => autoPicar(i));
      vis.picks = true; escribirVis(); dibujarTodo();
    });
    $('#btnBorrarPicks').addEventListener('click', () => { picks.delete(disparoActual); dibujarTodo(); });
    $$('.pestaña').forEach(b => b.addEventListener('click', () => { pestaña = b.dataset.tab; dibujarAnalisis(); }));
    eventosRegistro();
    eventosExportar();
    const ro = new ResizeObserver(() => { if (ctx && cache.has(disparoActual)) dibujarTodo(); });
    ['#envRegistro', '#envModelo', '#envAnalisis'].forEach(s => ro.observe($(s)));
    aplicarPreset('refraccion');
  }

  window.addEventListener('DOMContentLoaded', iniciar);
})();
