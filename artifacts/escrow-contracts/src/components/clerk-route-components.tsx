import type { ReactNode } from 'react';
import {
  AuthenticateWithRedirectCallback,
  useUser,
} from '@clerk/react';
import { Redirect } from 'wouter';
import { ClerkAppShell } from '@/components/clerk-app-shell';
import ContractDetail from '@/pages/contract-detail';
import { usePiIframeSession } from '@/lib/pi-iframe-session';
import { usePiAppSession } from '@/lib/pi-app-session';

export function ClerkHomeRedirect({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const { isLoaded, isSignedIn } = useUser();
  const { session } = usePiIframeSession();
  const { loading: piLoading, signedIn: piSignedIn } = usePiAppSession();
  if (!session && !piSignedIn && (!isLoaded || piLoading)) return null;
  if (!session && !isSignedIn && !piSignedIn) return <>{fallback}</>;
  return <ClerkAppShell>{children}</ClerkAppShell>;
}

export function ClerkProtectedContent({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const { session } = usePiIframeSession();
  const { loading: piLoading, signedIn: piSignedIn } = usePiAppSession();
  if (!session && !piSignedIn && (!isLoaded || piLoading)) return null;
  if (!session && !isSignedIn && !piSignedIn) return <Redirect to="/" />;
  return <ClerkAppShell>{children}</ClerkAppShell>;
}

export function ClerkContractDetailRoute() {
  const { user } = useUser();
  return <ContractDetail clerkUserId={user?.id ?? null} />;
}

export function ClerkSsoCallback() {
  return <AuthenticateWithRedirectCallback />;
}