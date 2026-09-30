import type { ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import { AppShellFrame } from '@/components/app-shell';
import { usePiIframeSession } from '@/lib/pi-iframe-session';
import { usePiAppSession } from '@/lib/pi-app-session';
import { useI18n } from '@/i18n';

export function ClerkAppShell({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  const { isSignedIn, user } = useUser();
  const { session, clearSession } = usePiIframeSession();
  const { signedIn: piAppSignedIn, username: piUsername, signOut: signOutPiApp } = usePiAppSession();
  const { t } = useI18n();
  const signedInLabel = session?.identity.username
    ? `@${session.identity.username}`
    : piAppSignedIn
      ? piUsername ? `@${piUsername}` : t('navigation.workspaceOwner')
      : user?.fullName || user?.primaryEmailAddress?.emailAddress || t('navigation.workspaceOwner');

  return (
    <AppShellFrame
      signedInLabel={signedInLabel}
      allowAdminNavigation
      onSignOut={async () => {
        if (session) await clearSession();
        if (piAppSignedIn) await signOutPiApp();
        if (isSignedIn) await signOut({ redirectUrl: import.meta.env.BASE_URL });
      }}
    >
      {children}
    </AppShellFrame>
  );
}