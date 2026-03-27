import Link from 'next/link';
import { BarChart3, Bot, Store, Globe } from 'lucide-react';

const features = [
  {
    icon: BarChart3,
    title: 'Analítica Inteligente',
    description: 'Dashboards de stock, ventas, gastos y compras sin necesidad de Power BI. Todo automatizado.',
  },
  {
    icon: Bot,
    title: 'Agentes de IA',
    description: 'Un equipo virtual que analiza tu negocio, te alerta y te recomienda acciones. Próximamente.',
  },
  {
    icon: Store,
    title: 'Multi-local',
    description: 'Gestión centralizada de todos tus locales desde un solo lugar. Compará rendimiento entre sucursales.',
  },
  {
    icon: Globe,
    title: 'Sin instalación',
    description: '100% web. Accedé desde cualquier dispositivo, en cualquier momento. Sin descargas ni configuraciones.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#132229] text-white">
      {/* Navbar */}
      <nav className="border-b border-[#32576F]/30">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ED7C00] flex items-center justify-center text-white text-xl font-bold">
              α
            </div>
            <span className="text-lg font-semibold">Alpha IT Hub</span>
          </div>
          <Link
            href="/login"
            className="bg-[#ED7C00] hover:bg-[#d06e00] text-white font-medium px-5 py-2.5 rounded-xl transition-colors text-sm"
          >
            Iniciar sesión
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-24 md:py-32">
        <div className="max-w-3xl">
          <div className="inline-block bg-[#ED7C00]/10 border border-[#ED7C00]/30 rounded-full px-4 py-1.5 text-[#ED7C00] text-sm font-medium mb-6">
            RetailAI para tiendas de ropa
          </div>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">
            Tu equipo de IA para
            <span className="text-[#ED7C00]"> tu tienda de ropa</span>
          </h1>
          <p className="text-[#CDD4DA] text-lg md:text-xl leading-relaxed mb-10 max-w-2xl">
            Analítica de stock, ventas, gastos y compras.
            Agentes de inteligencia artificial que trabajan 24/7 para tu negocio.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              href="/login"
              className="bg-[#ED7C00] hover:bg-[#d06e00] text-white font-semibold px-8 py-4 rounded-xl transition-colors text-center text-lg"
            >
              Iniciar sesión
            </Link>
            <a
              href="#features"
              className="border border-[#32576F] hover:border-[#CDD4DA] text-[#CDD4DA] hover:text-white font-medium px-8 py-4 rounded-xl transition-colors text-center text-lg"
            >
              Conocer más
            </a>
          </div>
        </div>

        {/* Decorative gradient */}
        <div className="absolute top-0 right-0 w-1/2 h-96 bg-gradient-to-bl from-[#ED7C00]/5 via-[#32576F]/5 to-transparent pointer-events-none" />
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Todo lo que necesitás para tu negocio
          </h2>
          <p className="text-[#CDD4DA] text-lg max-w-xl mx-auto">
            Herramientas diseñadas específicamente para tiendas de ropa y retail.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-8 hover:border-[#ED7C00]/50 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-[#ED7C00]/10 flex items-center justify-center mb-5">
                <feature.icon className="w-6 h-6 text-[#ED7C00]" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
              <p className="text-[#CDD4DA] leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Social proof */}
      <section className="border-y border-[#32576F]/30 py-16">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <p className="text-[#7A9BAD] text-lg mb-2">Confiado por</p>
          <p className="text-4xl font-bold text-white mb-2">50+</p>
          <p className="text-[#CDD4DA]">tiendas de ropa en Argentina</p>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          Empezá a tomar mejores decisiones hoy
        </h2>
        <p className="text-[#CDD4DA] text-lg mb-8 max-w-xl mx-auto">
          Conectá tu sistema de gestión y accedé a analítica inteligente en minutos.
        </p>
        <Link
          href="/login"
          className="inline-block bg-[#ED7C00] hover:bg-[#d06e00] text-white font-semibold px-8 py-4 rounded-xl transition-colors text-lg"
        >
          Iniciar sesión
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#32576F]/30 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#ED7C00] flex items-center justify-center text-white text-sm font-bold">
              α
            </div>
            <span className="text-sm text-[#7A9BAD]">
              &copy; 2026 Alpha IT Hub. Todos los derechos reservados.
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/login" className="text-[#CDD4DA] hover:text-white transition-colors">
              Iniciar sesión
            </Link>
            <a
              href="https://wa.me/5491100000000"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#CDD4DA] hover:text-white transition-colors"
            >
              Contacto
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
