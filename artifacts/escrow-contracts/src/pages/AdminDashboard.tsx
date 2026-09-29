import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, ChevronRight, CircleDot, FileText, Gavel, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, Wallet, X } from 'lucide-react';
import {
  getGetAdminAccessQueryKey, getGetAdminOverviewQueryKey, getListAdminDisputesQueryKey, getListAdminPayoutsQueryKey,
  useGetAdminAccess, useGetAdminOverview, useListAdminDisputes, useListAdminPayouts,
  useAnalyzeAdminDispute, useDecideAdminDispute, useReconcileAdminPayouts, useDeleteAdminSession,
  type AdminAnalysis, type AdminDecisionResult, type AdminPayoutReconciliation,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { useI18n } from '@/i18n';
import { AppShell } from '@/components/app-shell';
import AdminPasswordGate from '@/components/admin-password-gate';
import { usePiIframeSession } from '@/lib/pi-iframe-session';
import ChatAdminManagement from '@/components/chat-admin-management';

const copy = {
  en: {
    access: 'Admin password required', accessBody: 'Enter the admin password to access dispute data and Gemini analysis.', unavailable: 'Arbitration service unavailable', unavailableBody: 'The server cannot provide this workspace right now. No action has been taken.', retry: 'Try again',
    clerkPayoutRequired: 'Clerk authorization is checked when you submit a release, refund, or payout reconciliation. Disputes and Gemini analysis are available with the admin password.', clerkAuthorizationRequired: 'Sign in with Clerk as an authorized arbitrator to submit payout actions.', signInClerk: 'Sign in with Clerk', lockAdmin: 'Lock admin session',
    title: 'Arbitration desk', sub: 'Human decisions. Verified movement of funds.', live: 'LIVE OVERSIGHT', refresh: 'Refresh data', last: 'Updates every 30 seconds',
    open: 'Open disputes', resolved: 'Resolved disputes', contracts: 'Disputed contracts', attention: 'Payouts needing attention', escrow: 'Escrow in Pi', enabled: 'Payouts enabled', disabled: 'Payouts paused',
    queue: 'Dispute queue', queueSub: 'Select a case to review the facts and decide.', all: 'All cases', active: 'Needs review', empty: 'No disputes to review', emptyBody: 'New disputes will appear here as they arrive.', noMatch: 'No cases in this view', noMatchBody: 'Switch to all cases to see the full history.',
    case: 'CASE FILE', contract: 'Contract', buyer: 'Buyer', seller: 'Seller', amount: 'Escrow amount', opened: 'Opened', issue: 'Dispute reason', account: 'Participant statement', request: 'Requested outcome', resolution: 'Recorded resolution', pendingReview: 'Awaiting human review', payout: 'Payout state', noPayout: 'No payout intent',
    analysis: 'Gemini advisory', analysisSub: 'An independent reading of the case, not a decision.', generate: 'Generate analysis', regenerate: 'Regenerate analysis', analyzing: 'Analyzing case…', recommendation: 'Suggested direction', confidence: 'Confidence', reasoning: 'Rationale', gaps: 'Evidence gaps', noGaps: 'No gaps identified in this analysis.', aiNote: 'Advisory only. Verify the evidence yourself. Gemini cannot release or refund funds.', aiError: 'Analysis could not be generated. Please try again.',
    decision: 'Human decision', decisionSub: 'Choose one final outcome for the full escrow amount.', release: 'Release to seller', refund: 'Refund buyer in full', releaseDetail: 'Send the escrow payout to the seller.', refundDetail: 'Return the full escrow to the buyer.', locked: 'Decision unavailable: this case is resolved or has a payout intent.', paused: 'Decisions are paused while payouts are disabled.', irreversible: 'Irreversible action', confirmTitle: 'Confirm your decision', confirmLead: 'You are authorizing a Pi payout on the configured network. Verify the network before continuing; this cannot be undone.', reason: 'Reason for decision', reasonHint: 'Record your independent reasoning (10–2000 characters).', type: 'Type to confirm', cancel: 'Cancel', submit: 'Authorize decision', submitting: 'Submitting decision…', resultConfirmed: 'Payment confirmed', resultPending: 'Decision recorded · payout not confirmed', resultManual: 'Manual reconciliation required', resultDetail: 'Do not submit another decision. Check payout oversight for the latest state.', decisionError: 'Decision could not be completed. Refresh the case and payout ledger before taking any further action.', validation: 'Enter at least 10 characters and the exact confirmation word.',
    payouts: 'Payout oversight', payoutsSub: 'Intent status is the source of truth. An unconfirmed payment is never a completed transfer.', reconcile: 'Reconcile incomplete payments', reconcileTitle: 'Run payout reconciliation?', reconcileLead: 'This checks existing server payments. It does not submit a new payout.', reconciling: 'Checking payments…', reconcileResult: 'Reconciliation complete', inspected: 'Inspected', incomplete: 'Incomplete', outcomes: 'Outcomes', reconcileError: 'Reconciliation failed. Review the payout ledger before trying again.', noPayoutRows: 'No payout intents yet', noPayoutRowsBody: 'Payout intents will appear here when a transfer is initiated.', paymentId: 'Payment ID', txid: 'Transaction ID', network: 'Network', status: 'Status', purpose: 'Purpose', unknown: 'Not assigned', review: 'Review', confirmed: 'Confirmed', manual: 'Manual reconciliation', pending: 'In progress', failed: 'Failed', close: 'Close', latest: 'Latest payout status',
  },
  ar: {
    access: 'كلمة مرور الإدارة مطلوبة', accessBody: 'أدخل كلمة مرور الإدارة لعرض بيانات النزاعات وتحليل Gemini.', unavailable: 'خدمة التحكيم غير متاحة', unavailableBody: 'لا يستطيع الخادم عرض مساحة العمل حاليًا. لم يُتخذ أي إجراء.', retry: 'حاول مجددًا',
    clerkPayoutRequired: 'يتم التحقق من صلاحية Clerk عند إرسال طلب الصرف أو ردّ الأموال أو مطابقة الدفعات. وتتيح كلمة مرور الإدارة الوصول إلى النزاعات وتحليل Gemini.', clerkAuthorizationRequired: 'سجّل الدخول عبر Clerk كمحكّم مخوّل لإرسال إجراءات الدفع.', signInClerk: 'تسجيل الدخول عبر Clerk', lockAdmin: 'قفل جلسة الإدارة',
    title: 'مكتب التحكيم', sub: 'قرارات بشرية. حركة أموال موثّقة.', live: 'مراقبة مباشرة', refresh: 'تحديث البيانات', last: 'تحديث كل 30 ثانية',
    open: 'نزاعات مفتوحة', resolved: 'نزاعات محسومة', contracts: 'عقود متنازع عليها', attention: 'دفعات تتطلب متابعة', escrow: 'رصيد الضمان بعملة Pi', enabled: 'الدفعات مفعّلة', disabled: 'الدفعات متوقفة',
    queue: 'قائمة النزاعات', queueSub: 'اختر قضية لمراجعة الوقائع واتخاذ القرار.', all: 'كل القضايا', active: 'تحتاج للمراجعة', empty: 'لا توجد نزاعات للمراجعة', emptyBody: 'ستظهر النزاعات الجديدة هنا عند وصولها.', noMatch: 'لا توجد قضايا في هذا العرض', noMatchBody: 'انتقل إلى كل القضايا لعرض السجل الكامل.',
    case: 'ملف القضية', contract: 'العقد', buyer: 'المشتري', seller: 'البائع', amount: 'مبلغ الضمان', opened: 'تاريخ الفتح', issue: 'سبب النزاع', account: 'إفادة الطرف', request: 'النتيجة المطلوبة', resolution: 'التسوية المسجلة', pendingReview: 'بانتظار مراجعة بشرية', payout: 'حالة الدفع', noPayout: 'لا توجد نية دفع',
    analysis: 'رأي Gemini الاستشاري', analysisSub: 'قراءة مستقلة للقضية وليست قرارًا.', generate: 'إنشاء التحليل', regenerate: 'إعادة التحليل', analyzing: 'جارٍ تحليل القضية…', recommendation: 'التوصية', confidence: 'درجة الثقة', reasoning: 'الأسباب', gaps: 'نواقص الأدلة', noGaps: 'لم تُحدّد نواقص في هذا التحليل.', aiNote: 'للاستشارة فقط. تحقّق من الأدلة بنفسك. لا يستطيع Gemini صرف الأموال أو ردّها.', aiError: 'تعذّر إنشاء التحليل. حاول مجددًا.',
    decision: 'القرار البشري', decisionSub: 'اختر نتيجة نهائية واحدة لكامل مبلغ الضمان.', release: 'صرف المبلغ للبائع', refund: 'ردّ كامل المبلغ للمشتري', releaseDetail: 'إرسال دفعة الضمان إلى البائع.', refundDetail: 'إعادة كامل الضمان إلى المشتري.', locked: 'القرار غير متاح: حُسمت القضية أو توجد نية دفع.', paused: 'القرارات متوقفة لأن الدفعات معطّلة.', irreversible: 'إجراء لا رجعة فيه', confirmTitle: 'تأكيد قرارك', confirmLead: 'أنت تفوّض دفعة Pi على الشبكة المحددة. تحقّق من الشبكة قبل المتابعة؛ لا يمكن التراجع عن التحويل.', reason: 'سبب القرار', reasonHint: 'سجّل أسبابك المستقلة (من 10 إلى 2000 حرف).', type: 'اكتب كلمة التأكيد', cancel: 'إلغاء', submit: 'تفويض القرار', submitting: 'جارٍ إرسال القرار…', resultConfirmed: 'تم تأكيد الدفع', resultPending: 'سُجّل القرار · الدفع غير مؤكّد', resultManual: 'يتطلب تسوية يدوية', resultDetail: 'لا ترسل قرارًا آخر. راجع حالة الدفعات لمعرفة المستجدات.', decisionError: 'تعذّر إتمام القرار. حدّث القضية وسجل الدفعات قبل اتخاذ إجراء آخر.', validation: 'أدخل سببًا من 10 أحرف على الأقل وكلمة التأكيد المطابقة تمامًا.',
    payouts: 'مراقبة الدفعات', payoutsSub: 'حالة نية الدفع هي المرجع. الدفع غير المؤكد ليس تحويلاً مكتملًا.', reconcile: 'مطابقة الدفعات غير المكتملة', reconcileTitle: 'هل تريد تشغيل المطابقة؟', reconcileLead: 'يفحص هذا الدفعات الموجودة على الخادم ولا ينشئ دفعة جديدة.', reconciling: 'جارٍ فحص الدفعات…', reconcileResult: 'اكتملت المطابقة', inspected: 'تم الفحص', incomplete: 'غير مكتمل', outcomes: 'النتائج', reconcileError: 'فشلت المطابقة. راجع سجل الدفعات قبل المحاولة مجددًا.', noPayoutRows: 'لا توجد نيات دفع بعد', noPayoutRowsBody: 'ستظهر نيات الدفع هنا عند بدء التحويل.', paymentId: 'معرّف الدفع', txid: 'معرّف المعاملة', network: 'الشبكة', status: 'الحالة', purpose: 'الغرض', unknown: 'غير معيّن', review: 'مراجعة', confirmed: 'مؤكّد', manual: 'تسوية يدوية', pending: 'قيد التنفيذ', failed: 'فشل', close: 'إغلاق', latest: 'آخر حالة للدفع',
  },
} as const;

function statusText(status: string | null | undefined, c: typeof copy.en | typeof copy.ar) {
  if (!status) return c.noPayout;
  if (status === 'confirmed') return c.confirmed;
  if (status === 'manual_reconciliation') return c.manual;
  if (status === 'failed') return c.failed;
  return c.pending;
}
function statusStyle(status: string | null | undefined) {
  if (status === 'confirmed') return 'border-[#2b7550] bg-[#163b28] text-[#78e6a0]';
  if (status === 'manual_reconciliation' || status === 'failed') return 'border-[#816039] bg-[#352716] text-[#f6c688]';
  return 'border-[#485c4b] bg-[#273228] text-[#b7cdb7]';
}
function date(value: string, language: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}
function amount(value: string, currency: string) {
  const number = Number(value);
  return `${Number.isFinite(number) ? new Intl.NumberFormat('en', { maximumFractionDigits: 8 }).format(number) : value} ${currency}`;
}
function failure(error: unknown, fallback: string, c: typeof copy.en | typeof copy.ar, unauthorizedMessage: string = c.accessBody) {
  const status = (error as {status?: number} | null)?.status;
  if (status === 401 || status === 403) return unauthorizedMessage;
  if (status === 503) return c.unavailableBody;
  return fallback;
}

export default function AdminDashboard() {
  const { language } = useI18n();
  const c = language === 'ar' ? copy.ar : copy.en;
  const queryClient = useQueryClient();
  const access = useGetAdminAccess({ query: { queryKey: getGetAdminAccessQueryKey(), refetchInterval: 30000, refetchOnWindowFocus: true, retry: false } });
  useEffect(() => {
    if (!access.data?.adminPasswordAuthenticated || access.isError) {
      queryClient.removeQueries({ queryKey: getGetAdminOverviewQueryKey() });
      queryClient.removeQueries({ queryKey: getListAdminDisputesQueryKey() });
      queryClient.removeQueries({ queryKey: getListAdminPayoutsQueryKey() });
    }
  }, [access.data?.adminPasswordAuthenticated, access.isError, queryClient]);
  if (access.isLoading) return <div className="space-y-6" data-testid="loading-admin"><div className="skeleton h-24 rounded-xl" /><div className="grid gap-4 sm:grid-cols-3">{[1,2,3].map(i => <div key={i} className="skeleton h-28 rounded-xl" />)}</div><div className="skeleton h-96 rounded-xl" /></div>;
  if (access.isError || !access.data) {
    return <StatePanel title={c.unavailable} body={c.unavailableBody} action={c.retry} onRetry={() => access.refetch()} testId="admin-unavailable" />;
  }
  if (!access.data.adminPasswordAuthenticated) return <AdminPasswordGate />;
  return <AppShell><ArbitrationWorkspace /></AppShell>;
}

function StatePanel({ title, body, action, onRetry, testId }: { title: string; body: string; action?: string; onRetry?: () => void; testId: string }) {
  return <section className="admin-panel mx-auto mt-12 max-w-xl p-8 text-center sm:p-12" data-testid={testId}><LockKeyhole className="mx-auto text-[#1de9b6]" size={30}/><h1 className="mt-5 font-['Syne'] text-2xl font-semibold">{title}</h1><p className="mt-3 text-sm leading-7 text-[#a6b7aa]">{body}</p>{onRetry && <button className="admin-soft-button mt-7" onClick={onRetry} data-testid="button-retry-admin"><RefreshCw size={15}/>{action}</button>}</section>;
}

function ArbitrationWorkspace() {
  const { language } = useI18n();
  const c = language === 'ar' ? copy.ar : copy.en;
  const qc = useQueryClient();
  const { setAdminSessionToken } = usePiIframeSession();
  const overview = useGetAdminOverview({ query: { queryKey: getGetAdminOverviewQueryKey(), refetchInterval: 30000, retry: false } });
  const disputes = useListAdminDisputes({ query: { queryKey: getListAdminDisputesQueryKey(), refetchInterval: 30000, retry: false } });
  const payouts = useListAdminPayouts({ query: { queryKey: getListAdminPayoutsQueryKey(), refetchInterval: 30000, retry: false } });
  const analyze = useAnalyzeAdminDispute();
  const decide = useDecideAdminDispute();
  const reconcile = useReconcileAdminPayouts();
  const deleteAdminSession = useDeleteAdminSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [analysis, setAnalysis] = useState<{ id: string; value: AdminAnalysis } | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [modal, setModal] = useState<'release' | 'refund' | 'reconcile' | null>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [result, setResult] = useState<AdminDecisionResult | null>(null);
  const [reconcileResult, setReconcileResult] = useState<AdminPayoutReconciliation | null>(null);
  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  pendingRef.current = decide.isPending || reconcile.isPending;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetAdminAccessQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAdminDisputesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAdminPayoutsQueryKey() });
  };
  const items = disputes.data ?? [];
  const visible = filter === 'active' ? items.filter(item => item.status !== 'resolved' && !item.decision) : items;
  const selected = items.find(item => item.id === selectedId) ?? visible[0] ?? null;
  const relatedPayout = selected ? (payouts.data ?? []).find(p => p.disputeId === selected.id) : null;
  // A recorded decision or any intent is a hard stop, even when its payment remains ambiguous.
  const locked = !!selected && (selected.status === 'resolved' || !!selected.decision || !!selected.payoutStatus || !!relatedPayout || lockedIds.includes(selected.id) || result?.disputeId === selected.id);
  const canDecide = !!selected && !locked && overview.data?.payoutEnabled === true && !overview.isError && !disputes.isError && !payouts.isError && !payouts.isLoading;

  useEffect(() => {
    if (!modal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingRef.current) setModal(null);
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); triggerRef.current?.focus(); };
  }, [modal]);
  const select = (id: string) => { setSelectedId(id); setAnalysisError(''); setMutationError(''); };
  const openDecision = (value: 'release' | 'refund') => { triggerRef.current = document.activeElement as HTMLElement; setReason(''); setTyped(''); setMutationError(''); setModal(value); };
  const sendDecision = async () => {
    if (!selected || !modal || modal === 'reconcile' || !canDecide || reason.trim().length < 10 || reason.trim().length > 2000 || typed !== modal.toUpperCase()) return;
    const id = selected.id;
    setMutationError('');
    // Lock immediately, including on timeout: a server-side intent may already exist.
    setLockedIds(previous => previous.includes(id) ? previous : [...previous, id]);
    try {
      const response = await decide.mutateAsync({ id, data: { decision: modal, reason: reason.trim(), confirmation: modal.toUpperCase() as 'RELEASE' | 'REFUND' } });
      setResult(response);
      setModal(null);
      refresh();
    } catch (error) {
      setMutationError(failure(error, c.decisionError, c, c.clerkAuthorizationRequired));
      refresh();
    }
  };
  const sendReconcile = async () => {
    setMutationError('');
    try {
      const response = await reconcile.mutateAsync();
      setReconcileResult(response);
      setModal(null);
      refresh();
    } catch (error) { setMutationError(failure(error, c.reconcileError, c, c.clerkAuthorizationRequired)); }
  };
  const lockAdminSession = async () => {
    setMutationError('');
    try {
      await deleteAdminSession.mutateAsync();
      setAdminSessionToken(null);
      qc.removeQueries({ queryKey: getGetAdminOverviewQueryKey() });
      qc.removeQueries({ queryKey: getListAdminDisputesQueryKey() });
      qc.removeQueries({ queryKey: getListAdminPayoutsQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetAdminAccessQueryKey() });
    } catch {
      setMutationError(c.unavailableBody);
    }
  };

  if (overview.isLoading || disputes.isLoading || payouts.isLoading) return <div className="space-y-6" data-testid="loading-admin-workspace"><div className="skeleton h-24 rounded-xl"/><div className="grid gap-4 sm:grid-cols-3">{[1,2,3].map(i=><div key={i} className="skeleton h-28 rounded-xl"/>)}</div><div className="skeleton h-[500px] rounded-xl"/></div>;
  if (overview.isError || disputes.isError || payouts.isError || !overview.data) {
    const error = overview.error || disputes.error || payouts.error;
    const status = (error as {status?: number} | null)?.status;
    return <StatePanel title={status === 401 || status === 403 ? c.access : c.unavailable} body={status === 401 || status === 403 ? c.accessBody : c.unavailableBody} action={c.retry} onRetry={refresh} testId={status === 401 || status === 403 ? 'admin-forbidden' : 'admin-unavailable'} />;
  }

  return <div className="animate-rise-in pb-16" data-testid="admin-dashboard">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div><p className="admin-label flex items-center gap-2 text-[#1de9b6]"><span className="h-1.5 w-1.5 rounded-full bg-[#00c853]"/>{c.live}</p><h1 className="mt-3 font-['Syne'] text-4xl font-semibold tracking-tight sm:text-5xl" data-testid="heading-admin">{c.title}<span className="text-[#00c853]">.</span></h1><p className="mt-3 text-sm text-[#a2b8a8]">{c.sub}</p></div>
      <div className="flex flex-wrap gap-2">
        <button className="admin-soft-button" onClick={lockAdminSession} disabled={deleteAdminSession.isPending} data-testid="button-lock-admin"><LockKeyhole size={15}/>{c.lockAdmin}</button>
        <button className="admin-soft-button" onClick={refresh} data-testid="button-refresh-admin"><RefreshCw size={15}/>{c.refresh}<span className="hidden border-s border-[#4a6050] ps-3 text-[11px] font-normal text-[#91a699] sm:inline">{c.last}</span></button>
      </div>
    </div>
    <p className="mt-5 flex flex-wrap items-center gap-2 rounded-lg border border-[#594c33] bg-[#241f16] p-3 text-xs leading-5 text-[#e4c795]" role="note" data-testid="note-clerk-payout-auth"><LockKeyhole size={14}/>{c.clerkPayoutRequired}<Link href="/sign-in" className="font-semibold text-[#b9e7c5] underline underline-offset-4">{c.signInClerk}</Link></p>
    {mutationError && <p role="alert" className="mt-4 text-sm text-[#ffc19b]" data-testid="error-admin-session">{mutationError}</p>}
    <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
      {([
        [c.open, overview.data.openDisputes, Gavel], [c.resolved, overview.data.resolvedDisputes, Check],
        [c.contracts, overview.data.disputedContracts, FileText], [c.attention, overview.data.payoutAttention, AlertTriangle],
      ] as const).map(([label, value, Icon], i) => <div key={label} className={`admin-panel min-w-0 p-4 sm:p-5 ${i === 3 ? 'border-[#6a5336]' : ''}`}><div className="flex items-center justify-between gap-2"><span className="admin-label !tracking-[.08em]">{label}</span><Icon size={16} className={i === 3 ? 'shrink-0 text-[#e0ae71]' : 'shrink-0 text-[#66c78b]'}/></div><div className="mt-5 font-['Syne'] text-3xl font-semibold" data-testid={`stat-admin-${i}`}>{value}</div></div>)}
      <div className="admin-panel col-span-2 min-w-0 border-[#316e48] bg-[#183423] p-4 sm:p-5 lg:col-span-1"><div className="flex items-center justify-between gap-2"><span className="admin-label !text-[#9cd6aa]">{c.escrow}</span><Wallet size={16} className="shrink-0 text-[#73df9d]"/></div><div className="mt-5 truncate font-['Syne'] text-2xl font-semibold" data-testid="stat-admin-escrow">{amount(overview.data.totalEscrowPi, 'Pi')}</div></div>
    </div>
    <div className="mt-4 flex items-center gap-2 text-xs text-[#a4b7a8]" data-testid="status-payout-enabled"><CircleDot size={14} className={overview.data.payoutEnabled ? 'text-[#62d28e]' : 'text-[#e5b879]'}/>{overview.data.payoutEnabled ? c.enabled : c.disabled}</div>

    <section className="mt-12" aria-labelledby="queue-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="admin-label text-[#1de9b6]">01 / {c.review}</p><h2 id="queue-title" className="mt-2 font-['Syne'] text-2xl font-semibold sm:text-3xl">{c.queue}</h2><p className="mt-2 text-sm text-[#96a99c]">{c.queueSub}</p></div><div className="flex rounded-lg border border-[#364d3d] bg-[#121a15] p-1" role="group" aria-label={c.queue}><button onClick={()=>{setFilter('active');setSelectedId(null)}} aria-pressed={filter==='active'} className={`rounded-md px-3 py-2 text-xs font-semibold ${filter==='active'?'bg-[#254733] text-[#b7edc8]':'text-[#91a699]'}`} data-testid="button-filter-active">{c.active}</button><button onClick={()=>{setFilter('all');setSelectedId(null)}} aria-pressed={filter==='all'} className={`rounded-md px-3 py-2 text-xs font-semibold ${filter==='all'?'bg-[#254733] text-[#b7edc8]':'text-[#91a699]'}`} data-testid="button-filter-all">{c.all}</button></div></div>
      {!visible.length ? <div className="admin-panel grid min-h-56 place-content-center p-8 text-center" data-testid="empty-admin-disputes"><Gavel className="mx-auto text-[#63bb83]" size={28}/><h3 className="mt-4 font-['Syne'] text-lg">{items.length ? c.noMatch : c.empty}</h3><p className="mt-2 text-sm text-[#8fa495]">{items.length ? c.noMatchBody : c.emptyBody}</p></div> :
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(245px,310px)_minmax(0,1fr)]">
        <div className="admin-panel max-h-[790px] overflow-y-auto p-2" aria-label={c.queue}>{visible.map(item => <button key={item.id} onClick={()=>select(item.id)} aria-current={selected?.id===item.id?'true':undefined} data-testid={`button-select-dispute-${item.id}`} className={`mb-1 w-full rounded-xl border p-4 text-start transition-colors last:mb-0 ${selected?.id===item.id ? 'border-[#447b55] bg-[#203a29]' : 'border-transparent hover:bg-[#202b23]'}`}><div className="flex items-start justify-between gap-2"><span className="font-mono text-[10px] text-[#77cb94]" dir="ltr">{item.contractReference}</span><ChevronRight size={15} className="shrink-0 text-[#6f9079] rtl:rotate-180"/></div><p className="mt-3 line-clamp-2 text-sm font-semibold leading-5">{item.contractTitle}</p><p className="mt-1 line-clamp-1 text-xs text-[#a7b7a8]">{item.reason}</p><div className="mt-4 flex items-center justify-between gap-2 border-t border-[#3a5140] pt-3"><span className="font-mono text-xs text-[#e1e9dc]" dir="ltr">{amount(item.contractAmount,item.contractCurrency)}</span><span className={`rounded-full border px-2 py-1 text-[10px] ${item.status==='resolved'?'border-[#3c7850] text-[#89dba0]':'border-[#776040] text-[#e3b981]'}`}>{item.status==='resolved'?c.resolved:c.active}</span></div></button>)}</div>
        {selected && <div className="min-w-0 space-y-4" data-testid={`panel-dispute-${selected.id}`}>
          <article className="admin-panel overflow-hidden">
            <div className="border-b border-[#34463a] bg-[#1d2920] px-5 py-5 sm:px-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="admin-label text-[#88dba4]">{c.case} / <span dir="ltr">{selected.contractReference}</span></p><h3 className="mt-2 font-['Syne'] text-xl font-semibold sm:text-2xl">{selected.contractTitle}</h3></div><span className="rounded-full border border-[#4e654e] px-3 py-1 text-xs text-[#c2d3c1]">{selected.status==='resolved'?c.resolved:c.pendingReview}</span></div></div>
            <div className="grid gap-x-7 gap-y-5 border-b border-[#34463a] p-5 sm:grid-cols-2 sm:p-7 lg:grid-cols-4">
              {[[c.buyer,selected.buyerName],[c.seller,selected.sellerName],[c.amount,amount(selected.contractAmount,selected.contractCurrency)],[c.opened,date(selected.createdAt,language)]].map(([label,value])=><div key={label}><p className="admin-label">{label}</p><p className="mt-2 break-words text-sm font-medium" data-testid={`text-case-${label===c.amount?'amount':label===c.buyer?'buyer':label===c.seller?'seller':'opened'}`}>{value}</p></div>)}
            </div>
            <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-2"><div className="space-y-5"><div><p className="admin-label">{c.issue}</p><p className="mt-2 text-sm font-semibold">{selected.reason}</p></div><div><p className="admin-label">{c.account}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-[#c3d1c5]">{selected.description}</p></div></div><div className="space-y-5"><div><p className="admin-label">{c.request}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-[#c3d1c5]">{selected.requestedResolution}</p></div><div><p className="admin-label">{c.resolution}</p><p className="mt-2 text-sm text-[#b0c4b3]">{selected.resolution || c.pendingReview}</p></div><div><p className="admin-label">{c.payout}</p><span className={`mt-2 inline-block rounded-full border px-2.5 py-1 text-xs ${statusStyle(relatedPayout?.status || selected.payoutStatus)}`} data-testid="status-selected-payout">{statusText(relatedPayout?.status || selected.payoutStatus,c)}</span></div></div></div>
            <div className="border-t border-[#34463a] px-5 py-3 sm:px-7"><Link href={`/contracts/${selected.contractId}`} className="inline-flex items-center gap-2 text-xs text-[#80d99a] hover:text-[#bbf5c9]" data-testid="link-admin-contract">{c.contract}<ArrowRight size={13} className="rtl:rotate-180"/></Link></div>
          </article>
          <div className="grid gap-4 lg:grid-cols-2">
            <article className="admin-panel p-5 sm:p-6"><div className="flex items-start gap-3"><span className="rounded-lg border border-[#416956] bg-[#213e31] p-2 text-[#96ecc0]"><Sparkles size={17}/></span><div><h3 className="font-['Syne'] text-lg font-semibold">{c.analysis}</h3><p className="mt-1 text-xs leading-5 text-[#98ac9c]">{c.analysisSub}</p></div></div>
              <p className="mt-5 rounded-lg border border-[#4a563a] bg-[#292c1c] p-3 text-xs leading-5 text-[#d6d7a9]">{c.aiNote}</p>
              {analysis?.id===selected.id && <div className="mt-5 space-y-4 text-sm" data-testid="panel-admin-analysis"><p className="leading-6 text-[#d3e1d4]">{analysis.value.summary}</p><div className="flex flex-wrap gap-2"><span className="rounded-full border border-[#4c7656] px-2.5 py-1 text-xs">{c.recommendation}: {analysis.value.recommendation==='release'?c.release:analysis.value.recommendation==='refund'?c.refund:c.review}</span><span className="rounded-full border border-[#4c7656] px-2.5 py-1 text-xs">{c.confidence}: {analysis.value.confidence}</span></div><div><p className="admin-label">{c.reasoning}</p><ul className="mt-2 list-inside list-disc space-y-2 text-xs leading-5 text-[#b8c9bb]">{analysis.value.rationale.map((line,i)=><li key={i}>{line}</li>)}</ul></div><div><p className="admin-label">{c.gaps}</p><ul className="mt-2 list-inside list-disc space-y-2 text-xs leading-5 text-[#b8c9bb]">{analysis.value.evidenceGaps.length?analysis.value.evidenceGaps.map((line,i)=><li key={i}>{line}</li>):<li>{c.noGaps}</li>}</ul></div><p className="font-mono text-[10px] text-[#819585]">{date(analysis.value.generatedAt,language)}</p></div>}
              {analysisError && <p role="alert" className="mt-4 text-xs text-[#ffc19b]">{analysisError}</p>}
              <button className="admin-soft-button mt-5 w-full" disabled={analyze.isPending} onClick={async()=>{setAnalysisError('');const id=selected.id;try{const value=await analyze.mutateAsync({id});setAnalysis({id,value});}catch(error){setAnalysisError(failure(error,c.aiError,c));}}} data-testid="button-analyze-dispute"><Sparkles size={15}/>{analyze.isPending?c.analyzing:analysis?.id===selected.id?c.regenerate:c.generate}</button>
            </article>
            <article className="admin-panel p-5 sm:p-6"><div className="flex items-start gap-3"><span className="rounded-lg border border-[#566c45] bg-[#303822] p-2 text-[#d9dd9a]"><Gavel size={17}/></span><div><h3 className="font-['Syne'] text-lg font-semibold">{c.decision}</h3><p className="mt-1 text-xs leading-5 text-[#98ac9c]">{c.decisionSub}</p></div></div>
              <div className="mt-6 space-y-3"><button className="group flex w-full items-center justify-between gap-3 rounded-xl border border-[#3d7952] bg-[#1c3928] p-4 text-start hover:bg-[#254a32] disabled:cursor-not-allowed disabled:opacity-45" disabled={!canDecide || decide.isPending} onClick={()=>openDecision('release')} data-testid="button-release-dispute"><span><strong className="block text-sm text-[#bdf1c8]">{c.release}</strong><span className="mt-1 block text-xs text-[#9abca3]">{c.releaseDetail}</span></span><ArrowRight size={17} className="shrink-0 text-[#79dc9b] rtl:rotate-180"/></button><button className="group flex w-full items-center justify-between gap-3 rounded-xl border border-[#6d6041] bg-[#312a1d] p-4 text-start hover:bg-[#423322] disabled:cursor-not-allowed disabled:opacity-45" disabled={!canDecide || decide.isPending} onClick={()=>openDecision('refund')} data-testid="button-refund-dispute"><span><strong className="block text-sm text-[#f5dcac]">{c.refund}</strong><span className="mt-1 block text-xs text-[#c5b99b]">{c.refundDetail}</span></span><ArrowRight size={17} className="shrink-0 text-[#e3ba80] rtl:rotate-180"/></button></div>
              {(locked || !overview.data.payoutEnabled) && <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-[#dfbf94]"><LockKeyhole size={14} className="mt-0.5 shrink-0"/>{locked?c.locked:c.paused}</p>}
              {result?.disputeId===selected.id && <div className={`mt-5 rounded-lg border p-4 ${statusStyle(result.status)}`} role="status" data-testid="status-admin-decision"><p className="font-semibold">{result.status==='confirmed'?c.resultConfirmed:result.status==='manual_reconciliation'?c.resultManual:c.resultPending}</p><p className="mt-2 text-xs">{result.status==='confirmed' ? `${c.txid}: ${result.txid || c.unknown}` : c.resultDetail}</p><p className="mt-2 break-all font-mono text-[10px]">{result.payoutIntentId}</p></div>}
              {mutationError && <p role="alert" className="mt-4 text-xs leading-5 text-[#ffc19b]" data-testid="error-admin-mutation">{mutationError}</p>}
            </article>
          </div>
        </div>}
      </div>}
    </section>

    <section className="mt-12" aria-labelledby="payout-title"><div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="admin-label text-[#1de9b6]">02 / {c.latest}</p><h2 id="payout-title" className="mt-2 font-['Syne'] text-2xl font-semibold sm:text-3xl">{c.payouts}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#96a99c]">{c.payoutsSub}</p></div><button className="admin-soft-button" onClick={()=>{triggerRef.current=document.activeElement as HTMLElement;setMutationError('');setModal('reconcile')}} disabled={reconcile.isPending} data-testid="button-open-reconcile"><RefreshCw size={15}/>{c.reconcile}</button></div>
      {reconcileResult && <div className="admin-panel mb-4 border-[#497a50] p-5" role="status" data-testid="status-reconcile-result"><p className="text-sm font-semibold text-[#99e5aa]">{c.reconcileResult}</p><p className="mt-2 text-xs text-[#b9caba]">{c.inspected}: {reconcileResult.inspected} · {c.incomplete}: {reconcileResult.incompleteServerPayments}</p>{reconcileResult.outcomes.length>0 && <div className="mt-3 space-y-2">{reconcileResult.outcomes.map(row=><p key={row.intentId} className="break-all font-mono text-[11px] text-[#a8c6ae]">{row.intentId} — {statusText(row.status,c)}</p>)}</div>}</div>}
      {mutationError && !modal && <p role="alert" className="mb-4 text-sm text-[#ffc19b]" data-testid="error-admin-payout">{mutationError}</p>}
      {!payouts.data?.length?<div className="admin-panel grid min-h-44 place-content-center p-8 text-center" data-testid="empty-admin-payouts"><Wallet className="mx-auto text-[#69bd87]"/><h3 className="mt-3 font-['Syne'] text-lg">{c.noPayoutRows}</h3><p className="mt-2 text-sm text-[#8fa495]">{c.noPayoutRowsBody}</p></div>:
      <div className="admin-panel overflow-hidden"><div className="divide-y divide-[#304238]">{payouts.data.map(p=><div key={p.id} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:items-center" data-testid={`row-admin-payout-${p.id}`}><div className="min-w-0"><p className="admin-label">{c.contract} / {c.purpose}</p><p className="mt-1 break-all font-mono text-xs text-[#d2e6d6]" dir="ltr">{p.contractId}</p><p className="mt-1 text-xs text-[#8da998]">{p.purpose.replaceAll('_',' ')} {p.disputeId ? `· ${p.disputeId}` : ''}</p></div><div><p className="admin-label">{c.amount}</p><p className="mt-1 font-mono text-sm">{amount(p.amount,'Pi')}</p><p className="mt-1 text-[11px] text-[#8da998]">{p.network}</p></div><div className="min-w-0"><p className="admin-label">{c.status}</p><span className={`mt-1 inline-block rounded-full border px-2.5 py-1 text-xs ${statusStyle(p.status)}`} data-testid={`status-payout-${p.id}`}>{statusText(p.status,c)}</span><p className="mt-1 text-[11px] text-[#8da998]">{date(p.updatedAt,language)}</p></div><div className="min-w-0 text-xs text-[#a4baa8]"><p className="admin-label">{c.paymentId}</p><p className="mt-1 break-all font-mono" dir="ltr">{p.paymentId || '—'}</p><p className="admin-label mt-2">{c.txid}</p><p className="mt-1 break-all font-mono" dir="ltr">{p.txid || '—'}</p></div></div>)}</div></div>}
    </section>

    <ChatAdminManagement />

    {modal && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#07100b]/85 p-4 backdrop-blur-sm" onMouseDown={e=>{if(e.target===e.currentTarget&&!decide.isPending&&!reconcile.isPending)setModal(null)}}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" aria-describedby="admin-modal-description" className="w-full max-w-lg rounded-2xl border border-[#547258] bg-[#1b261e] p-5 shadow-[0_26px_100px_rgba(0,0,0,.55)] sm:p-7" data-testid="dialog-admin-confirmation"><div className="flex items-start justify-between gap-4"><span className="rounded-xl border border-[#755e3c] bg-[#342a1c] p-3 text-[#e6b776]"><AlertTriangle size={21}/></span><button autoFocus={modal==='reconcile'} className="rounded-lg p-2 text-[#adc0af] hover:bg-[#2b3b2d]" onClick={()=>setModal(null)} disabled={decide.isPending||reconcile.isPending} aria-label={c.close} data-testid="button-close-confirmation"><X size={18}/></button></div><p className="admin-label mt-6 text-[#eac38d]">{c.irreversible}</p><h2 id="admin-modal-title" className="mt-2 font-['Syne'] text-2xl font-semibold">{modal==='reconcile'?c.reconcileTitle:c.confirmTitle}</h2><p id="admin-modal-description" className="mt-3 text-sm leading-6 text-[#b6c8b9]">{modal==='reconcile'?c.reconcileLead:c.confirmLead}</p>
      {modal!=='reconcile' && <><div className="mt-5 rounded-lg border border-[#4e654d] bg-[#142118] p-4 text-sm"><strong className="block text-[#d5efdc]">{modal==='release'?c.release:c.refund}</strong><span className="mt-1 block text-[#a9bfad]">{selected?.contractTitle} · {selected?amount(selected.contractAmount,selected.contractCurrency):''}</span></div><label className="mt-5 block text-sm font-semibold" htmlFor="admin-decision-reason">{c.reason}</label><p className="mt-1 text-xs text-[#92a797]">{c.reasonHint}</p><textarea id="admin-decision-reason" autoFocus rows={4} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} className="admin-field mt-2 resize-y" data-testid="input-admin-decision-reason"/><label className="mt-5 block text-sm font-semibold" htmlFor="admin-decision-confirm">{c.type} <span className="font-mono text-[#e5bd87]" dir="ltr">{modal.toUpperCase()}</span></label><input id="admin-decision-confirm" autoComplete="off" spellCheck={false} value={typed} onChange={e=>setTyped(e.target.value)} className="admin-field mt-2 font-mono" dir="ltr" data-testid="input-admin-decision-confirm"/>{(reason.length>0||typed.length>0) && (reason.trim().length<10||typed!==modal.toUpperCase()) && <p className="mt-2 text-xs text-[#efbb8a]">{c.validation}</p>}</>}
      {mutationError && <p role="alert" className="mt-4 text-sm text-[#ffc19b]">{mutationError}</p>}
      <div className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button className="admin-soft-button" onClick={()=>setModal(null)} disabled={decide.isPending||reconcile.isPending} data-testid="button-cancel-admin-confirmation">{c.cancel}</button><button className="admin-primary-button" disabled={modal==='reconcile'?reconcile.isPending:decide.isPending||!canDecide||reason.trim().length<10||reason.trim().length>2000||typed!==modal.toUpperCase()} onClick={modal==='reconcile'?sendReconcile:sendDecision} data-testid="button-confirm-admin-action"><ShieldCheck size={16}/>{modal==='reconcile'?(reconcile.isPending?c.reconciling:c.reconcile):(decide.isPending?c.submitting:c.submit)}</button></div></div></div>}
  </div>;
}