# STOCK_SPEC.md — Especificación Completa de la Página de Analítica de Stock

> **Objetivo de la página:** Que el usuario entre, mire, y salga sabiendo QUÉ tiene que comprar, CUÁNTO, y POR QUÉ.  
> **Principio de diseño:** Menos secciones, más inteligencia. Nada de tablas repetitivas.  
> **Paleta:** #32576F · #132229 · #CDD4DA · #FFFFFF · #ED7C00  
> **Tipografía:** Space Grotesk

---

## ESTRUCTURA DE LA BD (referencia rápida)

```
Productos (ProductoID, PrecioCompra, PrecioVenta, Stock, LocalID,
           ProductoNombreId→ProductoNombre.Id,
           ProductoDescripcionId→ProductoDescripcion.Id,
           ProductoTalleId→ProductoTalle.Id,
           ProductoColorId→ProductoColor.Id)

ProductoNombre (Id, Nombre)          -- "Zapatillas", "Pantalon", "Medias"
ProductoDescripcion (Id, Descripcion) -- "Nike Jordan 4", "Vans Hylane"
ProductoTalle (Id, Talle)            -- "38", "42", "S/T"
ProductoColor (Id, Color)            -- "Negro", "Blanco con Negro"

VentaCabecera (VentaID, Fecha, LocalID, Total, Anulada)
VentaDetalle (VentaDetalleID, VentaID, ProductoID, Cantidad, PrecioUnitario)

CompraCabecera (CompraId, Fecha, ProveedorId, LocalId, Total)
CompraDetalle (CompraDetalleId, CompraId, ProductoId, Cantidad, CostoUnitario)

Proveedores (ProveedorId, Nombre, Telefono, Email)

Locales (LocalID, Nombre)

StockMovimiento (MovimientoID, ProductoID, Cantidad, TipoMovimiento, Fecha)
```

**Jerarquía de agrupación:**
- **Nombre** (ProductoNombre) = categoría más general → "Zapatillas"
- **Descripción** (ProductoDescripcion) = modelo → "Nike Jordan 4"
- **SKU** = Nombre + Descripción + Talle + Color → nivel más granular

**IMPORTANTE:** El análisis de recompra se hace a nivel **Nombre** (no SKU), porque aperturar por color/talle/modelo pierde sentido analítico para decisiones de compra.

---

## LAYOUT DE LA PÁGINA

La página tiene 3 secciones verticales, nada más:

```
┌─────────────────────────────────────────────────────────┐
│  HEADER: "Analítica · Stock"  +  Filtro Local  +  Toggle│
│          [Todos los locales ▼]    [Simple | Avanzado]   │
├─────────────────────────────────────────────────────────┤
│  SECCIÓN 1: TARJETAS KPI (7 cards, 2 filas)            │
├─────────────────────────────────────────────────────────┤
│  SECCIÓN 2: ANÁLISIS ABC / PARETO (ya funciona, conservar)│
├─────────────────────────────────────────────────────────┤
│  SECCIÓN 3: RECOMENDACIÓN DE COMPRA (nueva, reemplaza  │
│             todas las tablas rotas actuales)             │
└─────────────────────────────────────────────────────────┘
```

---

## SECCIÓN 1: TARJETAS KPI

### 1.1 Valor Total del Stock
```sql
SELECT ISNULL(SUM(ISNULL(p.PrecioCompra, 0) * ISNULL(p.Stock, 0)), 0) AS ValorTotalStock
FROM Productos p
WHERE (@LocalID IS NULL OR p.LocalID = @LocalID)
  AND p.Stock > 0
```
**Formato:** `$ {valor}` con separador de miles (punto en Argentina).  
**Subtítulo:** "precio de compra × unidades"

### 1.2 Rotación Promedio Mensual
**Fórmula correcta para esta BD:**
```sql
-- Rotación = Unidades vendidas en período / Stock promedio del período
-- Stock promedio estimado = Stock actual + (unidades vendidas / 2)
-- Si no hay ventas, rotación = 0

WITH ventas_periodo AS (
    SELECT SUM(vd.Cantidad) AS UnidadesVendidas
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    WHERE vc.Anulada = 0
      AND vc.Fecha >= DATEADD(MONTH, -1, GETDATE())
      AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
),
stock_actual AS (
    SELECT SUM(ISNULL(p.Stock, 0)) AS StockTotal
    FROM Productos p
    WHERE (@LocalID IS NULL OR p.LocalID = @LocalID)
)
SELECT
    CASE
        WHEN sa.StockTotal + (vp.UnidadesVendidas / 2.0) = 0 THEN 0
        ELSE ROUND(vp.UnidadesVendidas / (sa.StockTotal + (vp.UnidadesVendidas / 2.0)), 2)
    END AS RotacionMensual
FROM ventas_periodo vp, stock_actual sa
```
**Formato:** `{valor}x`  
**Subtítulo:** "últimos 30 días"  
**Color:** verde si > 0.5, amarillo si 0.2-0.5, rojo si < 0.2

### 1.3 Calce Financiero
```sql
-- Días para recuperar la inversión en COMPRAS DEL PERÍODO como CMV
-- Numerador: total de compras del período (últimos 30 días)
-- Denominador: CMV diario promedio (cuánto vendés por día valuado al costo)
-- Resultado: en cuántos días recuperás lo que gastaste en compras este mes
-- USO: negociar plazos de pago con proveedores (si calce = 45d, necesitás 45+ días de plazo)

WITH compras_periodo AS (
    SELECT ISNULL(SUM(cc.Total), 0) AS TotalCompras
    FROM CompraCabecera cc
    WHERE cc.Fecha >= DATEADD(DAY, -30, GETDATE())
      AND (@LocalID IS NULL OR cc.LocalId = @LocalID)
),
cmv_diario AS (
    -- CMV diario = suma de (cantidad vendida × precio de compra) / días del período
    SELECT
        ISNULL(
            SUM(vd.Cantidad * ISNULL(p.PrecioCompra, 0))
            / NULLIF(DATEDIFF(DAY, DATEADD(DAY, -90, GETDATE()), GETDATE()), 0)
        , 0) AS CMVDiario
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
    WHERE vc.Anulada = 0
      AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
      AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
)
SELECT
    CASE WHEN cd.CMVDiario = 0 THEN 999
    ELSE CEILING(cp.TotalCompras / cd.CMVDiario)
    END AS CalceDias
FROM compras_periodo cp, cmv_diario cd
```
**Formato:** `{valor} días`  
**Subtítulo:** "para recuperar compras del mes como CMV"  
**Color:** verde si < 30, amarillo si 30-60, rojo si > 60  
**Tooltip al pasar el mouse:** "Compras del período: ${total_compras} · CMV diario: ${cmv_diario} · Negociá al proveedor un plazo mayor a {calce} días"

### 1.4 Compras del Período
```sql
SELECT ISNULL(SUM(cc.Total), 0) AS ComprasPeriodo
FROM CompraCabecera cc
WHERE cc.Fecha >= DATEADD(MONTH, -1, GETDATE())
  AND (@LocalID IS NULL OR cc.LocalId = @LocalID)
```
**Formato:** `$ {valor}`  
**Subtítulo:** Calcular "Ventas {porcentaje_variación}% vs anterior" comparando con el mes previo.

### 1.5 Productos Más Rentables (Clase A)
```sql
-- Contar cuántos ProductoNombre distintos representan el 80% del revenue
-- (usar resultado del Pareto ya calculado)
```
**Formato:** `{cantidad}`  
**Subtítulo:** "generan el 80% del revenue · click para ver"  
**Acción:** al hacer click, scroll a la sección del Pareto y filtra por Clase A.

### 1.6 Productos a Reponer
```sql
-- Productos cuyo stock actual es menor al promedio de venta de los últimos 30 días
WITH promedio_venta AS (
    SELECT vd.ProductoID,
           SUM(vd.Cantidad) * 1.0 / 30 AS PromDiario
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    WHERE vc.Anulada = 0
      AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
      AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
    GROUP BY vd.ProductoID
)
SELECT COUNT(DISTINCT p.ProductoNombreId) AS ProductosAReponer,
       SUM(CEILING(pv.PromDiario * 30) - p.Stock) AS UnidadesNecesarias
FROM Productos p
INNER JOIN promedio_venta pv ON p.ProductoID = pv.ProductoID
WHERE p.Stock < CEILING(pv.PromDiario * 30)
  AND (@LocalID IS NULL OR p.LocalID = @LocalID)
```
**Formato:** `{cantidad}`  
**Subtítulo:** "{unidades} unidades · horizonte 30d"

### 1.7 Total SKUs
```sql
SELECT COUNT(*) AS TotalSKUs,
       COUNT(DISTINCT pn.Id) AS TiposProducto
FROM Productos p
INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
WHERE (@LocalID IS NULL OR p.LocalID = @LocalID)
```
**Formato:** `{total_skus}`  
**Subtítulo:** "{tipos} tipos de producto"

---

## SECCIÓN 2: ANÁLISIS ABC / PARETO

**CONSERVAR TAL CUAL ESTÁ.** Es la única sección que funciona bien.

Solo verificar:
- Que el toggle Gráfico/Tabla funcione correctamente
- Que Exportar PDF funcione
- Que los filtros de Clase A / B / C funcionen

Si tiene algún bug menor, corregirlo en un paso separado.

---

## SECCIÓN 3: RECOMENDACIÓN DE COMPRA

Esta es la sección nueva que reemplaza TODAS las tablas rotas (Más vendidos, Inventario por SKU, Predicciones). Se borra todo eso y se construye desde cero.

### Toggle de Modo: [Simple | Avanzado]

El toggle aparece en el header de la página. Determina qué se muestra en esta sección.

---

### MODO SIMPLE (pocos datos o usuario nuevo)

**Cuándo activar automáticamente:** si el tenant tiene menos de 90 días de datos de ventas, mostrar este modo por defecto (el usuario puede cambiar manualmente).

**Título:** "Recomendación de compra · Modo rápido"  
**Subtítulo:** "Basado en ventas recientes y stock actual"

#### Componente: Tabla de Recomendación Simple

Agrupada a nivel **ProductoNombre** (categoría), con capacidad de expandir para ver detalle.

**Columnas de la tabla:**

| Columna | Fuente | Descripción |
|---------|--------|-------------|
| Nombre | ProductoNombre.Nombre | Categoría del producto |
| Unidades vendidas | SUM(VentaDetalle.Cantidad) últimos 30d | Total vendido del período |
| Stock actual | SUM(Productos.Stock) | Total en todos los SKUs de ese Nombre |
| Velocidad diaria | Vendidas / 30 | Promedio diario |
| Cobertura (días) | Stock / Velocidad diaria | Días que dura el stock actual |
| Estado | Calculado | Semáforo visual |
| Proveedor | Último proveedor de CompraCabecera | Si existe compra previa |
| Sugerencia | Calculado | Unidades recomendadas a comprar |

**Estado (semáforo):**
- 🔴 **CRÍTICO**: cobertura < 7 días
- 🟡 **BAJO**: cobertura 7-15 días
- 🟢 **OK**: cobertura 15-45 días
- 🔵 **EXCESO**: cobertura > 45 días

**Sugerencia de compra:** `MAX(0, (velocidad_diaria × 30) - stock_actual)`  
Es decir: cuántas unidades necesita para cubrir los próximos 30 días.

**Ordenamiento por defecto:** Estado CRÍTICO primero, luego BAJO, luego OK, luego EXCESO.

**Funcionalidad de expansión:** Al hacer click en una fila, se expande mostrando los SKUs individuales (Descripción + Talle + Color) con su stock y velocidad particular. Esto es solo informativo, la decisión de compra se toma a nivel Nombre.

**Query SQL principal:**
```sql
WITH ventas_30d AS (
    SELECT p.ProductoNombreId,
           SUM(vd.Cantidad) AS UnidadesVendidas
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
    WHERE vc.Anulada = 0
      AND vc.Fecha >= DATEADD(DAY, -30, GETDATE())
      AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
    GROUP BY p.ProductoNombreId
),
stock_actual AS (
    SELECT p.ProductoNombreId,
           SUM(ISNULL(p.Stock, 0)) AS StockTotal
    FROM Productos p
    WHERE (@LocalID IS NULL OR p.LocalID = @LocalID)
    GROUP BY p.ProductoNombreId
),
ultimo_proveedor AS (
    SELECT p.ProductoNombreId,
           prov.Nombre AS ProveedorNombre,
           ROW_NUMBER() OVER (PARTITION BY p.ProductoNombreId ORDER BY cc.Fecha DESC) AS rn
    FROM CompraDetalle cd
    INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
    INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
    INNER JOIN Proveedores prov ON cc.ProveedorId = prov.ProveedorId
)
SELECT
    pn.Nombre,
    ISNULL(v.UnidadesVendidas, 0) AS Vendidas30d,
    ISNULL(s.StockTotal, 0) AS StockActual,
    ROUND(ISNULL(v.UnidadesVendidas, 0) / 30.0, 2) AS VelocidadDiaria,
    CASE
        WHEN ISNULL(v.UnidadesVendidas, 0) = 0 THEN 999
        ELSE ROUND(ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0), 0)
    END AS CoberturaDias,
    up.ProveedorNombre,
    CASE
        WHEN ISNULL(v.UnidadesVendidas, 0) - ISNULL(s.StockTotal, 0) > 0
        THEN ISNULL(v.UnidadesVendidas, 0) - ISNULL(s.StockTotal, 0)
        ELSE 0
    END AS SugerenciaCompra
FROM ProductoNombre pn
LEFT JOIN ventas_30d v ON pn.Id = v.ProductoNombreId
LEFT JOIN stock_actual s ON pn.Id = s.ProductoNombreId
LEFT JOIN ultimo_proveedor up ON pn.Id = up.ProductoNombreId AND up.rn = 1
WHERE ISNULL(s.StockTotal, 0) > 0 OR ISNULL(v.UnidadesVendidas, 0) > 0
ORDER BY
    CASE
        WHEN ISNULL(v.UnidadesVendidas, 0) = 0 THEN 4
        WHEN ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0) < 7 THEN 1
        WHEN ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0) < 15 THEN 2
        WHEN ISNULL(s.StockTotal, 0) / (ISNULL(v.UnidadesVendidas, 0) / 30.0) < 45 THEN 3
        ELSE 5
    END,
    ISNULL(v.UnidadesVendidas, 0) DESC
```

**Buscador:** Campo de texto arriba de la tabla para filtrar por nombre.  
**Exportar PDF:** Botón para exportar la tabla con recomendaciones.

---

### MODO AVANZADO (con datos históricos)

**Cuándo activar automáticamente:** si el tenant tiene 90+ días de datos de ventas.

**Título:** "Recomendación de compra · Modo avanzado"  
**Subtítulo:** "Análisis histórico con clasificación de productos"

#### 3A. Clasificación de Productos

Antes de la tabla principal, mostrar un panel de **clasificación por ProductoNombre**.

Cada ProductoNombre puede ser clasificado como:

| Tipo | Icono | Lógica de recompra |
|------|-------|-------------------|
| **Básico** | 🔄 | Se vende todo el año. Mantener stock constante. Recomprar cuando cobertura < umbral. |
| **Temporada** | 📅 | Tiene picos estacionales. Lógica basada en CALENDARIO, no en velocidad actual. El usuario configura mes de inicio y fin de temporada. |
| **Quiebre** | ⚡ | Solo se recompra cuando el stock llega a 0. No mantener reserva. |

**Implementación:** Guardar esta clasificación en una tabla nueva. Si no hay clasificación asignada, el sistema intenta detectarla automáticamente:

**Auto-detección:**
- Si el coeficiente de variación mensual de ventas es > 0.6 → sugerir "Temporada"
- Si las ventas son muy constantes mes a mes (CV < 0.3) → sugerir "Básico"
- Si el producto tiene ventas esporádicas y bajo volumen → sugerir "Quiebre"

El usuario puede cambiar la clasificación desde la UI con un click en el ícono.

**Configuración adicional para productos de Temporada:**

Cuando el usuario clasifica un producto como "Temporada", se le despliega un mini-formulario:

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| Mes inicio temporada | Mes en que arranca la demanda fuerte | Octubre (para primavera/verano) |
| Mes fin temporada | Mes en que se liquida | Febrero |
| Mes inicio liquidación | A partir de cuándo bajar precio y no reponer | Enero |

Con estos datos + el lead time del proveedor, el sistema calcula automáticamente:
- **Fecha de emisión de orden:** `mes_inicio_temporada - lead_time_dias - stock_seguridad_dias`
- **Cantidad a comprar:** basada en ventas de la temporada anterior (si hay datos) o estimación manual
- **Estado actual:** Pre-temporada / En temporada / Liquidación / Fuera de temporada

#### 3B. Tabla de Recomendación Avanzada

Misma estructura que la Simple pero con columnas adicionales:

| Columna adicional | Descripción |
|-------------------|-------------|
| Tipo | Básico / Temporada / Quiebre (editable con click) |
| Lead time | Días que tarda el proveedor en entregar (editable, viene de Proveedores.LeadTimeDias) |
| Stock seguridad | Días de colchón extra (editable, viene de ProductoClasificacion.StockSeguridadDias) |
| Punto de reorden | Lead time + Stock seguridad (en días). Se muestra en rojo si cobertura < punto de reorden |
| Tendencia | Flecha ↑↓→ comparando últimos 30d vs 30d anteriores |
| Venta mensual prom. | Promedio de los últimos 6 meses (o lo que haya) |
| Costo promedio compra | Último PrecioCompra promedio del ProductoNombre |
| Inversión sugerida | SugerenciaCompra × CostoPromedio |
| Fecha límite compra | HOY + (cobertura_dias - punto_reorden). Si es negativa → "¡YA!" en rojo |

**Tendencia:**
```sql
-- Ventas últimos 30d vs 30d anteriores
-- Si diferencia > 20%: ↑ verde
-- Si diferencia < -20%: ↓ rojo
-- Si entre -20% y 20%: → gris
```

**Lógica de sugerencia según tipo:**

**Básico y Quiebre: alerta basada en stock actual:**
```
cobertura_dias < lead_time + stock_seguridad_dias
```
Esto significa: "si no comprás HOY, no vas a recibir la mercadería a tiempo".

**Temporada: alerta basada en CALENDARIO, no en stock:**
```
La alerta se dispara cuando:
HOY >= fecha_emision_orden

Donde:
fecha_emision_orden = inicio_temporada - lead_time - stock_seguridad_dias

Ejemplo: Ojotas, temporada Oct-Feb, proveedor China 90d, seguridad 7d
→ fecha_emision_orden = 1 Oct - 90 - 7 = 27 de junio
→ El 27 de junio, aunque stock = 0 y velocidad = 0, el sistema alerta:
   "Emitir orden de Ojotas. Temporada inicia en 97 días."
```

**Básico:**
```
punto_reorden = lead_time + stock_seguridad_dias
sugerencia = MAX(0, (velocidad_diaria × punto_reorden × 1.2) - stock_actual)
-- Comprar lo suficiente para cubrir el lead time + seguridad + 20% margen
```

**Temporada (LÓGICA COMPLETA):**
```
El ciclo completo de un producto de temporada tiene 4 estados:

1. FUERA DE TEMPORADA (fin_temporada → fecha_emision_orden)
   - Stock probablemente = 0 (se liquidó)
   - Velocidad = 0
   - Estado en tabla: gris, "Fuera de temp."
   - No sugerir compra
   - Mostrar: "Próxima orden: {fecha_emision_orden}"

2. PRE-TEMPORADA: EMITIR ORDEN (fecha_emision_orden → inicio_temporada)
   - HOY >= inicio_temporada - lead_time - seguridad
   - Estado en tabla: NARANJA ALERTA, "¡Emitir orden!"
   - Sugerencia de cantidad:
     Si hay datos de la temporada anterior:
       sugerencia = ventas_totales_temporada_anterior × 1.1
       (10% más por crecimiento natural, ajustable)
     Si NO hay datos anteriores:
       El usuario ingresa manualmente la cantidad estimada
       O se usa: promedio_mensual_historico × meses_de_temporada × 1.2
   - Mostrar: inversión estimada = sugerencia × costo_promedio

3. EN TEMPORADA (inicio_temporada → inicio_liquidacion)
   - Acá SÍ funciona la lógica normal de velocidad
   - Monitorear velocidad real vs proyectada
   - Si la velocidad real > proyectada × 1.3: alertar "Demanda superior
     a la esperada, considerar reposición urgente"
   - Si velocidad real < proyectada × 0.7: alertar "Demanda menor
     a la esperada, considerar adelantar liquidación"
   - Estado: verde, "En temporada"

4. LIQUIDACIÓN (inicio_liquidacion → fin_temporada)
   - NO reponer bajo ningún concepto
   - Estado: amarillo, "Liquidación"
   - Mostrar: stock restante y días hasta fin de temporada
   - Sugerencia: "Liquidar {stock} unidades en {dias} días.
     Descuento sugerido: {%} para vaciar stock."
```

**Quiebre:**
```
sugerencia = stock_actual == 0 ? (velocidad_diaria × lead_time × 1.1) : 0
-- Solo sugerir compra si está en 0, y comprar justo para cubrir el lead time
-- No se usa stock de seguridad en quiebre (el concepto es no mantener reserva)
```

**Campos editables inline:** Lead time, Stock seguridad, Tipo, y para Temporada
también Mes inicio/fin/liquidación son editables directamente desde la tabla.
Al cambiar un valor, se recalcula automáticamente la fila completa.
Los cambios se guardan en ProductoClasificacion y Proveedores respectivamente.

#### 3C. Resumen Ejecutivo (arriba de la tabla)

Cuatro cards de resumen:

| Card | Cálculo |
|------|---------|
| **Inversión total sugerida** | SUM de todas las Inversión sugerida |
| **Productos críticos** | COUNT donde cobertura < punto_de_reorden (lead_time + seguridad) |
| **Comprar antes de 7 días** | COUNT donde fecha_limite_compra está dentro de los próximos 7 días |
| **Productos en exceso** | COUNT donde cobertura > 60 días |

#### 3D. Gráfico de Punto de Reorden (debajo de la tabla)

**Gráfico principal: "Proyección de stock vs punto de reorden"**

Cuando el usuario hace click en un producto de la tabla, se muestra un gráfico de línea:

- **Eje X:** días (hoy → hoy + horizonte dinámico). El horizonte se adapta al lead time: `MAX(60, lead_time × 1.5)` días. Si el lead time es 90d, muestra 135d.
- **Eje Y:** unidades de stock
- **Línea azul descendente:** proyección del stock. Se calcula con demanda proyectada, NO velocidad plana (ver Modelo de Proyección abajo).
- **Línea roja horizontal:** punto de reorden (demanda_proyectada_en_lead_time + stock_seguridad)
- **Zona verde:** por encima del punto de reorden (estás bien)
- **Zona roja:** por debajo del punto de reorden (tenés que comprar)
- **Marcador vertical amarillo:** "Emitir orden" — la fecha donde hay que hacer el pedido para que la mercadería llegue a tiempo
- **Marcador vertical rojo:** "Quiebre de stock" — la fecha donde el stock llega a 0 si no se compra
- **Línea gris punteada:** fecha estimada de llegada si se compra hoy (hoy + lead_time)

**Modelo de Proyección de Demanda:**

Para lead times cortos (< 30 días), la velocidad diaria promedio de los últimos 30 días es suficiente.

Para lead times largos (30+ días, ej: proveedor de China con 90 días), se usa un modelo más inteligente:

```
1. Calcular velocidad diaria de los últimos 90 días como base.
2. Si hay datos del mismo período del año anterior (ej: marzo-junio del año pasado),
   calcular el factor estacional:
   factor = ventas_periodo_año_anterior / promedio_anual_diario_año_anterior
3. Demanda proyectada para los próximos N días = velocidad_base × factor_estacional × N
4. Si NO hay datos históricos del año anterior, usar solo la velocidad base × N
5. Para productos clasificados como "Temporada": el factor estacional pesa más (×1.3)
6. Para productos clasificados como "Básico": se suaviza el factor (closer to 1.0)
```

**Cálculo del momento de emisión de orden:**
```
demanda_durante_lead_time = velocidad_proyectada × lead_time
punto_reorden_unidades = demanda_durante_lead_time + (velocidad_proyectada × stock_seguridad_dias)
dias_hasta_punto_reorden = (stock_actual - punto_reorden_unidades) / velocidad_proyectada
fecha_emitir_orden = HOY + dias_hasta_punto_reorden

Si dias_hasta_punto_reorden <= 0 → la alerta es "¡EMITIR ORDEN YA!"
Si dias_hasta_punto_reorden <= 7 → la alerta es "URGENTE: emitir en {dias} días"
```

**Ejemplo concreto (caso China):**
- Proveedor de China, lead time = 90 días
- Producto "Zapatillas", velocidad = 2 un/día, stock actual = 250 un, seguridad = 7 días
- Demanda durante lead time = 2 × 90 = 180 un
- Punto de reorden = 180 + (2 × 7) = 194 un
- Días hasta punto de reorden = (250 - 194) / 2 = 28 días
- Fecha de emisión de orden = HOY + 28 días
- Si no compra: quiebre en 250/2 = 125 días
- Si compra en fecha: la mercadería llega el día 28+90 = 118, y le quedan 250-(2×118) = 14 un de colchón

Si no se seleccionó ningún producto, mostrar una versión compacta:
**"Top 10 productos por urgencia de compra"** — gráfico de barras horizontal
ordenado por menor `dias_hasta_punto_reorden`, con barra que muestra días restantes
vs 0 (fecha de hoy). Rojo si ya pasó el punto, amarillo si < 7 días, verde si OK.
Cada barra muestra el nombre del producto y el proveedor asociado.

Este gráfico es la respuesta visual a "¿cuándo tengo que hacer el pedido y qué pasa si no lo hago?".

**Visualización especial para productos de Temporada:**

Cuando el usuario hace click en un producto clasificado como Temporada, el gráfico
cambia a una vista de **timeline anual** en vez de la proyección descendente:

- **Eje X:** meses del año (Ene → Dic), centrado en el ciclo de la temporada
- **Barras grises:** ventas mensuales del año anterior (si hay datos)
- **Zona verde:** meses de temporada activa (mes_inicio → mes_liquidacion)
- **Zona amarilla:** mes de liquidación (mes_liquidacion → mes_fin)
- **Zona gris:** fuera de temporada
- **Marcador rojo vertical:** "Emitir orden aquí" (inicio_temporada - lead_time - seguridad)
- **Marcador naranja:** HOY (para que el usuario vea dónde está parado)
- **Flecha:** desde fecha de orden hasta inicio de temporada, mostrando el lead time

Si no hay datos del año anterior, mostrar la timeline vacía con las zonas marcadas
y un mensaje: "Sin datos de temporada anterior. Ingresá cantidad estimada manualmente."

Cards superiores cuando se selecciona un producto de temporada:

| Card | Valor |
|------|-------|
| Estado | "Fuera de temp." / "¡Emitir orden!" / "En temporada" / "Liquidación" |
| Fecha de orden | dd/mm/yyyy o "¡YA!" si ya pasó |
| Cantidad sugerida | X unidades (de temporada anterior × 1.1 o manual) |
| Inversión estimada | cantidad × costo promedio |

---

## INTERACCIONES Y UX

### Filtro por Local
- Dropdown en el header: "Todos los locales" + lista de locales.
- Al cambiar, TODOS los datos se recalculan (KPIs, Pareto, Recomendación).
- El filtro pasa como parámetro `@LocalID` a todas las queries. `NULL` = todos.

### Toggle Simple / Avanzado
- Mostrar en el header junto al filtro de local.
- Recordar la preferencia del usuario (localStorage o config en Supabase).
- Auto-seleccionar según antigüedad de datos al primer ingreso.

### Expandir fila
- Click en fila de la tabla → expande mostrando SKUs individuales.
- Animación suave de expansión.
- Mostrar solo: Descripción, Talle, Color, Stock, Velocidad diaria.

### Exportar PDF
- Un solo botón "Exportar PDF" que genera un reporte con:
  - KPIs del momento
  - Tabla de recomendación completa
  - Fecha y hora de generación
  - Local seleccionado

---

## QUÉ BORRAR DEL CÓDIGO ACTUAL

Eliminar completamente estos componentes/secciones:
1. ❌ Tabla "Más vendidos del período" (imagen 5 del estado actual)
2. ❌ Tabla "Inventario por SKU" con clasificación ABC individual (imagen 4)
3. ❌ Sección "Predicciones y compras recomendadas" con el análisis IA de Claude (imagen 6)
4. ❌ Tabla expandible de variantes con detección de desbalance (imagen 7)
5. ❌ Primera tabla larga con todas las columnas (imagen 1)

**Conservar:**
- ✅ Tarjetas KPI (corregir las queries)
- ✅ Análisis ABC / Pareto (funciona bien)

---

## PLAN DE EJECUCIÓN PARA CLAUDE CODE

### Prompt 1: Limpiar y preparar
```
Contexto: Estoy reconstruyendo la página de Analítica de Stock.
Lee el archivo STOCK_SPEC.md en la raíz del repo para entender la estructura completa.

Tarea: Eliminar de la página de Stock TODOS los componentes debajo del Pareto ABC.
Esto incluye: la tabla de "Más vendidos", "Inventario por SKU", "Predicciones y compras",
y la tabla con detección de desbalance. NO toques las tarjetas KPI ni el Pareto.

Resultado esperado: la página queda con header + KPIs + Pareto + nada más debajo.
No modifiques ningún otro archivo fuera de los componentes de la página de Stock.
```

### Prompt 2: Corregir las tarjetas KPI
```
Contexto: Lee STOCK_SPEC.md, sección "SECCIÓN 1: TARJETAS KPI".

Tarea: Corregir las queries/lógica de las tarjetas KPI de la página de Stock.
Los problemas actuales son:
1. "Valor Total del Stock" muestra $0. La query correcta es:
   SUM(ISNULL(PrecioCompra, 0) * ISNULL(Stock, 0)) FROM Productos WHERE Stock > 0
   Filtrar por LocalID si hay filtro activo.
2. "Rotación Promedio Mensual" debe usar la fórmula del spec.
3. El filtro por local no funciona. Asegurar que TODAS las queries
   reciban el LocalID del dropdown y filtren por p.LocalID.

Las queries exactas están en STOCK_SPEC.md. Usá esas.
No modifiques el Pareto ni nada debajo de los KPIs.
```

### Prompt 3: Crear componente de Recomendación Simple
```
Contexto: Lee STOCK_SPEC.md, sección "MODO SIMPLE".

Tarea: Crear un nuevo componente llamado StockRecommendation (o el nombre
que se use en el proyecto) que muestre la tabla de recomendación de compra
en modo simple.

Requisitos:
- Tabla agrupada a nivel ProductoNombre con las columnas del spec.
- Semáforo visual por estado de cobertura (CRÍTICO/BAJO/OK/EXCESO).
- Filas expandibles que muestren los SKUs individuales al hacer click.
- Buscador de texto arriba para filtrar por nombre.
- Ordenar por urgencia: críticos primero.
- Recibe LocalID como prop para filtrar.
- La query SQL está en el spec, creá el endpoint en el backend si no existe.

Diseño: fondo #132229, texto #CDD4DA, acentos #ED7C00 para críticos,
verde para OK, tipografía Space Grotesk. Estilo visual consistente
con las tarjetas KPI que ya existen.

No toques los KPIs ni el Pareto. Este componente va DEBAJO del Pareto.
```

### Prompt 4: Crear componente de Recomendación Avanzada (Básico y Quiebre)
```
Contexto: Lee STOCK_SPEC.md, sección "MODO AVANZADO" completa,
incluyendo "Modelo de Proyección de Demanda" y el ejemplo de China.

Tarea: Crear el modo avanzado de la tabla de recomendación, que se activa
con el toggle Simple/Avanzado del header. En este paso implementar solo
la lógica para productos Básico y Quiebre. Temporada se agrega después.

Requisitos:
- Misma tabla base que el modo simple pero con columnas adicionales:
  Tipo (Básico/Temporada/Quiebre editable), Lead time (editable, en días),
  Stock seguridad (editable, en días), Punto de reorden (calculado),
  Tendencia (↑↓→), Costo promedio, Inversión sugerida, Fecha emisión orden.
- Los campos Lead time, Stock seguridad y Tipo son EDITABLES inline.
  Al cambiar un valor se recalcula automáticamente la fila y se guarda en BD.
- Lead time viene del proveedor (Proveedores.LeadTimeDias). Si un proveedor
  tiene 4 productos distintos, todos comparten el mismo lead time.
- El modelo de proyección de demanda debe funcionar con lead times largos
  (90+ días). Para esto, usar velocidad promedio de 90 días como base.
- Cards de resumen arriba: Inversión total sugerida, Productos críticos,
  Comprar antes de 7 días, Productos en exceso.
- Gráfico debajo: al hacer click en un producto Básico o Quiebre, mostrar
  gráfico de línea con proyección de stock vs punto de reorden.
  El horizonte del gráfico se adapta al lead time: MAX(60, lead_time × 1.5) días.
  Mostrar marcador "Emitir orden" y "Quiebre stock".
  Si ninguno seleccionado, mostrar barras del Top 10 por urgencia.
- Crear la tabla ProductoClasificacion en Azure SQL si no existe
  (ver SQL en STOCK_SPEC.md, incluir los campos de temporada aunque
  queden NULL por ahora). Agregar LeadTimeDias a Proveedores.

No toques las secciones anteriores. Reutilizá el componente del modo
simple como base y extendelo.
```

### Prompt 4B: Agregar lógica de productos de Temporada
```
Contexto: Lee STOCK_SPEC.md, secciones "Temporada (LÓGICA COMPLETA)"
y "Visualización especial para productos de Temporada".

Tarea: Agregar al modo avanzado la lógica completa para productos
clasificados como "Temporada". Esto es DISTINTO a Básico/Quiebre:
los productos de temporada usan lógica de CALENDARIO, no de stock actual.

Requisitos:
- Cuando el usuario clasifica un producto como "Temporada", desplegar
  un mini-formulario para configurar: mes inicio temporada, mes fin,
  mes inicio liquidación. Guardar en ProductoClasificacion.
- Los 4 estados del ciclo: Fuera de temp / Pre-temp (emitir orden) /
  En temporada / Liquidación. Calcular cuál aplica según HOY vs las fechas.
- La alerta de "Emitir orden" se dispara cuando:
  HOY >= inicio_temporada - lead_time - stock_seguridad
  AUNQUE el stock sea 0 y la velocidad sea 0.
- Sugerencia de cantidad: usar ventas de la misma temporada del año
  anterior × 1.1. Si no hay datos, permitir ingreso manual.
- Al hacer click en un producto de Temporada, el gráfico cambia a
  timeline anual (12 meses) mostrando zonas de temporada, liquidación,
  y la fecha de emisión de orden. Ver spec para detalle visual.
- En estado "Liquidación": mostrar stock restante y no sugerir recompra.
- En estado "En temporada": usar velocidad real y comparar vs proyectada.

NO modifiques la lógica de Básico/Quiebre que ya funciona.
Solo agregá la lógica de Temporada sobre lo existente.
```

### Prompt 5: Integrar toggle y pulir
```
Contexto: Lee STOCK_SPEC.md, sección "INTERACCIONES Y UX".

Tarea: Integrar el toggle Simple/Avanzado en el header de la página
de Stock. El toggle controla qué modo de la tabla de recomendación
se muestra. Auto-detectar según antigüedad de datos.

También:
- Verificar que el filtro por local funcione en TODA la página
  (KPIs + Pareto + Recomendación).
- Agregar el botón de Exportar PDF que genere un reporte con
  KPIs + tabla de recomendación + fecha.
- Verificar que el Pareto ABC no se haya roto.

Este es el último paso. Probá que todo cargue correctamente.
```

---

## NOTAS PARA EL DESARROLLADOR

### Sobre la rotación mensual
La BD no tiene snapshots históricos de stock, así que no se puede calcular stock promedio exacto.
Se usa la aproximación: `stock_promedio ≈ stock_actual + (ventas_periodo / 2)`.
Es una estimación razonable para negocios retail.

### Sobre las ventas anuladas
SIEMPRE filtrar `VentaCabecera.Anulada = 0` en todas las queries de ventas.

### Sobre los datos nulos
Muchos productos pueden tener PrecioCompra NULL o Stock NULL.
SIEMPRE usar ISNULL() en cálculos numéricos para evitar que un NULL
anule todo el resultado.

### Sobre el análisis estacional (modo avanzado)
Los productos de temporada usan lógica de CALENDARIO, no de velocidad actual.
El usuario configura mes_inicio, mes_fin y mes_liquidacion para cada producto
de temporada. El sistema calcula automáticamente la fecha de emisión de orden
restando el lead_time del proveedor al inicio de la temporada.

**Cálculo de cantidad para la temporada (query de referencia):**
```sql
-- Si hay datos de la temporada anterior, usar esas ventas como base
-- Ejemplo: ojotas, temporada Oct-Feb, queremos saber cuánto se vendió Oct24-Feb25
SELECT SUM(vd.Cantidad) AS VentasTemporadaAnterior
FROM VentaDetalle vd
INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
WHERE vc.Anulada = 0
  AND p.ProductoNombreId = @ProductoNombreId
  AND (
    -- Manejo de temporadas que cruzan año (ej: Oct a Feb)
    (@MesInicio > @MesFin AND (
      (MONTH(vc.Fecha) >= @MesInicio AND YEAR(vc.Fecha) = YEAR(GETDATE()) - 1)
      OR
      (MONTH(vc.Fecha) <= @MesFin AND YEAR(vc.Fecha) = YEAR(GETDATE()))
    ))
    OR
    -- Temporadas dentro del mismo año (ej: Mar a Jul)
    (@MesInicio <= @MesFin AND
      MONTH(vc.Fecha) BETWEEN @MesInicio AND @MesFin
      AND YEAR(vc.Fecha) = YEAR(GETDATE()) - 1
    )
  )
```
Si no hay datos del año anterior, el usuario ingresa la cantidad manualmente
en el campo TemporadaCantidadEstimada.

**Los 4 estados del ciclo de temporada son:**
1. Fuera de temporada → no sugerir compra, solo mostrar fecha de próxima orden
2. Pre-temporada (emitir orden) → alerta activa, mostrar cantidad y inversión
3. En temporada → lógica normal de velocidad, monitorear vs proyección
4. Liquidación → no reponer, mostrar stock restante y sugerir descuento

### Sobre la nueva tabla de clasificación de productos
Para almacenar el tipo (Básico/Temporada/Quiebre) se necesita o bien:
- Una nueva tabla `ProductoClasificacion (ProductoNombreId, Tipo, TenantId)` en la BD del tenant
- O un campo JSON en la config del tenant en Supabase

Opción recomendada: tabla nueva en Azure SQL, es más limpio y queryable.
```sql
CREATE TABLE ProductoClasificacion (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    ProductoNombreId INT NOT NULL REFERENCES ProductoNombre(Id),
    TipoRecompra VARCHAR(20) NOT NULL DEFAULT 'Basico', -- 'Basico', 'Temporada', 'Quiebre'
    StockSeguridadDias INT NOT NULL DEFAULT 7,           -- días de colchón extra

    -- Campos exclusivos para productos de Temporada (NULL si es Básico/Quiebre)
    TemporadaMesInicio INT NULL,       -- Mes en que arranca la demanda (1-12). Ej: 10 = octubre
    TemporadaMesFin INT NULL,          -- Mes en que termina la temporada. Ej: 2 = febrero
    TemporadaMesLiquidacion INT NULL,  -- Mes en que empieza la liquidación. Ej: 1 = enero
    TemporadaCantidadEstimada INT NULL,-- Cantidad estimada para la temporada (manual o calculada)

    ModificadoEn DATETIME2 DEFAULT SYSUTCDATETIME(),
    ModificadoPor NVARCHAR(50),
    CONSTRAINT UQ_ProductoClasificacion_Nombre UNIQUE (ProductoNombreId)
);
```

### Sobre el Lead Time de proveedores
Se agrega a la tabla Proveedores existente (o se crea una tabla puente si se quiere
lead time diferente por proveedor + producto):
```sql
-- Opción simple: agregar columna a Proveedores
ALTER TABLE Proveedores ADD LeadTimeDias INT NOT NULL DEFAULT 7;

-- El usuario configura esto desde la UI del modo avanzado.
-- Si no lo configura, se usa el default de 7 días.
```

### Sobre el Stock de Seguridad
Se almacena por ProductoNombre en la tabla ProductoClasificacion.
El usuario lo configura desde la tabla de recomendación avanzada (campo editable).
Default: 7 días. Significa que el sistema sugiere comprar cuando la cobertura
cae por debajo de `lead_time + stock_seguridad_dias`.

### Sobre la proyección de demanda con lead times largos
Cuando el lead time es > 30 días (ej: proveedor de China con 90d), la velocidad
promedio de los últimos 30 días NO es suficiente para proyectar demanda.

**Implementación por etapas:**

**V1 (lanzamiento):** usar velocidad promedio de los últimos 90 días (más estable
que 30d). Esto funciona razonablemente para la mayoría de los productos.
```sql
-- Velocidad diaria base para producto con lead time largo
SELECT SUM(vd.Cantidad) * 1.0 / DATEDIFF(DAY, MIN(vc.Fecha), GETDATE()) AS VelDiaria
FROM VentaDetalle vd
INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
WHERE vc.Anulada = 0
  AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
  AND p.ProductoNombreId = @ProductoNombreId
```

**V2 (posterior):** si hay datos del año anterior, calcular factor estacional:
```sql
-- Factor estacional: ventas del mismo período del año pasado / promedio anual
-- Si ventas marzo-junio 2025 fueron 1.4× el promedio → factor = 1.4
-- Demanda proyectada = velocidad_base × factor_estacional × lead_time_dias
```

La clave es que el gráfico siempre muestra la proyección de forma visual, así
el usuario puede validar si la estimación tiene sentido antes de actuar.
El horizonte del gráfico se adapta: MAX(60 días, lead_time × 1.5).
