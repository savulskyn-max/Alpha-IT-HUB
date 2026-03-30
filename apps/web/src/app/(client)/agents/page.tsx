import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';

export default async function AgentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Agentes IA"
        subtitle="Asistentes inteligentes para tu negocio"
        userEmail={user.email}
      />

      <main className="flex-1 px-6 py-6 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 rounded-2xl bg-[#ED7C00]/10 flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-[#ED7C00]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.375 3.375 0 01-4.06.44L12 17m0 0l-.47.53a3.375 3.375 0 01-4.06.44L5 14.5m7 2.5v4.25" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Próximamente</h2>
          <p className="text-[#7A9BAD] text-sm leading-relaxed">
            Estamos trabajando en agentes de inteligencia artificial que te ayudarán
            a optimizar tu inventario, predecir demanda y automatizar decisiones
            de compra.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 bg-[#1E3340] border border-[#32576F] rounded-xl px-4 py-2">
            <div className="w-2 h-2 rounded-full bg-[#ED7C00] animate-pulse" />
            <span className="text-[#CDD4DA] text-xs">En desarrollo</span>
          </div>
        </div>
      </main>
    </div>
  );
}
