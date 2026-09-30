import { useState, type FormEvent } from 'react';
import { AlertTriangle, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  getGetListingAdFeeQueryKey,
  getGetMyListingsQueryKey,
  getSearchListingsQueryKey,
  useCreateListingDeletePaymentIntent,
  useCreateListingEditPaymentIntent,
  useGetListingAdFee,
  useGetMyListings,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useI18n } from '@/i18n';
import { usePiPayment } from '@/hooks/use-pi-payment';

type OwnedListing = {
  id: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
  active: boolean;
  createdAt: string;
};

export default function MyListings() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const listings = useGetMyListings({ query: { queryKey: getGetMyListingsQueryKey(), retry: false } });
  const fees = useGetListingAdFee({ query: { queryKey: getGetListingAdFeeQueryKey(), retry: false } });
  const editPayment = useCreateListingEditPaymentIntent();
  const deletePayment = useCreateListingDeletePaymentIntent();
  const pi = usePiPayment();
  const [editing, setEditing] = useState<OwnedListing | null>(null);
  const [deleting, setDeleting] = useState<OwnedListing | null>(null);
  const [form, setForm] = useState({ title: '', description: '', amount: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshListings = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetMyListingsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getSearchListingsQueryKey() }),
    ]);
  };

  const beginEdit = (listing: OwnedListing) => {
    setError('');
    setNotice('');
    setForm({
      title: listing.title,
      description: listing.description,
      amount: String(listing.amount),
    });
    setEditing(listing);
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    setError('');
    if (pi.state !== 'ready') {
      setError(t('myListings.piUnavailable'));
      return;
    }
    const data = {
      ...(form.title.trim() !== editing.title ? { title: form.title.trim() } : {}),
      ...(form.description !== editing.description ? { description: form.description } : {}),
      ...(Number(form.amount) !== editing.amount ? { amount: Number(form.amount) } : {}),
    };
    if (Object.keys(data).length === 0) {
      setError(t('myListings.noChanges'));
      return;
    }
    try {
      const intent = await editPayment.mutateAsync({
        id: editing.id,
        data,
      });
      await pi.pay(intent);
      await refreshListings();
      setEditing(null);
      setNotice(t('myListings.listingsUpdated'));
    } catch (error) {
      setError(error instanceof Error ? error.message : pi.error || t('myListings.paymentError'));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setError('');
    if (pi.state !== 'ready') {
      setError(t('myListings.piUnavailable'));
      return;
    }
    try {
      const intent = await deletePayment.mutateAsync({ id: deleting.id });
      await pi.pay(intent);
      await refreshListings();
      setDeleting(null);
      setNotice(t('myListings.listingDeleted'));
    } catch (error) {
      setError(error instanceof Error ? error.message : pi.error || t('myListings.paymentError'));
    }
  };

  const busy = editPayment.isPending || deletePayment.isPending || pi.state === 'paying';
  const owned = (listings.data ?? []) as OwnedListing[];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('myListings.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#9fb2a4]">{t('myListings.subtitle')}</p>
        </div>
        <Link
          href="/contracts/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#00c853] px-4 font-medium text-[#07120b] hover:bg-[#25dc72]"
        >
          <Plus size={17} />
          {t('navigation.createContract')}
        </Link>
      </div>

      {listings.isLoading ? (
        <div className="mt-8 h-28 animate-pulse rounded-xl border border-[#29352e] bg-[#151a17]" />
      ) : listings.isError ? (
        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-xl border border-[#4e3829] bg-[#211812] p-4 text-sm text-[#ffc19b]" role="alert">
          <AlertTriangle size={17} />
          <span>{t('myListings.loadError')}</span>
          <button type="button" className="inline-flex items-center gap-2 underline" onClick={() => void listings.refetch()}>
            <RefreshCw size={14} />{t('myListings.retry')}
          </button>
        </div>
      ) : owned.length === 0 ? (
        <div className="mt-8 rounded-xl border border-[#29352e] bg-[#151a17] p-6 text-sm text-[#a9b5ad]">
          {t('myListings.empty')}
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {owned.map((listing) => (
            <article key={listing.id} className="rounded-xl border border-[#29352e] bg-[#151a17] p-5 sm:flex sm:items-center sm:justify-between sm:gap-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold">{listing.title}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${listing.active ? 'bg-[#153522] text-[#91e8ae]' : 'bg-[#2a302c] text-[#b0bab4]'}`}>
                    {listing.active ? t('myListings.active') : t('myListings.inactive')}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-[#9fb2a4]">{listing.description}</p>
                <p className="mt-3 font-mono text-sm text-[#d8e3dc]">{listing.amount} {listing.currency}</p>
              </div>
              {listing.active && (
                <div className="mt-4 flex shrink-0 gap-2 sm:mt-0">
                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#43604d] px-3 text-sm hover:bg-[#202d24] disabled:opacity-50"
                    onClick={() => beginEdit(listing)}
                    disabled={busy || fees.isLoading || fees.isError}
                  >
                    <Pencil size={15} />{t('myListings.edit')}
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#69403b] px-3 text-sm text-[#ffb6aa] hover:bg-[#2d211f] disabled:opacity-50"
                    onClick={() => { setError(''); setNotice(''); setDeleting(listing); }}
                    disabled={busy || fees.isLoading || fees.isError}
                  >
                    <Trash2 size={15} />{t('myListings.delete')}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {notice && <p className="mt-5 rounded-lg border border-[#285439] bg-[#112219] p-3 text-sm text-[#91e8ae]" role="status">{notice}</p>}
      {pi.error && !error && <p className="mt-4 text-sm text-[#ffc19b]" role="alert">{t('myListings.paymentPending')}</p>}

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="presentation">
          <form onSubmit={saveEdit} className="w-full max-w-xl rounded-2xl border border-[#34463a] bg-[#121815] p-5 shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="edit-listing-title">
            <h2 id="edit-listing-title" className="text-xl font-semibold">{t('myListings.edit')}: {editing.title}</h2>
            <label className="mt-5 block text-sm text-[#bdc9c1]">
              {t('myListings.titleField')}
              <input required maxLength={240} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border border-[#36443b] bg-[#0c100e] px-3 text-white" />
            </label>
            <label className="mt-4 block text-sm text-[#bdc9c1]">
              {t('myListings.descriptionField')}
              <textarea maxLength={10000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-2 min-h-28 w-full rounded-lg border border-[#36443b] bg-[#0c100e] p-3 text-white" />
            </label>
            <label className="mt-4 block text-sm text-[#bdc9c1]">
              {t('myListings.amountField')}
              <input required type="text" inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border border-[#36443b] bg-[#0c100e] px-3 font-mono text-white" dir="ltr" />
            </label>
            <p className="mt-4 rounded-lg border border-[#34463a] bg-[#18221b] p-3 text-sm text-[#c2d3c8]">
              {t('myListings.editFee')}: <strong className="font-mono text-white">{fees.data?.listingEditFeePi ?? '—'} Pi</strong>
            </p>
            {error && <p className="mt-3 text-sm text-[#ffc19b]" role="alert">{error}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" className="min-h-11 rounded-lg border border-[#39463e] px-4 text-sm" onClick={() => setEditing(null)} disabled={busy}>{t('myListings.cancel')}</button>
              <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#00c853] px-4 font-medium text-[#07120b] disabled:opacity-50" disabled={busy || fees.isError || !fees.data || !form.title.trim() || !Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0}>
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
                {t('myListings.saveAndPay')}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="presentation">
          <div className="w-full max-w-md rounded-2xl border border-[#34463a] bg-[#121815] p-5 shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="delete-listing-title">
            <h2 id="delete-listing-title" className="text-xl font-semibold">{t('myListings.delete')}</h2>
            <p className="mt-3 break-words text-sm text-[#b4c0b8]">{deleting.title}</p>
            <p className="mt-3 text-sm text-[#9fb2a4]">{t('myListings.deletePrompt')}</p>
            <p className="mt-4 rounded-lg border border-[#69403b] bg-[#211715] p-3 text-sm text-[#ffd2c9]">
              {t('myListings.deleteFee')}: <strong className="font-mono text-white">{fees.data?.listingDeleteFeePi ?? '—'} Pi</strong>
            </p>
            {error && <p className="mt-3 text-sm text-[#ffc19b]" role="alert">{error}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" className="min-h-11 rounded-lg border border-[#39463e] px-4 text-sm" onClick={() => setDeleting(null)} disabled={busy}>{t('myListings.cancel')}</button>
              <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#b84d3f] px-4 font-medium text-white disabled:opacity-50" onClick={() => void confirmDelete()} disabled={busy || fees.isError || !fees.data}>
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={15} />}
                {t('myListings.deleteAndPay')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}