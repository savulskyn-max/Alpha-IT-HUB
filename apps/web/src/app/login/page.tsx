'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// ── Left panel feature list ────────────────────────────────────────────────────

const leftFeatures = [
  {
    title: 'Stock en tiempo real',
    desc: 'Rotación, quiebres y reposición automática.',
  },
  {
    title: 'Ventas por canal',
    desc: 'KPIs, tendencias y análisis comparativo.',
  },
  {
    title: 'Agentes de IA',
    desc: 'Predicciones y alertas sin intervención manual.',
  },
];

// ── Component ──────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Determine redirect based on role
    // Priority: JWT claim > user metadata > backend /auth/me
    let role = 'viewer';
    if (data.session?.access_token) {
      try {
        const payload = data.session.access_token.split('.')[1];
        const claims = JSON.parse(atob(payload));
        role = claims.user_role ?? 'viewer';
      } catch {
        // fallback
      }
    }
    if (role === 'viewer' && data.user) {
      role = (data.user.app_metadata?.role as string)
        ?? (data.user.user_metadata?.role as string)
        ?? 'viewer';
    }
    if (role === 'viewer' && data.session?.access_token) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const meRes = await fetch('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          signal: ctrl.signal,
        });
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.role) role = me.role;
        }
      } catch {
        // timeout or network error — continue with current role
      } finally {
        clearTimeout(timer);
      }
    }

    document.cookie = `x-user-role=${role}; path=/; max-age=86400; samesite=lax`;

    const home = role === 'admin' || role === 'superadmin' ? '/admin' : '/dashboard';
    router.push(home);
    router.refresh();
  };

  return (
    <div className="min-h-[100dvh] flex">

      {/* ── Left panel: brand ── */}
      <div className="hidden lg:flex lg:w-[52%] flex-col justify-between
                      bg-[#0F1E26] border-r border-[#32576F]/30 p-12 relative overflow-hidden">

        {/* Subtle background texture */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 20% 80%, rgba(237,124,0,0.06) 0%, transparent 60%),' +
              'radial-gradient(ellipse 60% 50% at 80% 10%, rgba(50,87,111,0.15) 0%, transparent 60%)',
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#ED7C00] flex items-center justify-center
                          text-white font-bold select-none shadow-[0_4px_16px_rgba(237,124,0,0.3)]">
            α
          </div>
          <span className="text-white font-semibold tracking-tight text-lg">Alpha IT Hub</span>
        </div>

        {/* Center content */}
        <div className="relative space-y-10">
          <div className="space-y-4">
            <p className="text-[#ED7C00] text-xs font-semibold uppercase tracking-widest">
              Inteligencia empresarial
            </p>
            <h2 className="text-4xl font-bold tracking-tight text-white leading-tight">
              Decisiones basadas<br />en tus propios datos.
            </h2>
            <p className="text-[#7A9BAD] text-base leading-relaxed max-w-[40ch]">
              Analítica avanzada para distribuidores que quieren crecer con precisión.
            </p>
          </div>

          {/* Feature list */}
          <div className="space-y-5">
            {leftFeatures.map((f, i) => (
              <div
                key={f.title}
                className="flex items-start gap-4"
                style={{ animation: `fadeSlideRight 0.5s ${0.1 + i * 0.1}s cubic-bezier(0.16,1,0.3,1) both` }}
              >
                <div className="mt-0.5 w-6 h-6 rounded-full bg-[#ED7C00]/15 border border-[#ED7C00]/30
                                flex items-center justify-center shrink-0">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M2 5l2.5 2.5L8 3"
                          stroke="#ED7C00" strokeWidth="1.5"
                          strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">{f.title}</p>
                  <p className="text-[#7A9BAD] text-xs mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <p className="relative text-[#32576F] text-xs">
          © {new Date().getFullYear()} Alpha IT Hub
        </p>
      </div>

      {/* ── Right panel: form ── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0A1920] px-6 py-12">

        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-3 mb-10">
          <div className="w-9 h-9 rounded-xl bg-[#ED7C00] flex items-center justify-center
                          text-white font-bold select-none">
            α
          </div>
          <span className="text-white font-semibold tracking-tight">Alpha IT Hub</span>
        </div>

        <div
          className="w-full max-w-[400px] space-y-8"
          style={{ animation: 'fadeSlideIn 0.6s cubic-bezier(0.16,1,0.3,1) both' }}
        >
          {/* Heading */}
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Iniciar sesión</h1>
            <p className="text-[#7A9BAD] text-sm mt-1.5">Accede a tu espacio de trabajo</p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-5">

            {/* Error state */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/25 text-red-400 text-sm
                              rounded-xl px-4 py-3 flex items-start gap-2.5">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                     className="mt-0.5 shrink-0" aria-hidden="true">
                  <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 4v3M7 9.5v.5"
                        stroke="currentColor" strokeWidth="1.5"
                        strokeLinecap="round" />
                </svg>
                {error}
              </div>
            )}

            {/* Email */}
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-[#CDD4DA]"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@empresa.com"
                required
                className="w-full bg-[#1A2F3D] border border-[#32576F] rounded-xl px-4 py-3
                           text-white placeholder-[#7A9BAD] text-sm
                           transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]
                           focus:outline-none focus:border-[#ED7C00]
                           focus:shadow-[0_0_0_3px_rgba(237,124,0,0.12)]"
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[#CDD4DA]"
              >
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-[#1A2F3D] border border-[#32576F] rounded-xl px-4 py-3
                           text-white placeholder-[#7A9BAD] text-sm
                           transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]
                           focus:outline-none focus:border-[#ED7C00]
                           focus:shadow-[0_0_0_3px_rgba(237,124,0,0.12)]"
              />
            </div>

            {/* Submit — loading state + tactile feedback */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#ED7C00] text-white font-semibold py-3.5 rounded-xl text-sm
                         transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                         hover:bg-[#d06e00] hover:-translate-y-[1px]
                         hover:shadow-[0_8px_24px_rgba(237,124,0,0.3)]
                         active:scale-[0.98] active:translate-y-0
                         disabled:opacity-50 disabled:cursor-not-allowed
                         disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="w-4 h-4 animate-spin"
                    viewBox="0 0 24 24" fill="none"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10"
                            stroke="currentColor" strokeWidth="3"
                            strokeLinecap="round"
                            strokeDasharray="32" strokeDashoffset="12" />
                  </svg>
                  Verificando...
                </span>
              ) : (
                'Entrar'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
