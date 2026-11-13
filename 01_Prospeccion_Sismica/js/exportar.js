/* =====================================================================
 * exportar.js — Escritura de formatos de intercambio sísmico
 * ---------------------------------------------------------------------
 *  - SEG-Y rev 1 (big-endian, IEEE float32, formato 5) — todos los disparos
 *  - SEG-2 rev 1 (little-endian, float32, código 4) — un archivo por disparo
 *    (formato nativo de sismógrafos de refracción tipo Geode/StrataVisor)
 *  - ZIP sin compresión (para agrupar los SEG-2)
 *  - CSV de trazas, de geometría y de tiempos picados
 * ===================================================================== */
(function (global) {
  'use strict';
  const E = {};

  const quitarAcentos = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');

  // ---------------- ASCII → EBCDIC (cp037) ----------------
  const EBCDIC = (function () {
    const t = new Uint8Array(128).fill(0x6F); // '?'
    const pares = {
      ' ': 0x40, '.': 0x4B, '<': 0x4C, '(': 0x4D, '+': 0x4E, '|': 0x4F, '&': 0x50, '!': 0x5A, '$': 0x5B,
      '*': 0x5C, ')': 0x5D, ';': 0x5E, '-': 0x60, '/': 0x61, ',': 0x6B, '%': 0x6C, '_': 0x6D, '>': 0x6E,
      '?': 0x6F, '`': 0x79, ':': 0x7A, '#': 0x7B, '@': 0x7C, "'": 0x7D, '=': 0x7E, '"': 0x7F, '~': 0xA1,
      '^': 0xB0, '[': 0xBA, ']': 0xBB, '{': 0xC0, '}': 0xD0, '\\': 0xE0
    };
    for (const k in pares) t[k.charCodeAt(0)] = pares[k];
    const rango = (a, b, base) => { for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) t[c] = base + c - a.charCodeAt(0); };
    rango('a', 'i', 0x81); rango('j', 'r', 0x91); rango('s', 'z', 0xA2);
    rango('A', 'I', 0xC1); rango('J', 'R', 0xD1); rango('S', 'Z', 0xE2);
    rango('0', '9', 0xF0);
    return t;
  })();

  function cabeceraTextual(lineas) {
    const b = new Uint8Array(3200);
    for (let i = 0; i < 40; i++) {
      let l = ('C' + String(i + 1).padStart(2, ' ') + ' ' + quitarAcentos(lineas[i] || '')).slice(0, 80).padEnd(80, ' ');
      if (i === 39) l = 'C40 END TEXTUAL HEADER'.padEnd(80, ' ');
      for (let j = 0; j < 80; j++) b[i * 80 + j] = EBCDIC[l.charCodeAt(j) & 0x7f];
    }
    return b;
  }

  const i16 = v => Math.max(-32768, Math.min(32767, Math.round(v)));
  const i32 = v => Math.max(-2147483648, Math.min(2147483647, Math.round(v)));

  /**
   * SEG-Y rev1 con todos los disparos.
   * Coordenadas escaladas con SCALCO = −100 (precisión de cm).
   */
  E.segy = function (disparos, ctx, info) {
    const P = ctx.P;
    const ns = ctx.ns, dtus = Math.round(ctx.dt * 1e6);
    const ntr = disparos.reduce((s, d) => s + d.trazas.length, 0);
    const buf = new ArrayBuffer(3600 + ntr * (240 + 4 * ns));
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    const capasTxt = ctx.capas.map((c, i) =>
      `  Capa ${i + 1}: ${i === ctx.capas.length - 1 ? 'semiespacio' : 'h=' + c.h + ' m'} Vp=${c.vp} Vs=${c.vs} rho=${c.rho} Q=${c.q}`);
    const lineas = [
      'DATOS SINTETICOS - SIMULADOR DE PROSPECCION SISMICA (Simulaciones_Geofisica)',
      `Estudio: ${info.estudio}   Fecha de generacion: ${new Date().toISOString().slice(0, 19)}`,
      `Fuente: ${info.fuente}   Apilamiento vertical: ${P.stacks}`,
      `Geofonos: f0=${P.f0} Hz  zeta=${P.zeta}   Canales: ${P.nch}  dx=${P.dx} m`,
      `Muestreo: dt=${P.dtms} ms  ns=${ns}  Registro=${P.trec} ms  Pre-disparo=${P.pretrig} ms`,
      `Disparos: ${disparos.length}   Trazas totales: ${ntr}   Formato: IEEE float32 (5)`,
      'Coordenadas en metros, SCALCO=-100 (bytes 71-72). Linea 2D sobre eje X (Y=0).',
      'Offset (37-40) en metros enteros. Retardo de registro (109-110) en ms.',
      'CDP (21-24) = round(2*xmedio/dx). CDP-X (181-184) escalado con SCALCO.',
      `Semilla aleatoria: ${P.semilla}`,
      'MODELO DE CAPAS (verdad de campo):',
      ...capasTxt
    ];
    u8.set(cabeceraTextual(lineas), 0);

    // Cabecera binaria (400 bytes, desde 3200)
    const B = 3200;
    dv.setInt32(B + 0, 1);                       // job id
    dv.setInt32(B + 4, 1);                       // número de línea
    dv.setInt32(B + 8, 1);                       // número de carrete
    dv.setInt16(B + 12, P.nch);                  // trazas por registro
    dv.setInt16(B + 14, 0);                      // trazas auxiliares
    dv.setInt16(B + 16, dtus);                   // intervalo de muestreo (µs)
    dv.setInt16(B + 18, dtus);
    dv.setUint16(B + 20, ns);                    // muestras por traza
    dv.setUint16(B + 22, ns);
    dv.setInt16(B + 24, 5);                      // formato: IEEE float32
    dv.setInt16(B + 26, 1);                      // fold del ensamble
    dv.setInt16(B + 28, 1);                      // ordenamiento: tal como se registró
    dv.setInt16(B + 54, 1);                      // sistema de medida: metros
    dv.setUint16(B + 300, 0x0100);               // revisión SEG-Y 1.0
    dv.setInt16(B + 302, 1);                     // longitud de traza fija
    dv.setInt16(B + 304, 0);                     // sin cabeceras textuales extendidas

    const ahora = new Date();
    const dia = Math.floor((ahora - new Date(ahora.getFullYear(), 0, 0)) / 864e5);
    let o = 3600, seq = 0;
    for (const d of disparos) {
      for (let i = 0; i < d.trazas.length; i++) {
        const m = d.meta[i];
        seq++;
        const xm = 0.5 * (d.xs + m.xr);
        dv.setInt32(o + 0, seq);                      // nº de secuencia en la línea
        dv.setInt32(o + 4, seq);                      // nº de secuencia en el archivo
        dv.setInt32(o + 8, 1000 + d.id);              // FFID (registro de campo)
        dv.setInt32(o + 12, m.canal);                 // canal
        dv.setInt32(o + 16, d.id);                    // punto de fuente (SP)
        dv.setInt32(o + 20, i32(2 * xm / P.dx));      // CDP
        dv.setInt32(o + 24, 1);
        dv.setInt16(o + 28, m.muerta ? 2 : 1);        // 1 = sísmica, 2 = muerta
        dv.setInt16(o + 30, P.stacks);                // apilamiento vertical
        dv.setInt16(o + 32, 1);
        dv.setInt16(o + 34, 1);                       // producción
        dv.setInt32(o + 36, i32(m.off));              // offset (m)
        dv.setInt16(o + 68, -100);                    // escalar de elevaciones
        dv.setInt16(o + 70, -100);                    // SCALCO
        dv.setInt32(o + 72, i32(d.xs * 100));         // X fuente
        dv.setInt32(o + 80, i32(m.xr * 100));         // X receptor
        dv.setInt16(o + 88, 1);                       // unidades: longitud
        dv.setInt16(o + 108, i16(-P.pretrig));        // retardo de registro (ms)
        dv.setUint16(o + 114, ns);
        dv.setUint16(o + 116, dtus);
        dv.setInt16(o + 118, 1);                      // tipo de ganancia: fija
        if (P.tipoFuente === 'vibro') {
          dv.setInt16(o + 124, 2);                    // correlacionado: sí
          dv.setInt16(o + 126, i16(P.f1));            // frecuencia inicial del barrido
          dv.setInt16(o + 128, i16(P.f2));            // frecuencia final del barrido
        }
        dv.setInt16(o + 140, i16(0.4 / ctx.dt));      // filtro antialias (Hz)
        dv.setInt16(o + 148, i16(P.f0));              // corte bajo = frecuencia natural del geófono
        dv.setInt16(o + 156, ahora.getFullYear());
        dv.setInt16(o + 158, dia);
        dv.setInt16(o + 160, ahora.getHours());
        dv.setInt16(o + 162, ahora.getMinutes());
        dv.setInt16(o + 164, ahora.getSeconds());
        dv.setInt16(o + 166, 2);                      // base de tiempo: GMT/UTC
        dv.setInt32(o + 180, i32(xm * 100));          // CDP X
        dv.setInt32(o + 196, d.id);                   // número de punto de tiro
        o += 240;
        const tr = d.trazas[i];
        for (let n = 0; n < ns; n++) { dv.setFloat32(o, tr[n], false); o += 4; }
      }
    }
    return buf;
  };

  // ---------------- SEG-2 ----------------
  function bloqueCadenas(cadenas) {
    // Cada cadena: uint16 desplazamiento a la siguiente + texto + terminador NUL
    const partes = [];
    let tam = 0;
    for (const c of cadenas) {
      const txt = quitarAcentos(c);
      const n = 2 + txt.length + 1;
      const b = new Uint8Array(n);
      new DataView(b.buffer).setUint16(0, n, true);
      for (let i = 0; i < txt.length; i++) b[2 + i] = txt.charCodeAt(i);
      partes.push(b); tam += n;
    }
    partes.push(new Uint8Array(2)); tam += 2; // fin de lista
    const out = new Uint8Array(tam);
    let o = 0; for (const p of partes) { out.set(p, o); o += p.length; }
    return out;
  }
  const relleno4 = n => (n + 3) & ~3;

  E.seg2 = function (d, ctx, info) {
    const P = ctx.P, ns = ctx.ns, ntr = d.trazas.length;
    const ahora = new Date();
    const meses = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const fecha = `${String(ahora.getDate()).padStart(2, '0')}/${meses[ahora.getMonth()]}/${ahora.getFullYear()}`;
    const hora = ahora.toTimeString().slice(0, 8);
    const cadArchivo = bloqueCadenas([
      `ACQUISITION_DATE ${fecha}`,
      `ACQUISITION_TIME ${hora}`,
      `CLIENT Simulaciones_Geofisica`,
      `COMPANY Datos sinteticos`,
      `INSTRUMENT Simulador sismico HTML`,
      `JOB_ID ${info.estudio}`,
      `OBSERVER Simulador`,
      `TRACE_SORT AS_ACQUIRED`,
      `UNITS METERS`,
      `NOTE Fuente: ${info.fuente}; stacks=${P.stacks}; geofono f0=${P.f0} Hz; semilla=${P.semilla}`
    ]);
    const M = relleno4(4 * ntr);
    const tamDesc = relleno4(32 + M + cadArchivo.length);
    const descTraza = [];
    for (let i = 0; i < ntr; i++) {
      const m = d.meta[i];
      const cad = bloqueCadenas([
        `CHANNEL_NUMBER ${m.canal}`,
        `DELAY ${(-P.pretrig / 1000).toFixed(6)}`,
        `DESCALING_FACTOR 1`,
        `LINE_ID 1`,
        `RAW_RECORD ${1000 + d.id}`,
        `RECEIVER_LOCATION ${m.xr.toFixed(3)} 0 0`,
        `SAMPLE_INTERVAL ${ctx.dt.toFixed(7)}`,
        `SHOT_SEQUENCE_NUMBER ${d.id}`,
        `SOURCE_LOCATION ${d.xs.toFixed(3)} 0 0`,
        `STACK ${P.stacks}`,
        `RECEIVER GEOPHONE ${P.f0} Hz`
      ]);
      descTraza.push(cad);
    }
    let total = tamDesc;
    const tamBloques = descTraza.map(c => relleno4(32 + c.length));
    for (let i = 0; i < ntr; i++) total += tamBloques[i] + 4 * ns;
    const buf = new ArrayBuffer(total);
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    dv.setUint16(0, 0x3a55, true);   // identificador de bloque de archivo
    dv.setUint16(2, 1, true);        // revisión 1
    dv.setUint16(4, M, true);        // tamaño del sub-bloque de punteros
    dv.setUint16(6, ntr, true);      // número de trazas
    u8[8] = 1; u8[9] = 0; u8[10] = 0;       // terminador de cadena: NUL
    u8[11] = 1; u8[12] = 0x0a; u8[13] = 0;  // terminador de línea: LF
    u8.set(cadArchivo, 32 + M);
    let o = tamDesc;
    for (let i = 0; i < ntr; i++) {
      dv.setUint32(32 + 4 * i, o, true);
      dv.setUint16(o, 0x4422, true);           // identificador de bloque de traza
      dv.setUint16(o + 2, tamBloques[i], true);
      dv.setUint32(o + 4, 4 * ns, true);
      dv.setUint32(o + 8, ns, true);
      u8[o + 12] = 4;                          // float32 IEEE
      u8.set(descTraza[i], o + 32);
      o += tamBloques[i];
      const tr = d.trazas[i];
      for (let n = 0; n < ns; n++) { dv.setFloat32(o, tr[n], true); o += 4; }
    }
    return buf;
  };

  // ---------------- ZIP (método 0: almacenado) ----------------
  const TABLA_CRC = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = TABLA_CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  E.zip = function (archivos) {
    const ahora = new Date();
    const tDos = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
    const fDos = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
    const partes = [], central = [];
    let off = 0;
    for (const a of archivos) {
      const datos = a.datos instanceof Uint8Array ? a.datos : new Uint8Array(a.datos);
      const nombre = new TextEncoder().encode(a.nombre);
      const crc = crc32(datos);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, tDos, true); lh.setUint16(12, fDos, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, datos.length, true); lh.setUint32(22, datos.length, true);
      lh.setUint16(26, nombre.length, true); lh.setUint16(28, 0, true);
      partes.push(new Uint8Array(lh.buffer), nombre, datos);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0, true); ch.setUint16(10, 0, true); ch.setUint16(12, tDos, true); ch.setUint16(14, fDos, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, datos.length, true); ch.setUint32(24, datos.length, true);
      ch.setUint16(28, nombre.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), nombre);
      off += 30 + nombre.length + datos.length;
    }
    const tamC = central.reduce((s, p) => s + p.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tamC, true); fin.setUint32(16, off, true);
    return new Blob([...partes, ...central, new Uint8Array(fin.buffer)], { type: 'application/zip' });
  };

  // ---------------- CSV ----------------
  E.csvTrazas = function (d, ctx) {
    const filas = [];
    filas.push('# Disparo ' + d.id + '; x_fuente=' + d.xs + ' m; dt=' + ctx.P.dtms + ' ms; columnas = trazas (x receptor en m)');
    filas.push(['t_ms', ...d.meta.map(m => 'x' + m.xr.toFixed(2))].join(','));
    for (let n = 0; n < ctx.ns; n++) {
      const fila = [((ctx.t0 + n * ctx.dt) * 1000).toFixed(4)];
      for (let i = 0; i < d.trazas.length; i++) fila.push(d.trazas[i][n].toExponential(6));
      filas.push(fila.join(','));
    }
    return filas.join('\n');
  };

  E.csvGeometria = function (ctx) {
    const filas = ['disparo,ffid,x_fuente_m,canal,x_receptor_m,offset_m,cdp_x_m'];
    for (const d of ctx.disparos) {
      d.rx.forEach((xr, i) => filas.push([d.id, 1000 + d.id, d.x.toFixed(3), i + 1, xr.toFixed(3), (xr - d.x).toFixed(3), (0.5 * (xr + d.x)).toFixed(3)].join(',')));
    }
    return filas.join('\n');
  };

  /** picks: Map(iDisparo → Float64Array en s), teoricos: Map(iDisparo → meta[]) */
  E.csvPicks = function (ctx, picks, metas) {
    const filas = ['disparo,x_fuente_m,canal,x_receptor_m,offset_m,t_pick_ms,t_verdadero_ms,tipo_onda'];
    ctx.disparos.forEach((d, s) => {
      const pk = picks.get(s), mt = metas.get(s);
      if (!pk) return;
      d.rx.forEach((xr, i) => {
        if (!isFinite(pk[i])) return;
        const m = mt ? mt[i] : null;
        filas.push([d.id, d.x.toFixed(3), i + 1, xr.toFixed(3), (xr - d.x).toFixed(3), (pk[i] * 1000).toFixed(3),
          m ? (m.tPrimer * 1000).toFixed(3) : '', m ? (m.tipoPrimer === 'directa' ? 'directa' : 'refractada_capa' + (m.idxPrimer + 1)) : ''].join(','));
      });
    });
    return filas.join('\n');
  };

  E.descargar = function (contenido, nombre, tipo) {
    const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  global.Exportar = E;
})(typeof window !== 'undefined' ? window : globalThis);
