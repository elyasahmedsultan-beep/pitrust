import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, LoaderCircle, RefreshCw, Save } from 'lucide-react';
import {
  getGetListingAdFeeQueryKey,
  useGetListingAdFee,
  useUpdateAdminListingAdFee,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';

const MIN_FEE = 0.00000001;
const MAX_FEE = 1000000;
type FeeKey = 'listingAdFeePi' | 'listingEditFeePi' | 'listingDeleteFeePi';

function validFee(value: string): boolean {
  if (!/^\d+(?:\.\d{1,8})?$/.test(value.trim())) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= MIN_FEE && parsed <= MAX_FEE;
}

export default function AdminListingAdFeeSettings() {
  const { language } = useI18n();
  const queryClient = useQueryClient();
  const fee = useGetListingAdFee({ query: { queryKey: getGetListingAdFeeQueryKey(), retry: false } });
  const update = useUpdateAdminListingAdFee();
  const [amounts, setAmounts] = useState<Record<FeeKey, string>>({
    listingAdFeePi: '1',
    listingEditFeePi: '0.25',
    listingDeleteFeePi: '0.25',
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<FeeKey | null>(null);
  const ar = language === 'ar';
  const copy = ar
    ? {
        systemSettings: 'إعدادات النظام',
        title: 'رسوم الإعلانات',
        description: 'تُضبط رسوم النشر والتعديل والحذف كلٌّ على حدة. القيم موجبة حتى 1,000,000 Pi وبدقة تصل إلى 8 منازل عشرية. التغييرات تنطبق على طلبات الدفع الجديدة فقط.',
        current: 'الرسم الحالي',
        publication: 'رسوم نشر الإعلان',
        edit: 'رسوم تعديل الإعلان',
        remove: 'رسوم حذف الإعلان',
        save: 'حفظ الرسم',
        saving: 'جارٍ الحفظ…',
        invalid: 'أدخل قيمة موجبة لا تتجاوز 1,000,000 Pi وبحد أقصى 8 منازل عشرية.',
        unavailable: 'تعذر تحميل الرسم أو تحديثه. تحقق من جلسة الإدارة وإعدادات قاعدة البيانات.',
        saved: 'تم حفظ الرسم. ستستخدمه طلبات الدفع الجديدة.',
        retry: 'إعادة المحاولة',
      }
    : {
        systemSettings: 'SYSTEM SETTINGS',
        title: 'Listing ad fees',
        description: 'Publication, edit, and deletion fees are configured independently. Values are positive, up to 1,000,000 Pi, with up to 8 decimal places. Changes apply to new payment intents only.',
        current: 'Current fee',
        publication: 'Publication fee',
        edit: 'Edit fee',
        remove: 'Delete fee',
        save: 'Save fee',
        saving: 'Saving…',
        invalid: 'Enter a positive amount up to 1,000,000 Pi with no more than 8 decimal places.',
        unavailable: 'Could not load or update the fee. Check the admin session and database settings.',
        saved: 'Fee saved. New payment intents will use it.',
        retry: 'Retry',
      };
  const feeFields: { key: FeeKey; label: string }[] = [
    { key: 'listingAdFeePi', label: copy.publication },
    { key: 'listingEditFeePi', label: copy.edit },
    { key: 'listingDeleteFeePi', label: copy.remove },
  ];

  useEffect(() => {
    if (fee.data) {
      setAmounts({
        listingAdFeePi: String(fee.data.listingAdFeePi),
        listingEditFeePi: String(fee.data.listingEditFeePi),
        listingDeleteFeePi: String(fee.data.listingDeleteFeePi),
      });
    }
  }, [fee.data?.listingAdFeePi, fee.data?.listingEditFeePi, fee.data?.listingDeleteFeePi]);

  const submit = async (event: FormEvent<HTMLFormElement>, key: FeeKey) => {
    event.preventDefault();
    setSaved(null);
    if (!validFee(amounts[key])) {
      setError(copy.invalid);
      return;
    }
    setError('');
    try {
      const value = Number(amounts[key]);
      const data = key === 'listingAdFeePi'
        ? { listingAdFeePi: value }
        : key === 'listingEditFeePi'
          ? { listingEditFeePi: value }
          : { listingDeleteFeePi: value };
      const result = await update.mutateAsync({
        data,
      });
      setAmounts({
        listingAdFeePi: String(result.listingAdFeePi),
        listingEditFeePi: String(result.listingEditFeePi),
        listingDeleteFeePi: String(result.listingDeleteFeePi),
      });
      await queryClient.invalidateQueries({ queryKey: getGetListingAdFeeQueryKey() });
      setSaved(key);
    } catch {
      setError(copy.unavailable);
    }
  };

  return (
    <section
      className="admin-panel mt-8 p-5 sm:p-6"
      aria-labelledby="admin-listing-fee-title"
      data-testid="admin-listing-fee-settings"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="admin-label text-[#1de9b6]">{copy.systemSettings}</p>
          <h2 id="admin-listing-fee-title" className="mt-2 font-['Syne'] text-xl font-semibold">
            {copy.title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#9fb2a4]">{copy.description}</p>
        </div>
      </div>

      {fee.isLoading ? (
        <div className="skeleton mt-5 h-14 rounded-lg" />
      ) : fee.isError ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-[#ffc19b]" role="alert">
          <AlertTriangle size={16} />
          <span>{copy.unavailable}</span>
          <button
            type="button"
            className="admin-soft-button"
            onClick={() => void fee.refetch()}
            data-testid="button-retry-listing-fee"
          >
            <RefreshCw size={14} />{copy.retry}
          </button>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {feeFields.map(({ key, label }) => (
            <form
              key={key}
              onSubmit={(event) => void submit(event, key)}
              className="rounded-xl border border-[#294b37] bg-[#0d1b12] p-4"
            >
              <p className="text-xs text-[#9fb2a4]">
                {copy.current}: <strong className="ms-1 font-mono text-[#e6f4e9]">{fee.data?.[key]} Pi</strong>
              </p>
              <label className="admin-label mt-3 block">
                {label}
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={amounts[key]}
                  onChange={(event) => {
                    setAmounts((current) => ({ ...current, [key]: event.target.value }));
                    setError('');
                    setSaved(null);
                  }}
                  className="admin-field mt-2"
                  dir="ltr"
                  data-testid={`input-${key}-setting`}
                />
              </label>
              <button
                type="submit"
                className="admin-primary-button mt-4 min-h-11 w-full"
                disabled={update.isPending || !validFee(amounts[key])}
                data-testid={`button-save-${key}`}
              >
                {update.isPending ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}
                {update.isPending ? copy.saving : copy.save}
              </button>
              {saved === key && (
                <p className="mt-3 flex items-center gap-2 text-sm text-[#86dda0]" role="status">
                  <Check size={15} />{copy.saved}
                </p>
              )}
            </form>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-[#ffc19b]" role="alert">{error}</p>}
    </section>
  );
}