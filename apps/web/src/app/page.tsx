import { redirect } from 'next/navigation';

/**
 * Root page: redirect to dashboard.
 * The dashboard layout and login page handle role-based routing.
 */
export default function RootPage() {
  redirect('/dashboard');
}
