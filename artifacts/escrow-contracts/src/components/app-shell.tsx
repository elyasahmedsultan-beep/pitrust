import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowUpRight, Bell, CircleHelp, Gavel, Globe2, LayoutGrid, Menu, MessageCircle, Plus, ShieldCheck, Store, UserRound, WalletCards, X } from 'lucide-react';
import { getGetAdminAccessQueryKey, getListNotificationsQueryKey, useGetAdminAccess, useListNotifications } from '@workspace/api-client-react';
import { Link, useLocation } from 'wouter';
import { LanguageSwitcher, useI18n } from '@/i18n';
import { PI_SANDBOX } from '@/lib/pi-sdk';
import { usePiIframeSession } from '@/lib/pi-iframe-session';
import { usePiAppSession } from '@/lib/pi-app-session';

export function AppShellFrame({
  children,
  signedInLabel,
  onSignOut,
  allowAdminNavigation,
}: {
  children: ReactNode;
  signedInLabel: string;
  onSignOut: () => Promise<void>;
  allowAdminNavigation: boolean;
}) {
  const { direction, t } = useI18n();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const previousLocation = useRef<string | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (previousLocation.current === null) {
      previousLocation.current = location;
      return;
    }

    if (previousLocation.current === location) return;
    previousLocation.current = location;
    setIsNavigating(true);
    const timeoutId = window.setTimeout(() => setIsNavigating(false), 450);
    return () => window.clearTimeout(timeoutId);
  }, [location]);
  const adminAccess = useGetAdminAccess({ query: { queryKey: getGetAdminAccessQueryKey(), enabled: allowAdminNavigation, refetchInterval: (query) => query.state.status === 'error' ? false : 30000, refetchOnWindowFocus: false, retry: false } });
  const notifications = useListNotifications({ query: { queryKey: getListNotificationsQueryKey(), refetchInterval: (query) => query.state.status === 'error' ? false : 30000 } });
  const unreadNotifications = (notifications.data ?? []).filter((notification) => !notification.readAt).length;
  const nav = [
    { path: '/', label: t('navigation.overview'), icon: LayoutGrid },
    { path: '/marketplace', label: t('navigation.marketplace'), icon: Store },
    { path: '/listings', label: t('navigation.myListings'), icon: Store },
    { path: '/activity', label: t('navigation.activity'), icon: Activity },
     { path: '/chat', label: t('navigation.chat'), icon: MessageCircle },
    { path: '/rates', label: t('escrow.piEscrow'), icon: Globe2 },
    ...(PI_SANDBOX ? [{ path: '/wallet', label: t('navigation.wallet'), icon: WalletCards }] : []),
    { path: '/profile', label: t('navigation.profile'), icon: UserRound },
    ...(allowAdminNavigation && adminAccess.data?.adminPasswordAuthenticated === true && !adminAccess.isError ? [{ path: '/admin', label: direction === 'rtl' ? 'التحكيم' : 'Arbitration', icon: Gavel }] : []),
  ];
  const closedSidebarTransform = direction === 'rtl' ? 'translate-x-full' : '-translate-x-full';
  const handleSignOut = async () => {
    await onSignOut();
    queryClient.clear();
  };
  return <div className="min-h-[100dvh] bg-[#0D0D0D] text-[#F2F5F3] md:flex">
    {isNavigating && <div className="route-loading-indicator" role="status" aria-live="polite" aria-atomic="true">
      <span className="route-loading-indicator__bar"/>
      <span className="sr-only">{t('common.loading')}</span>
    </div>}
    <aside className={`${open ? 'translate-x-0' : closedSidebarTransform} fixed inset-y-0 start-0 z-40 flex w-[256px] flex-col border-e border-[#292f2c] bg-[#111513] transition-transform md:sticky md:top-0 md:h-[100dvh] md:translate-x-0`}>
      <div className="flex h-20 items-center justify-between border-b border-[#292f2c] px-6">
        <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-3" data-testid="link-brand"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#00C853] text-[#0D0D0D]"><ShieldCheck size={21}/></span><span className="font-semibold tracking-tight">PiTrust<span className="text-[#00C853]">.</span></span></Link>
        <button onClick={() => setOpen(false)} className="md:hidden" aria-label={t('navigation.closeNavigation')} data-testid="button-close-menu"><X size={18}/></button>
      </div>
       <div className="px-4 pt-8"><p className="px-3 font-mono text-[10px] uppercase tracking-[.2em] text-[#789088]">{t('navigation.workspace')}</p><nav className="mt-5 space-y-1">{nav.map(({path,label,icon:Icon}) => { const active = location === path || (path === '/chat' && location.startsWith('/chat/')); return <Link key={path} href={path} onClick={() => setOpen(false)} data-testid={`link-nav-${path.replace('/','') || 'home'}`} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${active ? 'bg-[#193126] text-[#1DE9B6]' : 'text-[#99aaa1] hover:bg-[#1c2821] hover:text-[#f2f5f3]'}`}><Icon size={17}/>{label}{active && <span className="ms-auto h-1.5 w-1.5 rounded-full bg-[#00C853]"/>}</Link>; })}</nav>
          <Link href="/contracts/new" onClick={() => setOpen(false)} data-testid="link-new-contract" className="mt-8 flex items-center justify-between rounded-lg bg-[#00C853] px-4 py-3 text-sm font-bold text-[#07130B] hover:bg-[#1DE9B6]">{t('common.submit')} {t('marketplace.listing')}<Plus size={18}/></Link>
      </div>
       <div className="mt-auto space-y-4 border-t border-[#292f2c] p-5"><div className="rounded-xl border border-[#24513a] bg-[#14241b] p-4"><ShieldCheck size={20} className="text-[#1DE9B6]"/><p className="mt-3 text-xs font-semibold">{t('navigation.fundsStayProtected')}</p><p className="mt-1 text-xs leading-relaxed text-[#8ca59a]">{t('navigation.paymentOnlyMovesOnAgreement')}</p></div><div className="flex items-center gap-2 text-xs text-[#92a69b]"><CircleHelp size={14}/>{signedInLabel}</div></div>
    </aside>
    {open && <button className="fixed inset-0 z-30 bg-[#050907]/80 md:hidden" onClick={() => setOpen(false)} aria-label={t('navigation.closeNavigation')} data-testid="button-overlay"/>}
     <main className="min-w-0 flex-1"><header className="flex h-20 items-center justify-between border-b border-[#292f2c] px-5 sm:px-8 lg:px-12"><div className="flex items-center gap-3"><button className="md:hidden" onClick={() => setOpen(true)} aria-label={t('navigation.openNavigation')} data-testid="button-open-menu"><Menu size={21}/></button><span className="font-mono text-[10px] uppercase tracking-[.2em] text-[#7d9489]">PiTrust / <span className="text-[#cbd8d0]">{nav.find(n => n.path === location)?.label || t('navigation.contracts')}</span></span></div><div className="flex items-center gap-5"><Link href="/activity" aria-label={t('navigation.notifications')} title={t('navigation.notifications')} className="relative rounded-lg p-2 text-[#a7b9ad] hover:bg-[#1b2820] hover:text-[#1DE9B6]" data-testid="link-notifications"><Bell size={18}/>{unreadNotifications > 0 && <span className="absolute -end-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-[#00C853] px-1 font-mono text-[9px] font-bold text-[#08150d]">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</Link><LanguageSwitcher/><button onClick={() => void handleSignOut()} className="flex items-center gap-2 text-xs text-[#9eafa4] hover:text-[#1DE9B6]" data-testid="button-sign-out">{t('common.back')} <ArrowUpRight size={14}/></button></div></header><div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-12">{children}</div></main>
  </div>;
}

export function PiAppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { session, clearSession } = usePiIframeSession();
  const { signedIn: piAppSignedIn, username: piUsername, signOut: signOutPiApp } = usePiAppSession();
  const signedInLabel = session?.identity.username
    ? `@${session.identity.username}`
    : piAppSignedIn
      ? piUsername ? `@${piUsername}` : t('navigation.workspaceOwner')
      : t('navigation.workspaceOwner');

  return (
    <AppShellFrame
      signedInLabel={signedInLabel}
      allowAdminNavigation={false}
      onSignOut={async () => {
        if (session) await clearSession();
        if (piAppSignedIn) await signOutPiApp();
      }}
    >
      {children}
    </AppShellFrame>
  );
}