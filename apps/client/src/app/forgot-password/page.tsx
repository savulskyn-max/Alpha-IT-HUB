'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
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
        </div>

        <div className="bg-[#1E3340] border border-[#32576F] rounded-2xl p-8">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-white">Email enviado</h2>
              <p className="text-[#CDD4DA] text-sm">
                Si existe una cuenta con <strong>{email}</strong>, vas a recibir un link para restablecer tu contraseña.
              </p>
              <Link
                href="/login"
                className="inline-block text-[#ED7C00] hover:text-[#d06e00] font-medium transition-colors"
              >
                Volver al login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold text-white mb-1">Recuperar contraseña</h2>
                <p className="text-[#7A9BAD] text-sm">
                  Ingresá tu email y te enviamos un link para restablecer tu contraseña.
                </p>
              </div>

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

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#ED7C00] hover:bg-[#d06e00] disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                {loading ? 'Enviando...' : 'Enviar link de recuperación'}
              </button>

              <div className="text-center">
                <Link href="/login" className="text-[#7A9BAD] hover:text-white text-sm transition-colors">
                  Volver al login
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
