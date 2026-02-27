interface HeaderProps {
  title: string;
  subtitle?: string;
  userEmail?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, userEmail, actions }: HeaderProps) {
  return (
    <header className="bg-[#1E3340] border-b border-[#32576F] px-6 py-4 flex items-center justify-between">
      <div>
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        {subtitle && <p className="text-[#7A9BAD] text-sm mt-0.5">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-4">
        {actions}
        {userEmail && (
          <div className="flex items-center gap-3 pl-4 border-l border-[#32576F]">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-[#CDD4DA] leading-tight">{userEmail}</p>
              <p className="text-xs text-[#7A9BAD]">Administrador</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#ED7C00]/20 border border-[#ED7C00]/30 flex items-center justify-center">
              <span className="text-[#ED7C00] text-xs font-semibold">
                {userEmail.charAt(0).toUpperCase()}
              </span>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-[#7A9BAD] hover:text-[#ED7C00] text-sm transition-colors"
                title="Cerrar sesión"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
