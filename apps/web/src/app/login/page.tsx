'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

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
    const role =
      data.user?.app_metadata?.role ??
      data.user?.user_metadata?.role ??
      'viewer';

    const home = role === 'admin' || role === 'superadmin' ? '/admin' : '/dashboard';
    router.push(home);
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#132229] px-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#ED7C00] text-white text-3xl font-bold mb-4">
            α
          </div>
          <h1 className="text-2xl font-bold text-white">Alpha IT Hub</h1>
          <p className="text-[#CDD4DA] text-sm mt-1">Inicia sesión para continuar</p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleLogin}
          className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-8 space-y-5"
        >
          <h2 className="text-xl font-semibold text-white mb-2">Iniciar sesión</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[#CDD4DA] mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              required
              className="w-full bg-[#132229] border border-[#32576F] rounded-xl px-4 py-3 text-white placeholder-[#7A9BAD] focus:outline-none focus:border-[#ED7C00] transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#CDD4DA] mb-2">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full bg-[#132229] border border-[#32576F] rounded-xl px-4 py-3 text-white placeholder-[#7A9BAD] focus:outline-none focus:border-[#ED7C00] transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#ED7C00] hover:bg-[#d06e00] disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
          </button>
        </form>

        <p className="text-center text-[#7A9BAD] text-xs mt-6">
          Alpha IT Hub © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
