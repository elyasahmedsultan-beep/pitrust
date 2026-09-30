import { createContext, lazy, Suspense, useCallback, useContext, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowRight,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { PiAppShell } from '@/components/app-shell';
import { ErrorBoundary } from '@/components/error-boundary';
import { PiSignInButton } from '@/components/pi-sign-in-button';
import { PiIframeSessionProvider } from '@/lib/pi-iframe-session';
import { usePiIframeSession } from '@/lib/pi-iframe-session';
import { PiAppSessionProvider, usePiAppSession } from '@/lib/pi-app-session';
import { isPiBrowserRuntime, PI_SANDBOX } from '@/lib/pi-sdk';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider, useI18n } from '@/i18n';

const ActivityPage = lazy(() => import('@/pages/activity'));
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'));
const ContractDetail = lazy(() => import('@/pages/contract-detail'));
const Dashboard = lazy(() => import('@/pages/dashboard'));
const Disputes = lazy(() => import('@/pages/disputes'));
const NewContract = lazy(() => import('@/pages/new-contract'));
const NotFound = lazy(() => import('@/pages/not-found'));
const Marketplace = lazy(() => import('@/pages/marketplace'));
const MyListings = lazy(() => import('@/pages/my-listings'));
const Rates = lazy(() => import('@/pages/rates'));
const ProfilePage = lazy(() => import('@/pages/profile'));
const ContractChat = lazy(() => import('@/pages/contract-chat'));
const ChatRoomsPage = lazy(() => import('@/pages/chat'));
const PublicChatRoomPage = lazy(() => import('@/pages/public-chat-room'));
const PrivacyPolicyPage = lazy(() => import('@/pages/privacy-policy'));
const TermsOfServicePage = lazy(() => import('@/pages/terms-of-service'));
const WalletPage = lazy(() => import('@/pages/wallet'));
const ClerkProviderWithRoutes = lazy(() =>
  import('@/components/clerk-provider-with-routes').then((module) => ({
    default: module.ClerkProviderWithRoutes,
  })),
);
const ClerkHomeRedirect = lazy(() =>
  import('@/components/clerk-route-components').then((module) => ({
    default: module.ClerkHomeRedirect,
  })),
);
const ClerkProtectedContent = lazy(() =>
  import('@/components/clerk-route-components').then((module) => ({
    default: module.ClerkProtectedContent,
  })),
);
const ClerkContractDetailRoute = lazy(() =>
  import('@/components/clerk-route-components').then((module) => ({
    default: module.ClerkContractDetailRoute,
  })),
);
const ClerkSsoCallback = lazy(() =>
  import('@/components/clerk-route-components').then((module) => ({
    default: module.ClerkSsoCallback,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      retryOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchIntervalInBackground: false,
    },
  },
});

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const AuthModeContext = createContext<() => void>(() => {});

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

function PiAuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { t } = useI18n();
  const isSignIn = mode === 'sign-in';
  return (
    <div className="grid min-h-[100dvh] bg-[#0D0D0D] text-[#f2f5f3] lg:grid-cols-2">
      <aside className="hidden flex-col justify-between border-e border-[#2b4431] bg-[#14251a] p-12 lg:flex"><Link href="/" className="flex items-center gap-2 font-['Syne'] text-xl"><ShieldCheck className="text-[#1DE9B6]"/>{t('common.appName')}</Link><div><p className="font-mono text-xs uppercase tracking-widest text-[#1DE9B6]">{t('landing.eyebrow')}</p><h1 className="mt-6 font-['Syne'] text-5xl leading-tight">{t('landing.headline')}</h1><p className="mt-6 max-w-md text-sm leading-7 text-[#9eb8a4]">{t('landing.description')}</p></div><p className="text-xs text-[#86a08b]">{t('escrow.fundsHeldSecurely')}</p></aside>
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[440px] rounded-2xl border border-[#29332E] bg-[#151917] p-6 shadow-[0_24px_80px_rgba(0,0,0,.32)] sm:p-9">
          <Link href="/" className="mb-8 flex items-center gap-3 font-['Syne'] text-lg lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#00C853] text-[#07130B]"><ShieldCheck size={22}/></span>
            {t('common.appName')}
          </Link>
          <p className="font-mono text-xs uppercase tracking-[.2em] text-[#1DE9B6]">{t('landing.eyebrow')}</p>
          <h1 className="mt-4 font-['Syne'] text-3xl font-semibold leading-tight sm:text-4xl">{t('landing.headline')}</h1>
          <p className="mt-4 text-sm leading-7 text-[#9eb8a4]">{t('landing.description')}</p>
          <PiSignInButton
            mode={mode}
            modeSwitchLink={
              <Link
                href={isSignIn ? '/sign-up' : '/sign-in'}
                className="mt-3 flex w-full items-center justify-center rounded-lg border border-[#3b5144] bg-[#101a14] px-5 py-3 text-sm font-semibold text-[#1DE9B6] transition hover:border-[#1DE9B6] hover:bg-[#17271d]"
                data-testid="link-auth-mode-switch"
              >
                {isSignIn ? t('auth.signUpWithPi') : t('auth.signInWithPi')}
              </Link>
            }
          />
        </div>
      </div>
    </div>
  );
}

function SignInPage() {
  return <PiAuthPage mode="sign-in" />;
}

function SignUpPage() {
  return <PiAuthPage mode="sign-up" />;
}

function LandingPage() {
  const { t, direction } = useI18n();
  const isArabic = direction === 'rtl';

  return (
    <main className="landing-grid min-h-[100dvh] overflow-hidden bg-[#0D0D0D] text-[#F2F5F3]">
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 sm:py-6 lg:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-3" aria-label="PiTrust home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#00C853] text-[#07130B] sm:h-10 sm:w-10">
            <ShieldCheck size={22} strokeWidth={2.4} />
          </span>
          <span className="text-base font-semibold tracking-tight sm:text-lg">PiTrust</span>
        </Link>
        <nav className="flex shrink-0 items-center gap-1 sm:gap-3">
          <Link href="/sign-in" className="shrink-0 whitespace-nowrap rounded-lg px-2.5 py-2.5 text-xs font-medium text-[#C2CCC6] transition hover:text-white sm:px-4 sm:text-sm">
            Sign in
          </Link>
          <Link href="/sign-up" className="max-w-[128px] shrink-0 rounded-lg bg-[#00C853] px-3 py-2.5 text-center text-xs font-semibold leading-4 text-[#07130B] transition hover:bg-[#1DE9B6] sm:max-w-none sm:px-4 sm:text-sm sm:leading-normal">
            {t('landing.createFirstContract')}
          </Link>
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-7xl items-center gap-16 px-6 pb-24 pt-16 lg:grid-cols-[1.1fr_.9fr] lg:px-10 lg:pb-32 lg:pt-24">
        <div className="relative z-10">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#214A36] bg-[#102117] px-3.5 py-2 text-xs font-medium text-[#1DE9B6]">
            <Sparkles size={14} /> {t('landing.eyebrow')}
          </div>
          <h1 className="max-w-3xl text-[clamp(2.25rem,12vw,3rem)] font-semibold leading-[1.06] tracking-[-.055em] sm:text-6xl lg:text-[76px]">
            {t('landing.headline')}
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-[#A5B0AA] sm:text-lg sm:leading-8">
            {t('landing.description')}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link href="/sign-up" className="group inline-flex items-center gap-2 rounded-lg bg-[#00C853] px-5 py-3.5 text-sm font-semibold text-[#07130B] transition hover:bg-[#1DE9B6]">
              {t('landing.createFirstContract')} <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/sign-in" className="rounded-lg border border-[#303A34] px-5 py-3.5 text-sm font-medium text-[#D5DDD8] transition hover:border-[#1DE9B6]/60 hover:text-white">
              Sign in
            </Link>
          </div>
          <div className="mt-12 flex items-center gap-3 text-xs text-[#89958E]">
            <LockKeyhole size={15} className="text-[#1DE9B6]" />
            {t('escrow.fundsHeldSecurely')}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[520px]">
          <div className="absolute -inset-10 rounded-full bg-[#00C853]/[.08] blur-3xl" />
          <div className="relative overflow-hidden rounded-2xl border border-[#28332D] bg-[#151917] p-8 shadow-[0_28px_100px_rgba(0,0,0,.42)] sm:p-10">
            <p className="font-mono text-xs uppercase tracking-[.2em] text-[#1DE9B6]">{t('landing.howItWorks')}</p>
            <div className="mt-10 space-y-0 border-t border-[#31513a]">{(['landing.stepOneTitle','landing.stepTwoTitle','landing.stepThreeTitle'] as const).map((key,i)=><div className="flex items-center gap-5 border-b border-[#31513a] py-7" key={key}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#346f46] font-mono text-xs text-[#1DE9B6]">0{i+1}</span><p className="font-['Syne'] text-lg">{t(key)}</p><ArrowRight className="ms-auto shrink-0 text-[#1DE9B6]" size={18}/></div>)}</div>
            <div className="mt-9 flex items-center gap-3 rounded-lg bg-[#102117] px-4 py-4 text-xs text-[#B7C5BC]"><LockKeyhole size={15} className="shrink-0 text-[#1DE9B6]"/>{t('escrow.fundsHeldSecurely')}</div>
          </div>
        </div>
      </section>

      <section className="relative border-t border-[#28372c] bg-[#121a15] px-6 py-24 lg:px-10">
        <div className="mx-auto max-w-7xl"><p className="font-mono text-[11px] uppercase tracking-[.2em] text-[#1DE9B6]">01 / {t('landing.howItWorks')}</p><div className="mt-10 grid gap-12 lg:grid-cols-[1fr_2fr]"><h2 className="font-['Syne'] text-4xl font-semibold leading-tight sm:text-6xl">{t('landing.howItWorks')}<span className="text-[#00C853]">.</span></h2><div className="space-y-0 border-t border-[#35513a]">{[['landing.stepOneTitle','landing.stepOneDescription'],['landing.stepTwoTitle','landing.stepTwoDescription'],['landing.stepThreeTitle','landing.stepThreeDescription']].map(([title,description],i)=><div className="grid gap-4 border-b border-[#35513a] py-7 sm:grid-cols-[3rem_1fr] lg:py-9" key={title}><span className="font-mono text-xs text-[#1DE9B6]">0{i+1}</span><div><h3 className="font-['Syne'] text-2xl">{t(title as 'landing.stepOneTitle')}</h3><p className="mt-3 max-w-xl text-sm leading-7 text-[#a0b2a4]">{t(description as 'landing.stepOneDescription')}</p></div></div>)}</div></div></div>
      </section>
      <section className="border-t border-[#2b3c2e] px-6 py-24 lg:px-10"><div className="mx-auto max-w-7xl"><p className="font-mono text-[11px] uppercase tracking-[.2em] text-[#1DE9B6]">02 / {t('navigation.marketplace')}</p><div className="mt-8 flex flex-wrap items-end justify-between gap-8"><h2 className="max-w-3xl font-['Syne'] text-4xl leading-tight sm:text-6xl">{t('contractWizard.choosePipeline')}</h2><Link href="/sign-up" className="flex items-center gap-2 border-b border-[#1DE9B6] pb-2 text-sm text-[#1DE9B6]">{t('landing.browseMarketplace')}<ArrowRight size={17}/></Link></div><div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-[#2c4433] bg-[#2c4433] md:grid-cols-2">{(['contractWizard.digital','contractWizard.shippable','contractWizard.localProperty','contractWizard.customTerms'] as const).map((key,i)=><div key={key} className="bg-[#151d17] p-8 sm:p-10"><span className="font-mono text-xs text-[#1DE9B6]">0{i+1} / 04</span><h3 className="mt-12 font-['Syne'] text-2xl">{t(key)}</h3><p className="mt-3 text-sm leading-7 text-[#9fb2a2]">{t((['contractWizard.digitalDescription','contractWizard.shippableDescription','contractWizard.localPropertyDescription','contractWizard.customTermsDescription'] as const)[i])}</p></div>)}</div></div></section>
      <section className="border-t border-[#2b3c2e] bg-[#163120] px-6 py-24 lg:px-10"><div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 lg:flex-row lg:items-end"><div><ShieldCheck className="text-[#1DE9B6]" size={38}/><h2 className="mt-8 max-w-2xl font-['Syne'] text-4xl leading-tight sm:text-6xl">{t('escrow.fundsHeldSecurely')}</h2><p className="mt-6 max-w-xl text-sm leading-7 text-[#bfd2c1]">{t('landing.description')}</p></div><Link href="/sign-up" className="inline-flex items-center gap-3 rounded-lg bg-[#00C853] px-6 py-4 text-sm font-semibold text-[#09170b]">{t('landing.createFirstContract')}<ArrowRight size={17}/></Link></div></section>
      <footer className="flex flex-col items-center justify-center gap-3 border-t border-[#202622] px-6 py-8 text-center text-xs text-[#718078] sm:flex-row sm:gap-5">
        <span>{t('common.appName')} · {t('escrow.fundsHeldSecurely')}</span>
        <Link href="/privacy-policy" className="text-[#1DE9B6] transition hover:text-white">Privacy Policy / سياسة الخصوصية</Link>
        <Link href="/terms-of-service" className="text-[#1DE9B6] transition hover:text-white">Terms of Service / شروط الخدمة</Link>
        <a href="mailto:elyasahmedsultan@gmail.com" className="transition hover:text-white">Privacy contact</a>
      </footer>
    </main>
  );
}

function PiHomeRedirect() {
  const { session } = usePiIframeSession();
  const { loading: piLoading, signedIn: piSignedIn } = usePiAppSession();
  if (!session && !piSignedIn && piLoading) return null;
  if (!session && !piSignedIn) return <LandingPage />;
  return <PiAppShell><Dashboard /></PiAppShell>;
}

function PiProtectedContent({ children }: { children: ReactNode }) {
  const { session } = usePiIframeSession();
  const { loading: piLoading, signedIn: piSignedIn } = usePiAppSession();
  if (!session && !piSignedIn && piLoading) return null;
  if (!session && !piSignedIn) return <Redirect to="/" />;
  return <PiAppShell>{children}</PiAppShell>;
}

function ProtectedPage({ children, clerkEnabled }: {
  children: ReactNode;
  clerkEnabled: boolean;
}) {
  return clerkEnabled
    ? <ClerkProtectedContent>{children}</ClerkProtectedContent>
    : <PiProtectedContent>{children}</PiProtectedContent>;
}

function RouteLoading() {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[#0D0D0D]" role="status" aria-label="Loading page">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#244331] border-t-[#1DE9B6]" />
    </div>
  );
}

function PiProfileRoute() {
  const enableClerk = useContext(AuthModeContext);
  return <ProfilePage onEnableClerk={enableClerk} />;
}

function Router({ clerkEnabled }: { clerkEnabled: boolean }) {
  const [location] = useLocation();

  return (
    <ErrorBoundary resetKey={location}>
      <Suspense fallback={<RouteLoading />}>
        <Switch>
          <Route path="/privacy-policy" component={PrivacyPolicyPage} />
          <Route path="/terms-of-service" component={TermsOfServicePage} />
          <Route path="/">{() => clerkEnabled
            ? <ClerkHomeRedirect fallback={<LandingPage />}><Dashboard /></ClerkHomeRedirect>
            : <PiHomeRedirect />}</Route>
          <Route path="/sso-callback">{() => clerkEnabled ? <ClerkSsoCallback /> : <Redirect to="/" />}</Route>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/contracts/new">
            {() => <ProtectedPage clerkEnabled={clerkEnabled}><NewContract /></ProtectedPage>}
          </Route>
          <Route path="/admin">
            {() => <AdminDashboard />}
          </Route>
          <Route path="/contracts/:id/disputes">
            {() => <ProtectedPage clerkEnabled={clerkEnabled}><Disputes /></ProtectedPage>}
          </Route>
          <Route path="/contracts/:id/chat">
            {() => <ProtectedPage clerkEnabled={clerkEnabled}><ContractChat /></ProtectedPage>}
          </Route>
          <Route path="/marketplace">{() => <ProtectedPage clerkEnabled={clerkEnabled}><Marketplace /></ProtectedPage>}</Route>
          <Route path="/listings">{() => <ProtectedPage clerkEnabled={clerkEnabled}><MyListings /></ProtectedPage>}</Route>
          <Route path="/rates">{() => <ProtectedPage clerkEnabled={clerkEnabled}><Rates /></ProtectedPage>}</Route>
          <Route path="/profile">{() => <ProtectedPage clerkEnabled={clerkEnabled}>{clerkEnabled ? <ProfilePage /> : <PiProfileRoute />}</ProtectedPage>}</Route>
          <Route path="/wallet">{() => PI_SANDBOX ? <ProtectedPage clerkEnabled={clerkEnabled}><WalletPage /></ProtectedPage> : <Redirect to="/" />}</Route>
          <Route path="/contracts/:id">
            {() => (
              <ProtectedPage clerkEnabled={clerkEnabled}>
                {clerkEnabled ? <ClerkContractDetailRoute /> : <ContractDetail />}
              </ProtectedPage>
            )}
          </Route>
          <Route path="/activity">
            {() => <ProtectedPage clerkEnabled={clerkEnabled}><ActivityPage /></ProtectedPage>}
          </Route>
          <Route path="/chat/:roomId">
            {() => <ProtectedPage clerkEnabled={clerkEnabled}><PublicChatRoomPage /></ProtectedPage>}
          </Route>
          <Route path="/chat">
            {() => <ProtectedPage clerkEnabled={clerkEnabled}><ChatRoomsPage /></ProtectedPage>}
          </Route>
          <Route>
            {() => <ProtectedPage clerkEnabled={clerkEnabled}><NotFound /></ProtectedPage>}
          </Route>
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}

function AuthModeResolver() {
  const { loading: piLoading, signedIn: piSignedIn } = usePiAppSession();
  const { session: piIframeSession } = usePiIframeSession();
  const [location] = useLocation();
  const [forceClerk, setForceClerk] = useState(false);
  const enableClerk = useCallback(() => setForceClerk(true), []);
  const piAuthRoute = location.startsWith('/sign-in') || location.startsWith('/sign-up');
  const clerkRequiredRoute = location === '/sso-callback' ||
    location === '/admin' ||
    location.startsWith('/admin/');
  const usePiOnly = !forceClerk && !clerkRequiredRoute && (
    isPiBrowserRuntime() ||
    piAuthRoute ||
    piSignedIn ||
    Boolean(piIframeSession)
  );

  let content: ReactNode;
  if (usePiOnly) {
    content = <Router clerkEnabled={false} />;
  } else if (piLoading && !forceClerk && !clerkRequiredRoute) {
    content = <div className="grid min-h-[100dvh] place-items-center bg-[#0D0D0D]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#244331] border-t-[#1DE9B6]" aria-label="Loading" />
    </div>;
  } else {
      content = <ClerkProviderWithRoutes><Router clerkEnabled /></ClerkProviderWithRoutes>;
  }

  return <AuthModeContext.Provider value={enableClerk}>{content}</AuthModeContext.Provider>;
}

function App() {
  return (
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <PiIframeSessionProvider>
            <PiAppSessionProvider>
              <WouterRouter base={basePath}>
                <AuthModeResolver />
              </WouterRouter>
            </PiAppSessionProvider>
          </PiIframeSessionProvider>
        </I18nProvider>
      </QueryClientProvider>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;