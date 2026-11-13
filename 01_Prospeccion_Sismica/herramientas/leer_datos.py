#!/usr/bin/env python3
"""
leer_datos.py — Lector mínimo de SEG-Y (rev1, IEEE float) y SEG-2 exportados
por el simulador sísmico. Sólo requiere NumPy; matplotlib es opcional para graficar.

Uso:
    python leer_datos.py archivo.sgy            # resumen de cabeceras
    python leer_datos.py archivo.sgy --graficar # además muestra el primer disparo
    python leer_datos.py 1001.sg2 --graficar

Como módulo:
    from leer_datos import leer_segy, leer_seg2
    datos, cab = leer_segy("sismica.sgy")   # datos: (ntrazas, nmuestras)
"""
import struct
import sys

import numpy as np

# Tabla EBCDIC (cp037) → ASCII para la cabecera textual
try:
    _EBCDIC = bytes(range(256)).decode("cp037")
except LookupError:  # pragma: no cover
    _EBCDIC = None


def leer_segy(ruta):
    """Lee un SEG-Y rev1 con formato 1 (IBM) o 5 (IEEE). Devuelve (datos, cabeceras)."""
    with open(ruta, "rb") as f:
        b = f.read()
    texto = b[:3200]
    if _EBCDIC:
        texto = "".join(_EBCDIC[c] for c in texto)
    else:
        texto = texto.decode("latin-1")
    lineas = [texto[i:i + 80].rstrip() for i in range(0, 3200, 80)]

    dt_us, = struct.unpack(">h", b[3216:3218])
    ns, = struct.unpack(">H", b[3220:3222])
    formato, = struct.unpack(">h", b[3224:3226])
    if formato not in (1, 5):
        raise ValueError(f"Formato de muestra no soportado: {formato}")
    tam = 240 + 4 * ns
    ntr = (len(b) - 3600) // tam
    datos = np.empty((ntr, ns), dtype=np.float32)
    campos = {k: np.empty(ntr) for k in
              ("ffid", "canal", "sp", "cdp", "offset", "x_fuente", "x_receptor", "cdp_x", "retardo_ms", "codigo", "stack")}
    for i in range(ntr):
        o = 3600 + i * tam
        h = b[o:o + 240]
        scalco, = struct.unpack(">h", h[70:72])
        esc = (1 / -scalco) if scalco < 0 else (scalco if scalco > 0 else 1)
        campos["ffid"][i], campos["canal"][i], campos["sp"][i], campos["cdp"][i] = struct.unpack(">iiii", h[8:24])
        campos["codigo"][i], campos["stack"][i] = struct.unpack(">hh", h[28:32])
        campos["offset"][i], = struct.unpack(">i", h[36:40])
        campos["x_fuente"][i] = struct.unpack(">i", h[72:76])[0] * esc
        campos["x_receptor"][i] = struct.unpack(">i", h[80:84])[0] * esc
        campos["retardo_ms"][i], = struct.unpack(">h", h[108:110])
        campos["cdp_x"][i] = struct.unpack(">i", h[180:184])[0] * esc
        crudo = b[o + 240:o + tam]
        if formato == 5:
            datos[i] = np.frombuffer(crudo, dtype=">f4")
        else:
            datos[i] = _ibm_a_ieee(np.frombuffer(crudo, dtype=">u4"))
    cab = {"texto": lineas, "dt": dt_us * 1e-6, "ns": ns, "formato": formato, "ntrazas": ntr, **campos}
    return datos, cab


def _ibm_a_ieee(u):
    u = u.astype(np.uint32)
    signo = np.where(u >> 31, -1.0, 1.0)
    exp = ((u >> 24) & 0x7F).astype(np.int32) - 64
    mant = (u & 0x00FFFFFF).astype(np.float64) / 2 ** 24
    return (signo * mant * 16.0 ** exp).astype(np.float32)


def leer_seg2(ruta):
    """Lee un SEG-2 (rev1, little-endian, códigos de datos 1, 2 y 4). Devuelve (datos, cabeceras)."""
    with open(ruta, "rb") as f:
        b = f.read()
    ident, rev, m, ntr = struct.unpack("<HHHH", b[:8])
    if ident != 0x3A55:
        raise ValueError("No es un archivo SEG-2 (little-endian)")
    punteros = struct.unpack(f"<{ntr}I", b[32:32 + 4 * ntr])

    def cadenas(o, fin):
        out = {}
        while o < fin:
            n, = struct.unpack("<H", b[o:o + 2])
            if n == 0:
                break
            txt = b[o + 2:o + n].split(b"\x00")[0].decode("latin-1").strip()
            if txt:
                k, _, v = txt.partition(" ")
                out[k] = v.strip()
            o += n
        return out

    cab_archivo = cadenas(32 + m, punteros[0] if ntr else len(b))
    trazas, cabs = [], []
    for p in punteros:
        idb, tam_bloque, tam_datos, ns = struct.unpack("<HHII", b[p:p + 12])
        codigo = b[p + 12]
        tc = cadenas(p + 32, p + tam_bloque)
        tipo = {1: "<i2", 2: "<i4", 4: "<f4", 5: "<f8"}[codigo]
        d = np.frombuffer(b[p + tam_bloque:p + tam_bloque + tam_datos], dtype=tipo).astype(np.float32)
        trazas.append(d[:ns])
        cabs.append(tc)
    datos = np.vstack(trazas)
    dt = float(cabs[0].get("SAMPLE_INTERVAL", "0.001"))
    return datos, {"archivo": cab_archivo, "trazas": cabs, "dt": dt, "ns": datos.shape[1], "ntrazas": ntr}


def graficar(datos, dt, retardo=0.0, titulo="", x=None):
    import matplotlib.pyplot as plt
    ntr, ns = datos.shape
    t = (retardo + np.arange(ns) * dt) * 1000
    norm = datos / (np.abs(datos).max(axis=1, keepdims=True) + 1e-30)
    x = np.arange(ntr) if x is None else np.asarray(x)
    paso = np.median(np.diff(x)) if ntr > 1 else 1.0
    fig, ax = plt.subplots(figsize=(10, 7))
    for i in range(ntr):
        tr = x[i] + 0.6 * paso * norm[i]
        ax.plot(tr, t, "k", lw=0.6)
        ax.fill_betweenx(t, x[i], tr, where=tr > x[i], color="k")
    ax.invert_yaxis()
    ax.set_xlabel("x receptor (m)")
    ax.set_ylabel("Tiempo (ms)")
    ax.set_title(titulo)
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    ruta = sys.argv[1]
    if ruta.lower().endswith((".sg2", ".seg2", ".dat")):
        datos, cab = leer_seg2(ruta)
        print(f"SEG-2: {cab['ntrazas']} trazas × {cab['ns']} muestras, dt = {cab['dt'] * 1000:g} ms")
        for k, v in cab["archivo"].items():
            print(f"  {k}: {v}")
        print("  Traza 1:", cab["trazas"][0])
        if "--graficar" in sys.argv:
            xr = [float(c["RECEIVER_LOCATION"].split()[0]) for c in cab["trazas"]]
            graficar(datos, cab["dt"], float(cab["trazas"][0].get("DELAY", 0)), ruta, xr)
    else:
        datos, cab = leer_segy(ruta)
        print("\n".join(l for l in cab["texto"] if l.strip()[3:].strip()))
        print(f"\nSEG-Y: {cab['ntrazas']} trazas × {cab['ns']} muestras, dt = {cab['dt'] * 1000:g} ms, formato {cab['formato']}")
        ffids = np.unique(cab["ffid"]).astype(int)
        print(f"Registros de campo (FFID): {ffids.min()}–{ffids.max()} ({len(ffids)} disparos)")
        print(f"Offsets: {cab['offset'].min():g} a {cab['offset'].max():g} m")
        if "--graficar" in sys.argv:
            sel = cab["ffid"] == ffids[0]
            graficar(datos[sel], cab["dt"], cab["retardo_ms"][sel][0] / 1000,
                     f"{ruta} — FFID {ffids[0]}", cab["x_receptor"][sel])
