import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#132229] flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-[#32576F]/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#ED7C00] flex items-center justify-center text-white font-bold text-sm">
            α
          </div>
          <span className="text-white font-semibold">Alpha IT Hub</span>
        </div>
        <Link
          href="/login"
          className="bg-[#ED7C00] hover:bg-[#d06e00] text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          Iniciar sesión
        </Link>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-2xl">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-[#ED7C00] text-white text-4xl font-bold mb-8">
            α
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
            Inteligencia para
            <span className="text-[#ED7C00]"> tu negocio</span>
          </h1>
          <p className="text-[#CDD4DA] text-lg mb-8 max-w-lg mx-auto">
            Analítica avanzada de stock, ventas, gastos y compras.
            Decisiones basadas en datos con agentes de IA.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/login"
              className="bg-[#ED7C00] hover:bg-[#d06e00] text-white font-semibold px-8 py-3 rounded-xl transition-colors"
            >
              Comenzar
            </Link>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-16">
            {[
              { title: 'Stock', desc: 'Inventario inteligente con rotación y alertas' },
              { title: 'Ventas', desc: 'KPIs, tendencias y análisis por canal' },
              { title: 'Agentes IA', desc: 'Automatización con inteligencia artificial' },
            ].map((f) => (
              <div key={f.title} className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-5 text-left">
                <h3 className="text-white font-semibold text-sm mb-1">{f.title}</h3>
                <p className="text-[#7A9BAD] text-xs">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-[#32576F]/50 text-center">
        <p className="text-[#7A9BAD] text-xs">
          Alpha IT Hub © {new Date().getFullYear()} · Todos los derechos reservados
        </p>
      </footer>
    </div>
  );
}
