import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useCreateAdminSession, getGetAdminAccessQueryKey } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { useI18n } from '@/i18n';
import { Form } from '@/components/ui/form';
import { usePiIframeSession } from '@/lib/pi-iframe-session';

type AdminPasswordGateProps = {
  sessionCheckFailed?: boolean;
  onRetrySessionCheck?: () => void;
};

export default function AdminPasswordGate({
  sessionCheckFailed = false,
  onRetrySessionCheck,
}: AdminPasswordGateProps) {
  const { language, direction } = useI18n();
  const queryClient = useQueryClient();
  const createSession = useCreateAdminSession();
  const { session: piSession, setAdminSessionToken } = usePiIframeSession();
  const form = useForm<{ password: string }>({ defaultValues: { password: '' } });
  const [error, setError] = useState('');
  const ar = language === 'ar';
  const copy = ar
    ? {
        title: 'دخول الإدارة',
        description: 'أدخل كلمة مرور الإدارة لعرض النزاعات وتحليل Gemini الاستشاري. يتم التحقق من صلاحية المحكّم عبر Clerk عند إرسال طلب الصرف أو رد الأموال أو مطابقة الدفعات.',
        password: 'كلمة مرور الإدارة',
        placeholder: '16 حرفًا على الأقل',
        tooShort: 'يجب أن تتكون كلمة المرور من 16 حرفًا على الأقل.',
        submit: 'فتح لوحة الإدارة',
        submitting: 'جارٍ التحقق…',
        invalid: 'كلمة المرور غير صحيحة.',
        unavailable: 'مصادقة كلمة مرور الإدارة غير مهيأة. أضف ADMIN_PASSWORD وجرّب مجددًا.',
        limited: 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
        generic: 'تعذر تسجيل الدخول. حاول مجددًا.',
        sessionCheckFailed: 'تعذر التحقق من جلسة الإدارة الآن. يمكنك المحاولة بكلمة المرور أو إعادة فحص الجلسة.',
        retrySessionCheck: 'إعادة فحص الجلسة',
        home: 'العودة إلى PiTrust',
      }
    : {
        title: 'Admin sign-in',
        description: 'Enter the admin password to view disputes and Gemini’s advisory analysis. Clerk arbitrator authorization is checked when you submit a release, refund, or payout reconciliation.',
        password: 'Admin password',
        placeholder: 'At least 16 characters',
        tooShort: 'Use at least 16 characters.',
        submit: 'Open admin desk',
        submitting: 'Verifying…',
        invalid: 'The password was not accepted.',
        unavailable: 'Admin password authentication is not configured. Add ADMIN_PASSWORD and try again.',
        limited: 'Too many attempts. Wait a while, then try again.',
        generic: 'Could not sign in. Please try again.',
        sessionCheckFailed: 'The admin session could not be checked. You can still try the password or retry the session check.',
        retrySessionCheck: 'Retry session check',
        home: 'Back to PiTrust',
      };

  const submit = form.handleSubmit(async ({ password }) => {
    setError('');
    try {
      const result = await createSession.mutateAsync({ data: { password } });
      if (piSession) {
        if (typeof result.sessionToken !== 'string' || !result.sessionToken) {
          throw new Error('Admin session token was not returned');
        }
        setAdminSessionToken(result.sessionToken);
      }
      form.reset();
      await queryClient.invalidateQueries({ queryKey: getGetAdminAccessQueryKey() });
    } catch (cause) {
      const status = (cause as { status?: number } | null)?.status;
      setError(status === 401 ? copy.invalid : status === 503 ? copy.unavailable : status === 429 ? copy.limited : copy.generic);
    }
  });

  return (
    <main dir={direction} className="grid min-h-[100dvh] place-items-center bg-[#0D0D0D] px-4 py-10 text-[#F2F5F3]">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-7 inline-flex items-center gap-3 text-sm font-semibold text-[#d7e5da]">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#00C853] text-[#07130B]"><ShieldCheck size={21} /></span>
          <span>PiTrust<span className="text-[#00C853]">.</span></span>
        </Link>
        <section className="admin-panel p-6 sm:p-8" aria-labelledby="admin-password-title">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#3b6550] bg-[#163424] text-[#77df9d]">
            <LockKeyhole size={20} />
          </div>
          <h1 id="admin-password-title" className="mt-5 font-['Syne'] text-2xl font-semibold">{copy.title}</h1>
          <p className="mt-3 text-sm leading-7 text-[#a6b7aa]">{copy.description}</p>
          {sessionCheckFailed && (
            <div className="mt-4 rounded-lg border border-[#594c33] bg-[#241f16] p-3 text-xs leading-5 text-[#e4c795]" role="status">
              <p>{copy.sessionCheckFailed}</p>
              {onRetrySessionCheck && (
                <button
                  type="button"
                  className="mt-2 font-semibold underline underline-offset-4"
                  onClick={onRetrySessionCheck}
                  data-testid="button-retry-admin-session-check"
                >
                  {copy.retrySessionCheck}
                </button>
              )}
            </div>
          )}
          <Form {...form}>
            <form className="mt-7 space-y-4" onSubmit={submit}>
              <label className="admin-label block" htmlFor="admin-secret-password">{copy.password}</label>
              <input
                id="admin-secret-password"
                type="password"
                autoComplete="current-password"
                minLength={16}
                maxLength={512}
                aria-invalid={!!form.formState.errors.password}
                {...form.register('password', { required: true, minLength: 16, maxLength: 512 })}
                placeholder={copy.placeholder}
                className="admin-field"
                dir="ltr"
                data-testid="input-admin-secret-password"
              />
              {form.formState.errors.password && <p role="alert" className="text-sm text-[#ffc19b]">{copy.tooShort}</p>}
              {error && <p role="alert" className="flex items-start gap-2 text-sm leading-6 text-[#ffc19b]" data-testid="error-admin-password"><AlertTriangle className="mt-1 shrink-0" size={15} />{error}</p>}
              <button className="admin-primary-button w-full" type="submit" disabled={form.formState.isSubmitting || createSession.isPending} data-testid="button-admin-password-submit">
                {form.formState.isSubmitting || createSession.isPending ? <LoaderCircle className="animate-spin" size={16} /> : <LockKeyhole size={16} />}
                {form.formState.isSubmitting || createSession.isPending ? copy.submitting : copy.submit}
              </button>
            </form>
          </Form>
        </section>
        <Link href="/" className="mt-6 inline-flex items-center gap-2 text-xs text-[#94aa9b] hover:text-[#c8e7d0]">
          {ar ? <ArrowLeft size={14} /> : <ArrowLeft size={14} />}
          {copy.home}
        </Link>
      </div>
    </main>
  );
}