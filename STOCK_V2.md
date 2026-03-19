# STOCK_V2.md — Iteración de Mejoras al Módulo de Stock

> Documento de correcciones y mejoras funcionales tras primera prueba.
> Ejecutar en orden. Cada prompt es un bloque independiente.
> Lee SIEMPRE STOCK_INTELLIGENCE.md para contexto general.

---

## CORRECCIONES URGENTES (Prompts A, B, C)

### Prompt A: Corregir bugs de carga (puntos 2, 8, 10)
```
Contexto: La página de Stock tiene 3 secciones que no cargan datos.

BUG 1 - Salud del inventario (treemap): El cuadro aparece vacío.
Verificar que el endpoint que alimenta el treemap devuelve datos.
Si devuelve un array vacío, el problema es la query.
El treemap necesita para cada ProductoNombre:
- nombre
- valorStock (SUM de PrecioCompra * Stock)
- coberturaDias (calculada)
- estado (critico/bajo/ok/exceso/fuera_temp)

Si el componente no está conectado al endpoint, conectarlo.
Si el endpoint no existe, crearlo. La query base es:
```sql
SELECT 
    pn.Nombre,
    SUM(ISNULL(p.PrecioCompra, 0) * ISNULL(p.Stock, 0)) AS ValorStock,
    SUM(ISNULL(p.Stock, 0)) AS StockTotal,
    ISNULL(SUM(v.Cantidad), 0) AS Vendidas90d,
    CASE 
        WHEN ISNULL(SUM(v.Cantidad), 0) = 0 THEN 999
        ELSE ROUND(SUM(ISNULL(p.Stock, 0)) / (ISNULL(SUM(v.Cantidad), 0) / 90.0), 0)
    END AS CoberturaDias
FROM Productos p
INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
LEFT JOIN (
    SELECT vd.ProductoID, SUM(vd.Cantidad) AS Cantidad
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
    GROUP BY vd.ProductoID
) v ON p.ProductoID = v.ProductoID
WHERE (@LocalID IS NULL OR p.LocalID = @LocalID)
GROUP BY pn.Nombre, pn.Id
HAVING SUM(ISNULL(p.Stock, 0)) > 0 OR ISNULL(SUM(v.Cantidad), 0) > 0
```

BUG 2 - Calendario error 502:
El endpoint /api/v1/analytics/{tenant}/stock/calendar devuelve 502.
El error dice "Error querying ten..." lo que sugiere un error de query SQL.
Verificar:
- Que la tabla OrdenCompraPlan existe en Azure SQL. Si no, crearla:
```sql
CREATE TABLE OrdenCompraPlan (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    ProductoNombreId INT NOT NULL REFERENCES ProductoNombre(Id),
    ProveedorId INT NULL REFERENCES Proveedores(ProveedorId),
    FechaPlanificada DATE NOT NULL,
    FechaLlegadaEstimada DATE NULL,
    CantidadSugerida INT NOT NULL DEFAULT 0,
    CantidadConfirmada INT NULL,
    InversionEstimada DECIMAL(12,2) NULL,
    Estado VARCHAR(20) NOT NULL DEFAULT 'Sugerida',
    Notas NVARCHAR(500) NULL,
    CreadoEn DATETIME2 DEFAULT SYSUTCDATETIME(),
    ModificadoEn DATETIME2 DEFAULT SYSUTCDATETIME(),
    ModificadoPor NVARCHAR(50)
);
```
- Que la query del endpoint no referencia tablas o columnas que no existen
- Que el connection string del tenant está bien configurado
- Agregar try/catch con error descriptivo si la tabla no existe

BUG 3 - Modo básico no carga:
La vista simple/básica no muestra nada. Verificar:
- Que el toggle simple/avanzado funcione
- Que el endpoint se llame correctamente cuando modo = "simple"
- Que el componente de modo simple esté renderizando

Para los 3 bugs: agregar logs de error descriptivos en el backend
y devolver mensajes claros al frontend cuando algo falle, en vez de 502.
```

---

## MEJORAS FUNCIONALES (Prompts 1-7)

### Prompt 1: Rediseñar KPI de rotación (punto 1)
```
Contexto: El KPI de "Rotación Promedio Mensual" no es útil como número global.

Tarea: Reemplazar la tarjeta de rotación por una versión interactiva que
muestra la rotación del MES ACTUAL y la proyección anualizada, y que al
hacer click se desagrega.

TARJETA PRINCIPAL:
- Título: "Rotación · Marzo"
- Valor grande: rotación del mes actual
  Fórmula: unidades_vendidas_mes / ((stock_inicio_mes + stock_actual) / 2)
  Como no hay snapshot de stock_inicio_mes, estimar:
  stock_inicio_mes ≈ stock_actual + unidades_vendidas_mes
- Subtítulo: "Anualizada: {rotacion_mes × 12}x"
- Color: verde si anualizada > 6x, amarillo si 3-6x, rojo si < 3x

AL HACER CLICK se abre un panel/modal con 3 niveles de desagregación:

Nivel 1 - Por local:
| Local        | Rotación Mar | Anualizada | Stock  | Vendido |
|-------------|-------------|------------|--------|---------|
| Centro      | 0.8x        | 9.6x       | $2.1M  | 1,680   |
| Shopping    | 0.5x        | 6.0x       | $3.4M  | 1,700   |
| Online      | 1.2x        | 14.4x      | $800K  | 960     |

Nivel 2 - Al hacer click en un local, desagrega por ProductoNombre:
| Producto     | Rotación Mar | Anualizada | Stock  | Vendido | Edad prom. |
|-------------|-------------|------------|--------|---------|------------|
| Zapatillas  | 0.4x        | 4.8x       | $8.4M  | 221     | 45d        |
| Pantalon    | 0.2x        | 2.4x       | $3.2M  | 89      | 90d        |
| Medias      | 4.8x        | 57.6x      | $180K  | 29      | 8d         |

"Edad prom." = días promedio que lleva el stock actual sin venderse.
Calculado como promedio de (GETDATE() - FechaCarga) de los productos con stock.
Los productos con edad alta y rotación baja son candidatos a liquidar.

Nivel 3 - Al hacer click en un Nombre, desagrega por Descripción:
| Modelo          | Rotación | Stock | Vendido | Edad prom. |
|----------------|----------|-------|---------|------------|
| Nike Jordan 4  | 0.7x     | 17    | 36      | 30d        |
| Vans Knu Skool | 0.02x    | 120   | 3       | 180d       |

Cada nivel debe poderse colapsar/expandir y los datos se cargan LAZY.

Query para rotación por ProductoNombre:
```sql
SELECT 
    pn.Nombre,
    SUM(ISNULL(p.Stock, 0)) AS StockActual,
    ISNULL(SUM(v.Cantidad), 0) AS VendidoMes,
    -- Rotación: vendido / stock promedio estimado
    CASE 
        WHEN SUM(ISNULL(p.Stock, 0)) + ISNULL(SUM(v.Cantidad), 0) = 0 THEN 0
        ELSE ROUND(
            ISNULL(SUM(v.Cantidad), 0) * 1.0 / 
            ((SUM(ISNULL(p.Stock, 0)) + ISNULL(SUM(v.Cantidad), 0) + SUM(ISNULL(p.Stock, 0))) / 2.0),
            2)
    END AS RotacionMes,
    -- Edad promedio del stock
    AVG(DATEDIFF(DAY, p.FechaCarga, GETDATE())) AS EdadPromedioDias
FROM Productos p
INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
LEFT JOIN (
    SELECT vd.ProductoID, SUM(vd.Cantidad) AS Cantidad
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    WHERE vc.Anulada = 0
      AND MONTH(vc.Fecha) = MONTH(GETDATE())
      AND YEAR(vc.Fecha) = YEAR(GETDATE())
    GROUP BY vd.ProductoID
) v ON p.ProductoID = v.ProductoID
WHERE p.Stock > 0
  AND (@LocalID IS NULL OR p.LocalID = @LocalID)
GROUP BY pn.Nombre, pn.Id
ORDER BY RotacionMes ASC  -- Peor rotación primero
```

No toques las otras tarjetas KPI. Solo reemplazar la de rotación.
```

### Prompt 2: Pronóstico de demanda con horizonte seleccionable (puntos 3, 4 inicio)
```
Contexto: Lee STOCK_INTELLIGENCE.md, Vista 2.

Tarea: Rediseñar la Vista de Análisis por Producto. El flujo del usuario es:
PRIMERO ver el panorama completo de demanda del producto → DESPUÉS bajar al detalle.

CAMBIO 1 - SELECTOR DE PRODUCTO:
Reemplazar el input de texto por un dropdown/lista desplegable que muestre
TODOS los ProductoNombre ordenados alfabéticamente. Cada item muestra:
- Nombre del producto
- Stock total
- Estado (semáforo de cobertura)
Al seleccionar, se carga todo el análisis de ese producto.

CAMBIO 2 - PANEL DE PRONÓSTICO DE DEMANDA:
Este es el elemento principal de la vista. Al seleccionar un producto,
lo primero que ve el usuario es:

A) GRÁFICO DE EVOLUCIÓN ANUAL + PROYECCIÓN:
- Eje X: últimos 12 meses + próximos N meses (horizonte seleccionable)
- Barras grises: ventas reales mensuales de los últimos 12 meses
- Barras punteadas azules: ventas del mismo mes del año anterior (si hay)
- Línea naranja: proyección de demanda futura
- Zona sombreada: rango de confianza (±20% de la proyección)

B) SELECTOR DE HORIZONTE (encima del gráfico):
Botones: [30 días] [60 días] [90 días] [6 meses] [Personalizado: ___]
Al cambiar el horizonte, se recalcula TODO lo que aparece debajo.

C) PANEL DE PROYECCIÓN (al lado derecho del gráfico):
┌─────────────────────────────────┐
│ Pronóstico: próximos 60 días    │
│                                 │
│ Demanda estimada: 420 un.       │
│ Stock actual:     563 un.       │
│ Diferencia:       +143 un.      │
│ Cobertura real:   80 días       │
│                                 │
│ Tipo: Básico 🔄                 │
│ Factor tendencia: +15% ↑        │
│ Factor estacional: 1.2x (mar)   │
│                                 │
│ ─────────────────────────────── │
│ Si comprás 0 unidades:          │
│ → Te alcanza para 80 días       │
│ → El stock cae a 0 el 6 jun     │
│                                 │
│ Si comprás 200 unidades:        │
│ → Te alcanza para 109 días      │
│ → Capital inmovilizado: $3M     │
│ → ⚠ Alto volumen estacionado    │
│   ($3M en zapatillas es 35%     │
│    de tu stock total)           │
└─────────────────────────────────┘

ALGORITMO DE PROYECCIÓN:
```python
def proyectar_demanda(producto_nombre_id, horizonte_dias, local_id=None):
    # 1. Traer ventas mensuales de los últimos 24 meses
    ventas_mensuales = query_ventas_mensuales(producto_nombre_id, 24, local_id)
    
    # 2. Calcular velocidad base (últimos 90 días, más estable)
    vel_base = sum(ventas_ultimos_90d) / 90
    
    # 3. Factor tendencia: últimos 45d vs 45d anteriores
    vel_reciente = sum(ventas_ultimos_45d) / 45
    vel_anterior = sum(ventas_45_a_90d) / 45
    factor_tendencia = min(2.0, max(0.5, vel_reciente / vel_anterior)) if vel_anterior > 0 else 1.0
    
    # 4. Factor calendario: para cada mes del horizonte
    proyeccion_por_mes = []
    for mes in meses_del_horizonte:
        # Buscar ventas del mismo mes del año anterior
        ventas_mes_ant = ventas_mensuales.get(mes_anio_anterior)
        promedio_mensual = promedio(ventas_mensuales_anio_anterior)
        
        if ventas_mes_ant and promedio_mensual > 0:
            factor_cal = ventas_mes_ant / promedio_mensual
        else:
            factor_cal = 1.0
        
        # Si es producto de temporada, ajustar según calendario configurado
        if tipo == 'Temporada':
            factor_cal = ajustar_por_temporada(mes, config_temporada)
        
        demanda_mes = vel_base * factor_tendencia * factor_cal * dias_en_mes
        proyeccion_por_mes.append(demanda_mes)
    
    demanda_total = sum(proyeccion_por_mes)
    
    # 5. Análisis financiero de la compra
    stock_actual = query_stock_total(producto_nombre_id, local_id)
    costo_promedio = query_costo_promedio(producto_nombre_id)
    stock_total_negocio = query_valor_stock_total(local_id)
    
    cobertura_sin_comprar = stock_actual / vel_base if vel_base > 0 else 999
    
    return {
        'ventas_historicas': ventas_mensuales,
        'demanda_proyectada': demanda_total,
        'proyeccion_por_mes': proyeccion_por_mes,
        'stock_actual': stock_actual,
        'cobertura_dias': cobertura_sin_comprar,
        'vel_base': vel_base,
        'factor_tendencia': factor_tendencia,
        'factores_calendario': factores_por_mes,
        'costo_promedio': costo_promedio,
        'peso_en_stock_total': (stock_actual * costo_promedio) / stock_total_negocio
    }
```

ANÁLISIS FINANCIERO DE COMPRA (aparece debajo del pronóstico):
El sistema calcula para distintos escenarios de compra:

```
Escenarios de compra para Zapatillas (horizonte 60d):
──────────────────────────────────────────────────────
Comprar 0 un.  → Cobertura: 80d  │ Inversión: $0
Comprar 50 un. → Cobertura: 92d  │ Inversión: $750K  │ 8% del stock
Comprar 200 un.→ Cobertura: 128d │ Inversión: $3M    │ ⚠ 35% del stock
Comprar 420 un.→ Cobertura: 180d │ Inversión: $6.3M  │ ⚠ 48% del stock
──────────────────────────────────────────────────────
Recomendación: Comprar ~100 un. cubre el horizonte de 60 días
sin exceder el 15% del capital total en un solo producto.
```

La "Recomendación" se calcula así:
```
unidades_necesarias = MAX(0, demanda_proyectada - stock_actual)
// Pero limitar si el peso financiero es alto:
inversion = unidades_necesarias * costo_promedio
peso = inversion / stock_total_negocio
if peso > 0.25:
    // Advertencia: esta compra representaría más del 25% del stock total
    // Sugerir comprar en cuotas o priorizar solo los modelos más rentables
    mostrar_warning = True
```

QUERIES:
```sql
-- Ventas mensuales últimos 24 meses
SELECT 
    YEAR(vc.Fecha) AS Anio,
    MONTH(vc.Fecha) AS Mes,
    SUM(vd.Cantidad) AS UnidadesVendidas,
    SUM(vd.Cantidad * vd.PrecioUnitario) AS MontoVendido
FROM VentaDetalle vd
INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
WHERE vc.Anulada = 0
  AND p.ProductoNombreId = @ProductoNombreId
  AND vc.Fecha >= DATEADD(MONTH, -24, GETDATE())
  AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
GROUP BY YEAR(vc.Fecha), MONTH(vc.Fecha)
ORDER BY Anio, Mes

-- Costo promedio y peso en stock total
SELECT 
    ROUND(AVG(ISNULL(p.PrecioCompra, 0)), 2) AS CostoPromedio,
    SUM(ISNULL(p.PrecioCompra, 0) * ISNULL(p.Stock, 0)) AS ValorStockProducto,
    (SELECT SUM(ISNULL(p2.PrecioCompra, 0) * ISNULL(p2.Stock, 0)) 
     FROM Productos p2 
     WHERE @LocalID IS NULL OR p2.LocalID = @LocalID) AS ValorStockTotal
FROM Productos p
WHERE p.ProductoNombreId = @ProductoNombreId
  AND (@LocalID IS NULL OR p.LocalID = @LocalID)
```

Este panel es lo primero que ve el usuario. Le da el contexto completo:
cuánto se vendió históricamente, cuánto se estima vender, cuánto stock tiene,
y cuánto le conviene comprar sin inmovilizar demasiado capital.

RECIÉN DESPUÉS de ver esto, el usuario baja al detalle de descripciones.
```

### Prompt 3: Modelo predictivo refinado por descripción, color y talle (punto 4 completo)
```
Contexto: Este es el cambio más importante del módulo.
IMPORTANTE: Este análisis aparece DEBAJO del panel de pronóstico del Prompt 2.
El usuario ya vio cuánto se estima vender del producto y cuánto conviene comprar.
Ahora necesita saber QUÉ modelos, colores y talles reponer.

PROBLEMA ACTUAL:
El análisis dice que "Air Force 1" tiene cobertura de 56 días y está OK.
Pero en realidad, el color Negro talle 42 se quedó sin stock y tiene demanda,
solo que está "cubierto" por otros colores y talles que sí tienen stock.
El usuario no ve que necesita reponer ese combo específico.

FLUJO COMPLETO (el usuario ya vio el pronóstico de arriba):
1. El pronóstico dice: "Zapatillas: demanda estimada 420 un en 60 días,
   stock actual 563, recomendamos comprar ~100 un."
2. Ahora el usuario necesita saber: ¿100 unidades de QUÉ exactamente?
3. La respuesta viene de las 4 capas que siguen.

NUEVO MODELO DE ANÁLISIS (4 capas):

ENCABEZADO DEL ANÁLISIS (conecta con el pronóstico):
┌──────────────────────────────────────────────────────────────┐
│ Desglose de la recomendación de compra                       │
│ Demanda estimada: 420 un (60d) │ Stock actual: 563 un       │
│ Compra sugerida: ~100 un       │ Inversión est.: $1.5M      │
│ Con 100 un. cubrís 74 días. No se recomienda comprar más    │
│ porque el capital inmovilizado ya representa el 22% del total│
└──────────────────────────────────────────────────────────────┘

CAPA 1 (ya resuelta en Prompt 2): El pronóstico general del producto.

CAPA 2 - RANKING DE DESCRIPCIONES DENTRO DEL MARCO DE DEMANDA:
El pronóstico dice "comprar ~100 un de zapatillas". Ahora hay que distribuir
esas 100 unidades entre los modelos (Descripciones) según DOS criterios:

  a) VELOCIDAD DE SALIDA DESDE ÚLTIMA COMPRA: en moda, lo que está
     rotando rápido ahora es lo que hay que priorizar. No importa tanto
     la historia de 12 meses de un modelo si en los últimos 30 días
     dejó de venderse.

  b) COBERTURA ACTUAL DEL MODELO: un modelo con alta velocidad pero
     todavía con stock para 40 días es menos urgente que uno con
     velocidad media pero solo 5 días de cobertura.

RANKING: ordenar por un SCORE que combina ambos:
```python
score = (velocidad_salida / max_velocidad) * 0.6 + (1 - min(cobertura/60, 1)) * 0.4
# 60% peso a la velocidad (lo que está de moda)
# 40% peso a la urgencia (lo que se está quedando sin stock)
# Score más alto = más prioridad de compra
```

Para cada Descripción, calcular cuánto de las ~100 unidades le corresponde:
```python
# Distribuir las unidades recomendadas proporcionalmente al score
for desc in descripciones:
    desc.unidades_sugeridas = round(
        unidades_totales_a_comprar * (desc.score / sum_scores)
    )
    # Pero limitar: no comprar más de lo que se estima vender en el horizonte
    desc.unidades_sugeridas = min(
        desc.unidades_sugeridas,
        desc.demanda_proyectada_horizonte - desc.stock_actual
    )
    # Y no sugerir compra si la cobertura es > horizonte seleccionado
    if desc.cobertura > horizonte_dias:
        desc.unidades_sugeridas = 0
        desc.estado = 'OK - stock suficiente para el horizonte'
```

VISUALIZACIÓN:
┌───────────────────────────────────────────────────────────────┐
│ Distribución de compra recomendada (100 un. en 60 días):     │
│                                                               │
│ ▶ Nike Jordan 4    vel: 1.2/d │ stock: 17 │ 14d │ COMPRAR 35│
│ ▶ Nike SB Dunk     vel: 0.8/d │ stock: 3  │ 4d  │ COMPRAR 25│
│ ▶ Air Force 1      vel: 0.7/d │ stock: 45 │ 64d │ OK        │
│   ⚠ REVISAR: Negro sin stock, 30% de la demanda de este mod.│
│ ▶ Vans Hylane      vel: 0.3/d │ stock: 80 │267d │ EXCESO    │
│ ▶ Vans Knu Skool   vel: 0.1/d │ stock: 120│1200d│ EXCESO    │
│                                                               │
│ Comprando 35 Jordan4 + 25 SB Dunk + 40 varios = 100 un.     │
│ Cobertura ponderada post-compra: 74 días                     │
│ Inversión: $1.5M (22% del stock total)                       │
└───────────────────────────────────────────────────────────────┘

NOTA sobre Air Force 1: tiene cobertura de 64 días (está OK a nivel global)
pero tiene un color sin stock con demanda. Por eso muestra "OK" en la compra
general pero la alerta de "REVISAR" debajo. El usuario puede decidir si
agrega ese color específico al carrito o no, pero la compra principal se
concentra en Jordan 4 y SB Dunk que son los que realmente necesitan reposición.

QUERY PARA CAPA 2:
```sql
WITH ultima_compra AS (
    SELECT p.ProductoDescripcionId,
           MAX(cc.Fecha) AS FechaUltimaCompra
    FROM CompraDetalle cd
    INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
    INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
    WHERE p.ProductoNombreId = @ProductoNombreId
    GROUP BY p.ProductoDescripcionId
),
ventas_desde_compra AS (
    SELECT p.ProductoDescripcionId,
           SUM(vd.Cantidad) AS VendidasDesdeCompra,
           GREATEST(DATEDIFF(DAY, MAX(uc.FechaUltimaCompra), GETDATE()), 1) AS DiasDesdeCompra
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
    LEFT JOIN ultima_compra uc ON p.ProductoDescripcionId = uc.ProductoDescripcionId
    WHERE vc.Anulada = 0
      AND p.ProductoNombreId = @ProductoNombreId
      AND (uc.FechaUltimaCompra IS NULL OR vc.Fecha >= uc.FechaUltimaCompra)
      AND (@LocalID IS NULL OR vc.LocalID = @LocalID)
    GROUP BY p.ProductoDescripcionId
)
SELECT 
    pd.Id AS DescripcionId,
    pd.Descripcion,
    SUM(ISNULL(p.Stock, 0)) AS StockTotal,
    ISNULL(vdc.VendidasDesdeCompra, 0) AS VendidasDesdeCompra,
    ISNULL(vdc.DiasDesdeCompra, 999) AS DiasDesdeCompra,
    CASE WHEN ISNULL(vdc.DiasDesdeCompra, 0) = 0 THEN 0
         ELSE ROUND(ISNULL(vdc.VendidasDesdeCompra, 0) * 1.0 / vdc.DiasDesdeCompra, 2)
    END AS VelocidadSalida,
    -- Cobertura en días
    CASE WHEN ISNULL(vdc.VendidasDesdeCompra, 0) = 0 THEN 999
         ELSE ROUND(SUM(ISNULL(p.Stock, 0)) / 
              (ISNULL(vdc.VendidasDesdeCompra, 0) * 1.0 / vdc.DiasDesdeCompra), 0)
    END AS CoberturaDias,
    -- Costo promedio de compra
    ROUND(AVG(ISNULL(p.PrecioCompra, 0)), 2) AS CostoPromedio
FROM Productos p
INNER JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
LEFT JOIN ventas_desde_compra vdc ON p.ProductoDescripcionId = vdc.ProductoDescripcionId
WHERE p.ProductoNombreId = @ProductoNombreId
  AND (@LocalID IS NULL OR p.LocalID = @LocalID)
GROUP BY pd.Id, pd.Descripcion, vdc.VendidasDesdeCompra, vdc.DiasDesdeCompra
ORDER BY 
    CASE WHEN ISNULL(vdc.DiasDesdeCompra, 0) = 0 THEN 0
         ELSE ISNULL(vdc.VendidasDesdeCompra, 0) * 1.0 / vdc.DiasDesdeCompra
    END DESC
```

Para cada Descripción con estado COMPRAR, el sistema calcula:
- unidades_sugeridas: su porción de las ~100 unidades totales
- cobertura_post_compra: "(stock + compra) / velocidad = X días"
- inversión: unidades × costo_promedio
- mensaje: "Comprando 35 un. de Jordan 4 cubrís 45 días. 
  No se recomienda comprar más porque ya representaría $1.05M 
  (15% de tu stock total)"

CAPA 3 - ANÁLISIS POR COLOR DENTRO DE CADA DESCRIPCIÓN:
Para cada Descripción, agrupar por ProductoColor y calcular:
- Stock por color
- Vendidas por color (últimos 90 días)
- % del total de ventas de esa descripción

```sql
SELECT 
    pc.Color,
    SUM(ISNULL(p.Stock, 0)) AS StockColor,
    ISNULL(SUM(v.Cantidad), 0) AS VendidasColor,
    -- % de demanda que representa este color
    ROUND(ISNULL(SUM(v.Cantidad), 0) * 100.0 / 
        NULLIF((SELECT SUM(vd2.Cantidad) 
                FROM VentaDetalle vd2 
                INNER JOIN VentaCabecera vc2 ON vd2.VentaID = vc2.VentaID
                INNER JOIN Productos p2 ON vd2.ProductoID = p2.ProductoID
                WHERE vc2.Anulada = 0 AND vc2.Fecha >= DATEADD(DAY, -90, GETDATE())
                AND p2.ProductoDescripcionId = @DescripcionId
                AND p2.ProductoNombreId = @ProductoNombreId), 0), 1) AS PctDemanda
FROM Productos p
INNER JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
LEFT JOIN (
    SELECT vd.ProductoID, SUM(vd.Cantidad) AS Cantidad
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
    GROUP BY vd.ProductoID
) v ON p.ProductoID = v.ProductoID
WHERE p.ProductoNombreId = @ProductoNombreId
  AND p.ProductoDescripcionId = @DescripcionId
GROUP BY pc.Color, pc.Id
ORDER BY VendidasColor DESC
```

ESTADO POR COLOR:
- Si el color tiene demanda > 0 y stock = 0 → "REPONER" (rojo)
- Si el color tiene demanda > stock para 15 días → "REVISAR" (amarillo)
- Si el color tiene stock pero 0 demanda → "SIN MOVIMIENTO" (gris)
- Si el color está equilibrado → "OK" (verde)

CAPA 4 - DISTRIBUCIÓN DE TALLES POR COLOR:
Para cada Color con estado REPONER o REVISAR, mostrar los talles
con demanda relativa (% del total de ese color) y stock actual.

Este es el nivel más granular y es SOLO UNA RECOMENDACIÓN.
Mostrar un aviso: "Recomendación de talles basada en demanda.
Considerar que muchas veces hay que comprar la gama completa."

VISUALIZACIÓN EN LA UI:

Al seleccionar un producto (Zapatillas), se ve:

1. Gráfico de ventas anual (del prompt anterior)

2. Lista de DESCRIPCIONES ordenadas por velocidad de salida:
   ┌─────────────────────────────────────────────────┐
   │ ▶ Nike Jordan 4    vel: 1.2/d  stock: 17  14d  │ ← click para expandir
   │ ▶ Nike SB Dunk     vel: 0.8/d  stock: 3   4d   │
   │ ▶ Air Force 1      vel: 0.7/d  stock: 45  64d  │
   │   ⚠ REVISAR: Negro 42 sin stock, 30% demanda   │ ← alerta visible SIN expandir
   │ ▶ Vans Hylane      vel: 0.3/d  stock: 80  267d │
   └─────────────────────────────────────────────────┘

3. Al expandir una Descripción (Air Force 1):
   ┌─────────────────────────────────────────────────┐
   │ COLORES:                                        │
   │ 🔴 Negro   | 30% demanda | stock: 0 | REPONER  │
   │ 🟢 Blanco  | 25% demanda | stock: 18 | OK      │
   │ 🟢 Gris    | 20% demanda | stock: 12 | OK      │
   │ ⚪ Rojo    | 0% demanda  | stock: 8 | SIN MOV. │
   │                                                 │
   │ ▼ Negro — distribución de talles recomendada:   │
   │   40 ████████████ 22% demanda  ← PRIORIDAD     │
   │   42 ██████████ 20% demanda    ← PRIORIDAD     │
   │   41 ████████ 18% demanda                       │
   │   39 ██████ 15% demanda                         │
   │   ...                                           │
   │   ℹ Considerar comprar gama completa 37-44      │
   │                                                 │
   │ 📍 Demanda por local:                           │
   │   Centro: 45% (13.5 un/mes)                     │
   │   Shopping: 35% (10.5 un/mes)                   │
   │   Online: 20% (6 un/mes)                        │
   │                                                 │
   │ [+ Agregar al carrito de compra]                 │
   └─────────────────────────────────────────────────┘

DEMANDA POR LOCAL (dentro de cada expansión):
```sql
SELECT 
    l.Nombre AS Local,
    SUM(vd.Cantidad) AS Vendidas,
    ROUND(SUM(vd.Cantidad) * 100.0 / NULLIF(
        (SELECT SUM(vd2.Cantidad) FROM VentaDetalle vd2 
         INNER JOIN VentaCabecera vc2 ON vd2.VentaID = vc2.VentaID
         INNER JOIN Productos p2 ON vd2.ProductoID = p2.ProductoID
         WHERE vc2.Anulada = 0 AND vc2.Fecha >= DATEADD(DAY, -90, GETDATE())
         AND p2.ProductoNombreId = @NombreId AND p2.ProductoDescripcionId = @DescId
         AND p2.ProductoColorId = @ColorId), 0), 1) AS PctDemanda
FROM VentaDetalle vd
INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
INNER JOIN Locales l ON vc.LocalID = l.LocalID
WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
  AND p.ProductoNombreId = @NombreId
  AND p.ProductoDescripcionId = @DescId
  AND p.ProductoColorId = @ColorId
GROUP BY l.Nombre
ORDER BY Vendidas DESC
```

ALERTAS VISIBLES SIN EXPANDIR:
Cuando una Descripción está en estado OK a nivel global pero tiene
un color/talle crítico, mostrar el mensaje de alerta debajo de la fila
SIN necesidad de expandir. Ejemplo:
"⚠ REVISAR: Negro 42 sin stock, representa 30% de la demanda"
"⚠ REVISAR: 2 colores con demanda sin stock"

Esto evita que situaciones críticas queden ocultas.

Los datos de cada capa se cargan LAZY:
- Capa 2 (descripciones): al seleccionar el producto
- Capa 3 (colores): al expandir la descripción
- Capa 4 (talles): al expandir el color
- Demanda por local: junto con capa 3

─────────────────────────────────────────────────────────────
SECCIÓN DE LIQUIDACIÓN (aparece al final de la lista de descripciones)
─────────────────────────────────────────────────────────────

Debajo de la lista de descripciones con sus estados de COMPRAR/OK/REVISAR,
agregar una sección separada visualmente con los modelos que se recomienda
LIQUIDAR. Estos son los que tienen stock pero no rotan.

CRITERIOS PARA RECOMENDAR LIQUIDACIÓN:
```python
def detectar_liquidacion(descripcion, producto_tipo):
    # Un modelo es candidato a liquidar si:
    
    # 1. Tiene stock > 0
    if stock == 0:
        return False
    
    # 2. Velocidad de salida muy baja o nula
    #    (menos del 10% de la velocidad promedio del Nombre padre)
    vel_promedio_nombre = velocidad_total_nombre / cantidad_descripciones_con_venta
    if velocidad_salida > vel_promedio_nombre * 0.1:
        return False  # todavía rota algo, no liquidar
    
    # 3. Edad del stock alta
    #    (FechaCarga promedio de los SKUs con stock > 60 días)
    if edad_promedio < 60:
        return False  # es stock reciente, darle tiempo
    
    # 4. Si es producto de temporada y estamos fuera de temporada
    #    → liquidar siempre el remanente
    if producto_tipo == 'Temporada' and estado == 'Fuera de temp.':
        return True
    
    # 5. Cobertura absurdamente alta (> 365 días)
    if cobertura > 365:
        return True  # con la demanda actual, tarda más de un año en venderse
    
    return edad_promedio > 60 and velocidad_salida < vel_promedio_nombre * 0.1
```

QUERY PARA DETECTAR MODELOS A LIQUIDAR:
```sql
WITH vel_por_desc AS (
    SELECT 
        p.ProductoDescripcionId,
        pd.Descripcion,
        SUM(ISNULL(p.Stock, 0)) AS StockTotal,
        SUM(ISNULL(p.PrecioCompra, 0) * ISNULL(p.Stock, 0)) AS ValorStock,
        AVG(DATEDIFF(DAY, p.FechaCarga, GETDATE())) AS EdadPromDias,
        ISNULL(SUM(v90.Cantidad), 0) AS Vendidas90d,
        CASE WHEN ISNULL(SUM(v90.Cantidad), 0) = 0 THEN 0
             ELSE ROUND(ISNULL(SUM(v90.Cantidad), 0) / 90.0, 3)
        END AS VelDiaria
    FROM Productos p
    INNER JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
    LEFT JOIN (
        SELECT vd.ProductoID, SUM(vd.Cantidad) AS Cantidad
        FROM VentaDetalle vd
        INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
        WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
        GROUP BY vd.ProductoID
    ) v90 ON p.ProductoID = v90.ProductoID
    WHERE p.ProductoNombreId = @ProductoNombreId
      AND p.Stock > 0
      AND (@LocalID IS NULL OR p.LocalID = @LocalID)
    GROUP BY p.ProductoDescripcionId, pd.Descripcion
),
vel_promedio_nombre AS (
    SELECT AVG(VelDiaria) AS VelPromedioNombre
    FROM vel_por_desc
    WHERE VelDiaria > 0
)
SELECT 
    v.Descripcion,
    v.StockTotal,
    v.ValorStock,
    v.EdadPromDias,
    v.Vendidas90d,
    v.VelDiaria,
    CASE 
        WHEN v.VelDiaria = 0 THEN 999
        ELSE ROUND(v.StockTotal / v.VelDiaria, 0)
    END AS CoberturaDias
FROM vel_por_desc v
CROSS JOIN vel_promedio_nombre vp
WHERE v.StockTotal > 0
  AND (
    -- Sin venta en 90 días y edad > 60 días
    (v.Vendidas90d = 0 AND v.EdadPromDias > 60)
    -- O velocidad < 10% del promedio y edad > 60 días
    OR (v.VelDiaria < vp.VelPromedioNombre * 0.1 AND v.EdadPromDias > 60)
    -- O cobertura > 365 días
    OR (v.VelDiaria > 0 AND v.StockTotal / v.VelDiaria > 365)
  )
ORDER BY v.ValorStock DESC  -- Los de mayor capital inmovilizado primero
```

PARA CADA MODELO A LIQUIDAR, desglosar por color y talle:
```sql
-- Detalle de SKUs sin movimiento de un modelo a liquidar
SELECT 
    pc.Color,
    pt.Talle,
    p.Stock,
    ISNULL(p.PrecioCompra, 0) AS PrecioCosto,
    p.PrecioVenta,
    DATEDIFF(DAY, p.FechaCarga, GETDATE()) AS DiasEnStock,
    ISNULL(v.Vendidas, 0) AS Vendidas90d
FROM Productos p
LEFT JOIN ProductoColor pc ON p.ProductoColorId = pc.Id
LEFT JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
LEFT JOIN (
    SELECT vd.ProductoID, SUM(vd.Cantidad) AS Vendidas
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
    GROUP BY vd.ProductoID
) v ON p.ProductoID = v.ProductoID
WHERE p.ProductoNombreId = @ProductoNombreId
  AND p.ProductoDescripcionId = @DescripcionId
  AND p.Stock > 0
  AND (@LocalID IS NULL OR p.LocalID = @LocalID)
ORDER BY ISNULL(v.Vendidas, 0) ASC, DATEDIFF(DAY, p.FechaCarga, GETDATE()) DESC
```

VISUALIZACIÓN DE LIQUIDACIÓN:
La sección aparece al final de la lista de descripciones, separada 
con un divisor visual y un encabezado distinto:

┌───────────────────────────────────────────────────────────────┐
│ 🏷️ Recomendación de liquidación                              │
│ Capital inmovilizado en stock sin rotación: $1.850.000       │
│                                                               │
│ ▶ Vans Knu Skool   120 un. │ $1.2M │ 180 días │ 0 vtas/90d │
│   Detalle: 8 colores, 45 talles sin movimiento               │
│   Sugerencia: descuento 30-40% o incluir en promo 2×1       │
│                                                               │
│ ▶ Tesla Classic     25 un. │ $375K │ 120 días │ 2 vtas/90d  │
│   Detalle: Blanco 43(5) 44(3), Gris 41(4) 42(5) sin venta  │
│   Sugerencia: descuento 20% en talles extremos               │
│                                                               │
│ ▶ Ogiy Runner       18 un. │ $270K │ 95 días  │ 1 vta/90d   │
│   Detalle: Azul sin movimiento en ningún talle                │
│   Sugerencia: liquidar color completo, descuento 40%         │
│                                                               │
│ ─────────────────────────────────────────────────────────────│
│ Total capital recuperable (estimado con 30% desc): $1.295.000 │
│                                                               │
│ [Exportar lista de liquidación PDF]                           │
│ [Transferir entre locales primero]                            │
└───────────────────────────────────────────────────────────────┘

Al expandir un modelo a liquidar, se muestra la tabla de color × talle
con stock, días en inventario, y ventas, para que el usuario vea
EXACTAMENTE qué combinaciones son las que no rotan.

SUGERENCIA DE DESCUENTO (calculada automáticamente):
```python
def sugerir_descuento(edad_dias, vendidas_90d, cobertura):
    if vendidas_90d == 0 and edad_dias > 120:
        return 40  # Stock muerto, descuento agresivo
    if vendidas_90d == 0 and edad_dias > 60:
        return 30  # Sin venta reciente
    if cobertura > 365:
        return 30  # Más de un año de cobertura
    if cobertura > 180:
        return 20  # Medio año de cobertura
    return 15  # Rotación muy lenta pero algo se vende
```

CAPITAL RECUPERABLE:
Estimar cuánto recupera el negocio si liquida todo el stock muerto
aplicando el descuento sugerido sobre el PrecioVenta:
capital_recuperable = SUM(stock × PrecioVenta × (1 - descuento/100))

INTEGRACIÓN CON MULTILOCAL:
Antes de liquidar, el sistema verifica si algún otro local tiene demanda
de ese modelo. Si Local A tiene Knu Skool sin rotación pero Local B vendió
3 pares el último mes, la primera recomendación es "Transferir a Local B"
en vez de "Liquidar". El botón "Transferir entre locales primero" lleva
a la vista Multilocal filtrada por ese modelo.
```

### Prompt 4: Carrito de compra (puntos 5, 7)
```
Contexto: A medida que el usuario analiza productos y encuentra qué reponer,
necesita ir armando una orden de compra. No debería tener que anotar en otro lado.

Tarea: Crear un componente de "Carrito de compra" persistente que aparece
como un panel lateral o barra inferior en la Vista de Análisis.

AGREGAR AL CARRITO:
En cada expansión de color (Capa 3 del análisis), hay un botón
"[+ Agregar al carrito]". Al hacer click:
1. Agrega el producto con: Nombre, Descripción, Color seleccionado
2. Pre-carga los talles con las cantidades sugeridas (distribución por demanda)
3. El usuario puede editar las cantidades por talle o marcar "Gama completa"
4. Auto-detecta el proveedor: buscar en CompraCabecera la última compra
   de productos con ese ProductoNombreId + ProductoDescripcionId, traer
   el ProveedorId y nombre del proveedor.

```sql
-- Encontrar último proveedor de un producto
SELECT TOP 1 prov.Nombre, prov.ProveedorId, prov.Telefono, prov.Email
FROM CompraDetalle cd
INNER JOIN CompraCabecera cc ON cd.CompraId = cc.CompraId
INNER JOIN Proveedores prov ON cc.ProveedorId = prov.ProveedorId
INNER JOIN Productos p ON cd.ProductoId = p.ProductoID
WHERE p.ProductoNombreId = @NombreId
  AND p.ProductoDescripcionId = @DescripcionId
ORDER BY cc.Fecha DESC
```

VISUALIZACIÓN DEL CARRITO:
Panel lateral derecho que muestra:

┌─────────────────────────────────┐
│ 🛒 Orden de compra (3 items)    │
│                                 │
│ Proveedor: NikeAR               │
│ ┌─────────────────────────────┐ │
│ │ Air Force 1 · Negro         │ │
│ │ 38(2) 39(3) 40(4) 41(3)   │ │
│ │ 42(4) 43(2)               │ │
│ │ 18 un × $15.000 = $270.000│ │
│ │ [Editar] [Quitar]         │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ Jordan 4 · Negro            │ │
│ │ 38(3) 39(4) 40(5) 41(4)   │ │
│ │ 42(5) 43(3)               │ │
│ │ 24 un × $22.000 = $528.000│ │
│ │ [Editar] [Quitar]         │ │
│ └─────────────────────────────┘ │
│                                 │
│ ─────────────────────────────── │
│ Total: 42 unidades              │
│ Inversión: $798.000             │
│                                 │
│ [Guardar como orden planificada]│
│ [Exportar PDF]                  │
│ [Limpiar carrito]               │
└─────────────────────────────────┘

EDICIÓN DEL CARRITO:
Al hacer click en "Editar" de un item:
- Se puede cambiar la cantidad de cada talle
- Se puede cambiar el color
- Se puede cambiar el proveedor (dropdown de proveedores)
- El precio unitario viene de PrecioCompra del producto.
  Si hay varios PrecioCompra (distintos SKUs), usar el promedio.
- El total se recalcula en tiempo real

AGRUPAR POR PROVEEDOR:
Si el carrito tiene items de distintos proveedores, agrupar:
- Sección "NikeAR" con sus items y subtotal
- Sección "ImportChina" con sus items y subtotal
- Total general

GUARDAR COMO ORDEN:
Al hacer click "Guardar como orden planificada":
- Crear registros en OrdenCompraPlan (uno por item del carrito)
- Estos aparecen en el Calendario como órdenes planificadas
- Vaciar el carrito después de guardar

PERSISTENCIA:
El carrito se mantiene mientras el usuario navega entre tabs.
Guardar en state del frontend (no en DB hasta que confirme).
Si cierra sesión se pierde, y eso está bien.

PRECIO UNITARIO:
```sql
-- Precio de compra promedio para un producto
SELECT ROUND(AVG(ISNULL(p.PrecioCompra, 0)), 2) AS PrecioCompraPromedio
FROM Productos p
WHERE p.ProductoNombreId = @NombreId
  AND p.ProductoDescripcionId = @DescripcionId
  AND p.PrecioCompra > 0
```
```

### Prompt 5: Limpiar vista Resumen (punto 6)
```
Tarea: En la vista de Resumen (tab principal), eliminar la tabla larga
de configuración masiva que aparece debajo del Pareto.

La configuración ahora se hace desde la Vista de Análisis donde el usuario
selecciona un producto y configura tipo, lead time, seguridad, etc.

Dejar la vista de Resumen limpia con solo:
1. Tarjetas KPI
2. Treemap de salud del inventario (que ya se arregló en Prompt A)
3. Panel de alertas urgentes
4. Pareto ABC

Nada más. Si el usuario necesita configurar masivamente, puede ir
a la Vista de Análisis y recorrer los productos.
```

### Prompt 6: Renovar optimización multilocal (punto 9)
```
Contexto: La vista multilocal debe reflejar el nuevo modelo de análisis
por color y talle, no solo por ProductoNombre.

Tarea: Actualizar la vista de optimización entre locales.

MAPA DE COBERTURA POR LOCAL:
El mapa de calor actual muestra cobertura por ProductoNombre × Local.
Mejorar para que al expandir un ProductoNombre se vea:
- Cobertura por Descripción × Local
- Y dentro de cada Descripción, los colores con desbalance

RECOMENDACIONES DE TRANSFERENCIA MEJORADAS:
Las transferencias ahora deben ser específicas:

EN VEZ DE: "Mover 15 Zapatillas de Centro a Shopping"
AHORA: "Mover 5 Air Force 1 Negro (talles 40, 41, 42) de Centro a Shopping.
        Centro tiene 20 pares sin demanda, Shopping tiene 0 con demanda de 2/semana."

Query para detectar desbalances por local a nivel Descripción+Color:
```sql
WITH stock_por_local AS (
    SELECT 
        p.ProductoNombreId, p.ProductoDescripcionId, p.ProductoColorId,
        p.LocalID,
        SUM(ISNULL(p.Stock, 0)) AS Stock
    FROM Productos p
    GROUP BY p.ProductoNombreId, p.ProductoDescripcionId, p.ProductoColorId, p.LocalID
),
demanda_por_local AS (
    SELECT 
        p.ProductoNombreId, p.ProductoDescripcionId, p.ProductoColorId,
        vc.LocalID,
        SUM(vd.Cantidad) * 1.0 / 90 AS VelDiaria
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    INNER JOIN Productos p ON vd.ProductoID = p.ProductoID
    WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
    GROUP BY p.ProductoNombreId, p.ProductoDescripcionId, p.ProductoColorId, vc.LocalID
)
SELECT 
    pn.Nombre, pd.Descripcion, pc.Color,
    l.Nombre AS Local,
    ISNULL(s.Stock, 0) AS Stock,
    ISNULL(d.VelDiaria, 0) AS VelDiaria,
    CASE WHEN ISNULL(d.VelDiaria, 0) = 0 THEN 999
         ELSE ROUND(ISNULL(s.Stock, 0) / d.VelDiaria, 0)
    END AS CoberturaDias
FROM stock_por_local s
FULL OUTER JOIN demanda_por_local d 
    ON s.ProductoNombreId = d.ProductoNombreId 
    AND s.ProductoDescripcionId = d.ProductoDescripcionId
    AND s.ProductoColorId = d.ProductoColorId
    AND s.LocalID = d.LocalID
INNER JOIN ProductoNombre pn ON COALESCE(s.ProductoNombreId, d.ProductoNombreId) = pn.Id
INNER JOIN ProductoDescripcion pd ON COALESCE(s.ProductoDescripcionId, d.ProductoDescripcionId) = pd.Id
INNER JOIN ProductoColor pc ON COALESCE(s.ProductoColorId, d.ProductoColorId) = pc.Id
INNER JOIN Locales l ON COALESCE(s.LocalID, d.LocalID) = l.LocalID
```

Algoritmo de transferencia:
Para cada combinación Nombre+Desc+Color con desbalance entre locales:
  Si local A tiene cobertura > 60d Y local B tiene cobertura < 15d:
    Calcular cuánto transferir sin dejar a A en riesgo
    Mostrar los talles disponibles en A que B necesita
    Calcular ahorro vs comprar nuevo

VISUALIZACIÓN:
Cards de transferencia que muestran:
┌──────────────────────────────────────────────┐
│ Air Force 1 · Negro                          │
│ Centro (cobert. 120d) → Shopping (cobert. 3d)│
│ Transferir: 5 pares (40×1, 41×2, 42×2)      │
│ Shopping queda en ~18d de cobertura          │
│ Ahorro vs compra nueva: $75.000              │
│ [Confirmar transferencia]                    │
└──────────────────────────────────────────────┘

Que la demanda proyectada por local (del Prompt 3) se integre acá
para que cuando el usuario arme la orden de compra, pueda distribuir
las unidades entre locales proporcionalmente a la demanda de cada uno.
```

### Prompt 7: Integrar todo y verificar
```
Tarea: Verificar que todas las piezas se integran correctamente.

1. Vista Resumen: KPIs (con rotación interactiva) + Treemap + Alertas + Pareto
   SIN la tabla larga de configuración.
   En las alertas urgentes, incluir también alertas de liquidación:
   "🏷️ $1.2M en Vans Knu Skool sin rotación · 120 un. hace 180 días · Liquidar"
   
   Agregar al treemap: los productos con capital inmovilizado alto y sin
   rotación deben mostrarse en color MORADO/VIOLETA para distinguirlos
   de los que tienen exceso pero sí rotan (esos son azules).

2. Vista Análisis: Selector dropdown + Pronóstico con horizonte seleccionable
   + Modelo 4 capas (Nombre → Descripción por velocidad → Color → Talles)
   + Sección de liquidación al final de la lista de descripciones
   + Carrito de compra lateral + Demanda por local en cada expansión.
   + Alertas de "REVISAR" visibles sin expandir.

3. Vista Calendario: Corregido el error 502. Las órdenes guardadas desde
   el carrito aparecen acá.

4. Vista Multilocal: Mapa de cobertura renovado con detalle por Desc+Color
   + Recomendaciones de transferencia específicas con talles.
   + Antes de recomendar liquidar, verificar si otro local tiene demanda.

Verificar flujo completo:

FLUJO DE COMPRA:
- Usuario entra al Resumen → ve que Zapatillas tiene alerta
- Click en Zapatillas → va a Análisis
- Ve pronóstico: "420 un demanda en 60d, stock 563, comprar ~100"
- Baja al desglose: Jordan 4 necesita 35 un, SB Dunk 25 un
- Expande Jordan 4 → ve que Negro está sin stock con 30% de demanda
- Expande Negro → ve distribución de talles, demanda por local
- Click "Agregar al carrito" → se agrega con proveedor auto-detectado
- Sigue analizando, agrega más items al carrito
- En el carrito ajusta cantidades, ve el total
- Click "Guardar orden" → aparece en el Calendario

FLUJO DE LIQUIDACIÓN:
- En la misma vista de Análisis de Zapatillas, baja hasta la sección
  de liquidación → ve que Vans Knu Skool tiene 120 un. hace 180 días
- Expande → ve que son 8 colores y 45 talles sin movimiento
- Ve sugerencia: "descuento 30-40%"
- Ve capital recuperable estimado
- Click "Transferir entre locales primero" → va a Multilocal filtrado
- Si otro local tiene demanda de Knu Skool → recomienda transferir
- Si ningún local tiene demanda → confirma liquidación
- Click "Exportar lista de liquidación PDF" → genera reporte

Todo este flujo debe funcionar sin trabas ni errores.
```

---

## ORDEN DE EJECUCIÓN

| # | Prompt | Modelo | Descripción |
|---|--------|--------|-------------|
| A | Bugs   | Sonnet | Corregir treemap, calendario 502, modo básico |
| 1 | Rotación | Sonnet | KPI de rotación interactiva |
| 2 | Pronóstico | **Opus** | Pronóstico de demanda con horizonte + escenarios de compra |
| 3 | Modelo predictivo | **Opus** | 4 capas de análisis + alertas + liquidación |
| 4 | Carrito | Sonnet | Panel de carrito de compra |
| 5 | Limpiar resumen | Sonnet | Quitar tabla larga, agregar alertas de liquidación |
| 6 | Multilocal | **Opus** | Renovar con detalle por color/talle + priorizar transferencia antes de liquidar |
| 7 | Integrar | Sonnet | Verificación del flujo completo (compra + liquidación) |
