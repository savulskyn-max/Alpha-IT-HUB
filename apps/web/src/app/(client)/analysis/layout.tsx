import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { AnalysisTabs } from './AnalysisTabs';
import { AnalyticsCacheWrapper } from './AnalyticsCacheWrapper';

export default async function AnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Análisis"
        subtitle="Datos e inteligencia de tu negocio"
        userEmail={user.email}
      />
      <div className="px-6 pt-4">
        <AnalysisTabs />
      </div>
      <main className="flex-1 px-6 py-4">
        <AnalyticsCacheWrapper>
          {children}
        </AnalyticsCacheWrapper>
      </main>
    </div>
  );
}
