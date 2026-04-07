import Link from 'next/link';
import Image from 'next/image';
import AgentsHubViz from '@/components/landing/AgentsHubViz';
import ModuleAccordion from '@/components/landing/ModuleAccordion';

// ── Data ─────────────────────────────────────────────────────────────────────

const stats = [
  { value: '12+', label: 'Módulos integrados' },
  { value: '100%', label: 'Configurable' },
  { value: 'Multi', label: 'Local & sucursal' },
  { value: 'Auto', label: 'Factura por email' },
];

const agents = [
  { name: 'Maya',  role: 'Analista BI',        color: '#ED7C00' },
  { name: 'Brio',  role: 'Agente de Ventas',   color: '#2B8CB8' },
  { name: 'Caro',  role: 'Admin. Financiera',  color: '#2AAF7B' },
  { name: 'Luca',  role: 'Jefe de Inventario', color: '#D4A017' },
  { name: 'Vera',  role: 'Fidelización',       color: '#C84B7A' },
  { name: 'Hugo',  role: 'Coordinador Op.',    color: '#5A8FAF' },
];

const faqItems = [
  {
    q: '¿Los agentes funcionan con mi base de datos existente?',
    a: 'Sí. Nos conectamos directamente a la base de datos de tu ERP (Azure SQL). No necesitás migrar datos ni cambiar ningún proceso.',
  },
  {
    q: '¿En cuánto tiempo puedo empezar a usarlo?',
    a: 'En menos de 48 horas. El onboarding es rápido: conectamos tu base de datos, configuramos los agentes para tu negocio y te damos acceso al sistema.',
  },
  {
    q: '¿Qué pasa si no tengo conocimientos técnicos?',
    a: 'No necesitás ningún conocimiento técnico. La plataforma está diseñada para que cualquier persona pueda usarla desde el primer día. Y si tenés dudas, nuestro soporte es directo y sin tickets.',
  },
  {
    q: '¿Puedo usar Alpha IT Hub en mi celular?',
    a: 'Sí. La plataforma funciona desde cualquier dispositivo: celular, tablet o computadora. Disponible 24 horas al día, 7 días a la semana.',
  },
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqItems.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
};

// ── CSS mockup helpers ─────────────────────────────────────────────────────────

const mockupWrap = 'bg-[#0A141D] rounded-xl border border-[#32576F]/30 overflow-hidden text-xs';
const mockupHead = 'px-3 py-2 bg-[#1A2F3D] border-b border-[#32576F]/30 flex items-center justify-between';
const mockupRow  = 'px-3 py-2.5 flex items-center justify-between border-b border-[#32576F]/15 last:border-0';

// ── Mockup components (server-rendered) ───────────────────────────────────────

function MockupClientes() {
  const rows = [
    { name: 'Valentina Rodríguez', doc: 'CUIT 20-32147896-5', saldo: '-$8.400',  cls: 'text-red-400'     },
    { name: 'Bruno Acosta',         doc: 'DNI 38.412.756',     saldo: '$0',       cls: 'text-[#7A9BAD]'  },
    { name: 'Florencia Méndez',     doc: 'CUIT 27-29841203-7', saldo: '-$3.200',  cls: 'text-amber-400'  },
    { name: 'Tomás Guerrero',       doc: 'DNI 41.237.809',     saldo: '+$12.000', cls: 'text-emerald-400'},
  ];
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}>
        <span className="text-[#7A9BAD]">Clientes — 247 registros</span>
        <span className="text-[#ED7C00]">+ Nuevo</span>
      </div>
      {rows.map((r) => (
        <div key={r.name} className={mockupRow}>
          <div><p className="text-white font-medium">{r.name}</p><p className="text-[#7A9BAD] text-[10px] font-mono">{r.doc}</p></div>
          <span className={"font-mono font-semibold " + r.cls}>{r.saldo}</span>
        </div>
      ))}
    </div>
  );
}

function MockupProductos() {
  const rows = [
    { name: 'Campera Bomber', var: 'XL / Negro', stock: 23, precio: '$34.900' },
    { name: 'Jean Skinny',    var: '36 / Azul',  stock: 47, precio: '$18.500' },
    { name: 'Vestido Floral', var: 'M / Blanco', stock: 8,  precio: '$24.200' },
    { name: 'Remera Básica',  var: 'S / Gris',   stock: 62, precio: '$8.900'  },
  ];
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Productos — 312 SKUs</span><span className="text-[#ED7C00]">+ Agregar</span></div>
      {rows.map((r) => (
        <div key={r.name} className={mockupRow}>
          <div><p className="text-white font-medium">{r.name}</p><p className="text-[#7A9BAD] text-[10px]">{r.var}</p></div>
          <div className="text-right"><p className="text-white font-mono">{r.precio}</p><p className={"text-[10px] font-mono " + (r.stock < 10 ? 'text-amber-400' : 'text-emerald-400')}>Stock: {r.stock}</p></div>
        </div>
      ))}
    </div>
  );
}

function MockupVentas() {
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#ED7C00] font-semibold">Venta en curso — Local Centro</span><span className="text-[#7A9BAD]">Cliente: V. Rodríguez</span></div>
      <div className="p-3 space-y-2">
        {[{n:'Campera Bomber XL',p:'$34.900'},{n:'Jean Skinny 36 Azul',p:'$18.500'}].map(i=>(
          <div key={i.n} className="flex justify-between text-white"><span>{i.n}</span><span className="font-mono">{i.p}</span></div>
        ))}
        <div className="border-t border-[#32576F]/30 pt-2 flex justify-between"><span className="text-[#7A9BAD]">Total</span><span className="text-white font-bold font-mono text-sm">$53.400</span></div>
        <div className="flex gap-2 mt-2">
          {['Efectivo','Débito','MP'].map((m,i)=>(
            <span key={m} className={"px-2 py-1 rounded text-[10px] font-semibold " + (i===0?'bg-[#ED7C00] text-white':'bg-[#1A2F3D] text-[#7A9BAD] border border-[#32576F]/40')}>{m}</span>
          ))}
        </div>
        <div className="mt-2 w-full bg-[#ED7C00] text-white text-xs font-semibold py-2 rounded text-center">Cerrar venta</div>
      </div>
    </div>
  );
}

function MockupReportes() {
  const bars = [55,70,45,85,60,90,75,50,80,95,65,88];
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Abril 2025 · Local Centro</span><span className="text-emerald-400 text-[10px]">+18.4% vs. mes ant.</span></div>
      <div className="p-3 grid grid-cols-3 gap-2 border-b border-[#32576F]/20">
        {[{l:'Cobrado',v:'$234.800'},{l:'Ventas',v:'47'},{l:'Ticket prom.',v:'$47.200'}].map(m=>(
          <div key={m.l}><p className="text-white font-bold font-mono text-sm">{m.v}</p><p className="text-[#7A9BAD] text-[10px]">{m.l}</p></div>
        ))}
      </div>
      <div className="p-3 flex items-end gap-0.5 h-16">
        {bars.map((h,i)=><div key={i} className="flex-1 rounded-sm" style={{height:h+'%',backgroundColor:i===9?'#ED7C00':'rgba(50,87,111,0.5)'}} />)}
      </div>
    </div>
  );
}

function MockupCompras() {
  const rows = [
    { prov: 'Distribuidora Vanesa SRL', monto: '$89.700', medio: 'Transferencia' },
    { prov: 'Moda Import SA',           monto: '$45.200', medio: 'Cheque'        },
    { prov: 'Textiles Palmieri',        monto: '$23.500', medio: 'Efectivo'      },
  ];
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Compras — Abril 2025</span><span className="text-[#ED7C00]">+ Registrar</span></div>
      {rows.map(r=>(
        <div key={r.prov} className={mockupRow}>
          <div><p className="text-white font-medium">{r.prov}</p><p className="text-[#7A9BAD] text-[10px]">{r.medio}</p></div>
          <span className="font-mono font-semibold text-white">{r.monto}</span>
        </div>
      ))}
    </div>
  );
}

function MockupGastos() {
  const rows = [
    { desc: 'Alquiler Local Centro',   cat: 'Costos Fijos', monto: '$85.000' },
    { desc: 'Servicio de luz',         cat: 'Costos Fijos', monto: '$12.400' },
    { desc: 'Bolsas y embalaje',       cat: 'Otros',        monto: '$3.700'  },
    { desc: 'Mantenimiento cartelería',cat: 'Otros',        monto: '$8.200'  },
  ];
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Gastos — $109.300 total</span></div>
      {rows.map(r=>(
        <div key={r.desc} className={mockupRow}>
          <div><p className="text-white font-medium">{r.desc}</p><p className="text-[#7A9BAD] text-[10px]">{r.cat}</p></div>
          <span className="font-mono font-semibold text-white">{r.monto}</span>
        </div>
      ))}
    </div>
  );
}

function MockupCaja() {
  const rows = [
    { tipo: 'Ingreso', desc: 'Retiro caja matutina',    monto: '+$30.000', cls: 'text-emerald-400' },
    { tipo: 'Egreso',  desc: 'Pago personal Luciana F.',monto: '-$15.000', cls: 'text-red-400'     },
    { tipo: 'Ingreso', desc: 'Transfer. MP → Caja',     monto: '+$47.800', cls: 'text-emerald-400' },
  ];
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Movimientos de Caja — Local Centro</span></div>
      {rows.map(r=>(
        <div key={r.desc} className={mockupRow}>
          <div>
            <span className={"text-[10px] font-semibold px-1.5 py-0.5 rounded mr-2 " + (r.tipo==='Ingreso'?'bg-emerald-400/15 text-emerald-400':'bg-red-400/15 text-red-400')}>{r.tipo}</span>
            <span className="text-white">{r.desc}</span>
          </div>
          <span className={"font-mono font-semibold " + r.cls}>{r.monto}</span>
        </div>
      ))}
    </div>
  );
}

function MockupFichadas() {
  const rows = [
    { emp: 'Luciana Fernández', estado: 'Entrada',  hora: '09:12', local: 'Local Centro' },
    { emp: 'Martín Casas',      estado: 'Descanso', hora: '13:00', local: 'Local Norte'  },
    { emp: 'Gabriela Torres',   estado: 'Salida',   hora: '18:30', local: 'Local Centro' },
  ];
  const colorMap: Record<string,string> = { Entrada:'text-emerald-400', Descanso:'text-amber-400', Salida:'text-[#7A9BAD]' };
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Fichadas — Hoy</span></div>
      {rows.map(r=>(
        <div key={r.emp} className={mockupRow}>
          <div><p className="text-white font-medium">{r.emp}</p><p className="text-[#7A9BAD] text-[10px]">{r.local}</p></div>
          <div className="text-right"><p className={"font-semibold text-[10px] " + colorMap[r.estado]}>{r.estado}</p><p className="text-[#7A9BAD] font-mono">{r.hora}</p></div>
        </div>
      ))}
    </div>
  );
}

function MockupMarketing() {
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Campañas de Email</span><span className="text-[#ED7C00]">+ Nueva</span></div>
      {[
        { nombre:'Liquidación de invierno 2025', estado:'Programado', detalle:'18 Jun 10:00 hs · 247 dest.', cls:'text-amber-400'},
        { nombre:'Nuevos talles disponibles',    estado:'Enviado',    detalle:'3 Jun · 189 enviados',         cls:'text-emerald-400'},
      ].map(c=>(
        <div key={c.nombre} className={mockupRow}>
          <div><p className="text-white font-medium">{c.nombre}</p><p className="text-[#7A9BAD] text-[10px]">{c.detalle}</p></div>
          <span className={"text-[10px] font-semibold " + c.cls}>{c.estado}</span>
        </div>
      ))}
    </div>
  );
}

function MockupEtiquetas() {
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Vista previa — 55×30mm 203dpi</span></div>
      <div className="p-4 flex justify-center">
        <div className="border-2 border-dashed border-[#32576F]/50 rounded px-4 py-3 w-44 text-center space-y-1">
          <p className="text-[#ED7C00] text-[10px] font-bold uppercase tracking-widest">MODA URBANA</p>
          <p className="text-white text-xs font-semibold">Campera Bomber</p>
          <p className="text-[#7A9BAD] text-[10px]">Talle: XL · Color: Negro</p>
          <p className="text-white text-sm font-bold">$34.900</p>
          <div className="flex justify-center gap-px mt-1">
            {Array.from({length:28}).map((_,i)=><div key={i} className="w-[2px] bg-white rounded-sm" style={{height: i%3===0?'18px':'12px'}} />)}
          </div>
          <p className="text-[#7A9BAD] text-[9px] font-mono">7891234567890</p>
        </div>
      </div>
    </div>
  );
}

function MockupARCA() {
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Local Centro — Facturación ARCA</span><span className="text-emerald-400 text-[10px]">Activo</span></div>
      <div className="p-3 space-y-2">
        {[
          {l:'CUIT',v:'30-71234567-8'},
          {l:'Razón Social',v:'Moda Urbana SRL'},
          {l:'Certificado',v:'cert_2025.pfx'},
          {l:'Último CAE',v:'74029481736520'},
        ].map(f=>(
          <div key={f.l} className="flex justify-between items-center py-1.5 border-b border-[#32576F]/15 last:border-0">
            <span className="text-[#7A9BAD]">{f.l}</span>
            <span className="text-white font-mono text-[11px]">{f.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MockupSMTP() {
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Config. Email — Local Centro</span><span className="text-emerald-400 text-[10px]">Activado</span></div>
      <div className="p-3 space-y-2">
        {[
          {l:'Servidor',v:'smtp.gmail.com'},
          {l:'Puerto',v:'587 · StartTLS'},
          {l:'Remitente',v:'ventas@modaurbana.com'},
          {l:'Nombre',v:'Moda Urbana'},
        ].map(f=>(
          <div key={f.l} className="flex justify-between items-center py-1.5 border-b border-[#32576F]/15 last:border-0">
            <span className="text-[#7A9BAD]">{f.l}</span>
            <span className="text-white font-mono text-[11px]">{f.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── Module data ───────────────────────────────────────────────────────────────

const modules = [
  {
    tag: 'Clientes',
    title: 'Base de clientes, fidelización y cuenta corriente',
    desc: 'Administrá toda tu cartera desde un único lugar. Gestioná saldos, historial de compras y construí relaciones comerciales duraderas.',
    features: [
      'Alta y edición de clientes con DNI, CUIT, email, teléfono y dirección',
      'Control de saldo y cuenta corriente en tiempo real',
      'Historial completo de compras y pagos por cliente',
      'Pagos recientes y opción de saldar cuenta desde el mismo panel',
      'Filtros avanzados para búsqueda rápida en grandes bases de datos',
      'Envío automático de facturas en PDF al email del cliente',
    ],
    mockup: 'clientes',
  },
  {
    tag: 'Productos',
    title: 'Stock, precios y catálogo completo',
    desc: 'Manejá tu inventario con precisión. Variantes de talle y color, múltiples precios y control de stock por local.',
    features: [
      'Productos con nombre, talle, color, precio de compra, minorista y mayorista',
      'Control de stock en tiempo real por local y sucursal',
      'Generación automática de códigos de barras',
      'Transferencia de stock entre locales',
      'Actualización masiva de precios',
      'Impresión de etiquetas directamente desde el módulo',
    ],
    mockup: 'productos',
  },
  {
    tag: 'Punto de Venta',
    title: 'Punto de venta ágil y completo',
    desc: 'La pantalla de ventas está diseñada para la velocidad. Escaneá productos, seleccioná cliente y cerrá la venta en segundos.',
    features: [
      'Escaneo por código de barras para agregar productos al instante',
      'Cambio entre precio minorista y mayorista con un toggle',
      'Tipos de venta: Física u Online',
      'Selección de cliente y vendedor con facturación electrónica integrada',
      'Múltiples métodos de pago y destino de caja configurable',
      'Devoluciones, impresión de comprobante y configuración de impresora',
    ],
    mockup: 'ventas',
  },
  {
    tag: 'Reportes',
    title: 'Reportes y análisis de ventas en detalle',
    desc: 'Analizá el rendimiento con filtros potentes. Controlá lo que ingresó, cuándo y cómo, con trazabilidad completa.',
    features: [
      'Total de ventas, productos vendidos y dinero ingresado en tiempo real',
      'Filtros por fecha, local, cliente, vendedor, método de pago, tipo y producto',
      'Estado de facturación y estado de pago por venta',
      'Acceso al CAE para ventas con factura electrónica',
      'Exportación de datos y facturación masiva de ventas seleccionadas',
      'Control de dinero en cajas desde la misma pantalla',
    ],
    mockup: 'reportes',
  },
  {
    tag: 'Compras',
    title: 'Control total de compras a proveedores',
    desc: 'Registrá cada compra con el método de pago y el local correspondiente. Historial ordenado y consultable.',
    features: [
      'Registro de compras por proveedor, local y fecha',
      'Detalle de caja o cuenta utilizada para el pago',
      'Múltiples métodos de pago por compra (pago dividido)',
      'Vista detallada con desglose completo',
      'Filtros de búsqueda por proveedor, fecha y local',
      'Historial de todas las compras con paginación',
    ],
    mockup: 'compras',
  },
  {
    tag: 'Gastos',
    title: 'Registro y clasificación de todos los egresos',
    desc: 'Registrá cualquier gasto operativo con clasificación por tipo, categoría y local. Visibilidad total sobre dónde va tu dinero.',
    features: [
      'Registro rápido con clasificación, tipo, descripción y monto',
      'Selección de local y cuenta/caja de origen del gasto',
      'Categorías configurables: Costos Fijos, Marketing, Otros',
      'Historial completo con fechas y descripción detallada',
      'Filtros de búsqueda para auditoría y control contable',
      'Sin límite de entradas históricas',
    ],
    mockup: 'gastos',
  },
  {
    tag: 'Caja',
    title: 'Movimientos de caja por local y cuenta',
    desc: 'Registrá movimientos de dinero: transferencias entre cajas, ingresos especiales y ajustes manuales.',
    features: [
      'Registro de ingresos y egresos con descripción libre',
      'Selección de local, cuenta origen y monto',
      'Historial cronológico de todos los movimientos',
      'Descripción detallada para trazabilidad completa',
      'Organización por tipo (Ingreso / Egreso)',
      'Control de flujo de dinero entre Mercado Pago y caja física',
    ],
    mockup: 'caja',
  },
  {
    tag: 'RRHH',
    title: 'Gestión de asistencia y horarios del personal',
    desc: 'Llevá el control de entrada y salida de tu equipo desde el propio sistema. Sin planillas ni anotaciones externas.',
    features: [
      'Registro de entrada, salida, descanso y retorno para cada empleado',
      'Historial filtrable por usuario, local, tipo y fecha',
      'Control por sucursal: cada local registra su propio personal',
      'Interfaz simple para que el mismo empleado marque su fichada',
      'Integrado con el módulo de usuarios del sistema',
      'Base para el cálculo y auditoría de horas trabajadas',
    ],
    mockup: 'fichadas',
  },
  {
    tag: 'Marketing',
    title: 'Campañas de email directas a tus clientes',
    desc: 'Comunicá novedades, promociones y ofertas directamente a tu base de clientes desde el propio sistema.',
    features: [
      'Creación de campañas con nombre, asunto y contenido rico',
      'Programación de envíos por fecha y hora específica',
      'Segmentación por local o envío masivo a todos los locales',
      'Editor de texto con formato, imágenes y links',
      'Activación y desactivación de campañas con control total',
      'Lista de destinatarios con email, nombre y fuente de origen',
    ],
    mockup: 'marketing',
  },
  {
    tag: 'Etiquetas',
    title: 'Diseño e impresión de etiquetas personalizadas',
    desc: 'Imprimí etiquetas profesionales para tus productos. Diseñá el layout, elegí qué mostrar y calibrá tu impresora.',
    features: [
      'Configuración de tamaño en mm y resolución DPI',
      'Selección de campos: nombre, talle, color, precio y código de barras',
      'Vista previa en tiempo real del diseño',
      'Texto de marca personalizable para identificar tu negocio',
      'Ajuste de offset y margen seguro para calibración',
      'Diseñador visual con canvas editable',
    ],
    mockup: 'etiquetas',
  },
  {
    tag: 'AFIP / ARCA',
    title: 'Integración ARCA/AFIP con certificado digital',
    desc: 'Configurá la facturación electrónica con integración directa a ARCA. Cada local con su propio perfil.',
    features: [
      'Configuración de perfiles de facturación ARCA por local',
      'Sincronización automática entre dispositivos',
      'Carga de certificado digital .pfx con clave de seguridad',
      'Datos de facturación configurables por sucursal',
      'Generación de CAE directamente desde el sistema de ventas',
      'Compatible con todos los tipos de comprobante requeridos por AFIP',
    ],
    mockup: 'arca',
  },
  {
    tag: 'Email SMTP',
    title: 'Envío automático de facturas en PDF por email',
    desc: 'Configurá el servidor de email para envío automático de facturas en PDF al cliente tras cada venta.',
    features: [
      'Habilitación por local de forma independiente',
      'Configuración de servidor SMTP (Gmail, dominio propio) con puerto y StartTLS',
      'Usuario y contraseña SMTP con seguridad de conexión',
      'Configuración de remitente (nombre y email)',
      'Envío automático sin intervención manual en cada venta',
      'Compatible con cualquier proveedor de email con soporte SMTP',
    ],
    mockup: 'smtp',
  },
] as const;

type MockupKey = typeof modules[number]['mockup'];


// ── Mockup renderer ───────────────────────────────────────────────────────────

function MockupRenderer({ id }: { id: MockupKey }) {
  switch (id) {
    case 'clientes':  return <MockupClientes />;
    case 'productos': return <MockupProductos />;
    case 'ventas':    return <MockupVentas />;
    case 'reportes':  return <MockupReportes />;
    case 'compras':   return <MockupCompras />;
    case 'gastos':    return <MockupGastos />;
    case 'caja':      return <MockupCaja />;
    case 'fichadas':  return <MockupFichadas />;
    case 'marketing': return <MockupMarketing />;
    case 'etiquetas': return <MockupEtiquetas />;
    case 'arca':      return <MockupARCA />;
    case 'smtp':      return <MockupSMTP />;
  }
}

// ── Hub analytics mockups ─────────────────────────────────────────────────────

function HubStockMockup() {
  const alertRows = [
    { prod: 'Campera Bomber XL', stock: '3u', level: 'CRÍTICO', cls: 'text-red-400 bg-red-400/10' },
    { prod: 'Vestido Floral M',  stock: '8u', level: 'BAJO',    cls: 'text-amber-400 bg-amber-400/10' },
  ];
  const bars = [
    { label: 'Jean Skinny',    pct: 92 },
    { label: 'Campera Bomber', pct: 74 },
    { label: 'Remera Básica',  pct: 58 },
  ];
  return (
    <div className="space-y-3">
      <div className={mockupWrap}>
        <div className={mockupHead}><span className="text-[#7A9BAD]">Valor stock</span></div>
        <div className="p-3 grid grid-cols-3 gap-2">
          {[{l:'Valor total',v:'$1.847.200'},{l:'Rotación',v:'3.2×'},{l:'Cobertura',v:'8.3 días'}].map(m=>(
            <div key={m.l}><p className="text-white font-bold font-mono text-sm">{m.v}</p><p className="text-[#7A9BAD] text-[10px]">{m.l}</p></div>
          ))}
        </div>
      </div>
      <div className={mockupWrap}>
        <div className={mockupHead}><span className="text-red-400 text-[10px] font-semibold">2 alertas activas</span></div>
        {alertRows.map(r=>(
          <div key={r.prod} className={mockupRow}>
            <span className="text-white">{r.prod}</span>
            <div className="flex items-center gap-2">
              <span className="text-[#7A9BAD] font-mono">{r.stock}</span>
              <span className={"text-[9px] font-bold px-1.5 py-0.5 rounded " + r.cls}>{r.level}</span>
            </div>
          </div>
        ))}
      </div>
      <div className={mockupWrap}>
        <div className={mockupHead}><span className="text-[#7A9BAD]">Top modelos por velocidad</span></div>
        <div className="p-3 space-y-2">
          {bars.map(b=>(
            <div key={b.label}>
              <div className="flex justify-between text-[10px] mb-1"><span className="text-white">{b.label}</span><span className="text-[#7A9BAD] font-mono">{b.pct}%</span></div>
              <div className="h-1.5 rounded-full bg-[#32576F]/30"><div className="h-full rounded-full bg-[#ED7C00]" style={{width:b.pct + '%'}} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HubVentasMockup() {
  const barH = [45,68,52,80,61,90,74];
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Analítica de Ventas — Abril 2025</span></div>
      <div className="p-3 grid grid-cols-2 gap-2 border-b border-[#32576F]/20">
        {[
          {l:'Cobrado',v:'$234.800'},{l:'Facturado',v:'$198.400'},
          {l:'Ventas',v:'47'},{l:'Ticket prom.',v:'$47.200'},
          {l:'CMV',v:'$136.800'},{l:'Margen bruto',v:'41.7%'},
        ].map(m=>(
          <div key={m.l}><p className="text-white font-bold font-mono text-sm">{m.v}</p><p className="text-[#7A9BAD] text-[10px]">{m.l}</p></div>
        ))}
      </div>
      <div className="p-3 flex items-end gap-1 h-20">
        {barH.map((h,i)=><div key={i} className="flex-1 rounded-sm" style={{height:h+'%',backgroundColor:i===5?'#ED7C00':'rgba(50,87,111,0.5)'}} />)}
      </div>
    </div>
  );
}

function HubGastosMockup() {
  const cats = [
    { label: 'Costos Fijos', pct: 64, color: '#ED7C00' },
    { label: 'Otros',        pct: 24, color: '#2B8CB8'  },
    { label: 'Marketing',    pct: 12, color: '#2AAF7B'  },
  ];
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Gastos — Abril 2025</span></div>
      <div className="p-3 grid grid-cols-3 gap-2 border-b border-[#32576F]/20">
        {[{l:'Total gastos',v:'$89.400'},{l:'Ratio vtas.',v:'38.1%'},{l:'Prom. diario',v:'$2.980'}].map(m=>(
          <div key={m.l}><p className="text-white font-bold font-mono text-sm">{m.v}</p><p className="text-[#7A9BAD] text-[10px]">{m.l}</p></div>
        ))}
      </div>
      <div className="p-3 space-y-2">
        {cats.map(c=>(
          <div key={c.label}>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-white">{c.label}</span>
              <span className="font-mono" style={{color:c.color}}>{c.pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[#32576F]/30"><div className="h-full rounded-full" style={{width:c.pct+'%',backgroundColor:c.color}} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HubComprasMockup() {
  return (
    <div className={mockupWrap}>
      <div className={mockupHead}><span className="text-[#7A9BAD]">Analítica de Compras — Abril 2025</span></div>
      <div className="p-3 grid grid-cols-2 gap-2 border-b border-[#32576F]/20">
        {[{l:'Total',v:'$158.400'},{l:'Órdenes',v:'12'},{l:'Prom. orden',v:'$13.200'},{l:'Unidades',v:'847'}].map(m=>(
          <div key={m.l}><p className="text-white font-bold font-mono text-sm">{m.v}</p><p className="text-[#7A9BAD] text-[10px]">{m.l}</p></div>
        ))}
      </div>
      <div className="p-3">
        <p className="text-[#7A9BAD] text-[10px] mb-2">Proveedor principal</p>
        <div className="flex items-center justify-between">
          <span className="text-white text-xs">Distribuidora Vanesa SRL</span>
          <span className="text-[#ED7C00] font-mono font-bold text-sm">56.7%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[#32576F]/30 mt-1"><div className="h-full rounded-full bg-[#ED7C00]" style={{width:'57%'}} /></div>
      </div>
    </div>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-[#0F1E26] flex flex-col">

      {/* ── Nav ── */}
      <header className="sticky top-0 z-40 px-6 md:px-10 py-4 flex items-center justify-between
                         border-b border-[#32576F]/30 bg-[#0F1E26]/90 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <svg width="40" height="30" viewBox="0 0 301 220" fill="white" aria-label="Alpha IT Hub logo" role="img">
            <path d="M139.21,65.64c14.46,23.45,28.66,47.06,42.86,70.66,13.74,22.84,27.42,45.74,40.92,68.72h37.73c-3.19-5.15-6.38-10.31-9.57-15.46-14.46-23.45-28.66-47.06-42.86-70.66-14.2-23.6-28.34-47.25-42.27-71.02-4.12-6.93-8.16-13.9-12.12-20.91-1.37-2.25-2.62-4.57-3.81-6.92-4.67,7.7-9.34,15.39-14.06,23.05-1.77,2.91-3.58,5.78-5.39,8.67,2.86,4.62,5.72,9.24,8.58,13.86Z"/>
            <path d="M118.68,74.63c-9.28,15.66-18.61,31.28-27.98,46.89-2.3,3.83-4.61,7.65-6.92,11.48-3.8,6.34-7.59,12.68-11.39,19.02-10.63,17.71-21.33,35.39-32.11,53.01h40.45c19.51-31.8,39.02-63.6,58.54-95.39-6.86-11.67-13.73-23.34-20.59-35Z"/>
            <path d="M106.69,205.03h91.97c-6.94-11.56-13.88-23.13-20.82-34.69h-49.47c-7.23,11.56-14.45,23.13-21.68,34.69Z"/>
          </svg>
          <span className="text-white font-semibold tracking-tight text-sm">ALPHA <span className="font-light">IT</span></span>
        </div>
        <nav className="hidden md:flex items-center gap-6" aria-label="Navegación principal">
          {[{label:'El Sistema',href:'#sistema'},{label:'Analítica HUB',href:'#hub'},{label:'Agentes IA',href:'#hub-agentes'},{label:'Consultoría',href:'#consultoria'},{label:'Nosotros',href:'#nosotros'},{label:'FAQ',href:'#faq'}].map(l=>(
            <a key={l.href} href={l.href} className="text-[#CDD4DA] text-sm hover:text-white transition-colors duration-200">{l.label}</a>
          ))}
        </nav>
        <Link href="/login"
          className="bg-[#ED7C00] text-white text-sm font-semibold px-5 py-2.5 rounded-xl
                     transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                     hover:bg-[#d06e00] hover:-translate-y-[1px] hover:shadow-[0_6px_20px_rgba(237,124,0,0.25)]
                     active:scale-[0.98] active:translate-y-0">
          Iniciar sesión
        </Link>
      </header>

      <main>

        {/* ── Hero ── */}
        <section id="inicio" className="min-h-[100dvh] max-w-[1400px] mx-auto px-6 md:px-10
                                          grid grid-cols-1 lg:grid-cols-[1fr_460px] gap-12 lg:gap-16 items-center
                                          pt-16 md:pt-24 pb-20">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 bg-[#ED7C00]/10 border border-[#ED7C00]/20
                            text-[#ED7C00] text-xs font-semibold px-4 py-2 rounded-full"
                 style={{animation:'fadeSlideIn 0.6s cubic-bezier(0.16,1,0.3,1) both'}}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#ED7C00]" style={{animation:'pulse-dot 2s ease-in-out infinite'}} />
              Software de gestión para moda
            </div>

            <h1 className="text-5xl md:text-[5.25rem] font-bold tracking-tighter leading-none text-white"
                style={{animation:'fadeSlideIn 0.6s 0.1s cubic-bezier(0.16,1,0.3,1) both'}}>
              El ERP que hace<br /><span className="text-[#ED7C00]">crecer</span> tu negocio.
            </h1>

            <p className="text-[#7A9BAD] text-lg leading-relaxed max-w-[55ch]"
               style={{animation:'fadeSlideIn 0.6s 0.2s cubic-bezier(0.16,1,0.3,1) both'}}>
              ALPHA POS es un sistema integral de punto de venta y gestión comercial para tiendas de
              indumentaria y calzado. Instalación local, potencia real, analítica con IA.
            </p>

            <div className="flex items-center gap-4"
                 style={{animation:'fadeSlideIn 0.6s 0.3s cubic-bezier(0.16,1,0.3,1) both'}}>
              <a href="https://wa.me/5493455416005" target="_blank" rel="noopener noreferrer"
                 aria-label="Contactar por WhatsApp"
                 className="inline-flex items-center gap-2 border border-[#25D366]/40 text-[#25D366] font-semibold px-6 py-4 rounded-xl
                            transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                            hover:bg-[#25D366]/10 active:scale-[0.98]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.121.554 4.112 1.523 5.837L.057 23.882a.75.75 0 00.918.932l6.14-1.612A11.942 11.942 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.715 9.715 0 01-4.951-1.354l-.355-.212-3.678.964.982-3.584-.232-.37A9.72 9.72 0 012.25 12c0-5.376 4.374-9.75 9.75-9.75s9.75 4.374 9.75 9.75-4.374 9.75-9.75 9.75z"/>
                </svg>
                Hablar con el equipo
              </a>

              <a href="#sistema"
                 className="bg-[#ED7C00] text-white font-semibold px-8 py-4 rounded-xl
                            transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                            hover:bg-[#d06e00] hover:-translate-y-[2px] hover:shadow-[0_12px_32px_rgba(237,124,0,0.3)]
                            active:scale-[0.98] active:translate-y-0">
                Ver el sistema
              </a>
              <a href="#hub"
                 className="border border-[#32576F] text-[#CDD4DA] font-semibold px-8 py-4 rounded-xl
                            transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                            hover:border-[#ED7C00]/40 hover:text-white active:scale-[0.98]">
                Panel HUB
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-x-8 gap-y-4 pt-6 border-t border-[#32576F]/40"
                 style={{animation:'fadeSlideIn 0.6s 0.4s cubic-bezier(0.16,1,0.3,1) both'}}>
              {stats.map(s=>(
                <div key={s.label} className="space-y-0.5">
                  <p className="text-2xl font-bold tracking-tight text-white">{s.value}</p>
                  <p className="text-[10px] text-[#7A9BAD] uppercase tracking-widest">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Hero right: dashboard preview */}
          <div className="hidden lg:block" style={{animation:'fadeSlideIn 0.8s 0.25s cubic-bezier(0.16,1,0.3,1) both'}}>
            <div className="relative" style={{animation:'floatY 6s ease-in-out infinite'}}>
              <div className="bg-[#1A2F3D] border border-[#32576F]/60 rounded-[1.75rem] p-6
                              shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-[10px] text-[#7A9BAD] uppercase tracking-widest mb-1">Resumen del día</p>
                    <p className="text-xl font-bold text-white tracking-tight">Martes 6 de mayo</p>
                  </div>
                  <span className="text-xs font-semibold text-emerald-400 bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-400/20">Local Centro</span>
                </div>
                <div className="space-y-3 mb-5">
                  {[{l:'Ventas del día',v:'$87.400',c:'text-white'},{l:'Productos vendidos',v:'34',c:'text-white'},{l:'Clientes atendidos',v:'21',c:'text-white'}].map(r=>(
                    <div key={r.l} className="flex items-center justify-between py-2 border-t border-[#32576F]/30">
                      <span className="text-[#7A9BAD] text-xs">{r.l}</span>
                      <span className={"font-bold font-mono text-sm " + r.c}>{r.v}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-end gap-1 h-16">
                  {[55,70,45,85,60,90,75,50,80,95,65,88].map((h,i)=>(
                    <div key={i} className="flex-1 rounded-sm" style={{height:h+'%',backgroundColor:i===9?'#ED7C00':'rgba(50,87,111,0.5)'}} />
                  ))}
                </div>
              </div>
              <div className="absolute -bottom-5 -left-8 bg-[#0F1E26] border border-[#32576F]/60 rounded-2xl p-4 w-52
                              shadow-[0_20px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]">
                <p className="text-[9px] text-[#7A9BAD] uppercase tracking-widest mb-1">Alerta de stock</p>
                <p className="text-white text-xs font-semibold leading-snug">Campera Bomber XL — stock critico: 3 unidades</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" style={{animation:'pulse-dot 1.8s ease-in-out infinite'}} />
                  <span className="text-amber-400 text-[10px] font-medium">Accion recomendada</span>
                </div>
              </div>
            </div>
          </div>
        </section>


        {/* ── Tech Partners strip ── */}
        <div className="border-y border-[#32576F]/20 bg-[#0A141D]/60 py-8">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <p className="text-[#32576F] text-[10px] uppercase tracking-widest text-center mb-6">
              Tecnología integrada y certificada
            </p>
            <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
              <div className="flex items-center gap-2.5 opacity-60 hover:opacity-100 transition-opacity duration-200">
                <Image src="/logos-externos/arca.webp" alt="Integrado con ARCA/AFIP" width={80} height={32}
                       className="h-7 w-auto object-contain" loading="lazy" />
                <span className="text-[#7A9BAD] text-xs font-medium">ARCA / AFIP</span>
              </div>
              <div className="flex items-center gap-2.5 opacity-60 hover:opacity-100 transition-opacity duration-200">
                <Image src="/logos-externos/tiendanube.svg" alt="Integrado con Tienda Nube" width={100} height={32}
                       className="h-7 w-auto object-contain" loading="lazy" />
              </div>
              <div className="flex items-center gap-2.5 opacity-60 hover:opacity-100 transition-opacity duration-200">
                <Image src="/logos-externos/claude-ai.png" alt="Powered by Claude AI — Anthropic" width={80} height={32}
                       className="h-7 w-auto object-contain" loading="lazy" />
                <div>
                  <p className="text-[#7A9BAD] text-xs font-medium leading-none">Powered by Claude</p>
                  <p className="text-[#32576F] text-[10px]">Anthropic</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Modules ── */}
        <section id="sistema" className="py-20 md:py-28 border-t border-[#32576F]/30">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <p className="text-[#ED7C00] text-xs font-semibold uppercase tracking-widest mb-3">Funcionalidades del sistema</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight mb-2 max-w-2xl">
              Todo lo que tu comercio necesita, en un solo sistema
            </h2>
            <p className="text-[#7A9BAD] text-base leading-relaxed max-w-[60ch] mb-14">
              Cada modulo con pantalla de referencia y descripcion completa de sus funciones.
            </p>

            <ModuleAccordion />
          </div>
        </section>

        {/* ── HUB Analytics ── */}
        <section id="hub" className="py-20 md:py-28 bg-[#0A141D] border-y border-[#32576F]/30">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-12 items-start mb-16">
              <div>
                <p className="text-[#ED7C00] text-xs font-semibold uppercase tracking-widest mb-3">Disponible online</p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight mb-4">Panel HUB de Analisis</h2>
                <p className="text-[#7A9BAD] text-base leading-relaxed max-w-[50ch]">
                  Accede desde cualquier dispositivo y visualiza el desempeno de tu negocio con paneles de analisis
                  avanzados. El HUB centraliza la informacion de todos tus locales con graficos y metricas en tiempo real.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  {icon:'stock', name:'Stock',   desc:'Proyeccion de demanda, excesos, faltantes y alertas'},
                  {icon:'vtas',  name:'Ventas',  desc:'Evolucion diaria, ticket promedio y margen bruto'},
                  {icon:'comp',  name:'Compras', desc:'Ordenes, proveedores activos y distribucion'},
                  {icon:'gast',  name:'Gastos',  desc:'Total, ratio sobre ventas y distribucion por categoria'},
                ].map(c=>(
                  <div key={c.name} className="bg-[#1A2F3D] border border-[#32576F]/40 rounded-2xl p-5">
                    <p className="text-white font-semibold text-sm mb-1">{c.name}</p>
                    <p className="text-[#7A9BAD] text-xs leading-snug">{c.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-6">
              {[
                {
                  tag:'Analítica de Stock',
                  sub:'Valor, rotacion, calce financiero y predicciones de compra',
                  desc:'Detecta productos con exceso o faltante, proyecta la demanda futura y toma decisiones de compra basadas en datos reales.',
                  features:[
                    'Valor total del stock, rotacion promedio mensual y calce financiero en dias',
                    'Alertas activas: productos criticos con acciones urgentes recomendadas',
                    'Clasificacion de productos: Bajo stock, Exceso, Liquidar',
                    'Analisis con proyeccion de demanda a 30/60/90 dias',
                    'Ranking por velocidad de salida y distribucion por talle/color',
                    'Sugerencia automatica de compra y estimacion de inversion necesaria',
                    'Vista multilocal para comparar rendimiento entre sucursales',
                    'Exportacion a PDF de todos los reportes',
                  ],
                  mockup: 'stock',
                },
                {
                  tag:'Analítica de Ventas',
                  sub:'Metricas financieras, evolucion temporal y analisis de margen',
                  desc:'Visualiza el desempeno comercial con graficos de evolucion diaria, metricas de margen y filtros avanzados.',
                  features:[
                    'Cobrado total, facturado total, cantidad de ventas y productos vendidos',
                    'Ticket promedio y promedio diario por periodo',
                    'Costo de mercaderia vendida, comisiones de pago y margen bruto',
                    'Grafico de ventas por dia con evolucion acumulada',
                    'Filtros por local, metodo de pago, tipo de venta, producto, talle y color',
                    'Analisis multilocal para comparar sucursales',
                  ],
                  mockup: 'ventas_hub',
                },
                {
                  tag:'Analítica de Gastos',
                  sub:'Control total de egresos con distribucion y tendencias',
                  desc:'Conoce exactamente en que gasta tu negocio. Distribucion por categoria, ratio sobre ventas y evolucion temporal.',
                  features:[
                    'Total de gastos del periodo y ratio gastos/ventas',
                    'Promedio diario de egresos',
                    'Grafico de gastos por dia con evolucion',
                    'Distribucion por tipo de gasto',
                    'Gastos por metodo de pago',
                    'Filtros por local, metodo de pago, tipo y categoria',
                  ],
                  mockup: 'gastos_hub',
                },
                {
                  tag:'Analítica de Compras',
                  sub:'Ordenes, proveedores y distribucion de inversion',
                  desc:'Analiza tu estructura de compras: principales proveedores, distribucion de la inversion y concentracion de la cadena.',
                  features:[
                    'Total de compras, ordenes emitidas, promedio por orden y unidades compradas',
                    'Identificacion del proveedor principal y su participacion porcentual',
                    'Grafico de compras por dia',
                    'Distribucion por proveedor con desglose detallado',
                    'Proveedores activos en el periodo y concentracion del top 10',
                    'Filtros por local, metodo de pago y proveedor',
                  ],
                  mockup: 'compras_hub',
                },
              ].map(block => (
                <article key={block.tag}
                  className="bg-[#1A2F3D] border border-[#32576F]/50 rounded-[1.75rem] overflow-hidden
                              hover:border-[#ED7C00]/25 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]">
                  <div className="px-7 py-4 bg-[#0F1E26]/60 border-b border-[#32576F]/30">
                    <h3 className="text-white font-semibold">{block.tag}</h3>
                    <p className="text-[#ED7C00] text-xs mt-0.5">{block.sub}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] divide-y md:divide-y-0 md:divide-x divide-[#32576F]/30">
                    <div className="p-7">
                      <p className="text-[#7A9BAD] leading-relaxed mb-5">{block.desc}</p>
                      <ul className="space-y-2.5">
                        {block.features.map(f=>(
                          <li key={f} className="flex items-start gap-2.5 text-sm text-[#CDD4DA]">
                            <svg className="mt-1 shrink-0" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                              <path d="M2 5l2.5 2.5L8 3" stroke="#ED7C00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-7 flex items-start justify-center bg-[#0A141D]/60">
                      {block.mockup === 'stock'       && <div className="w-full"><HubStockMockup /></div>}
                      {block.mockup === 'ventas_hub'  && <div className="w-full"><HubVentasMockup /></div>}
                      {block.mockup === 'gastos_hub'  && <div className="w-full"><HubGastosMockup /></div>}
                      {block.mockup === 'compras_hub' && <div className="w-full"><HubComprasMockup /></div>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>


        {/* ── AI Agents Hub ── */}
        <section id="hub-agentes" className="py-20 md:py-28 border-b border-[#32576F]/30">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-12 lg:gap-16 items-start">

              {/* Left: text */}
              <div>
                <p className="text-[#ED7C00] text-xs font-semibold uppercase tracking-widest mb-3">Hub de Agentes</p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight mb-4">
                  Tu equipo de IA,<br />especializado en moda
                </h2>
                <p className="text-[#7A9BAD] text-base leading-relaxed max-w-[52ch] mb-8">
                  Alpha posee un hub de agentes especializados que trabajan en conjunto para la operacion diaria de tu
                  tienda. No es sourcing externo, es inteligencia integrada directamente en tu negocio.
                </p>

                <div className="space-y-4 mb-8">
                  {[
                    { title: 'Especializacion en moda', desc: 'Los agentes conocen temporadas, talles, rotacion y quiebres en colecciones.' },
                    { title: 'Conectados a tu ERP',     desc: 'Acceden directamente a la base de datos Azure SQL de tu negocio en tiempo real.' },
                    { title: 'Red de agentes',          desc: 'Se comunican entre si para darte respuestas completas y acciones coordinadas.' },
                  ].map((d,i)=>(
                    <div key={d.title} className="flex items-start gap-4"
                         style={{animation:'fadeSlideIn 0.5s ' + (i*0.1) + 's cubic-bezier(0.16,1,0.3,1) both'}}>
                      <div className="mt-0.5 w-6 h-6 rounded-full bg-[#ED7C00]/15 border border-[#ED7C00]/30 flex items-center justify-center shrink-0">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                          <path d="M2 5l2.5 2.5L8 3" stroke="#ED7C00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div><p className="text-white font-semibold text-sm">{d.title}</p><p className="text-[#7A9BAD] text-xs mt-0.5">{d.desc}</p></div>
                    </div>
                  ))}
                </div>

                {/* Agent pills */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
                  {agents.map(ag=>(
                    <div key={ag.name} className="bg-[#1A2F3D] border border-[#32576F]/40 rounded-xl p-3
                                                   hover:border-[#ED7C00]/30 transition-all duration-300">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                             style={{backgroundColor:ag.color}}>
                          {ag.name.slice(0,1)}
                        </div>
                        <span className="text-white font-semibold text-xs">{ag.name}</span>
                      </div>
                      <p className="text-[10px] leading-snug" style={{color:ag.color}}>{ag.role}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-[#1A2F3D] border border-[#32576F]/30 rounded-2xl p-5 mb-6 space-y-2">
                  <p className="text-white font-semibold text-sm">Sin herramientas externas de pago</p>
                  <ul className="space-y-1.5">
                    {['Sin Power BI ni herramientas de terceros','Sin integraciones complicadas de n8n o Zapier','Sin APIs externas de pago — todo incluido','Disponible 24/7 desde celular o computadora'].map(l=>(
                      <li key={l} className="text-[#7A9BAD] text-xs flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-[#ED7C00] shrink-0" />
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="text-[#32576F] text-xs italic mb-6">
                  Otras plataformas automatizan el sourcing global. Alpha IT Hub automatiza tu tienda.
                </p>

                <Link href="/login"
                  className="inline-flex items-center gap-2 bg-[#ED7C00] text-white font-semibold px-8 py-4 rounded-xl
                             transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                             hover:bg-[#d06e00] hover:-translate-y-[2px] hover:shadow-[0_12px_32px_rgba(237,124,0,0.3)]
                             active:scale-[0.98] active:translate-y-0">
                  Conoce a tu equipo
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M1 7h12M7 1l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </div>

              {/* Right: animated viz */}
              <div className="flex items-start justify-center">
                <AgentsHubViz />
              </div>
            </div>
          </div>
        </section>


        {/* ── Soporte Humano ── */}
        <section className="py-16 md:py-20 bg-[#0A141D] border-b border-[#32576F]/30">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-10 items-center">
              <div>
                <p className="text-[#25D366] text-xs font-semibold uppercase tracking-widest mb-3">Diferencial</p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight mb-4">
                  Soporte humano,<br />sin tickets ni bots.
                </h2>
                <p className="text-[#7A9BAD] text-base leading-relaxed max-w-[50ch] mb-8">
                  Cuando tenés un problema o una duda, hablás directamente con nosotros.
                  Sin formularios, sin tiempos de espera, sin respuestas automáticas.
                  Atención real de los fundadores y su equipo.
                </p>
                <div className="space-y-3 mb-8">
                  {[
                    'Onboarding personalizado para tu negocio',
                    'Soporte directo por WhatsApp en horario comercial',
                    'Actualizaciones y mejoras incluidas sin costo adicional',
                    'Respuesta garantizada en menos de 4 horas hábiles',
                  ].map(item => (
                    <div key={item} className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded-full bg-[#25D366]/15 border border-[#25D366]/30 flex items-center justify-center shrink-0">
                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                          <path d="M2 5l2.5 2.5L8 3" stroke="#25D366" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span className="text-[#CDD4DA] text-sm">{item}</span>
                    </div>
                  ))}
                </div>
                <a href="https://wa.me/5493455416005" target="_blank" rel="noopener noreferrer"
                   aria-label="Contactar soporte técnico por WhatsApp"
                   className="inline-flex items-center gap-3 bg-[#25D366]/15 border border-[#25D366]/30 text-[#25D366]
                              font-semibold px-7 py-4 rounded-xl text-sm
                              transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                              hover:bg-[#25D366]/25 hover:-translate-y-[1px] active:scale-[0.98]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.121.554 4.112 1.523 5.837L.057 23.882a.75.75 0 00.918.932l6.14-1.612A11.942 11.942 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.715 9.715 0 01-4.951-1.354l-.355-.212-3.678.964.982-3.584-.232-.37A9.72 9.72 0 012.25 12c0-5.376 4.374-9.75 9.75-9.75s9.75 4.374 9.75 9.75-4.374 9.75-9.75 9.75z"/>
                  </svg>
                  +54 9 3455 416005 — Escribinos ahora
                </a>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {[
                  { emoji: null, title: 'Sin tickets ni formularios', desc: 'Hablás directo con la persona que construyó el sistema. Sin nivel 1, sin nivel 2, sin esperas.', color: '#25D366' },
                  { emoji: null, title: 'Soporte en tu idioma', desc: 'Atención en español, sin tecnicismos innecesarios. Entendemos el retail de moda porque venimos de ahí.', color: '#2B8CB8' },
                  { emoji: null, title: 'Disponible 24/7 para urgencias', desc: 'Para problemas críticos que no pueden esperar, tenemos canal de urgencias disponible las 24 horas.', color: '#ED7C00' },
                ].map(card => (
                  <div key={card.title}
                       className="bg-[#1A2F3D] border border-[#32576F]/40 rounded-2xl p-5
                                  hover:border-[#ED7C00]/25 transition-all duration-300">
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                           style={{ backgroundColor: card.color + '20', border: '1px solid ' + card.color + '40' }}>
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: card.color }} />
                      </div>
                      <div>
                        <p className="text-white font-semibold text-sm mb-1">{card.title}</p>
                        <p className="text-[#7A9BAD] text-xs leading-relaxed">{card.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>


        {/* ── Consultoría ── */}
        <section id="consultoria" className="py-20 md:py-28 border-b border-[#32576F]/30">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-12 items-start">
              <div>
                <p className="text-[#ED7C00] text-xs font-semibold uppercase tracking-widest mb-3">Consultoría</p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight mb-4">
                  Consultoría especializada<br />en retail de moda
                </h2>
                <p className="text-[#7A9BAD] text-base leading-relaxed max-w-[52ch] mb-8">
                  No solo adoptás tecnología, transformás tu negocio. Nuestro equipo te acompaña en cada
                  paso para que la IA potencie lo que ya funciona y resuelva lo que no.
                </p>
                <div className="space-y-4">
                  {[
                    {
                      title: 'Adopción tecnológica',
                      desc: 'Te guiamos en la implementación del sistema y los agentes de IA, adaptando todo a tus procesos actuales sin interrumpir el negocio.',
                      color: '#ED7C00',
                    },
                    {
                      title: 'Optimización de procesos internos',
                      desc: 'Analizamos cómo trabaja tu equipo, identificamos cuellos de botella y diseñamos flujos de trabajo más eficientes con y sin IA.',
                      color: '#2B8CB8',
                    },
                    {
                      title: 'Estrategia de ventas',
                      desc: 'Análisis de tu mix de productos, márgenes, temporadas y canales. Te ayudamos a tomar decisiones basadas en tus propios datos.',
                      color: '#2AAF7B',
                    },
                    {
                      title: 'Gestión financiera del negocio',
                      desc: 'Control de flujo de caja, ratio de gastos, puntos de equilibrio y proyecciones de crecimiento para comercios de moda.',
                      color: '#D4A017',
                    },
                  ].map((item, i) => (
                    <div key={item.title}
                         className="bg-[#1A2F3D] border border-[#32576F]/40 rounded-2xl p-5
                                    hover:border-[#ED7C00]/25 transition-all duration-300"
                         style={{ animationDelay: i * 0.1 + 's' }}>
                      <div className="flex items-start gap-4">
                        <div className="mt-0.5 w-2 h-full min-h-[40px] rounded-full shrink-0"
                             style={{ backgroundColor: item.color }} />
                        <div>
                          <p className="text-white font-semibold text-sm mb-1">{item.title}</p>
                          <p className="text-[#7A9BAD] text-xs leading-relaxed">{item.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:sticky lg:top-24 space-y-4">
                <div className="bg-[#1A2F3D] border border-[#ED7C00]/30 rounded-[1.75rem] p-7"
                     style={{ boxShadow: '0 20px 60px rgba(237,124,0,0.08)' }}>
                  <h3 className="text-white font-bold text-lg tracking-tight mb-2">
                    Empezá con una consulta gratuita
                  </h3>
                  <p className="text-[#7A9BAD] text-sm leading-relaxed mb-6">
                    Contanos cómo es tu negocio hoy y te decimos exactamente qué podemos hacer
                    para mejorar tus resultados.
                  </p>
                  <div className="space-y-3 mb-6">
                    {[
                      'Diagnóstico inicial sin costo',
                      'Plan de implementación personalizado',
                      'Sin compromiso de contratación',
                    ].map(item => (
                      <div key={item} className="flex items-center gap-2.5">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                          <path d="M2.5 7l3 3 6-5.5" stroke="#ED7C00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className="text-[#CDD4DA] text-sm">{item}</span>
                      </div>
                    ))}
                  </div>
                  <a href="https://wa.me/5493455416005?text=Hola%2C%20quiero%20una%20consulta%20sobre%20Alpha%20IT%20Hub"
                     target="_blank" rel="noopener noreferrer"
                     aria-label="Solicitar consulta gratuita por WhatsApp"
                     className="block w-full text-center bg-[#ED7C00] text-white font-semibold py-3.5 rounded-xl text-sm
                                transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                                hover:bg-[#d06e00] hover:-translate-y-[1px] hover:shadow-[0_8px_24px_rgba(237,124,0,0.3)]
                                active:scale-[0.98] active:translate-y-0">
                    Solicitar consulta gratuita
                  </a>
                </div>

                <div className="bg-[#1A2F3D] border border-[#32576F]/40 rounded-2xl p-5">
                  <p className="text-[#7A9BAD] text-xs leading-relaxed italic">
                    "Empezamos con una tienda en Villaguay y entendemos los desafíos del retail de moda
                    desde adentro. No traemos una solución genérica — traemos lo que aprendimos funcionando."
                  </p>
                  <p className="text-[#ED7C00] text-xs font-semibold mt-3">— El equipo de Alpha IT Hub</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Nosotros ── */}
        <section id="nosotros" className="py-20 md:py-28 bg-[#132229] border-b border-[#32576F]/30">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-12 lg:gap-16 items-start">

              {/* Left: text */}
              <div>
                <p className="text-[#ED7C00] text-xs font-semibold uppercase tracking-widest mb-3">Quienes somos</p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight mb-6">Quienes somos</h2>

                <p className="text-[#7A9BAD] text-base leading-relaxed mb-8">
                  Somos dos amigos con un proposito: ayudar a tiendas de indumentaria y calzado a crecer y competir en un mercado
                  cada vez mas dificil. Nuestro objetivo es facilitarles herramientas a la persona de a pie, para que pueda mejorar
                  su negocio y la forma de vender, para que evolucione y crezca de manera ordenada.{' '}
                  <br /><br />
                  El proyecto nacio desde dentro de una tienda en Villaguay, Entre Rios, y buscamos compartir esta solucion con
                  todos aquellos emprendedores que sientan que no pueden con todo y necesitan una mano para sostener su trabajo
                  de todos los dias.
                </p>

                {/* Pillars */}
                <div className="space-y-4 mb-10">
                  {[
                    { title: 'Tecnologia con proposito', desc: 'IA que resuelve problemas reales del retail de moda.' },
                    { title: 'Disenada desde adentro',   desc: 'Creada por personas que conocen el negocio desde dentro.' },
                    { title: 'Soporte real',              desc: 'Sin tickets ni bots. Atencion directa de los fundadores.' },
                  ].map(p=>(
                    <div key={p.title} className="border-l-2 border-[#ED7C00]/50 pl-4">
                      <p className="text-white font-semibold text-sm">{p.title}</p>
                      <p className="text-[#7A9BAD] text-xs mt-0.5">{p.desc}</p>
                    </div>
                  ))}
                </div>

                {/* Team */}
                <div className="grid grid-cols-2 gap-4 mb-8">
                  {[
                    { name: 'Nicolas Savulsky',     role: 'Co-fundador & Dev Lead' },
                    { name: 'Ivan Frances Perez',   role: 'Co-fundador & Product'  },
                  ].map(m=>(
                    <div key={m.name} className="bg-[#1A2F3D] border border-[#32576F]/40 rounded-2xl p-4">
                      <div className="w-10 h-10 rounded-full bg-[#ED7C00]/20 border border-[#ED7C00]/30 flex items-center justify-center text-[#ED7C00] font-bold text-sm mb-3">
                        {m.name.split(' ').map(w=>w[0]).slice(0,2).join('')}
                      </div>
                      <p className="text-white font-semibold text-sm">{m.name}</p>
                      <p className="text-[#7A9BAD] text-xs mt-0.5">{m.role}</p>
                    </div>
                  ))}
                </div>

                <a href="https://wa.me/5434554631"
                   target="_blank" rel="noopener noreferrer"
                   aria-label="Contactar por WhatsApp"
                   className="inline-flex items-center gap-3 bg-[#25D366]/15 border border-[#25D366]/30 text-[#25D366]
                              font-semibold px-6 py-3.5 rounded-xl text-sm
                              transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                              hover:bg-[#25D366]/25 active:scale-[0.98]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.121.554 4.112 1.523 5.837L.057 23.882a.75.75 0 00.918.932l6.14-1.612A11.942 11.942 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.715 9.715 0 01-4.951-1.354l-.355-.212-3.678.964.982-3.584-.232-.37A9.72 9.72 0 012.25 12c0-5.376 4.374-9.75 9.75-9.75s9.75 4.374 9.75 9.75-4.374 9.75-9.75 9.75z" />
                  </svg>
                  Escribinos por WhatsApp
                </a>
              </div>

              {/* Right: founders photo */}
              <div className="flex items-start justify-center">
                <div className="relative w-full max-w-lg overflow-hidden rounded-[2rem]">
                  <Image
                    src="/founders.png"
                    alt="Nicolás Savulsky e Iván Francés Pérez, fundadores de Alpha IT Hub"
                    width={600}
                    height={600}
                    className="object-cover w-full"
                    style={{ objectPosition: 'center 15%', height: '520px' }}
                    loading="lazy"
                  />
                  {/* Cover Gemini watermark at bottom-right */}
                  <div className="absolute bottom-0 right-0 w-28 h-16 bg-[#132229] rounded-tl-xl" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="py-20 md:py-28 border-b border-[#32576F]/30">
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
          />
          <div className="max-w-[1400px] mx-auto px-6 md:px-10">
            <div className="max-w-[860px]">
              <p className="text-[#ED7C00] text-xs font-semibold uppercase tracking-widest mb-3">Preguntas frecuentes</p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight mb-10">
                Preguntas frecuentes
              </h2>
              <div className="space-y-3">
                {faqItems.map((item) => (
                  <details key={item.q}
                    className="group bg-[#1A2F3D] border border-[#32576F]/50 rounded-2xl overflow-hidden
                               hover:border-[#ED7C00]/30 transition-colors duration-300">
                    <summary className="flex items-center justify-between px-6 py-5 cursor-pointer list-none
                                        text-white font-semibold text-sm md:text-base
                                        hover:text-[#ED7C00] transition-colors duration-200"
                             aria-label={item.q}>
                      {item.q}
                      <svg className="shrink-0 ml-4 transition-transform duration-300 group-open:rotate-180"
                           width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </summary>
                    <div className="px-6 pb-5 border-t border-[#32576F]/30 pt-4">
                      <p className="text-[#7A9BAD] leading-relaxed text-sm">{item.a}</p>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer className="bg-[#0A141D] border-t border-[#32576F]/30 px-6 md:px-10 pt-14 pb-8">
        <div className="max-w-[1400px] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-10 mb-12">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-[#ED7C00] flex items-center justify-center text-white font-bold text-sm select-none">a</div>
                <span className="text-white font-semibold tracking-tight">Alpha IT Hub</span>
              </div>
              <p className="text-[#7A9BAD] text-sm leading-relaxed max-w-[36ch]">
                Sistema ERP con IA para tiendas de indumentaria y calzado. Desarrollado en Argentina.
              </p>
              <div className="flex items-center gap-3 mt-5">
                <a href="#" aria-label="LinkedIn de Alpha IT Hub" className="w-8 h-8 rounded-lg bg-[#1A2F3D] border border-[#32576F]/40 flex items-center justify-center text-[#7A9BAD] hover:text-white hover:border-[#ED7C00]/40 transition-colors duration-200">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
                <a href="#" aria-label="Instagram de Alpha IT Hub" className="w-8 h-8 rounded-lg bg-[#1A2F3D] border border-[#32576F]/40 flex items-center justify-center text-[#7A9BAD] hover:text-white hover:border-[#ED7C00]/40 transition-colors duration-200">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                </a>
              </div>
            </div>

            {/* Product links */}
            <div>
              <p className="text-white font-semibold text-sm mb-4">Producto</p>
              <ul className="space-y-2.5">
                {[{l:'El Sistema',h:'#sistema'},{l:'Analítica HUB',h:'#hub'},{l:'Agentes IA',h:'#hub-agentes'}].map(l=>(
                  <li key={l.l}><a href={l.h} className="text-[#7A9BAD] text-sm hover:text-white transition-colors duration-200">{l.l}</a></li>
                ))}
              </ul>
            </div>

            {/* Company links */}
            <div>
              <p className="text-white font-semibold text-sm mb-4">Empresa</p>
              <ul className="space-y-2.5">
                <li><a href="#nosotros" className="text-[#7A9BAD] text-sm hover:text-white transition-colors duration-200">Nosotros</a></li>
                <li><a href="#faq" className="text-[#7A9BAD] text-sm hover:text-white transition-colors duration-200">FAQ</a></li>
                <li>
                  <a href="https://wa.me/5434554631" target="_blank" rel="noopener noreferrer"
                     className="text-[#7A9BAD] text-sm hover:text-white transition-colors duration-200">
                    Contacto
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-[#32576F]/30 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-[#32576F] text-xs">
              Sistema ERP con agentes de inteligencia artificial para el retail de moda. Villaguay, Entre Rios, Argentina.
            </p>
            <div className="flex items-center gap-5">
              <a href="#" className="text-[#32576F] text-xs hover:text-[#7A9BAD] transition-colors duration-200">Terminos y Condiciones</a>
              <a href="#" className="text-[#32576F] text-xs hover:text-[#7A9BAD] transition-colors duration-200">Politica de Privacidad</a>
              <span className="text-[#32576F] text-xs">© 2026 Alpha IT Hub. Todos los derechos reservados.</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
