import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListEscrowServiceDepositsQueryKey,
  useCreateEscrowServiceDepositIntent,
  useListEscrowServiceDeposits,
} from '@workspace/api-client-react';
import { useI18n } from '@/i18n';
import { usePiPayment } from '@/hooks/use-pi-payment';

export function EscrowServiceDepositCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const deposits = useListEscrowServiceDeposits();
  const intent = useCreateEscrowServiceDepositIntent();
  const [checkoutError, setCheckoutError] = useState('');
  const pi = usePiPayment(() => {
    void queryClient.invalidateQueries({ queryKey: getListEscrowServiceDepositsQueryKey() });
  });

  const buyDeposit = async () => {
    setCheckoutError('');
    try {
      const paymentIntent = await intent.mutateAsync();
      if (
        paymentIntent.productName !== 'Escrow Service Deposit' ||
        paymentIntent.description !== 'Secure funds held in escrow for freelance service' ||
        paymentIntent.amount !== 1 ||
        paymentIntent.memo !== 'Escrow deposit for job agreement' ||
        paymentIntent.metadata.type !== 'escrow'
      ) {
        throw new Error('Unexpected escrow service deposit intent');
      }
      await pi.pay(paymentIntent);
    } catch {
      setCheckoutError(t('dashboard.serviceDepositFailed'));
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'confirmed') return t('dashboard.serviceDepositConfirmed');
    if (status === 'approved') return t('dashboard.serviceDepositApproved');
    return t('dashboard.serviceDepositPending');
  };

  return (
    <section
      className="mt-7 grid gap-7 rounded-xl border border-[#2b5138] bg-[#15271b] p-6 sm:p-8 lg:grid-cols-[1.2fr_.8fr]"
      aria-labelledby="service-deposit-title"
      data-testid="card-escrow-service-deposit"
    >
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#1DE9B6]">PI NETWORK / MAINNET</p>
        <h2 id="service-deposit-title" className="mt-3 font-['Syne'] text-2xl font-semibold">
          {t('dashboard.serviceDepositTitle')}
        </h2>
        <p className="mt-2 max-w-xl text-sm text-[#a8b8aa]">{t('dashboard.serviceDepositDescription')}</p>
        <p className="mt-4 inline-flex rounded-full border border-[#3a6844] px-3 py-1 font-mono text-xs text-[#1DE9B6]">
          {t('dashboard.serviceDepositPrice')}
        </p>
        <p className="mt-4 max-w-xl text-xs leading-5 text-[#9dae9e]">{t('dashboard.serviceDepositNotice')}</p>
        <button
          type="button"
          disabled={pi.state !== 'ready' || intent.isPending || deposits.isLoading || deposits.isError}
          onClick={() => void buyDeposit()}
          className="mt-5 rounded-lg bg-[#00C853] px-5 py-3 text-sm font-bold text-[#07150b] transition-colors hover:bg-[#1de9b6] disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-buy-escrow-service-deposit"
        >
          {intent.isPending || pi.state === 'paying'
            ? t('escrow.piPaymentPending')
            : t('dashboard.serviceDepositBuy')}
        </button>
        {pi.state === 'loading' && <p className="mt-3 text-xs text-[#9dae9e]">{t('common.loading')}</p>}
        {pi.state === 'unavailable' && <p className="mt-3 text-xs text-[#d9b697]">{t('common.notAvailable')}</p>}
        {(checkoutError || pi.error) && (
          <p className="mt-3 text-sm text-[#ff998e]" role="alert">
            {checkoutError || pi.error}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-[#324238] bg-[#1A1A1A] p-5">
        <h3 className="font-['Syne'] text-base">{t('dashboard.serviceDepositHistory')}</h3>
        {deposits.isLoading ? (
          <div className="skeleton mt-4 h-20 rounded-lg" />
        ) : deposits.isError ? (
          <div className="mt-4 text-sm text-[#f09b91]" role="alert">
            <p>{t('dashboard.serviceDepositHistoryError')}</p>
            <button
              type="button"
              className="mt-2 text-[#1DE9B6]"
              onClick={() => void deposits.refetch()}
              data-testid="button-retry-service-deposits"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : !deposits.data?.length ? (
          <p className="mt-4 text-sm text-[#9dae9e]">{t('dashboard.serviceDepositNoHistory')}</p>
        ) : (
          <ul className="mt-4 divide-y divide-[#334239]">
            {deposits.data.slice(0, 4).map((deposit) => (
              <li key={deposit.paymentId} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium">{deposit.productName}</p>
                  <p className="mt-1 text-xs text-[#9dae9e]">
                    {new Date(deposit.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-end">
                  <p className="font-mono text-xs">1 Pi</p>
                  <p className="mt-1 text-xs text-[#1DE9B6]">{statusLabel(deposit.status)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}