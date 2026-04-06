import Link from 'next/link';

// ── Static data ────────────────────────────────────────────────────────────────

const stats = [
  { value: '12.4K', label: 'SKUs gestionados' },
  { value: '94.7%', label: 'Precisión predictiva' },
  { value: '3.2×', label: 'Retorno promedio' },
];

const features = [
  {
    tag: 'Inventario',
    title: 'Stock con visión de 360°',
    desc: 'Rotación, alertas de quiebre y reposición automática. Cada SKU con su historial completo y predicción de demanda.',
    metric: '−23% sobrestock',
    bars: [40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88],
    large: true,
  },
  {
    tag: 'Ventas',
    title: 'KPIs en tiempo real',
    desc: 'Tendencias por canal, producto y período. Identifica oportunidades antes que la competencia.',
    large: false,
  },
  {
    tag: 'Agentes IA',
    title: 'Automatización que opera sola',
    desc: 'Compras, alertas y predicciones sin intervención manual. La IA trabaja mientras tú decides.',
    large: false,
  },
];

// ── Mock dashboard metrics for hero preview ────────────────────────────────────

const dashMetrics = [
  { label: 'SKUs críticos', value: '17', dot: 'bg-red-400' },
  { label: 'Pedidos pendientes', value: '43', dot: 'bg-amber-400' },
  { label: 'Rotación promedio', value: '4.1×', dot: 'bg-emerald-400' },
];

const barHeights = [55, 70, 45, 85, 60, 90, 75, 50, 80, 95, 65, 88];

// ── Page ───────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-[#0F1E26] flex flex-col">

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 px-6 md:px-10 py-4 flex items-center justify-between
                         border-b border-[#32576F]/30 bg-[#0F1E26]/90 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#ED7C00] flex items-center justify-center
                          text-white font-bold text-sm select-none">
            α
          </div>
          <span className="text-white font-semibold tracking-tight">Alpha IT Hub</span>
        </div>

        <Link
          href="/login"
          className="bg-[#ED7C00] text-white text-sm font-semibold px-5 py-2.5 rounded-xl
                     transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                     hover:bg-[#d06e00] hover:-translate-y-[1px]
                     hover:shadow-[0_6px_20px_rgba(237,124,0,0.25)]
                     active:scale-[0.98] active:translate-y-0"
        >
          Iniciar sesión
        </Link>
      </header>

      <main className="flex-1">

        {/* ── Hero — Split Screen ── */}
        <section className="max-w-[1400px] mx-auto px-6 md:px-10
                            pt-16 md:pt-24 pb-20
                            grid grid-cols-1 lg:grid-cols-[1fr_460px] gap-12 lg:gap-20 items-center">

          {/* Left: content */}
          <div className="space-y-8">

            {/* Status badge */}
            <div
              className="inline-flex items-center gap-2 bg-[#ED7C00]/10 border border-[#ED7C00]/20
                         text-[#ED7C00] text-xs font-semibold px-4 py-2 rounded-full"
              style={{ animation: 'fadeSlideIn 0.6s cubic-bezier(0.16,1,0.3,1) both' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#ED7C00]"
                    style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
              Analítica para distribuidores
            </div>

            {/* Headline */}
            <h1
              className="text-5xl md:text-[4.5rem] lg:text-[5.25rem] font-bold tracking-tighter leading-none text-white"
              style={{ animation: 'fadeSlideIn 0.6s 0.1s cubic-bezier(0.16,1,0.3,1) both' }}
            >
              Datos que<br />
              <span className="text-[#ED7C00]">mueven</span><br />
              negocios.
            </h1>

            {/* Body */}
            <p
              className="text-[#7A9BAD] text-lg leading-relaxed max-w-[55ch]"
              style={{ animation: 'fadeSlideIn 0.6s 0.2s cubic-bezier(0.16,1,0.3,1) both' }}
            >
              Analítica de stock, ventas y compras con predicción de IA.
              Decisiones concretas respaldadas por tus propios números.
            </p>

            {/* CTAs */}
            <div
              className="flex items-center gap-5"
              style={{ animation: 'fadeSlideIn 0.6s 0.3s cubic-bezier(0.16,1,0.3,1) both' }}
            >
              <Link
                href="/login"
                className="bg-[#ED7C00] text-white font-semibold px-8 py-4 rounded-xl
                           transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                           hover:bg-[#d06e00] hover:-translate-y-[2px]
                           hover:shadow-[0_12px_32px_rgba(237,124,0,0.3)]
                           active:scale-[0.98] active:translate-y-0"
              >
                Acceder al sistema
              </Link>

              <a
                href="#features"
                className="text-[#CDD4DA] text-sm font-medium hover:text-white
                           transition-colors duration-200 flex items-center gap-2"
              >
                Ver funciones
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M7 1v12M7 13l-5-5M7 13l5-5"
                        stroke="currentColor" strokeWidth="1.5"
                        strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>

            {/* Stats strip */}
            <div
              className="flex flex-wrap items-center gap-x-8 gap-y-4 pt-6 border-t border-[#32576F]/40"
              style={{ animation: 'fadeSlideIn 0.6s 0.4s cubic-bezier(0.16,1,0.3,1) both' }}
            >
              {stats.map((s) => (
                <div key={s.label} className="space-y-0.5">
                  <p className="text-2xl font-bold tracking-tight text-white">{s.value}</p>
                  <p className="text-[10px] text-[#7A9BAD] uppercase tracking-widest">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: UI preview — hidden on mobile */}
          <div
            className="hidden lg:block"
            style={{ animation: 'fadeSlideIn 0.8s 0.25s cubic-bezier(0.16,1,0.3,1) both' }}
          >
            <div
              className="relative"
              style={{ animation: 'floatY 6s ease-in-out infinite' }}
            >
              {/* Main dashboard card */}
              <div className="bg-[#1A2F3D] border border-[#32576F]/60 rounded-[1.75rem] p-6
                              shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)]">

                {/* Card header */}
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-[10px] text-[#7A9BAD] uppercase tracking-widest mb-1">
                      Cobertura de stock
                    </p>
                    <p className="text-2xl font-bold text-white tracking-tight">8.3 días</p>
                  </div>
                  <span className="text-xs font-semibold text-emerald-400 bg-emerald-400/10
                                   px-3 py-1.5 rounded-full border border-emerald-400/20">
                    +12.4% semana
                  </span>
                </div>

                {/* Mini bar chart */}
                <div className="flex items-end gap-1 h-20 mb-5">
                  {barHeights.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-sm transition-all duration-700"
                      style={{
                        height: `${h}%`,
                        backgroundColor:
                          i === 9 ? '#ED7C00'
                          : i > 7  ? 'rgba(50,87,111,0.8)'
                          : 'rgba(50,87,111,0.35)',
                        transitionDelay: `${i * 50}ms`,
                      }}
                    />
                  ))}
                </div>

                {/* Metric rows */}
                <div>
                  {dashMetrics.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between py-2.5 border-t border-[#32576F]/30"
                    >
                      <span className="text-[#7A9BAD] text-xs">{row.label}</span>
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${row.dot}`} />
                        <span className="text-white text-sm font-semibold">{row.value}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Floating alert card */}
              <div
                className="absolute -bottom-5 -left-8 bg-[#0F1E26] border border-[#32576F]/60
                            rounded-2xl p-4 w-52
                            shadow-[0_20px_40px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)]"
              >
                <p className="text-[9px] text-[#7A9BAD] uppercase tracking-widest mb-1">Alerta IA</p>
                <p className="text-white text-xs font-semibold leading-snug">
                  Producto A-142 alcanza quiebre en 2 días
                </p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-amber-400"
                    style={{ animation: 'pulse-dot 1.8s ease-in-out infinite' }}
                  />
                  <span className="text-amber-400 text-[10px] font-medium">Acción recomendada</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features — Asymmetric grid 2fr 1fr ── */}
        <section id="features" className="max-w-[1400px] mx-auto px-6 md:px-10 pb-24">

          {/* Section header */}
          <div className="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-[#ED7C00] text-xs font-semibold uppercase tracking-widest mb-3">
                Plataforma
              </p>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight max-w-lg">
                Todo lo que tu equipo necesita, en un solo lugar.
              </h2>
            </div>
            <Link
              href="/login"
              className="hidden md:inline-flex items-center gap-1.5 text-sm text-[#7A9BAD]
                         hover:text-white transition-colors duration-200 shrink-0"
            >
              Explorar todo
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M1 6h10M11 6L6 1M11 6L6 11"
                      stroke="currentColor" strokeWidth="1.5"
                      strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>

          {/* Asymmetric grid: large left card + 2 stacked right cards */}
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-5">

            {/* Large feature card */}
            <div
              className="bg-[#1A2F3D] border border-[#32576F]/50 rounded-[2rem] p-8
                         group hover:border-[#ED7C00]/30
                         transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]
                         hover:shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
            >
              <div className="flex items-start justify-between mb-6">
                <span className="text-[10px] text-[#ED7C00] font-semibold uppercase tracking-widest
                                 bg-[#ED7C00]/10 px-3 py-1.5 rounded-full border border-[#ED7C00]/20">
                  Inventario
                </span>
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-400/10
                                 px-3 py-1.5 rounded-full border border-emerald-400/20">
                  −23% sobrestock
                </span>
              </div>

              <h3 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-3">
                Stock con visión de 360°
              </h3>
              <p className="text-[#7A9BAD] leading-relaxed max-w-[45ch]">
                Rotación, alertas de quiebre y reposición automática.
                Cada SKU con su historial completo y predicción de demanda.
              </p>

              {/* Animated bar chart */}
              <div className="mt-8 flex items-end gap-1.5 h-16">
                {[40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm transition-all duration-700"
                    style={{
                      height: `${h}%`,
                      backgroundColor: 'rgba(50,87,111,0.5)',
                      transitionDelay: `${i * 40}ms`,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Right column: 2 stacked smaller cards */}
            <div className="flex flex-col gap-5">
              <div
                className="flex-1 bg-[#1A2F3D] border border-[#32576F]/50 rounded-[2rem] p-7
                           group hover:border-[#ED7C00]/30
                           transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]
                           hover:shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
              >
                <span className="text-[10px] text-[#ED7C00] font-semibold uppercase tracking-widest
                                 bg-[#ED7C00]/10 px-3 py-1.5 rounded-full border border-[#ED7C00]/20
                                 inline-block mb-5">
                  Ventas
                </span>
                <h3 className="text-xl font-bold text-white tracking-tight mb-2">
                  KPIs en tiempo real
                </h3>
                <p className="text-[#7A9BAD] text-sm leading-relaxed">
                  Tendencias por canal, producto y período. Identifica oportunidades antes que la competencia.
                </p>
              </div>

              <div
                className="flex-1 bg-[#1A2F3D] border border-[#32576F]/50 rounded-[2rem] p-7
                           group hover:border-[#ED7C00]/30
                           transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]
                           hover:shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
              >
                <span className="text-[10px] text-[#ED7C00] font-semibold uppercase tracking-widest
                                 bg-[#ED7C00]/10 px-3 py-1.5 rounded-full border border-[#ED7C00]/20
                                 inline-block mb-5">
                  Agentes IA
                </span>
                <h3 className="text-xl font-bold text-white tracking-tight mb-2">
                  Automatización inteligente
                </h3>
                <p className="text-[#7A9BAD] text-sm leading-relaxed">
                  Compras, alertas y predicciones que operan sin intervención manual.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[#32576F]/30 px-6 md:px-10 py-6">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-[#ED7C00] flex items-center justify-center
                            text-white text-xs font-bold select-none">
              α
            </div>
            <span className="text-[#7A9BAD] text-sm font-medium">Alpha IT Hub</span>
          </div>
          <p className="text-[#7A9BAD] text-xs">
            © {new Date().getFullYear()} Todos los derechos reservados
          </p>
        </div>
      </footer>
    </div>
  );
}
