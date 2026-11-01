# 💰 Mis Finanzas

App web personal para llevar tus finanzas: presupuestos por categoría con gráficos, registro de gastos e importación desde tus tarjetas y cuenta bancaria.

**Abrir:** `index.html` en el navegador (o publícala con GitHub Pages y ábrela desde el celular; se puede "Agregar a pantalla de inicio").
No necesita instalación ni servidor. Los datos se guardan **solo en tu navegador** (exporta respaldos desde *Ajustes*).

## Qué incluye
- **Resumen**: presupuesto vs. gastado, disponible por día, barras por categoría con estado (✓ en rango / ! cerca del límite / ✕ excedido), dona de gasto por categoría, gasto acumulado vs. ritmo ideal y comparación de los últimos 6 meses.
- **Presupuestos**: un medidor circular por categoría, montos predeterminados o ajustes solo para un mes, categorías propias.
- **Movimientos**: búsqueda y filtros, reclasificación en un clic; la app ofrece *recordar* el comercio como regla.
- **Conectar / Importar** (detecta duplicados):
  1. **Avisos del banco**: pega correos/SMS/notificaciones de compra; detecta monto, comercio, fecha y tarjeta (últimos 4 dígitos → asigna la tarjeta).
  2. **Cartolas** CSV u OFX/QFX descargadas desde tu banco, con asistente para elegir columnas.
  3. **Registro automático desde el celular**: una automatización (Atajos en iPhone, MacroDroid/Tasker en Android) abre `index.html#aviso=<texto del aviso>` y el gasto queda registrado y categorizado solo.
- Categorización automática con +200 comercios comunes de Latinoamérica (Lider, Jumbo, Uber, Copec, Rappi, Netflix, Falabella, OXXO…).
- Varias monedas (CLP, MXN, COP, ARS, PEN, UYU, USD, EUR), tema claro/oscuro, diseño para celular.

## Conexión directa con el banco
Una conexión directa por API requiere un agregador bancario (Fintoc, Belvo, Prometeo o Plaid según el país) y un pequeño servidor que guarde las claves de forma segura. Los movimientos que entregan (fecha, descripción, monto) calzan con el formato de importación de la app, así que se puede agregar como siguiente paso.

## Archivos
- `index.html` — estructura
- `app.js` — lógica, vistas y almacenamiento
- `charts.js` — gráficos SVG sin dependencias
- `parsers.js` — lectura de montos, fechas, CSV, OFX y avisos; categorización automática
- `styles.css` — estilos y paleta (clara/oscura, apta para daltonismo)
