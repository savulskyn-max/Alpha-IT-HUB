# ESTABILIZAR.md — 3 prompts quirúrgicos para estabilizar Stock
# REGLA: NO tocar lo que funciona. Solo arreglar lo roto y quitar lo inútil.

---

## Prompt 1 de 3: LIMPIAR + arreglar rotación (Sonnet)
```
ATENCIÓN: Este prompt es SOLO de limpieza y un arreglo puntual.
NO modifiques ningún componente que funcione actualmente.
NO agregues funcionalidad nueva. Solo QUITAR y CORREGIR.

PARTE A — QUITAR cosas que no funcionan de la página de Stock:

1. En la vista de Resumen:
   - Si el treemap de "Salud del inventario" está vacío/roto, QUITARLO.
     Reemplazar con un texto simple: "Salud del inventario: próximamente"
     o directamente no mostrar nada ahí.
   - NO tocar los KPIs que funcionan, NO tocar el Pareto, NO tocar las alertas.

2. En la vista de Análisis:
   - La sección "¿Qué comprar? Distribución recomendada" (la lista de 31 modelos
     con barras naranjas, $0, 999d) → QUITARLA COMPLETAMENTE.
     Esa lista no agrega valor, muestra datos incorrectos, y confunde.
   - La sección de "Recomendación de liquidación" que muestra 66 modelos con
     items de alta rotación como Jordan 4 → QUITARLA COMPLETAMENTE.
     Está recomendando liquidar productos que se venden bien, lo cual es un error.
   - Dejar SOLO: el pronóstico de demanda (gráfico), los escenarios de compra,
     el ranking de modelos por velocidad con expansión por color/talle, y el carrito.

3. Quitar la card "Predicciones" de la página de Analítica general
   (la que muestra Ventas, Gastos, Stock, Compras, Predicciones).

PARTE B — ARREGLAR la tarjeta de rotación:

La rotación se calcula así y SOLO así:
- Rotación del mes = Unidades vendidas en el mes actual / Stock promedio
- Stock promedio = (Stock actual + Unidades vendidas del mes) / 2
  (esto estima el stock de inicio del mes como: stock_actual + lo que se vendió)
- Si stock promedio = 0, rotación = 0
- Anualizada = rotación del mes × 12

Query EXACTA para la tarjeta:
```sql
SELECT
    ISNULL(SUM(v.Cantidad), 0) AS VendidoMes,
    SUM(ISNULL(p.Stock, 0)) AS StockActual,
    CASE
        WHEN (SUM(ISNULL(p.Stock, 0)) + ISNULL(SUM(v.Cantidad), 0)) = 0 THEN 0
        ELSE ROUND(
            ISNULL(SUM(v.Cantidad), 0) * 2.0 /
            (SUM(ISNULL(p.Stock, 0)) + ISNULL(SUM(v.Cantidad), 0)),
            2)
    END AS RotacionMes
FROM Productos p
LEFT JOIN (
    SELECT vd.ProductoID, SUM(vd.Cantidad) AS Cantidad
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    WHERE vc.Anulada = 0
      AND MONTH(vc.Fecha) = MONTH(GETDATE())
      AND YEAR(vc.Fecha) = YEAR(GETDATE())
    GROUP BY vd.ProductoID
) v ON p.ProductoID = v.ProductoID
WHERE (@LocalID IS NULL OR p.LocalID = @LocalID)
```

Título de la tarjeta: "Rotación · Marzo" (mes actual dinámico).
Valor: la rotación del mes.
Subtítulo: "Anualizada: Xx"

Al hacer click: SOLO mostrar un gráfico de barras con la rotación
de los últimos 6 meses. Nada de tablas expandibles por ahora.
Si la funcionalidad de expandir por local/nombre está rota, QUITARLA.
Un gráfico de barras simple con 6 meses alcanza.

VERIFICAR antes de commitear:
- La rotación muestra un número coherente (entre 0 y 5 típicamente)
- Las secciones rotas fueron quitadas
- Todo lo que funcionaba sigue funcionando
```

---

## Prompt 2 de 3: ARREGLAR carrito + calendario (Opus)
```
ATENCIÓN: Solo tocar el carrito y el calendario. NADA MÁS.

PROBLEMA 1 — CARRITO:
Al agregar un producto al carrito, tiene estos bugs:
a) No trae el precio de compra del producto
b) Carga un solo talle en vez de la gama completa
c) No se puede editar para agregar talles
d) No se puede programar fecha de compra

Arreglar:

a) PRECIO DE COMPRA:
Al agregar al carrito, buscar el PrecioCompra del producto:
```sql
SELECT ROUND(AVG(ISNULL(p.PrecioCompra, 0)), 2) AS PrecioCompra
FROM Productos p
WHERE p.ProductoNombreId = @NombreId
  AND p.ProductoDescripcionId = @DescripcionId
  AND p.ProductoColorId = @ColorId
  AND p.PrecioCompra > 0
```
Mostrar el precio unitario en el carrito y calcular total = precio × cantidad.

b) GAMA COMPLETA DE TALLES:
Al agregar, consultar TODOS los talles que existen para esa combinación:
```sql
SELECT DISTINCT pt.Talle, pt.Id AS TalleId
FROM Productos p
INNER JOIN ProductoTalle pt ON p.ProductoTalleId = pt.Id
WHERE p.ProductoNombreId = @NombreId
  AND p.ProductoDescripcionId = @DescripcionId
ORDER BY pt.Talle
```
Pre-cargar todos los talles con cantidad 1 como default.
El usuario ajusta las cantidades.

c) EDICIÓN:
Cada talle en el carrito debe tener un input numérico editable.
Agregar botón "+" para añadir un talle que no estaba en la lista.
Agregar botón "×" para quitar un talle.

d) FECHA:
Agregar un campo de fecha (date picker) en cada item del carrito.
Default: hoy + lead time del proveedor (si está configurado) o hoy + 7 días.

PROBLEMA 2 — CALENDARIO:
Si el calendario da error 502 o no carga:

1. Verificar que la tabla OrdenCompraPlan existe. Si no:
```sql
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrdenCompraPlan')
CREATE TABLE OrdenCompraPlan (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    ProductoNombreId INT NOT NULL,
    ProveedorId INT NULL,
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

2. El endpoint del calendario debe tener try/except:
   Si la tabla no existe → devolver {"ordenes": [], "mensaje": "Sin órdenes"}
   Si hay error de conexión → devolver error claro, NO 502

3. El frontend debe manejar el caso vacío:
   Mostrar calendario con mensaje "Sin órdenes planificadas"
   y botón "Las órdenes se crean desde el carrito de compras"

4. FLUJO CARRITO → CALENDARIO:
   Cuando el usuario hace click en "Guardar orden" en el carrito:
   - POST cada item a OrdenCompraPlan con la fecha del carrito
   - Vaciar el carrito
   - Navegar al tab Calendario
   - Refrescar los datos del calendario

VERIFICAR:
- Agregar un producto al carrito con todos los talles y precio
- Editar cantidades y fecha
- Guardar → verificar que aparece en el calendario
- El calendario carga sin errores
```

---

## Prompt 3 de 3: ARREGLAR transferencias (Sonnet)
```
ATENCIÓN: Solo tocar la vista Multilocal. NADA MÁS.

La vista de transferencias debe ser SIMPLE. No necesita ser compleja.

LÓGICA:
Para cada ProductoNombre + ProductoDescripcion:
  - Calcular en cada local: stock y velocidad diaria (ventas 90d / 90)
  - Calcular cobertura = stock / velocidad (si vel = 0, cobertura = 999)
  - Si un local tiene cobertura < 10 días Y otro tiene cobertura > 45 días:
    → Recomendar transferir

QUERY:
```sql
SELECT
    pn.Nombre AS Producto,
    pd.Descripcion AS Modelo,
    l.Nombre AS Local,
    l.LocalID,
    SUM(ISNULL(p.Stock, 0)) AS Stock,
    ISNULL(SUM(v.Cantidad), 0) AS Vendidas90d,
    CASE WHEN ISNULL(SUM(v.Cantidad), 0) = 0 THEN 0
         ELSE ROUND(ISNULL(SUM(v.Cantidad), 0) / 90.0, 2)
    END AS VelDiaria,
    CASE WHEN ISNULL(SUM(v.Cantidad), 0) = 0 THEN 999
         ELSE ROUND(SUM(ISNULL(p.Stock, 0)) / (ISNULL(SUM(v.Cantidad), 0) / 90.0), 0)
    END AS CoberturaDias
FROM Productos p
INNER JOIN ProductoNombre pn ON p.ProductoNombreId = pn.Id
INNER JOIN ProductoDescripcion pd ON p.ProductoDescripcionId = pd.Id
INNER JOIN Locales l ON p.LocalID = l.LocalID
LEFT JOIN (
    SELECT vd.ProductoID, SUM(vd.Cantidad) AS Cantidad
    FROM VentaDetalle vd
    INNER JOIN VentaCabecera vc ON vd.VentaID = vc.VentaID
    WHERE vc.Anulada = 0 AND vc.Fecha >= DATEADD(DAY, -90, GETDATE())
    GROUP BY vd.ProductoID
) v ON p.ProductoID = v.ProductoID
WHERE p.Stock > 0
GROUP BY pn.Nombre, pn.Id, pd.Descripcion, pd.Id, l.Nombre, l.LocalID
HAVING SUM(ISNULL(p.Stock, 0)) > 0
ORDER BY pn.Nombre, pd.Descripcion, l.Nombre
```

VISUALIZACIÓN:
Mostrar SOLO las recomendaciones de transferencia como cards:

Si hay recomendaciones:
┌──────────────────────────────────────────┐
│ 🔄 Nike Jordan 4                         │
│ Local Shopping (stock 3, vel 1.2/d, 3d)  │
│ ← Local Centro (stock 20, vel 0.3/d, 67d)│
│ Transferir: 8 unidades                    │
│ [Confirmar]                               │
└──────────────────────────────────────────┘

Si NO hay recomendaciones:
"✓ Stock equilibrado entre locales. Sin transferencias necesarias."

NO mostrar el mapa de calor completo si no funciona bien.
NO mostrar tablas complejas. Solo las cards de transferencia.

VERIFICAR:
- La vista carga sin errores
- Si hay desbalances, muestra recomendaciones
- Si no hay, muestra el mensaje de equilibrado
```

---

## INSTRUCCIONES FINALES

EJECUTAR: Prompt 1 → verificar → Prompt 2 → verificar → Prompt 3 → verificar.

Todos con Sonnet excepto el 2 que va con Opus (el carrito tiene más lógica).

REGLA DE ORO: Después de cada prompt, verificar que LO QUE FUNCIONABA
SIGUE FUNCIONANDO. Si algo se rompió, revertir antes de continuar.

Después de estos 3 prompts, la página de Stock queda estable y funcional.
No perfecta, pero usable. Y podemos avanzar con el resto de la app.
