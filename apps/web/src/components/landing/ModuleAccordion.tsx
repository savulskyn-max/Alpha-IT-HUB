'use client';

import { useState } from 'react';
import Image from 'next/image';

interface Module {
  tag: string;
  title: string;
  shortDesc: string;
  desc: string;
  features: string[];
  image: string;
  imageAlt: string;
}

const MODULES: Module[] = [
  {
    tag: 'Clientes',
    title: 'Base de clientes y cuenta corriente',
    shortDesc: 'Historial, saldos y fidelización de clientes',
    desc: 'Administrá toda tu cartera desde un único lugar. Gestioná saldos, historial de compras y construí relaciones comerciales duraderas con tu base de clientes.',
    features: [
      'Alta y edición con DNI, CUIT, email, teléfono y dirección',
      'Control de saldo y cuenta corriente en tiempo real',
      'Historial completo de compras y pagos por cliente',
      'Pagos recientes y opción de saldar cuenta desde el panel',
      'Filtros avanzados para búsqueda rápida',
      'Envío automático de facturas en PDF al email del cliente',
    ],
    image: '/sistema/Clientes.png',
    imageAlt: 'Pantalla del módulo de gestión de clientes del sistema Alpha IT Hub',
  },
  {
    tag: 'Productos',
    title: 'Stock, precios y catálogo',
    shortDesc: 'Inventario con variantes de talle, color y precios',
    desc: 'Manejá tu inventario con precisión. El sistema soporta variantes de talle y color, múltiples precios y control de stock por local y sucursal.',
    features: [
      'Productos con nombre, talle, color, precio de compra, minorista y mayorista',
      'Control de stock en tiempo real por local y sucursal',
      'Generación automática de códigos de barras',
      'Transferencia de stock entre locales',
      'Actualización masiva de precios',
      'Impresión de etiquetas directamente desde el módulo',
    ],
    image: '/sistema/Gestión-de-productos.png',
    imageAlt: 'Pantalla de gestión de productos con variantes de talle y color',
  },
  {
    tag: 'Punto de Venta',
    title: 'Sistema de ventas ágil',
    shortDesc: 'POS rápido con escaneo, facturación y múltiples pagos',
    desc: 'La pantalla de ventas está diseñada para la velocidad. Escaneá productos, seleccioná cliente y cerrá la venta en segundos con cualquier método de pago.',
    features: [
      'Escaneo por código de barras para agregar productos al instante',
      'Cambio entre precio minorista y mayorista con un toggle',
      'Tipos de venta: Física u Online',
      'Facturación electrónica integrada (AFIP/ARCA)',
      'Múltiples métodos de pago y destino de caja configurable',
      'Devoluciones, comprobantes y configuración de impresora',
    ],
    image: '/sistema/Ventas.png',
    imageAlt: 'Pantalla del punto de venta con carro de compras y métodos de pago',
  },
  {
    tag: 'Visualización de Ventas',
    title: 'Detalle y trazabilidad de ventas',
    shortDesc: 'Filtros avanzados, estados y trazabilidad completa',
    desc: 'Visualizá todas las ventas con filtros potentes. Controlá lo que ingresó, cuándo y cómo, con trazabilidad completa de cada operación.',
    features: [
      'Total de ventas, productos vendidos y dinero ingresado en tiempo real',
      'Filtros por fecha, local, cliente, vendedor, método de pago, tipo y producto',
      'Estado de facturación y estado de pago por venta',
      'Acceso al CAE para ventas con factura electrónica',
      'Exportación de datos y facturación masiva',
      'Control de dinero en cajas desde la misma pantalla',
    ],
    image: '/sistema/visualización-de-ventas.png',
    imageAlt: 'Pantalla de visualización de ventas con filtros avanzados y trazabilidad',
  },
  {
    tag: 'Compras',
    title: 'Control de compras a proveedores',
    shortDesc: 'Registro ordenado de compras, proveedores y pagos',
    desc: 'Registrá cada compra con el método de pago y local correspondiente. Mantené un historial ordenado, consultable y filtrable.',
    features: [
      'Registro de compras por proveedor, local y fecha',
      'Detalle de caja o cuenta utilizada para el pago',
      'Múltiples métodos de pago por compra (pago dividido)',
      'Vista detallada con desglose completo',
      'Filtros de búsqueda por proveedor, fecha y local',
      'Historial completo con paginación',
    ],
    image: '/sistema/Compras-2.png',
    imageAlt: 'Módulo de compras a proveedores con historial y métodos de pago',
  },
  {
    tag: 'Gastos',
    title: 'Registro y clasificación de gastos',
    shortDesc: 'Control total de egresos operativos por categoría',
    desc: 'Registrá cualquier gasto operativo con clasificación por tipo, categoría y local. Visibilidad total sobre dónde va tu dinero.',
    features: [
      'Registro rápido con clasificación, tipo, descripción y monto',
      'Selección de local y cuenta/caja de origen',
      'Categorías configurables: Costos Fijos, Marketing, Otros',
      'Historial completo con fechas y descripción detallada',
      'Filtros para auditoría y control contable',
      'Sin límite de entradas históricas',
    ],
    image: '/sistema/Gastos-2.png',
    imageAlt: 'Módulo de gastos con clasificación por categorías y filtros',
  },
  {
    tag: 'Caja',
    title: 'Movimientos de caja',
    shortDesc: 'Ingresos, egresos y transferencias entre cajas',
    desc: 'Registrá movimientos de dinero que no son ventas ni gastos directos: transferencias entre cajas, ingresos especiales y ajustes manuales.',
    features: [
      'Registro de ingresos y egresos con descripción libre',
      'Selección de local, cuenta origen y monto',
      'Historial cronológico de todos los movimientos',
      'Descripción detallada para trazabilidad completa',
      'Organización por tipo (Ingreso / Egreso)',
      'Control de flujo entre Mercado Pago y caja física',
    ],
    image: '/sistema/ingresos-y-egresos.png',
    imageAlt: 'Módulo de ingresos y egresos de caja con historial cronológico',
  },
  {
    tag: 'Fichadas',
    title: 'Control de asistencia del personal',
    shortDesc: 'Registro de entradas, salidas y horarios del equipo',
    desc: 'Llevá el control de entrada y salida de tu equipo desde el propio sistema. Sin planillas ni anotaciones externas.',
    features: [
      'Registro de entrada, salida, descanso y retorno por empleado',
      'Historial filtrable por usuario, local, tipo y fecha',
      'Control por sucursal: cada local registra su personal',
      'Interfaz simple para que el empleado marque su fichada',
      'Integrado con el módulo de usuarios del sistema',
      'Base para el cálculo y auditoría de horas trabajadas',
    ],
    image: '/sistema/fichadas.png',
    imageAlt: 'Módulo de fichadas del personal con registro de entradas y salidas',
  },
  {
    tag: 'Email Marketing',
    title: 'Campañas de email a clientes',
    shortDesc: 'Comunicación directa sin herramientas externas',
    desc: 'Comunicá novedades, promociones y ofertas directamente a tu base de clientes desde el propio sistema, sin depender de herramientas externas.',
    features: [
      'Creación de campañas con nombre, asunto y contenido rico',
      'Programación de envíos por fecha y hora específica',
      'Segmentación por local o envío masivo',
      'Editor de texto con formato, imágenes y links',
      'Activación y desactivación con control total',
      'Lista de destinatarios con email, nombre y origen',
    ],
    image: '/sistema/Email-marketing.png',
    imageAlt: 'Panel de email marketing con listado de campañas programadas',
  },
  {
    tag: 'Etiquetas',
    title: 'Diseño e impresión de etiquetas',
    shortDesc: 'Etiquetas personalizadas con código de barras',
    desc: 'Imprimí etiquetas profesionales para tus productos. Diseñá el layout, elegí qué información mostrar y calibrá tu impresora directamente desde el sistema.',
    features: [
      'Configuración de tamaño en mm y resolución DPI',
      'Selección de campos: nombre, talle, color, precio y código de barras',
      'Vista previa en tiempo real del diseño',
      'Texto de marca personalizable',
      'Ajuste de offset y margen para calibración',
      'Diseñador visual con canvas editable',
    ],
    image: '/sistema/etiquetas.png',
    imageAlt: 'Diseñador de etiquetas con vista previa y configuración de impresora',
  },
  {
    tag: 'AFIP / ARCA',
    title: 'Facturación electrónica ARCA',
    shortDesc: 'Integración directa con ARCA/AFIP por sucursal',
    desc: 'Configurá la facturación electrónica con integración directa a ARCA. Cada local puede tener su propio perfil con sincronización automática.',
    features: [
      'Configuración de perfiles ARCA por local/sucursal',
      'Sincronización automática entre dispositivos',
      'Carga de certificado digital .pfx con clave de seguridad',
      'Datos de facturación configurables por sucursal',
      'Generación de CAE directamente desde el sistema de ventas',
      'Compatible con todos los tipos de comprobante AFIP',
    ],
    image: '/sistema/arca.png',
    imageAlt: 'Configuración de facturación electrónica ARCA/AFIP por sucursal',
  },
  {
    tag: 'Email SMTP',
    title: 'Envío automático de facturas',
    shortDesc: 'Facturas en PDF por email al cliente después de cada venta',
    desc: 'Configurá el servidor de email para que el sistema envíe automáticamente las facturas en PDF tras cada venta facturada.',
    features: [
      'Habilitación por local de forma independiente',
      'Configuración de servidor SMTP (Gmail, dominio propio)',
      'Seguridad de conexión con StartTLS',
      'Configuración de remitente (nombre y email)',
      'Envío automático sin intervención manual',
      'Compatible con cualquier proveedor de email SMTP',
    ],
    image: '/sistema/Email-smpt.png',
    imageAlt: 'Configuración del servidor SMTP para envío automático de facturas',
  },
];

// Icon paths per module (SVG path data only)
const MODULE_ICONS: Record<string, string> = {
  Clientes:       'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M12 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  Productos:      'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM12 22V12M3.27 6.96L12 12.01l8.73-5.05M12 2.08V12',
  'Punto de Venta':'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0',
  'Visualización de Ventas': 'M18 20V10M12 20V4M6 20v-6',
  Compras:        'M1 3h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 001.9-1.44l1.54-5.56H6',
  Gastos:         'M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  Caja:           'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10',
  Fichadas:       'M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2',
  'Email Marketing':'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6',
  Etiquetas:      'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01',
  'AFIP / ARCA':  'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  'Email SMTP':   'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.63 2 2 0 012-2.18h3a2 2 0 012 1.72',
};

export default function ModuleAccordion() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div>
      {/* Summary grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        {MODULES.map((mod, i) => (
          <button
            key={mod.tag}
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            aria-controls={`module-detail-${i}`}
            className={[
              'text-left rounded-2xl p-4 border transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
              'hover:-translate-y-[1px] active:scale-[0.98]',
              open === i
                ? 'bg-[#1A2F3D] border-[#ED7C00]/50 shadow-[0_8px_32px_rgba(237,124,0,0.15)]'
                : 'bg-[#1A2F3D] border-[#32576F]/40 hover:border-[#ED7C00]/30',
            ].join(' ')}
          >
            <div className="flex items-start justify-between mb-2.5">
              <div className={[
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                open === i ? 'bg-[#ED7C00]' : 'bg-[#ED7C00]/15',
              ].join(' ')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke={open === i ? '#fff' : '#ED7C00'}
                     strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                     aria-hidden="true">
                  <path d={MODULE_ICONS[mod.tag] ?? 'M12 2v20M2 12h20'} />
                </svg>
              </div>
              <svg
                className={`shrink-0 transition-transform duration-300 ${open === i ? 'rotate-180' : ''}`}
                width="14" height="14" viewBox="0 0 14 14" fill="none"
                stroke="#7A9BAD" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 5l5 5 5-5" />
              </svg>
            </div>
            <p className={`text-xs font-semibold mb-1 ${open === i ? 'text-[#ED7C00]' : 'text-white'}`}>
              {mod.tag}
            </p>
            <p className="text-[11px] text-[#7A9BAD] leading-snug line-clamp-2">{mod.shortDesc}</p>
          </button>
        ))}
      </div>

      {/* Detail panel */}
      {MODULES.map((mod, i) => (
        <div
          key={mod.tag}
          id={`module-detail-${i}`}
          role="region"
          aria-label={`Detalle de ${mod.tag}`}
          className={[
            'overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
            open === i ? 'max-h-[900px] mb-4 opacity-100' : 'max-h-0 opacity-0',
          ].join(' ')}
        >
          {open === i && (
            <article className="bg-[#1A2F3D] border border-[#ED7C00]/20 rounded-[1.75rem] overflow-hidden">
              <div className="px-6 py-4 bg-[#0F1E26]/60 border-b border-[#32576F]/30 flex items-center gap-3">
                <span className="text-[10px] text-[#ED7C00] font-semibold uppercase tracking-widest bg-[#ED7C00]/10 px-3 py-1.5 rounded-full border border-[#ED7C00]/20">
                  {mod.tag}
                </span>
                <h3 className="text-white font-semibold">{mod.title}</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] divide-y md:divide-y-0 md:divide-x divide-[#32576F]/30">
                {/* Text side */}
                <div className="p-7">
                  <p className="text-[#7A9BAD] leading-relaxed mb-5">{mod.desc}</p>
                  <ul className="space-y-2.5" aria-label={`Funciones de ${mod.tag}`}>
                    {mod.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-[#CDD4DA]">
                        <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                          <path d="M2.5 7l3 3 6-5.5" stroke="#ED7C00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Screenshot side */}
                <div className="relative p-4 bg-[#0A141D]/60 flex items-start justify-center min-h-[280px]">
                  {/* Demo overlay banner */}
                  <div className="absolute top-5 right-5 z-10 bg-[#0F1E26]/80 backdrop-blur-sm text-[#ED7C00] text-[9px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full border border-[#ED7C00]/30">
                    Demo
                  </div>
                  <div className="relative w-full overflow-hidden rounded-xl border border-[#32576F]/30 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
                    <Image
                      src={mod.image}
                      alt={mod.imageAlt}
                      width={900}
                      height={600}
                      className="w-full object-cover object-top"
                      loading="lazy"
                    />
                    {/* Subtle data-anonymizing gradient overlay on bottom portion */}
                    <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-[#0A141D]/70 to-transparent pointer-events-none" />
                  </div>
                </div>
              </div>
            </article>
          )}
        </div>
      ))}
    </div>
  );
}
