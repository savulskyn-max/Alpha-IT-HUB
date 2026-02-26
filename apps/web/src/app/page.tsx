import { redirect } from 'next/navigation';

/**
 * Root page: redirect to dashboard (or login if unauthenticated — handled in middleware).
 */
export default function RootPage() {
  redirect('/dashboard');
}
