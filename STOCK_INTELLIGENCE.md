# STOCK_INTELLIGENCE.md — Rediseño Funcional del Módulo de Stock

> Este documento reemplaza los Fix anteriores y replantea el módulo completo
> como un sistema de inteligencia de compras, no como una tabla con semáforos.

---

## FILOSOFÍA

El dueño de una tienda de ropa no quiere ver una tabla con 40 filas.
Quiere abrir la app y saber tres cosas:

1. **¿Qué tengo que comprar HOY?** (urgencias)
2. **¿Cómo viene el negocio vs el año pasado?** (tendencia)
3. **¿Tengo plata mal distribuida entre locales?** (optimización)

El sistema tiene que responder esas preguntas de forma VISUAL y en menos
de 5 segundos. La tabla detallada existe, pero es una herramienta secundaria
de configuración y revisión masiva, no la pantalla principal.

---

## JERARQUÍA DE PRODUCTO (cómo piensa el negocio)

```
NOMBRE (Zapatillas) ← nivel de decisión de compra y presupuesto
  └── DESCRIPCIÓN (Nike Jordan 4) ← nivel de elección de modelo
        └── TALLE × COLOR (42 Negro) ← nivel de curva operativa
```

**Regla de oro:** La demanda se analiza a nivel NOMBRE.
La reposición se decide a nivel DESCRIPCIÓN.
El talle y color son distribución operativa dentro de un modelo, NO unidades de análisis.

Cuando el usuario quiere ver qué talles priorizar dentro de un modelo,
el sistema muestra los talles ordenados por demanda relativa (% del total
de ventas de esa descripción), no como lista plana.

---

## MOTOR DE INTELIGENCIA

### Cálculo de demanda (el cerebro del sistema)

NO usar ventanas fijas de 30 o 90 días. Usar un modelo adaptativo:

```
DEMANDA_PROYECTADA(producto, horizonte_dias) =
  velocidad_base × factor_tendencia × factor_calendario

Donde:
  velocidad_base = ventas últimos 90 días / 90
    (si hay menos de 90 días de datos, usar los que haya)
    (si hay menos de 14 días, marcar como "datos insuficientes")

  factor_tendencia = velocidad_ultimos_45d / velocidad_45d_anteriores
    (captura si la demanda está subiendo o bajando)
    (limitar entre 0.5 y 2.0 para evitar distorsiones por outliers)

  factor_calendario =
    SI hay datos del mismo mes del año anterior:
      ventas_mes_actual_anio_anterior / promedio_mensual_anio_anterior
      (captura estacionalidad: si marzo es históricamente 1.3× → factor = 1.3)
    SI NO hay datos del año anterior:
      1.0 (sin ajuste)
```

**Query SQL para el motor:**
```sql
WITH params AS (
    SELECT 
        @ProductoNombreId AS ProductoNombreId,
        @LocalID AS LocalID,
        GETDATE() AS Hoy
),
-- Velocidad base: últimos 90 días
vel_base AS (
    SELECT 
        p.ProductoNombreId,
        COUNT(DISTINCT CAST(vc.Fecha AS DATE)) AS DiasConVenta,
        SUM(vd.Cantidad) AS TotalVendido,
        SUM(vd.Cantidad) * 1.0 / GREATEST(DATEDIFF(DAY, MIN(vc.Fecha), GETDATE()), 1) AS VelocidadDiaria,
        MIN(vc.Fecha) AS PrimeraVenta
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
    WHERE vc.Anulada = 0
      AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
      AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
    GROUP BY p.ProductoNombreId
),
-- Factor tendencia: comparar últimos 45d vs 45d anteriores
vel_45_reciente AS (
    SELECT p.ProductoNombreId, SUM(vd.Cantidad) * 1.0 / 45 AS Vel
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
    WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -45, GETDATE())
      AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
    GROUP BY p.ProductoNombreId
),
vel_45_anterior AS (
    SELECT p.ProductoNombreId, SUM(vd.Cantidad) * 1.0 / 45 AS Vel
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
    WHERE vc.Anulada = 0
      AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
      AND vc.Fecha < DATEADD(DAY, -45, GETDATE())
      AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
    GROUP BY p.ProductoNombreId
),
-- Factor calendario: mismo mes año anterior vs promedio anual
vel_mes_anio_ant AS (
    SELECT p.ProductoNombreId, SUM(vd.Cantidad) * 1.0 AS VentasMesAnterior
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
    WHERE vc.Anulada = 0
      AND MONTH(vc.Fecha) = MONTH(GETDATE())
      AND YEAR(vc.Fecha) = YEAR(GETDATE()) - 1
      AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
    GROUP BY p.ProductoNombreId
),
vel_prom_anual AS (
    SELECT p.ProductoNombreId, SUM(vd.Cantidad) * 1.0 / 12 AS PromedioMensual
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
    WHERE vc.Anulada = 0
      AND YEAR(vc.Fecha) = YEAR(GETDATE()) - 1
      AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
    GROUP BY p.ProductoNombreId
)
SELECT
    pn.Nombre AS ProductoNombre,
    vb.VelocidadDiaria AS VelocidadBase,
    
    -- Factor tendencia (limitado 0.5 a 2.0)
    CASE
        WHEN ISNULL(va.Vel, 0) = 0 THEN 1.0
        ELSE ROUND(
            GREATEST(0.5, LEAST(2.0, ISNULL(vr.Vel, 0) / va.Vel)), 
            2)
    END AS FactorTendencia,
    
    -- Factor calendario
    CASE
        WHEN ISNULL(vpa.PromedioMensual, 0) = 0 THEN 1.0
        ELSE ROUND(ISNULL(vma.VentasMesAnterior, 0) / vpa.PromedioMensual, 2)
    END AS FactorCalendario,
    
    -- Demanda proyectada diaria
    vb.VelocidadDiaria 
        * CASE WHEN ISNULL(va.Vel, 0) = 0 THEN 1.0
               ELSE GREATEST(0.5, LEAST(2.0, ISNULL(vr.Vel, 0) / va.Vel)) END
        * CASE WHEN ISNULL(vpa.PromedioMensual, 0) = 0 THEN 1.0
               ELSE ISNULL(vma.VentasMesAnterior, 0) / vpa.PromedioMensual END
    AS DemandaProyectadaDiaria,
    
    -- Datos de contexto
    DATEDIFF(DAY, vb.PrimeraVenta, GETDATE()) AS DiasDeHistorial,
    CASE WHEN vma.VentasMesAnterior IS NOT NULL THEN 1 ELSE 0 END AS TieneDatosAnioAnterior

FROM ProductoNombre pn
LEFT JOIN vel_base vb ON pn.Id = vb.ProductoNombreId
LEFT JOIN vel_45_reciente vr ON pn.Id = vr.ProductoNombreId
LEFT JOIN vel_45_anterior va ON pn.Id = va.ProductoNombreId
LEFT JOIN vel_mes_anio_ant vma ON pn.Id = vma.ProductoNombreId
LEFT JOIN vel_prom_anual vpa ON pn.Id = vpa.ProductoNombreId
```

### Estados de producto de Temporada

```javascript
// LÓGICA COMPLETA - copiar tal cual al código
function calcularEstadoTemporada(config, hoy, leadTimeDias, seguridadDias, stockActual) {
    const mes = hoy.getMonth() + 1; // 1-12
    const { mesInicio, mesFin, mesLiquidacion } = config;
    const cruza = mesInicio > mesFin;
    
    // ¿Estamos dentro de la temporada?
    const enTemp = cruza 
        ? (mes >= mesInicio || mes <= mesFin)
        : (mes >= mesInicio && mes <= mesFin);
    
    // ¿Estamos en período de liquidación? (subconjunto de temporada)
    const enLiq = enTemp && (cruza
        ? (mes >= mesLiquidacion || mes <= mesFin)
        : (mes >= mesLiquidacion && mes <= mesFin));
    
    // Calcular fecha de próxima emisión de orden
    let anioOrden = hoy.getFullYear();
    let inicioTemp = new Date(anioOrden, mesInicio - 1, 1);
    if (inicioTemp <= hoy) inicioTemp.setFullYear(anioOrden + 1);
    const fechaOrden = new Date(inicioTemp);
    fechaOrden.setDate(fechaOrden.getDate() - leadTimeDias - seguridadDias);
    
    // ¿Estamos en ventana de pre-temporada?
    const enPre = !enTemp && hoy >= fechaOrden && hoy < inicioTemp;
    
    if (enLiq) return {
        estado: 'Liquidación',
        color: '#EF9F27',
        accion: `Liquidar ${stockActual} un. restantes. No reponer.`,
        compra: 0
    };
    if (enTemp) return {
        estado: 'En temporada',
        color: '#1D9E75',
        accion: 'Monitorear demanda real vs proyectada.',
        compra: null // usar lógica normal de cobertura
    };
    if (enPre) return {
        estado: '¡Emitir orden!',
        color: '#ED7C00',
        accion: `Pedir al proveedor. Temporada inicia en ${Math.ceil((inicioTemp - hoy) / 86400000)}d.`,
        compra: null // calcular basado en temporada anterior
    };
    // Fuera de temporada
    return {
        estado: stockActual > 0 ? 'Stock muerto' : 'Fuera de temp.',
        color: stockActual > 0 ? '#E24B4A' : '#5F5E5A',
        accion: stockActual > 0 
            ? `${stockActual} un. sin vender. Descuento agresivo o transferir.`
            : `Próxima orden: ${fechaOrden.toLocaleDateString('es-AR')}`,
        compra: 0
    };
}
```

---

## EXPERIENCIA DE USUARIO — REDISEÑO VISUAL

La página se reorganiza en 4 vistas, navegables con tabs:

```
[  Resumen  ] [  Análisis por producto  ] [  Calendario de compras  ] [  Multilocal  ]
```

### Vista 1: RESUMEN (dashboard visual)

Esta es la pantalla de entrada. Todo gráfico, nada de tablas.

**Fila 1: KPIs** (las 7 tarjetas que ya funcionan — no tocar)

**Fila 2: Gráfico "Salud del inventario"**
Un treemap o gráfico de burbujas donde:
- Cada burbuja/bloque es un ProductoNombre
- El TAMAÑO representa el valor del stock (PrecioCompra × Stock)
- El COLOR representa la salud:
  - Verde: cobertura entre 15-45 días (equilibrado)
  - Rojo: cobertura < 15 días (substock, necesita compra)
  - Azul: cobertura > 60 días (sobrestock, capital inmovilizado)
  - Gris: fuera de temporada
  - Naranja: en temporada/liquidación
- Al pasar el mouse: nombre, stock, cobertura, inversión
- Al hacer click: navega a la Vista 2 con ese producto seleccionado

Este gráfico le da al usuario EN UN VISTAZO la distribución de
su capital en inventario y dónde están los problemas. Un bloque rojo
grande = mucha plata en riesgo de quiebre. Un bloque azul grande = 
mucha plata inmovilizada sin necesidad.

**Fila 3: Panel de alertas urgentes (máximo 5)**
Cards horizontales con las acciones más urgentes:

```
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│ 🔴 Medias             │ │ 🔴 Nike SB Dunk      │ │ 🟡 Cholas             │
│ 6 días de cobertura  │ │ Quiebre inminente    │ │ Stock muerto: 45 un. │
│ Comprar 24 un.       │ │ dentro de Zapatillas │ │ Liquidar o transferir│
│ Inversión: $26.066   │ │ Stock: 3, vel: 0.4/d │ │                      │
│ [Ver detalle →]      │ │ [Ver detalle →]      │ │ [Ver detalle →]      │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
```

Estas cards salen de un ranking de urgencia que combina:
- Productos básicos con cobertura < punto_reorden → urgente
- Modelos (Descripción) dentro de un Nombre que pueden entrar en quiebre
- Productos de temporada en estado "Stock muerto" o "¡Emitir orden!"
- Transferencias recomendadas entre locales (si hay más de un local)

**Fila 4: Pareto ABC** (el que ya funciona — conservar)

---

### Vista 2: ANÁLISIS POR PRODUCTO (detalle interactivo)

Se accede haciendo click en un producto del resumen, o desde el tab.

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ Selector de producto: [Zapatillas ▼]  Tipo: [Básico ▼]     │
│                                       Lead: [7d] Seg: [7d] │
├────────────────────────────┬────────────────────────────────┤
│                            │                                │
│   GRÁFICO DE PROYECCIÓN    │   DESGLOSE POR MODELO          │
│   (punto de reorden o      │   (barras horizontales)        │
│    timeline de temporada)  │                                │
│                            │                                │
├────────────────────────────┴────────────────────────────────┤
│                                                             │
│   DETALLE DE MODELOS (tabla expandible)                     │
│   Cada modelo (Descripción) con su cobertura y estado       │
│   Al expandir: distribución de talles por demanda           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Panel izquierdo: Gráfico de proyección**

Para Básico/Quiebre: el gráfico de línea descendente con punto de reorden
(el que ya especificamos antes — implementarlo acá).

Para Temporada: el timeline anual con zonas de color y marcadores.

**Panel derecho: Desglose por modelo**

Gráfico de barras horizontales apiladas donde:
- Cada barra es una Descripción (modelo)
- La barra se divide en: stock actual (azul) vs demanda proyectada 30d (naranja)
- Si la demanda > stock → la parte naranja sobresale → visual de déficit
- Ordenado por déficit descendente (los que más necesitan reposición arriba)

```
Nike Jordan 4    ████████░░░░░░░░░░░  stock 17 | demanda 36 | DÉFICIT -19
Nike SB Dunk     ██░░░░░░░░░░         stock 3  | demanda 12 | DÉFICIT -9
Air Force 1      ████████████████░░   stock 45 | demanda 24 | OK +21
Vans Hylane      ████████████████████████████  stock 80 | demanda 27 | EXCESO +53
```

**Tabla de modelos expandible (debajo del gráfico)**

| Modelo | Stock | Vend. 90d | Vel/día | Cobert. | Tendencia | Estado |
|--------|-------|-----------|---------|---------|-----------|--------|
| Nike Jordan 4 | 17 | 108 | 1.2 | 14d | ↑ +15% | 🔴 Reponer |
| Nike SB Dunk | 3 | 36 | 0.4 | 8d | → 0% | 🔴 Reponer |
| Air Force 1 | 45 | 72 | 0.8 | 56d | ↓ -10% | 🟢 OK |
| Vans Knu Skool | 120 | 18 | 0.2 | 600d | ↓ -40% | 🔵 Exceso |

**Al expandir un modelo:** distribución de talles por demanda RELATIVA.
No una lista plana, sino una visualización de "curva de talles":

```
Nike Jordan 4 — distribución de demanda por talle:
  37  ░░░░░░░░ 5%     stock: 2
  38  ████████████████ 12%  stock: 0 ← PRIORIDAD
  39  ████████████████████ 15%  stock: 3
  40  ██████████████████████████ 22%  stock: 4
  41  ████████████████████████ 18%  stock: 3
  42  ████████████████████████████ 20%  stock: 5
  43  ████████████ 8%     stock: 0 ← PRIORIDAD
  
  Colores más vendidos: Negro (45%), Blanco (30%), Gris (15%), Otros (10%)
```

Esto le dice al usuario: "de Jordan 4, priorizá talles 38 y 43 que están
en 0 y tienen demanda. Y comprá mayoría Negro y Blanco."

NO es una lista de 733 SKUs. Es una visualización de la curva que le
permite armar la orden de compra al proveedor de forma inteligente.

---

### Vista 3: CALENDARIO DE COMPRAS

**Concepto:** Una vista de calendario mensual donde el usuario ve cuándo
tiene que hacer cada compra, cuánto dinero necesita, y puede ajustar las
fechas arrastrando eventos. El sistema actualiza la inversión proyectada
en tiempo real a medida que el usuario planifica.

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  RESUMEN DE INVERSIÓN PROYECTADA                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Marzo    │ │ Abril    │ │ Mayo     │ │ Total Q2 │       │
│  │ $2.4M   │ │ $1.8M   │ │ $5.1M   │ │ $9.3M    │       │
│  │ 3 órdenes│ │ 2 órdenes│ │ 4 órdenes│ │ 9 órdenes│       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CALENDARIO MENSUAL                    [◄ Mar 2026 ►]       │
│                                                             │
│  Lun    Mar    Mié    Jue    Vie    Sáb    Dom              │
│  ...                                                        │
│  16     17     18     19     20     21     22               │
│         HOY                                                 │
│                ┌──────────────────┐                         │
│                │ 🔴 Medias        │                         │
│                │ 24 un. · $26K   │                         │
│                │ Prov: TextilAR  │                         │
│                └──────────────────┘                         │
│  23     24     25     26     27     28     29               │
│  ┌──────────────────┐                                      │
│  │ 🟡 Buzo           │                                      │
│  │ 45 un. · $180K   │                                      │
│  │ Prov: ImportCo   │                                      │
│  └──────────────────┘                                      │
│  ...                                                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  TIMELINE DE ÓRDENES (vista alternativa)                    │
│                                                             │
│  Mar ──────────── Abr ──────────── May ──────── Jun         │
│   │                │                │                       │
│   ├─ Medias 24un   ├─ Remera 80un  ├─ Ojotas 1240un       │
│   │  $26K          │  $320K        │  $3.7M (temporada)    │
│   │                │               │                       │
│   └─ Buzo 45un    └─ Jordan4 50un ├─ Pantalon 60un        │
│      $180K           $750K        │  $480K                 │
│                                    │                       │
│                                    └─ llegada Ojotas →Oct  │
└─────────────────────────────────────────────────────────────┘
```

**Fuentes de datos para el calendario:**

Las órdenes de compra se generan automáticamente desde el motor de
inteligencia. Cada producto con fecha_emision_orden calculada genera
un evento en el calendario:

```javascript
// Para productos BÁSICOS:
evento = {
  fecha: hoy + dias_hasta_punto_reorden,  // cuándo comprar
  producto: nombre,
  modelo: descripcion_mas_urgente,
  cantidad: sugerencia_compra,
  inversion: cantidad * costo_promedio,
  proveedor: ultimo_proveedor,
  urgencia: cobertura < punto_reorden ? 'critico' : 'planificado',
  // Fechas calculadas:
  fechaLlegada: fecha + lead_time,
  fechaQuiebre: hoy + cobertura_dias  // si no compra
}

// Para productos de TEMPORADA:
evento = {
  fecha: inicio_temporada - lead_time - seguridad,  // fecha fija calendario
  producto: nombre,
  cantidad: ventas_temporada_anterior * 1.1,
  inversion: cantidad * costo_promedio,
  proveedor: ultimo_proveedor,
  urgencia: estado_temporada === '¡Emitir orden!' ? 'critico' : 'planificado',
  tipo: 'temporada',
  temporadaInicio: mes_inicio,
  temporadaFin: mes_fin,
  fechaLlegada: fecha + lead_time
}
```

**Interacciones del calendario:**

1. **Arrastrar evento:** El usuario puede mover una orden a otra fecha.
   Al hacerlo, el sistema recalcula:
   - ¿Alcanza el stock hasta la nueva fecha de llegada?
   - Si no → warning: "Si comprás el 25 en vez del 18, vas a tener 3 días sin stock"
   - La inversión mensual se actualiza en las cards de arriba

2. **Click en evento:** Abre un panel lateral con detalle:
   - Producto, modelo, proveedor, cantidad, inversión
   - Gráfico de proyección (el mismo de Vista 2) centrado en ese evento
   - Botón "Editar cantidad" para ajustar manualmente
   - Botón "Marcar como ordenado" cuando efectivamente hizo la compra

3. **Agregar evento manual:** Botón "+" para crear una orden de compra
   que el sistema no sugirió (ej: producto nuevo, reposición especial)

4. **Vista timeline:** Alternativa al calendario mensual.
   Muestra una línea de tiempo horizontal con todas las órdenes futuras,
   agrupadas por mes, con barras de inversión acumulada.
   Útil para ver los próximos 3-6 meses de un vistazo.

**Flujo de caja proyectado:**

Debajo del calendario, un gráfico de barras por semana/mes que muestra:
- Inversión planificada en compras (barras rojas hacia abajo)
- CMV proyectado / ingresos por ventas (barras verdes hacia arriba)
- Línea de saldo neto acumulado

Esto responde la pregunta: "¿tengo la plata para bancar estas compras
o necesito financiamiento?"

```
       Flujo de caja proyectado
       
  $5M  ┤         ████
       │    ████ ████      ████
  $0   ├────████─████──────████──────────
       │    ▓▓▓▓ ▓▓▓▓ ▓▓▓▓ ▓▓▓▓ ▓▓▓▓
 -$5M  ┤              ▓▓▓▓
       └────Mar───Abr──May──Jun──Jul─────
       
       ████ = ingresos CMV    ▓▓▓▓ = compras planificadas
       ─── = saldo neto acumulado
```

**Estados de una orden en el calendario:**

| Estado | Color | Significado |
|--------|-------|-------------|
| Sugerida | borde punteado | El sistema la sugiere, el usuario no confirmó |
| Planificada | borde sólido | El usuario la confirmó/ajustó |
| Ordenada | fondo sólido | Se hizo el pedido al proveedor |
| Recibida | fondo verde | Llegó la mercadería |
| Atrasada | borde rojo | Pasó la fecha y no se ordenó |

**Persistencia:** Las órdenes confirmadas/planificadas se guardan en una
tabla nueva:

```sql
CREATE TABLE OrdenCompraPlan (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    ProductoNombreId INT NOT NULL REFERENCES ProductoNombre(Id),
    ProveedorId INT NULL REFERENCES Proveedores(ProveedorId),
    FechaPlanificada DATE NOT NULL,
    FechaLlegadaEstimada DATE NULL,
    CantidadSugerida INT NOT NULL,
    CantidadConfirmada INT NULL,       -- NULL = no confirmada aún
    InversionEstimada DECIMAL(12,2),
    Estado VARCHAR(20) NOT NULL DEFAULT 'Sugerida',
    -- 'Sugerida', 'Planificada', 'Ordenada', 'Recibida', 'Atrasada'
    Notas NVARCHAR(500) NULL,
    CreadoEn DATETIME2 DEFAULT SYSUTCDATETIME(),
    ModificadoEn DATETIME2 DEFAULT SYSUTCDATETIME(),
    ModificadoPor NVARCHAR(50)
);
```

---

### Vista 4: OPTIMIZACIÓN MULTILOCAL

Solo aparece si el tenant tiene más de un local.

**Concepto:** El sistema cruza stock y demanda de cada local para encontrar
desequilibrios. Si Local A tiene 50 Zapatillas Jordan 4 y vende 1/semana,
pero Local B tiene 3 y vende 5/semana, el sistema recomienda transferir
unidades de A a B.

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  MAPA DE CALOR: Stock vs Demanda por local                  │
│                                                             │
│              Local Centro    Local Shopping    Local Online  │
│  Zapatillas     🟢 84d         🔴 12d           🟢 45d      │
│  Pantalon       🔵 120d        🟢 35d           🔴 8d       │
│  Medias         🔴 6d          🟢 30d           🟡 15d      │
│  ...                                                        │
├─────────────────────────────────────────────────────────────┤
│  TRANSFERENCIAS RECOMENDADAS                                │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Zapatillas Jordan 4                                  │   │
│  │  Local Centro (84d) ──→ Local Shopping (12d)          │   │
│  │  Transferir: 15 unidades                              │   │
│  │  Resultado: Centro queda en 45d, Shopping sube a 35d  │   │
│  │  Ahorro vs compra nueva: $450.000                     │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Pantalon Jeans Baggy                                 │   │
│  │  Local Centro (120d) ──→ Local Online (8d)            │   │
│  │  Transferir: 20 unidades                              │   │
│  │  Resultado: Centro queda en 60d, Online sube a 40d    │   │
│  │  Ahorro vs compra nueva: $380.000                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Algoritmo de transferencia:**
```
Para cada ProductoNombre:
  Para cada par de locales (A, B):
    cobertura_A = stock_A / demanda_diaria_A
    cobertura_B = stock_B / demanda_diaria_B
    
    Si cobertura_A > 60 AND cobertura_B < 15:
      // A tiene exceso, B tiene faltante
      deficit_B = (30 * demanda_diaria_B) - stock_B  // lo que B necesita para 30d
      exceso_A = stock_A - (30 * demanda_diaria_A)   // lo que A puede ceder sin riesgo
      transferir = MIN(deficit_B, exceso_A)
      
      Si transferir > 0:
        ahorro = transferir * costo_promedio  // vs comprar nuevo
        agregar recomendación
```

**Query SQL para el mapa de calor multilocal:**
```sql
WITH demanda_por_local AS (
    SELECT 
        p.ProductoNombreId,
        p.LocalID,
        SUM(ISNULL(p.Stock, 0)) AS StockLocal,
        ISNULL(SUM(v.Cantidad), 0) AS Vendidas90d,
        ISNULL(SUM(v.Cantidad), 0) * 1.0 / 90 AS VelocidadDiaria
    FROM Productos p
    LEFT JOIN (
        SELECT vd.ProductoID, SUM(vd.Cantidad) AS Cantidad
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
        GROUP BY vd.ProductoID
    ) v ON p.ProductoID = v.ProductoID
    GROUP BY p.ProductoNombreId, p.LocalID
)
SELECT 
    pn.Nombre,
    l.Nombre AS Local,
    d.StockLocal,
    d.VelocidadDiaria,
    CASE 
        WHEN d.VelocidadDiaria = 0 THEN 999
        ELSE ROUND(d.StockLocal / d.VelocidadDiaria, 0)
    END AS CoberturaDias
FROM demanda_por_local d
INNER JOIN ProductoNombre pn ON d.ProductoNombreId = pn.Id
INNER JOIN Locales l ON d.LocalID = l.LocalID
ORDER BY pn.Nombre, l.Nombre
```

---

## RENDIMIENTO

El problema de lentitud al cambiar estado de temporada probablemente viene
de recalcular todo en el frontend. Soluciones:

1. **Precálculo en el backend:** El endpoint /api/stock/analysis debe devolver
   los datos ya procesados. No mandar datos crudos al frontend para que calcule.

2. **Cache de 5 minutos:** Los datos de stock no cambian cada segundo.
   Cachear el resultado del análisis y solo invalidar cuando hay una venta,
   compra, o cambio de configuración.

3. **Lazy loading del detalle:** La tabla expandida carga los modelos
   solo cuando el usuario expande, no al cargar la página.

4. **Debounce en edición:** Cuando el usuario cambia Lead time o Tipo,
   esperar 500ms antes de recalcular y guardar, para no hacer un request
   por cada tecla.

---

## PLAN DE PROMPTS PARA CLAUDE CODE

### Prompt 1: Motor de inteligencia (backend)
```
Contexto: Lee STOCK_INTELLIGENCE.md, sección "MOTOR DE INTELIGENCIA".

Tarea: Crear o refactorizar el endpoint de análisis de stock en el backend
(FastAPI) para que devuelva datos preprocesados con el modelo de demanda
adaptativo.

El endpoint GET /api/stock/analysis debe recibir:
- localId (opcional, null = todos)
- modo ("simple" o "avanzado")

Y devolver un JSON con:
{
  kpis: { valorStock, rotacion, calce, comprasPeriodo, claseA, aReponer, totalSkus },
  productos: [
    {
      productoNombreId, nombre, tipo, leadTime, seguridad,
      stockTotal, velocidadBase, factorTendencia, factorCalendario,
      demandaProyectadaDiaria, coberturaDias, estado, sugerenciaCompra,
      inversionSugerida, fechaOrden, tendenciaInteranual,
      // Para temporada:
      estadoTemporada, temporadaConfig,
      // Modelos (solo IDs, el detalle se carga lazy):
      cantidadModelos, modelosCriticos
    }
  ],
  alertas: [ // Top 5 urgencias
    { tipo, producto, modelo, mensaje, accion, prioridad }
  ],
  // Solo si hay múltiples locales:
  transferencias: [
    { producto, modelo, localOrigen, localDestino, cantidad, ahorro }
  ]
}

Todas las queries del spec están en STOCK_INTELLIGENCE.md.
El cálculo de estado de temporada usa la función JavaScript del spec
(traducirla a Python para el backend).

Usar caching de 5 minutos con invalidación por evento.
```

### Prompt 2: Vista Resumen (frontend)
```
Contexto: Lee STOCK_INTELLIGENCE.md, sección "Vista 1: RESUMEN".

Tarea: Rediseñar la pantalla principal de Stock con:

1. KPIs existentes (no tocar, solo verificar que funcionan).

2. Gráfico "Salud del inventario": un treemap donde cada bloque
   es un ProductoNombre, el tamaño es el valor del stock, y el color
   indica la salud (verde=OK, rojo=substock, azul=exceso, gris=fuera de temp).
   Usar Recharts Treemap o D3. Al hacer click navegar a Vista 2.

3. Panel de alertas urgentes: máximo 5 cards horizontales con las
   acciones más urgentes del día. Los datos vienen del campo "alertas"
   del endpoint.

4. Pareto ABC existente (no tocar).

Paleta: #32576F #132229 #CDD4DA #FFFFFF #ED7C00
Tipografía: Space Grotesk. Gráficos con fondo transparente/oscuro.
```

### Prompt 3: Vista Análisis por Producto (frontend)
```
Contexto: Lee STOCK_INTELLIGENCE.md, sección "Vista 2: ANÁLISIS POR PRODUCTO".

Tarea: Crear la vista de análisis detallado de un producto.

1. Selector de producto (dropdown) + campos editables de Tipo, Lead time, Seguridad.

2. Panel izquierdo: Gráfico de proyección de stock.
   - Para Básico/Quiebre: línea descendente con punto de reorden y marcadores.
   - Para Temporada: timeline anual con zonas de color.
   Usar Chart.js o Recharts.

3. Panel derecho: Barras horizontales apiladas por modelo (Descripción).
   Cada barra muestra stock actual vs demanda proyectada 30d.
   Déficit visible cuando la demanda sobresale.

4. Tabla de modelos expandible debajo.
   Al expandir un modelo: distribución visual de talles por demanda relativa
   (barras de porcentaje, NO lista plana) + colores más vendidos.

El endpoint de detalle es GET /api/stock/analysis/{productoNombreId}/models
que devuelve los modelos agrupados por Descripción con stock, demanda, cobertura.
El sub-detalle GET /api/stock/analysis/{productoNombreId}/models/{descripcionId}/curve
devuelve la distribución de talles y colores.

Cargar el detalle de modelos LAZY (solo al seleccionar un producto).
Cargar la curva de talles LAZY (solo al expandir un modelo).
```

### Prompt 4: Vista Calendario de Compras (frontend + backend)
```
Contexto: Lee STOCK_INTELLIGENCE.md, sección "Vista 3: CALENDARIO DE COMPRAS".

Tarea: Crear la vista de calendario de planificación de compras.

Backend:
- Crear tabla OrdenCompraPlan en Azure SQL (ver SQL en spec).
- Endpoint GET /api/stock/calendar?meses=3 que devuelve:
  - Órdenes sugeridas por el motor (productos con fecha_emision_orden)
  - Órdenes planificadas/confirmadas del usuario (de OrdenCompraPlan)
  - Inversión proyectada por mes
  - Flujo de caja proyectado (CMV vs compras planificadas)
- Endpoint PUT /api/stock/calendar/{id} para actualizar fecha, cantidad, estado
- Endpoint POST /api/stock/calendar para crear orden manual

Frontend:
1. Cards de inversión por mes en la parte superior (próximos 3 meses + total).

2. Calendario mensual con eventos:
   - Cada orden es un bloque en el día correspondiente
   - Color según urgencia (rojo=crítico, naranja=planificado, verde=ordenado)
   - Borde punteado = sugerida, sólido = confirmada, relleno = ordenada
   - Drag & drop para mover órdenes a otra fecha
   - Al mover: recalcular si el stock alcanza y mostrar warning si no

3. Al hacer click en una orden: panel lateral con detalle completo
   + mini gráfico de proyección + botones de acción (editar, confirmar, ordenar)

4. Vista timeline alternativa (toggle): línea horizontal de los próximos
   3-6 meses con las órdenes agrupadas y barras de inversión.

5. Gráfico de flujo de caja debajo: barras de inversión en compras vs
   ingresos CMV por semana/mes, con línea de saldo neto.

Paleta: #32576F #132229 #CDD4DA #FFFFFF #ED7C00
```

### Prompt 5: Vista Optimización Multilocal (frontend + backend)
```
Contexto: Lee STOCK_INTELLIGENCE.md, sección "Vista 4: OPTIMIZACIÓN MULTILOCAL".

Tarea: Crear la vista de optimización entre locales.
Solo mostrar este tab si el tenant tiene más de 1 local.

1. Mapa de calor: tabla/grid donde filas = ProductoNombre, columnas = Locales,
   celdas = cobertura en días con color de semáforo.

2. Panel de transferencias recomendadas: cards que muestran origen → destino,
   cantidad, y ahorro estimado vs compra nueva.

Backend: nuevo endpoint GET /api/stock/multilocal que ejecuta la query
del spec y calcula las transferencias óptimas.

El algoritmo de transferencia está en STOCK_INTELLIGENCE.md.
Solo recomendar cuando el exceso de un local puede cubrir el déficit
del otro sin dejar al primero en riesgo.
```

### Prompt 6: Integrar las 4 vistas y pulir
```
Tarea: Integrar las 4 vistas con tabs de navegación en la página de Stock.

- Tab "Resumen" = Vista 1 (pantalla por defecto)
- Tab "Análisis" = Vista 2
- Tab "Calendario" = Vista 3
- Tab "Multilocal" = Vista 4 (solo si hay >1 local)

Navegación:
- Click en producto del Resumen → Análisis con ese producto preseleccionado
- Click "Ver detalle" en una alerta de compra → Calendario con esa orden resaltada
- Click en alerta de transferencia → Multilocal

Verificar:
- Filtro por local funciona en las 4 vistas
- Los datos se cargan rápido (lazy loading del detalle)
- Los campos editables (Tipo, Lead time, Seguridad) guardan correctamente
- El gráfico de proyección aparece al seleccionar un producto
- La distribución de talles se muestra al expandir un modelo
- El drag & drop del calendario funciona y muestra warnings
- Las órdenes se persisten correctamente en OrdenCompraPlan
- El flujo de caja se actualiza cuando se mueven/editan órdenes
```

---

## TABLA DE CONFIGURACIÓN MASIVA

La tabla estilo lista que ya existe NO se elimina. Se mantiene accesible
desde un botón "Configuración masiva" o ícono de engranaje en la Vista 2.
Sirve para cuando el usuario quiere revisar y configurar muchos productos
a la vez (cambiar tipos, lead times, etc.) sin navegar uno por uno.
Pero NO es la interfaz principal de análisis.
