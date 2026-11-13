# Simulaciones Geofísicas

Colección de **simuladores interactivos de prospección geofísica** para el aprendizaje.
Cada método tiene su carpeta con una página HTML autónoma: se ajustan los parámetros de
adquisición como en campo, se generan datos sintéticos con ruido realista y se exportan en
formatos estándar para procesarlos con otras herramientas.

Abra [`index.html`](index.html) para ver todos los simuladores, o el simulador directamente
desde su carpeta. No necesita instalación ni conexión a internet.

| Carpeta | Método | Estado |
|---|---|---|
| [`01_Prospeccion_Sismica`](01_Prospeccion_Sismica/) | Refracción, reflexión y MASW | ✅ Disponible |
| [`02_Prospeccion_Electrica`](02_Prospeccion_Electrica/) | Resistividad (SEV / tomografía), polarización inducida | 🕓 Pendiente |
| [`03_Prospeccion_Gravimetrica`](03_Prospeccion_Gravimetrica/) | Gravimetría | 🕓 Pendiente |
| [`04_Prospeccion_Magnetica`](04_Prospeccion_Magnetica/) | Magnetometría | 🕓 Pendiente |
| [`05_Prospeccion_GPR`](05_Prospeccion_GPR/) | Georradar | 🕓 Pendiente |
| [`06_Prospeccion_MT`](06_Prospeccion_MT/) | Magnetotelúrica | 🕓 Pendiente |

## Convenciones del repositorio

- **Una carpeta por método**, numerada, con nombres sin tildes ni espacios (evita problemas con
  URLs, Git y las rutas de Tauri/Rust).
- Cada simulador es **HTML + JavaScript puro**, sin dependencias externas. Separa el
  motor físico (`js/fisica.js`), los exportadores (`js/exportar.js`) y la interfaz
  (`js/interfaz.js`).
- Todos los datos aleatorios usan una **semilla** reproducible, y cada simulación se puede
  guardar y recargar como proyecto `.json`.
- Los datos exportados incluyen el **modelo verdadero**, para comparar con los resultados del
  procesamiento.
- `herramientas/` guarda los scripts auxiliares (Python) para leer y verificar los datos.

## Publicar en GitHub Pages

En *Settings → Pages*, elija la rama y la carpeta raíz. El índice quedará en
`https://<usuario>.github.io/Simulaciones_Geofisica/`.
