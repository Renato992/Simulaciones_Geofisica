/* =====================================================================
 * fisica.js — Motor físico del simulador de prospección sísmica
 * ---------------------------------------------------------------------
 * Modelo: capas horizontales, isótropas y homogéneas sobre un semiespacio.
 * Cada traza se sintetiza en el dominio de la frecuencia:
 *
 *   U(f) = J(f) · [ Σ_e  A_e · W(f) · e^{-i2πf·t_e} · e^{-πf·t*_e} · e^{i2f·t*_e·ln(f/fr)}  (ondas de cuerpo, Q causal)
 *                  + A_gr · W_gr(f) · e^{-i2πf·x/c(f)} · e^{-πf·x/(c·Qs)} (ground roll)
 *                  + A_a · W_a(f) · e^{-i2πf·x/343} ]                    (onda aérea)
 *          + N(f)                                                       (ruido sísmico)
 *   u(t) = IFFT{ H_geófono(f) · H_antialias(f) · U(f) }
 *
 * - Los tiempos de viaje (cinemática) son exactos para el modelo de capas
 *   (ley de Snell / principio de Fermat).
 * - Las amplitudes son aproximadas (divergencia esférica, coeficientes de
 *   reflexión acústicos dependientes del ángulo, pérdidas por transmisión,
 *   atenuación anelástica Q) — suficientes para el aprendizaje.
 * - La dispersión de ondas Rayleigh (modo fundamental) se aproxima con un
 *   promedio ponderado en profundidad de la lentitud de Rayleigh de cada capa.
 *
 * Convención FFT: X_k = Σ x_n e^{-2πi kn/N}; un retardo τ ⇒ X_k·e^{-2πi f_k τ}.
 * Unidades internas: metros, segundos, m/s, g/cm³.
 * ===================================================================== */
(function (global) {
  'use strict';
  const S = {};
  const DOS_PI = 2 * Math.PI;
  S.V_AIRE = 343;

  // ------------------------------------------------------------------
  // Utilidades numéricas
  // ------------------------------------------------------------------

  /** Generador pseudoaleatorio reproducible (mulberry32) + gaussiana. */
  S.rng = function (semilla) {
    let a = semilla >>> 0;
    const u = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let reserva = null;
    u.gauss = function () {
      if (reserva !== null) { const r = reserva; reserva = null; return r; }
      let x, y, r;
      do { x = 2 * u() - 1; y = 2 * u() - 1; r = x * x + y * y; } while (r >= 1 || r === 0);
      const m = Math.sqrt(-2 * Math.log(r) / r);
      reserva = y * m;
      return x * m;
    };
    return u;
  };

  /** Hash FNV-1a de una lista de enteros (para semillas derivadas). */
  S.hash = function () {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < arguments.length; i++) {
      let v = Math.round(arguments[i]) | 0;
      for (let b = 0; b < 4; b++) {
        h ^= v & 0xff;
        h = Math.imul(h, 16777619) >>> 0;
        v >>= 8;
      }
    }
    return h >>> 0;
  };

  S.siguientePot2 = function (n) { let p = 1; while (p < n) p <<= 1; return p; };

  const tablasFFT = new Map();
  function tablaFFT(n) {
    let t = tablasFFT.get(n);
    if (!t) {
      const c = new Float64Array(n / 2), s = new Float64Array(n / 2), rev = new Uint32Array(n);
      for (let k = 0; k < n / 2; k++) { c[k] = Math.cos(DOS_PI * k / n); s[k] = Math.sin(DOS_PI * k / n); }
      const bits = Math.round(Math.log2(n));
      for (let i = 0; i < n; i++) {
        let r = 0, x = i;
        for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
        rev[i] = r;
      }
      t = { c, s, rev };
      tablasFFT.set(n, t);
    }
    return t;
  }

  /** FFT compleja radix-2 en el sitio. inversa=true aplica 1/N. */
  S.fft = function (re, im, inversa) {
    const n = re.length;
    const { c, s, rev } = tablaFFT(n);
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sg = inversa ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const mitad = len >> 1, paso = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < mitad; k++) {
          const wr = c[k * paso], wi = sg * s[k * paso];
          const a = i + k, b = a + mitad;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
    if (inversa) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  };

  // ------------------------------------------------------------------
  // Modelo de capas
  // ------------------------------------------------------------------

  /** Profundidad del techo de cada capa. */
  S.profundidades = function (capas) {
    const z = [0];
    for (let i = 0; i < capas.length - 1; i++) z.push(z[i] + capas[i].h);
    return z;
  };

  /** Razón cR/Vs según Viktorov a partir del coeficiente de Poisson. */
  function razonRayleigh(vp, vs) {
    const r2 = (vp * vp) / (vs * vs);
    let nu = (r2 - 2) / (2 * (r2 - 1));
    if (!isFinite(nu)) nu = 0.25;
    nu = Math.min(0.499, Math.max(0, nu));
    return (0.862 + 1.14 * nu) / (1 + nu);
  }

  /**
   * Velocidad de fase aproximada de Rayleigh (modo fundamental) a la frecuencia f.
   * c(f) = 1 / <1/cR(z)>_w, con w(z) = e^{-z/L}, L = λ/4, iterando c ↔ λ = c/f.
   */
  S.velocidadRayleigh = function (capas, f) {
    const cr = capas.map(c => Math.max(30, c.vs) * razonRayleigh(c.vp, Math.max(30, c.vs)));
    const z = S.profundidades(capas);
    f = Math.max(f, 0.05);
    let c = cr[0];
    for (let it = 0; it < 80; it++) {
      const L = c / f / 4;
      let num = 0, den = 0;
      for (let j = 0; j < capas.length; j++) {
        const a = z[j];
        const ea = Math.exp(-a / L);
        const eb = j === capas.length - 1 ? 0 : Math.exp(-(a + capas[j].h) / L);
        const w = ea - eb;
        num += w / cr[j];
        den += w;
      }
      const cn = num > 0 ? den / num : c;
      const nuevo = 0.5 * (c + cn);
      if (Math.abs(nuevo - c) < 1e-4) { c = nuevo; break; }
      c = nuevo;
    }
    return c;
  };

  /** Onda directa. */
  S.ondaDirecta = function (capas, x) {
    const v = capas[0].vp;
    const t = x / v;
    return { t, tstar: t / capas[0].q };
  };

  /**
   * Onda refractada críticamente (onda cónica) en el techo de la capa n (n ≥ 1).
   * t = x/Vn + Σ_{j<n} 2 h_j √(1/Vj² − 1/Vn²) ; existe sólo si Vn > Vj ∀ j<n y x ≥ x_crit.
   */
  S.ondaRefractada = function (capas, n, x) {
    const vn = capas[n].vp;
    let ti = 0, xc = 0, tstarCapas = 0;
    for (let j = 0; j < n; j++) {
      const vj = capas[j].vp;
      if (vj >= vn) return null; // inversión de velocidad: no hay refracción crítica
      const s = vj / vn;
      const cos = Math.sqrt(1 - s * s);
      ti += 2 * capas[j].h * Math.sqrt(1 / (vj * vj) - 1 / (vn * vn));
      xc += 2 * capas[j].h * s / cos;
      tstarCapas += 2 * capas[j].h / (vj * cos) / capas[j].q;
    }
    const res = { ti, xc, existe: x >= xc };
    if (x >= xc) {
      res.t = x / vn + ti;
      res.tstar = tstarCapas + (x - xc) / vn / capas[n].q;
    }
    return res;
  };

  /**
   * Trazado de rayo de la reflexión en la base de la capa i (interfaz i | i+1).
   * m = 1 primaria, m = 2 múltiple de superficie de primer orden.
   * Resuelve X(p) = 2m Σ h_j p v_j / √(1 − p² v_j²) = x por bisección.
   */
  S.trazarReflexion = function (capas, i, x, m) {
    m = m || 1;
    x = Math.abs(x);
    let vmax = 0;
    for (let j = 0; j <= i; j++) vmax = Math.max(vmax, capas[j].vp);
    const X = function (p) {
      let s = 0;
      for (let j = 0; j <= i; j++) {
        const pv = p * capas[j].vp;
        s += capas[j].h * pv / Math.sqrt(1 - pv * pv);
      }
      return 2 * m * s;
    };
    let p = 0;
    if (x > 1e-9) {
      let lo = 0, hi = (1 - 1e-12) / vmax;
      for (let it = 0; it < 90; it++) {
        const mid = 0.5 * (lo + hi);
        if (X(mid) < x) lo = mid; else hi = mid;
      }
      p = 0.5 * (lo + hi);
    }
    let t = 0, tstar = 0, sv2 = 0;
    for (let j = 0; j <= i; j++) {
      const v = capas[j].vp;
      const cos = Math.sqrt(1 - p * p * v * v);
      const dt = 2 * m * capas[j].h / (v * cos);
      t += dt;
      tstar += dt / capas[j].q;
      sv2 += v * v * dt;
    }
    return { p, t, tstar, vrms: Math.sqrt(sv2 / t) };
  };

  /** Coeficiente de reflexión acústico (onda P) dependiente del ángulo. */
  function coefReflexion(c1, c2, p) {
    const z1 = c1.rho * c1.vp, z2 = c2.rho * c2.vp;
    const cos1 = Math.sqrt(Math.max(0, 1 - p * p * c1.vp * c1.vp));
    const s2 = 1 - p * p * c2.vp * c2.vp;
    if (s2 <= 0) return { R: 1, postcritica: true }; // reflexión total
    const cos2 = Math.sqrt(s2);
    return { R: (z2 * cos1 - z1 * cos2) / (z2 * cos1 + z1 * cos2), postcritica: false };
  }
  function coefNormal(c1, c2) {
    const z1 = c1.rho * c1.vp, z2 = c2.rho * c2.vp;
    return (z2 - z1) / (z2 + z1);
  }

  /**
   * Lista de eventos de onda de cuerpo para un offset x (≥ 0).
   * Devuelve [{tipo, idx, t, tstar, amp}]. Amplitudes relativas a la onda
   * directa a 1 m de la fuente (= 1).
   */
  S.eventos = function (capas, x, op) {
    const ev = [];
    const xx = Math.max(x, 0.5);
    const fp = op.fp || 50;
    if (op.directa) {
      const d = S.ondaDirecta(capas, x);
      ev.push({ tipo: 'directa', idx: 0, t: d.t, tstar: d.tstar, amp: 1 / xx });
    }
    if (op.refractadas) {
      for (let n = 1; n < capas.length; n++) {
        const r = S.ondaRefractada(capas, n, x);
        if (!r || !r.existe) continue;
        const lam = capas[n].vp / fp;
        const L = x - r.xc;
        // Decaimiento ~ x^{-1/2} L^{-3/2} de la onda cónica (regularizado en x_crit)
        const amp = 1.6 * lam / (Math.sqrt(xx) * Math.pow(L + lam, 1.5));
        ev.push({ tipo: 'refractada', idx: n, t: r.t, tstar: r.tstar, amp });
      }
    }
    if (op.reflexiones || op.multiples) {
      for (let i = 0; i < capas.length - 1; i++) {
        let T = 1;
        for (let j = 0; j < i; j++) { const r0 = coefNormal(capas[j], capas[j + 1]); T *= 1 - r0 * r0; }
        if (op.reflexiones) {
          const ray = S.trazarReflexion(capas, i, x, 1);
          const R = coefReflexion(capas[i], capas[i + 1], ray.p).R;
          ev.push({ tipo: 'reflexion', idx: i, t: ray.t, tstar: ray.tstar, amp: R * T / (ray.t * ray.vrms) });
        }
        if (op.multiples) {
          const ray = S.trazarReflexion(capas, i, x, 2);
          const R = coefReflexion(capas[i], capas[i + 1], ray.p).R;
          // superficie libre: R = −1
          ev.push({ tipo: 'multiple', idx: i, t: ray.t, tstar: ray.tstar, amp: -R * R * T * T / (ray.t * ray.vrms) });
        }
      }
    }
    return ev;
  };

  /** Primer arribo teórico (directa o refractada) para offset x. */
  S.primerArribo = function (capas, x) {
    let mejor = { t: x / capas[0].vp, tipo: 'directa', idx: 0 };
    for (let n = 1; n < capas.length; n++) {
      const r = S.ondaRefractada(capas, n, x);
      if (r && r.existe && r.t < mejor.t) mejor = { t: r.t, tipo: 'refractada', idx: n };
    }
    return mejor;
  };

  // ------------------------------------------------------------------
  // Ondículas, respuesta del geófono, filtros
  // ------------------------------------------------------------------

  /** Amplitud espectral de la fuente en f (sin normalizar). */
  function amplitudFuente(f, fu) {
    if (fu.forma === 'klauder') {
      // Barrido vibroseis correlacionado: espectro ≈ caja f1–f2 con rampas coseno
      const f1 = fu.f1, f2 = fu.f2, rampa = Math.max(1, 0.15 * (f2 - f1));
      if (f < f1 - rampa || f > f2 + rampa) return 0;
      if (f < f1) return 0.5 * (1 + Math.cos(Math.PI * (f1 - f) / rampa));
      if (f > f2) return 0.5 * (1 + Math.cos(Math.PI * (f - f2) / rampa));
      return 1;
    }
    const r = f / fu.fp; // Ricker
    return r * r * Math.exp(-r * r);
  }

  /**
   * Espectro complejo de la ondícula (longitud N, hermítico), normalizado a
   * pico temporal unitario. fase = 'cero' | 'min' (fase mínima por cepstrum).
   * Devuelve también la ondícula en el tiempo (para graficar).
   */
  S.espectroOndicula = function (fu, nfft, dt, fase) {
    const N = nfft, df = 1 / (N * dt);
    const A = new Float64Array(N);
    let amax = 0;
    for (let k = 0; k <= N / 2; k++) {
      const a = amplitudFuente(k * df, fu);
      A[k] = a; if (k > 0) A[N - k] = a;
      amax = Math.max(amax, a);
    }
    let re = new Float64Array(N), im = new Float64Array(N);
    if (fase === 'min') {
      const eps = 1e-5 * amax;
      for (let k = 0; k < N; k++) re[k] = Math.log(Math.max(A[k], eps));
      S.fft(re, im, true); // cepstrum real
      im.fill(0);
      for (let n = 1; n < N / 2; n++) re[n] *= 2;
      for (let n = N / 2 + 1; n < N; n++) re[n] = 0;
      S.fft(re, im, false);
      for (let k = 0; k < N; k++) {
        const m = Math.exp(re[k]);
        const ph = im[k];
        re[k] = m * Math.cos(ph); im[k] = m * Math.sin(ph);
      }
      // Anular la contribución del piso numérico fuera de banda
      for (let k = 0; k < N; k++) if (A[k] <= eps) { re[k] = 0; im[k] = 0; }
    } else {
      for (let k = 0; k < N; k++) re[k] = A[k];
    }
    // Normalización a pico 1 en el tiempo
    const tr = Float64Array.from(re), ti = Float64Array.from(im);
    S.fft(tr, ti, true);
    let pico = 0;
    for (let n = 0; n < N; n++) pico = Math.max(pico, Math.abs(tr[n]));
    if (pico > 0) for (let k = 0; k < N; k++) { re[k] /= pico; im[k] /= pico; }
    return { re, im, tiempo: tr.map(v => v / (pico || 1)) };
  };

  /** Respuesta (velocidad) de un geófono de frecuencia natural f0 y amortiguamiento ζ. */
  S.respuestaGeofono = function (f, f0, zeta) {
    const w = DOS_PI * f, w0 = DOS_PI * f0;
    // H = ω² / (ω² − ω0² − 2iζω0ω)  → 1 en alta frecuencia
    const dr = w * w - w0 * w0, di = -2 * zeta * w0 * w;
    const den = dr * dr + di * di;
    if (den === 0) return { re: 0, im: 0 };
    const nr = w * w;
    return { re: nr * dr / den, im: -nr * di / den };
  };

  // ------------------------------------------------------------------
  // Geometría de adquisición
  // ------------------------------------------------------------------

  /** Devuelve la lista de disparos [{id, x, rx:[...]}]. */
  S.geometria = function (P) {
    const disparos = [];
    const nch = Math.max(1, Math.round(P.nch));
    const dx = P.dx;
    if (P.tendido === 'rodante') {
      const ns = Math.max(1, Math.round(P.nDisparos));
      for (let s = 0; s < ns; s++) {
        const xs = P.xDisparo0 + s * P.dxDisparo;
        const rx = [];
        if (P.configuracion === 'split') {
          const izq = Math.floor(nch / 2), der = nch - izq;
          for (let i = 0; i < izq; i++) rx.push(xs - P.offMin - (izq - 1 - i) * dx);
          for (let i = 0; i < der; i++) rx.push(xs + P.offMin + i * dx);
        } else {
          for (let i = 0; i < nch; i++) rx.push(xs + P.offMin + i * dx);
        }
        disparos.push({ x: xs, rx });
      }
    } else {
      const rx = [];
      for (let i = 0; i < nch; i++) rx.push(P.x1 + i * dx);
      const xN = rx[rx.length - 1];
      let xs = [];
      if (P.disparos === 'lista') {
        xs = String(P.listaDisparos).split(/[;,\s]+/).map(Number).filter(v => isFinite(v) && String(v) !== '');
        if (!xs.length) xs = [P.x1 - dx / 2];
      } else {
        if (P.offExt > 0) xs.push(P.x1 - P.offExt);
        xs.push(P.x1 - dx / 2);
        const nInt = Math.max(0, Math.round(P.nInternos));
        for (let k = 1; k <= nInt; k++) {
          const g = Math.round(k * nch / (nInt + 1));
          xs.push(P.x1 + (g - 0.5) * dx);
        }
        xs.push(xN + dx / 2);
        if (P.offExt > 0) xs.push(xN + P.offExt);
      }
      xs.forEach(x => disparos.push({ x, rx: rx.slice() }));
    }
    disparos.forEach((d, i) => { d.id = i + 1; });
    return disparos;
  };

  // ------------------------------------------------------------------
  // Estáticas (capa meteorizada irregular) — función suave y aleatoria de x
  // ------------------------------------------------------------------
  S.crearEstaticas = function (semilla, sigma) {
    if (!(sigma > 0)) return () => 0;
    const r = S.rng(S.hash(semilla, 7771));
    const comps = [];
    for (let i = 0; i < 6; i++) comps.push({ k: DOS_PI / (15 + 135 * r()), fase: DOS_PI * r(), a: 0.5 + r() });
    const norm = Math.sqrt(comps.reduce((s, c) => s + c.a * c.a / 2, 0));
    return function (x) {
      let s = 0;
      for (const c of comps) s += c.a * Math.sin(c.k * x + c.fase);
      const local = S.rng(S.hash(semilla, Math.round(x * 10), 31)).gauss();
      return sigma * (0.9 * s / norm + 0.3 * local);
    };
  };

  // ------------------------------------------------------------------
  // Fuentes predefinidas
  // ------------------------------------------------------------------
  S.FUENTES = {
    martillo:  { nombre: 'Martillo (mandarria) sobre placa', fuerza: 1 },
    peso:      { nombre: 'Caída de peso (PEG / acelerado)', fuerza: 4 },
    escopeta:  { nombre: 'Escopeta sísmica (Betsy / cartucho)', fuerza: 3 },
    explosivo: { nombre: 'Explosivo en pozo', fuerza: 30 },
    vibro:     { nombre: 'Vibrador (vibroseis, barrido correlacionado)', fuerza: 15 }
  };

  // ------------------------------------------------------------------
  // Preparación del contexto de simulación (una vez por cambio de parámetros)
  // ------------------------------------------------------------------
  S.preparar = function (P, capas) {
    const dt = P.dtms / 1000;
    const t0 = -P.pretrig / 1000;
    const ns = Math.round((P.trec + P.pretrig) / P.dtms) + 1;
    const disparos = S.geometria(P);
    let maxOff = 0;
    disparos.forEach(d => d.rx.forEach(x => { maxOff = Math.max(maxOff, Math.abs(x - d.x)); }));

    const avisos = [];
    // Duración necesaria del buffer FFT (evita el "wrap-around" circular)
    let tNec = ns * dt * 1.25 + 0.25;
    let cminGR = Infinity;
    const fNyq = 0.5 / dt;
    const fmaxGR = Math.min(fNyq, 6 * P.fgr);
    if (P.evGroundRoll) {
      for (let f = 1; f <= fmaxGR; f += Math.max(0.5, fmaxGR / 60)) cminGR = Math.min(cminGR, S.velocidadRayleigh(capas, f));
      tNec = Math.max(tNec, maxOff / (0.6 * cminGR) + 0.3);
    }
    let nfft = S.siguientePot2(Math.ceil(tNec / dt));
    if (nfft > 65536) { nfft = 65536; avisos.push('El buffer FFT se limitó a 65536 muestras: el ground roll muy lento podría aparecer "envuelto" al inicio del registro.'); }
    const N = nfft, mitad = N / 2, df = 1 / (N * dt);

    const tipoF = S.FUENTES[P.tipoFuente] || S.FUENTES.martillo;
    const fu = P.tipoFuente === 'vibro' ? { forma: 'klauder', f1: P.f1, f2: P.f2 } : { forma: 'ricker', fp: P.fp };
    const fpEf = P.tipoFuente === 'vibro' ? 0.5 * (P.f1 + P.f2) : P.fp;
    const W = S.espectroOndicula(fu, N, dt, P.fase);
    const Wgr = S.espectroOndicula({ forma: 'ricker', fp: P.fgr }, N, dt, P.fase);
    const Wair = S.espectroOndicula({ forma: 'ricker', fp: Math.max(60, 1.6 * fpEf) }, N, dt, 'cero');

    // Respuesta instrumental: geófono × antialias (Butterworth 8 polos, 0.8·fNyq)
    const Hr = new Float64Array(mitad + 1), Hi = new Float64Array(mitad + 1);
    const fc = 0.8 * fNyq;
    for (let k = 0; k <= mitad; k++) {
      const f = k * df;
      const g = S.respuestaGeofono(f, P.f0, P.zeta);
      const aa = 1 / Math.sqrt(1 + Math.pow(f / fc, 16));
      Hr[k] = g.re * aa; Hi[k] = g.im * aa;
    }

    // Dispersión de Rayleigh por bin de frecuencia
    const kgr = Math.min(mitad, Math.ceil(fmaxGR / df));
    const cR = new Float64Array(kgr + 1);
    if (P.evGroundRoll) {
      // Se evalúa en una malla gruesa y se interpola (rápido)
      const nMalla = 200, fM = [], cM = [];
      for (let i = 0; i <= nMalla; i++) { const f = 0.2 + (fmaxGR - 0.2) * i / nMalla; fM.push(f); cM.push(S.velocidadRayleigh(capas, f)); }
      for (let k = 0; k <= kgr; k++) {
        const f = Math.max(0.2, k * df);
        const u = Math.min(nMalla, Math.max(0, (f - 0.2) / (fmaxGR - 0.2) * nMalla));
        const i0 = Math.min(nMalla - 1, Math.floor(u)), w = u - i0;
        cR[k] = cM[i0] * (1 - w) + cM[i0 + 1] * w;
      }
    }

    // Forma espectral del ruido ambiental (banda 2–150 Hz), normalizada a RMS 1
    const formaRuido = new Float64Array(mitad + 1);
    let e2 = 0;
    for (let k = 0; k <= mitad; k++) {
      const f = k * df;
      const lo = Math.pow(f / 2, 2) / (1 + Math.pow(f / 2, 2));
      const hi = 1 / (1 + Math.pow(f / 150, 4));
      formaRuido[k] = lo * hi;
      e2 += (k === 0 || k === mitad ? 1 : 2) * formaRuido[k] * formaRuido[k];
    }
    const nr = Math.sqrt(e2 / N) || 1;
    for (let k = 0; k <= mitad; k++) formaRuido[k] /= nr;

    // Término de dispersión de la Q causal: ψ(f) = 2 f ln(f/fr) · t*, con fr = frecuencia dominante
    // (las velocidades del modelo se interpretan como velocidades a fr).
    const gQ = new Float64Array(mitad + 1);
    for (let k = 1; k <= mitad; k++) { const f = k * df; gQ[k] = 2 * f * Math.log(f / fpEf); }

    const ctx = {
      P, capas, dt, t0, ns, N, df, disparos, maxOff, avisos, gQ,
      W, Wgr, Wair, Hr, Hi, cR, kgr, formaRuido,
      fuerza: tipoF.fuerza, fpEf,
      estatica: S.crearEstaticas(P.semilla, P.estaticas / 1000),
      opEventos: {
        directa: P.evDirecta, refractadas: P.evRefractadas, reflexiones: P.evReflexiones,
        multiples: P.evMultiples, fp: fpEf
      },
      qs: Math.max(5, 0.5 * capas[0].q)
    };
    return ctx;
  };

  // ------------------------------------------------------------------
  // Síntesis de un disparo completo
  // ------------------------------------------------------------------
  S.simularDisparo = function (ctx, iDisparo) {
    const { P, capas, N, df, dt, t0, ns, W, Wgr, Wair, Hr, Hi, cR, kgr, formaRuido, gQ } = ctx;
    const d = ctx.disparos[iDisparo];
    const mitad = N / 2;
    const nst = Math.max(1, Math.round(P.stacks));
    const rngD = S.rng(S.hash(P.semilla, iDisparo, 101));
    const fuerza = ctx.fuerza;

    // Jitter del disparador: promedio de e^{-iωτ_k} sobre los golpes apilados
    const sigJ = P.jitter / 1000;
    const Jr = new Float64Array(mitad + 1).fill(1), Ji = new Float64Array(mitad + 1);
    let jitterMedio = 0;
    if (sigJ > 0) {
      Jr.fill(0);
      for (let s = 0; s < nst; s++) {
        const tau = sigJ * rngD.gauss();
        jitterMedio += tau / nst;
        const rr = Math.cos(-DOS_PI * df * tau), ri = Math.sin(-DOS_PI * df * tau);
        let cr = 1, ci = 0;
        for (let k = 0; k <= mitad; k++) {
          Jr[k] += cr / nst; Ji[k] += ci / nst;
          const t = cr * rr - ci * ri; ci = cr * ri + ci * rr; cr = t;
        }
      }
    }

    const sigRuido = (P.ruidoAmb / 100) * 0.01 / Math.sqrt(nst);
    const re = new Float64Array(N), im = new Float64Array(N);
    const sr = new Float64Array(mitad + 1), si = new Float64Array(mitad + 1);
    const trazas = [], meta = [];
    const stS = ctx.estatica(d.x);
    const tLim = (N * dt) * 0.92;

    for (let it = 0; it < d.rx.length; it++) {
      const xr = d.rx[it];
      const off = Math.abs(xr - d.x);
      const xx = Math.max(off, 0.5);
      const st = stS + ctx.estatica(xr);
      sr.fill(0); si.fill(0);

      // --- Ondas de cuerpo ---
      const evs = S.eventos(capas, off, ctx.opEventos);
      for (const e of evs) {
        const tau = e.t + st - t0;
        if (tau > tLim) continue;
        const a0 = e.amp * fuerza;
        const rr = Math.cos(-DOS_PI * df * tau), ri = Math.sin(-DOS_PI * df * tau);
        const at = Math.exp(-Math.PI * df * e.tstar);
        let cr = 1, ci = 0, a = a0;
        for (let k = 0; k <= mitad; k++) {
          // Q constante causal (Kolsky–Futterman): fase extra t*·2f·ln(f/fr)
          const psi = e.tstar * gQ[k];
          const qr = Math.cos(psi), qi = Math.sin(psi);
          const pr = cr * qr - ci * qi, pi = cr * qi + ci * qr;
          const wr = W.re[k], wi = W.im[k];
          sr[k] += a * (wr * pr - wi * pi);
          si[k] += a * (wr * pi + wi * pr);
          const t = cr * rr - ci * ri; ci = cr * ri + ci * rr; cr = t;
          a *= at;
          if (a < 1e-12 * Math.abs(a0)) break;
        }
      }

      // --- Ground roll (Rayleigh dispersivo) ---
      if (P.evGroundRoll && P.ampGR > 0) {
        const a0 = P.ampGR * fuerza / Math.sqrt(xx);
        for (let k = 1; k <= kgr; k++) {
          const f = k * df, c = cR[k];
          const tau = off / c + st - t0;
          const ph = -DOS_PI * f * tau;
          const a = a0 * Math.exp(-Math.PI * f * off / (c * ctx.qs));
          const cr = Math.cos(ph), ci = Math.sin(ph);
          const wr = Wgr.re[k], wi = Wgr.im[k];
          sr[k] += a * (wr * cr - wi * ci);
          si[k] += a * (wr * ci + wi * cr);
        }
      }

      // --- Onda aérea ---
      if (P.evAerea && P.ampAerea > 0) {
        const tau = off / S.V_AIRE - t0;
        if (tau < tLim) {
          const a0 = 0.05 * P.ampAerea * fuerza / xx;
          const rr = Math.cos(-DOS_PI * df * tau), ri = Math.sin(-DOS_PI * df * tau);
          let cr = 1, ci = 0;
          for (let k = 0; k <= mitad; k++) {
            const wr = Wair.re[k], wi = Wair.im[k];
            sr[k] += a0 * (wr * cr - wi * ci);
            si[k] += a0 * (wr * ci + wi * cr);
            const t = cr * rr - ci * ri; ci = cr * ri + ci * rr; cr = t;
          }
        }
      }

      // --- Jitter del disparador + ruido ambiental + respuesta instrumental ---
      const rngT = S.rng(S.hash(P.semilla, iDisparo, it, 202));
      const escR = sigRuido * Math.sqrt(N / 2);
      for (let k = 0; k <= mitad; k++) {
        let a = sr[k] * Jr[k] - si[k] * Ji[k];
        let b = sr[k] * Ji[k] + si[k] * Jr[k];
        if (sigRuido > 0 && k > 0 && k < mitad) {
          a += escR * formaRuido[k] * rngT.gauss();
          b += escR * formaRuido[k] * rngT.gauss();
        }
        re[k] = a * Hr[k] - b * Hi[k];
        im[k] = a * Hi[k] + b * Hr[k];
      }
      im[0] = 0; im[mitad] = 0;
      for (let k = 1; k < mitad; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      S.fft(re, im, true);
      const tr = new Float32Array(ns);
      for (let n = 0; n < ns; n++) tr[n] = re[n];

      // --- Ruido en el dominio del tiempo ---
      // Inducción eléctrica de la red (50/60 Hz + 3er armónico)
      if (P.ruidoRed > 0) {
        const rEst = S.rng(S.hash(P.semilla, Math.round(xr * 100), 303));
        const amp = (P.ruidoRed / 100) * 0.004 * (0.3 + 1.4 * rEst());
        const ph = DOS_PI * rngT();
        for (let n = 0; n < ns; n++) {
          const t = t0 + n * dt;
          tr[n] += amp * (Math.sin(DOS_PI * P.freqRed * t + ph) + 0.2 * Math.sin(3 * DOS_PI * P.freqRed * t + 2 * ph));
        }
      }
      // Picos eléctricos
      if (P.probPicos > 0 && rngT() < P.probPicos / 100) {
        const n0 = Math.floor(rngT() * ns);
        const a = (rngT() < 0.5 ? -1 : 1) * 0.05 * fuerza * (0.5 + rngT());
        tr[n0] += a; if (n0 + 1 < ns) tr[n0 + 1] -= 0.4 * a;
      }

      // Propiedades del punto de estación (estables entre disparos: el geófono está plantado)
      const rEst = S.rng(S.hash(P.semilla, Math.round(xr * 100), 404));
      const muerta = rEst() < P.probMuerta / 100;
      const invertida = !muerta && rEst() < P.probInvertida / 100;
      const acople = Math.exp((P.varAcople / 100) * rEst.gauss());
      if (muerta) {
        for (let n = 0; n < ns; n++) tr[n] = 2e-6 * rngT.gauss();
      } else {
        const g = (invertida ? -1 : 1) * acople;
        for (let n = 0; n < ns; n++) tr[n] *= g;
      }
      trazas.push(tr);
      const pa = S.primerArribo(capas, off);
      meta.push({
        canal: it + 1, xr, off: xr - d.x, estatica: st, muerta, invertida, acople,
        tPrimer: pa.t + st + jitterMedio, tipoPrimer: pa.tipo, idxPrimer: pa.idx
      });
    }

    // Ruido transitorio (cultural: pasos, vehículos, viento) — eventos locales con moveout
    if (P.ruidoTrans > 0) {
      const nEv = Math.round(P.ruidoTrans / 20 + rngD() * P.ruidoTrans / 25);
      const x0 = Math.min(...d.rx), x1 = Math.max(...d.rx);
      for (let e = 0; e < nEv; e++) {
        const xc = x0 + (x1 - x0) * rngD();
        const tc = t0 + (ns * dt) * rngD();
        const f = 8 + 40 * rngD(), v = 150 + 250 * rngD();
        const dur = 0.03 + 0.12 * rngD();
        const amp = (P.ruidoTrans / 100) * 0.01 * (0.3 + rngD()) / Math.sqrt(nst);
        const alcance = 5 + 25 * rngD();
        for (let it = 0; it < d.rx.length; it++) {
          if (meta[it].muerta) continue;
          const dd = Math.abs(d.rx[it] - xc);
          const a = amp * Math.exp(-dd / alcance);
          if (a < amp * 0.02) continue;
          const tt = tc + dd / v;
          const tr = trazas[it];
          const n1 = Math.max(0, Math.floor((tt - 3 * dur - t0) / dt)), n2 = Math.min(ns - 1, Math.ceil((tt + 3 * dur - t0) / dt));
          for (let n = n1; n <= n2; n++) {
            const t = t0 + n * dt - tt;
            tr[n] += a * Math.exp(-(t * t) / (dur * dur)) * Math.sin(DOS_PI * f * t);
          }
        }
      }
    }

    return { iDisparo, id: d.id, xs: d.x, trazas, meta, jitterMedio, dt, t0, ns, stacks: nst };
  };

  /**
   * Picado automático de primeros arribos (dos etapas):
   *  1) Detección: primer índice i donde la razón de energía
   *     ER(i) = Σ_{i..i+L} a² / Σ_{i−L..i} a²  supera un umbral y la energía
   *     posterior supera varias veces el piso de ruido (ventana más tranquila).
   *  2) Refinamiento: máximo de la razón de energía modificada
   *     MER(i) = (ER(i)·|a_i|)³ en un entorno de la detección.
   */
  S.picadoAutomatico = function (traza, dt, t0, fp) {
    const ns = traza.length;
    const L = Math.max(4, Math.round(1.2 / (fp * dt)));
    const cs = new Float64Array(ns + 1);
    for (let i = 0; i < ns; i++) cs[i + 1] = cs[i] + traza[i] * traza[i];
    if (cs[ns] <= 0) return NaN;
    // Piso de ruido: RMS de la ventana más tranquila
    let piso = Infinity;
    for (let i = 0; i + L <= ns; i += Math.max(1, L >> 2)) piso = Math.min(piso, (cs[i + L] - cs[i]) / L);
    let emax = 0;
    for (let i = 0; i + L <= ns; i += Math.max(1, L >> 2)) emax = Math.max(emax, (cs[i + L] - cs[i]) / L);
    const eps = Math.max(piso, emax * 1e-7);
    const iIni = Math.max(L, Math.ceil(-t0 / dt));
    let det = -1;
    for (let i = iIni; i < ns - L; i++) {
      const post = (cs[i + L] - cs[i]) / L, pre = (cs[i] - cs[i - L]) / L;
      if (post > 16 * eps && post / (pre + eps) > 6) { det = i; break; }
    }
    if (det < 0) return NaN;
    let mejor = det, vmax = -1;
    // la ventana posterior detecta la llegada hasta L muestras antes: refinar hacia adelante
    for (let i = det; i <= Math.min(ns - L - 1, det + L); i++) {
      const er = (cs[i + L] - cs[i]) / (cs[i] - cs[i - L] + eps);
      const m = Math.pow(er * Math.abs(traza[i]), 3);
      if (m > vmax) { vmax = m; mejor = i; }
    }
    return t0 + mejor * dt;
  };

  global.Sismica = S;
})(typeof window !== 'undefined' ? window : globalThis);
