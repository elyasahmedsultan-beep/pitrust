import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, Clock3, Copy, Droplets, Landmark, RefreshCw, Send, ShieldCheck, WalletCards } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetTestnetWalletQueryKey,
  useClaimTestnetFaucet,
  useGetTestnetWallet,
  useTransferTestnetWallet,
  type TestnetWalletTransaction,
} from '@workspace/api-client-react';
import { useI18n } from '@/i18n';
import { PI_SANDBOX } from '@/lib/pi-sdk';

function formatAmount(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
}

function errorPayload(error: unknown): { reason?: string; message?: string; remainingSeconds?: number } {
  const candidate = error as { response?: { data?: unknown }; data?: unknown; message?: string } | undefined;
  const value = candidate?.response?.data ?? candidate?.data;
  if (value && typeof value === 'object') {
    const data = value as Record<string, unknown>;
    return {
      reason: typeof data.reason === 'string' ? data.reason : undefined,
      message: typeof data.error === 'string' ? data.error : undefined,
      remainingSeconds: typeof data.remainingSeconds === 'number' ? data.remainingSeconds : undefined,
    };
  }
  return { message: candidate?.message };
}

function formatRemaining(seconds: number): { hours: number; minutes: number } {
  const totalMinutes = Math.ceil(Math.max(0, seconds) / 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

function transactionLabel(transaction: TestnetWalletTransaction, t: ReturnType<typeof useI18n>['t']): string {
  if (transaction.type === 'faucet_claim') return t('wallet.faucetClaim');
  if (transaction.type === 'escrow_funding') return t('wallet.escrowFunding');
  if (transaction.type === 'escrow_release') return t('wallet.escrowRelease');
  return t('wallet.internalTransfer');
}

function transactionTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function WalletPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const wallet = useGetTestnetWallet({ query: { queryKey: getGetTestnetWalletQueryKey(), enabled: PI_SANDBOX, refetchInterval: 30000 } });
  const faucet = useClaimTestnetFaucet();
  const transfer = useTransferTestnetWallet();
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCooldownSeconds(wallet.data?.faucetCooldownRemainingSeconds ?? 0);
  }, [wallet.data?.faucetCooldownRemainingSeconds]);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setInterval(() => setCooldownSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSeconds > 0]);

  const remaining = useMemo(() => formatRemaining(cooldownSeconds), [cooldownSeconds]);
  const canClaim = Boolean(wallet.data && cooldownSeconds <= 0 && wallet.data.balance <= 10);
  const isValidAmount = /^\d+(?:\.\d{1,8})?$/.test(amount) && Number(amount) > 0;

  const refreshWallet = () => {
    void queryClient.invalidateQueries({ queryKey: getGetTestnetWalletQueryKey() });
  };

  const handleClaim = () => {
    if (!canClaim) return;
    faucet.mutate(undefined, {
      onSuccess: refreshWallet,
      onError: (error) => {
        const payload = errorPayload(error);
        if (payload.remainingSeconds) setCooldownSeconds(payload.remainingSeconds);
      },
    });
  };

  const handleTransfer = () => {
    const parsedAmount = Number(amount);
    setTransferError('');
    if (!recipient.trim() || !isValidAmount) {
      setTransferError(t('wallet.positiveAmount'));
      return;
    }
    if (recipient.trim() === wallet.data?.address) {
      setTransferError(t('wallet.selfTransfer'));
      return;
    }
    if (wallet.data && parsedAmount > wallet.data.balance) {
      setTransferError(t('wallet.insufficientBalance'));
      return;
    }
    transfer.mutate(
      { data: { recipient: recipient.trim(), amount: parsedAmount, requestId: crypto.randomUUID() } },
      {
        onSuccess: () => {
          setRecipient('');
          setAmount('');
          refreshWallet();
        },
        onError: (error) => {
          const payload = errorPayload(error);
          if (payload.reason === 'insufficient_balance') setTransferError(t('wallet.insufficientBalance'));
          else if (payload.reason === 'recipient_not_found' || payload.reason === 'recipient_ambiguous') setTransferError(t('wallet.unknownRecipient'));
          else if (payload.reason === 'self_transfer') setTransferError(t('wallet.selfTransfer'));
          else setTransferError(payload.message || t('wallet.transferFailed'));
        },
      },
    );
  };

  const copyAddress = async () => {
    if (!wallet.data?.address) return;
    try {
      await navigator.clipboard.writeText(wallet.data.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (!PI_SANDBOX) return null;
  if (wallet.isLoading) {
    return <div className="space-y-6" aria-label={t('common.loading')}><div className="skeleton h-36 rounded-2xl" /><div className="grid gap-6 lg:grid-cols-2"><div className="skeleton h-72 rounded-2xl" /><div className="skeleton h-72 rounded-2xl" /></div></div>;
  }
  if (wallet.isError || !wallet.data) {
    return <section className="rounded-2xl border border-[#5a3e39] bg-[#1b1715] p-8"><p className="text-sm text-[#f0c5b6]">{t('errors.network')}</p><button onClick={() => void wallet.refetch()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#856154] px-4 py-2 text-sm text-[#f3c1aa]" data-testid="button-retry-wallet"><RefreshCw size={15} />{t('common.retry')}</button></section>;
  }

  const data = wallet.data;
  return (
    <div className="animate-rise-in space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[.22em] text-[#1DE9B6]">PITRUST / {t('wallet.network')}</p>
          <h1 className="mt-3 font-['Syne'] text-4xl font-semibold tracking-[-.03em] sm:text-5xl">{t('wallet.title')}<span className="text-[#00C853]">.</span></h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#9db0a3]">{t('wallet.subtitle')}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[#2c5b48] bg-[#12261b] px-3 py-2 font-mono text-[10px] uppercase tracking-[.15em] text-[#8ff0c9]"><span className="h-1.5 w-1.5 rounded-full bg-[#1DE9B6]" />{data.network}</span>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-[#276248] bg-[#102c21] p-6 shadow-[0_20px_60px_rgba(0,200,83,.08)] sm:p-8" data-testid="card-wallet-balance">
        <div className="absolute -end-10 -top-16 h-48 w-48 rounded-full border border-[#2b7655]/40" />
        <div className="absolute -end-2 -top-8 h-32 w-32 rounded-full border border-[#2b7655]/30" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div><p className="text-xs uppercase tracking-[.16em] text-[#9dd6ba]">{t('wallet.availableBalance')}</p><p className="mt-4 font-mono text-5xl tracking-[-.04em] text-[#f0fff5] sm:text-6xl" data-testid="text-wallet-balance">{formatAmount(data.balance)} <span className="text-2xl text-[#73d4aa]">Test-Pi</span></p></div>
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-[#438d68] bg-[#194a32] text-[#8ff0c9]"><WalletCards size={23} /></div>
        </div>
        <p className="relative mt-8 max-w-xl text-xs leading-6 text-[#9ec4b0]">{t('wallet.sandboxNotice')}</p>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-2xl border border-[#324139] bg-[#191e1b] p-6 sm:p-7" data-testid="card-wallet-faucet">
          <div className="flex items-start justify-between gap-5"><div><div className="flex items-center gap-3"><Droplets size={19} className="text-[#1DE9B6]" /><h2 className="font-['Syne'] text-xl">{t('wallet.faucet')}</h2></div><p className="mt-3 max-w-lg text-sm leading-6 text-[#99ada0]">{t('wallet.faucetDescription')}</p></div><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#173426] text-[#1DE9B6]">100</span></div>
          <div className="mt-7 flex flex-wrap items-center gap-4"><button onClick={handleClaim} disabled={!canClaim || faucet.isPending} className="inline-flex items-center gap-2 rounded-lg bg-[#00C853] px-5 py-3 text-sm font-bold text-[#06150c] transition hover:bg-[#1DE9B6] disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-claim-faucet">{faucet.isPending ? t('wallet.claiming') : t('wallet.claim100')}<ArrowUpRight size={16} /></button>{cooldownSeconds > 0 ? <span className="inline-flex items-center gap-2 text-xs text-[#d9bb8f]" data-testid="status-faucet-cooldown"><Clock3 size={14} />{t('wallet.cooldown', remaining)}</span> : data.balance > 10 ? <span className="text-xs text-[#d9bb8f]" data-testid="status-faucet-balance">{t('wallet.balanceTooHigh')}</span> : <span className="text-xs text-[#82dcae]" data-testid="status-faucet-ready">{t('wallet.cooldownReady')}</span>}</div>
          {faucet.isError && <p className="mt-4 text-sm text-[#ff9c91]" role="alert" data-testid="alert-faucet-error">{errorPayload(faucet.error).reason === 'balance_too_high' ? t('wallet.balanceTooHigh') : t('wallet.faucetFailed')}</p>}
        </section>

        <section className="rounded-2xl border border-[#324139] bg-[#191e1b] p-6 sm:p-7" data-testid="card-wallet-receive">
          <div className="flex items-start gap-3"><ArrowDownLeft size={19} className="text-[#1DE9B6]" /><div><h2 className="font-['Syne'] text-xl">{t('wallet.receive')}</h2><p className="mt-3 text-sm leading-6 text-[#99ada0]">{t('wallet.receiveDescription')}</p></div></div>
          <div className="mt-6 flex items-center gap-2 rounded-xl border border-[#34483b] bg-[#111613] p-3"><p className="min-w-0 flex-1 break-all font-mono text-xs leading-5 text-[#d1e4d6]" data-testid="text-testnet-address">{data.address}</p><button onClick={copyAddress} className="shrink-0 rounded-lg bg-[#21412d] p-2.5 text-[#8ff0c9] hover:bg-[#2a5639]" aria-label={t('wallet.copyAddress')} data-testid="button-copy-wallet-address">{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
          {copied && <p className="mt-2 text-xs text-[#8ff0c9]" data-testid="status-address-copied">{t('wallet.addressCopied')}</p>}
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[.85fr_1.15fr]">
        <section className="rounded-2xl border border-[#324139] bg-[#191e1b] p-6 sm:p-7" data-testid="card-wallet-send">
          <div className="flex items-start gap-3"><Send size={19} className="text-[#1DE9B6]" /><div><h2 className="font-['Syne'] text-xl">{t('wallet.send')}</h2><p className="mt-3 text-sm leading-6 text-[#99ada0]">{t('wallet.sendDescription')}</p></div></div>
          <div className="mt-6 space-y-4">
            <label className="block text-xs text-[#a8b9ad]">{t('wallet.recipient')}<input value={recipient} onChange={(event) => setRecipient(event.target.value)} className="mt-2 w-full rounded-lg border border-[#35483b] bg-[#111613] px-3.5 py-3 text-sm text-[#eff9f0] outline-none focus:border-[#1DE9B6]" data-testid="input-wallet-recipient" /></label>
            <label className="block text-xs text-[#a8b9ad]">{t('wallet.amount')}<div className="mt-2 flex items-center rounded-lg border border-[#35483b] bg-[#111613] focus-within:border-[#1DE9B6]"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-sm text-[#eff9f0] outline-none" data-testid="input-wallet-amount" /><span className="px-3 font-mono text-xs text-[#6f9a80]">Test-Pi</span></div></label>
            {transferError && <p className="text-xs leading-5 text-[#ff9c91]" role="alert" data-testid="alert-wallet-transfer">{transferError}</p>}
            <button onClick={handleTransfer} disabled={transfer.isPending} className="inline-flex items-center gap-2 rounded-lg border border-[#44825a] px-5 py-3 text-sm font-semibold text-[#a9f4c9] hover:bg-[#163624] disabled:cursor-not-allowed disabled:opacity-45" data-testid="button-send-wallet">{transfer.isPending ? t('wallet.sending') : t('wallet.transfer')}<ArrowUpRight size={15} /></button>
          </div>
        </section>

        <section className="rounded-2xl border border-[#324139] bg-[#191e1b] p-6 sm:p-7" data-testid="card-wallet-history">
          <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><Landmark size={19} className="text-[#1DE9B6]" /><h2 className="font-['Syne'] text-xl">{t('wallet.transactionHistory')}</h2></div><span className="font-mono text-xs text-[#668b76]">{data.transactions.length.toString().padStart(2, '0')}</span></div>
          {data.transactions.length === 0 ? <div className="mt-8 rounded-xl border border-dashed border-[#3b5142] p-8 text-center"><ShieldCheck size={22} className="mx-auto text-[#4f8264]" /><p className="mt-3 text-sm text-[#91a798]" data-testid="empty-wallet-transactions">{t('wallet.noTransactions')}</p></div> : <div className="mt-6 divide-y divide-[#29392f]">{data.transactions.map((transaction) => <div key={transaction.id} className="flex items-center gap-3 py-4 first:pt-0 last:pb-0" data-testid={`row-wallet-transaction-${transaction.id}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${transaction.direction === 'credit' ? 'bg-[#163b29] text-[#68dda2]' : 'bg-[#35251d] text-[#e8ad82]'}`}>{transaction.direction === 'credit' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm text-[#deebe1]">{transactionLabel(transaction, t)}</p><p className="mt-1 truncate text-[11px] text-[#708979]">{transactionTime(transaction.createdAt)}{transaction.counterpartyAddress ? ` · ${transaction.counterpartyAddress}` : ''}</p></div><div className="text-end"><p className={`font-mono text-sm ${transaction.direction === 'credit' ? 'text-[#76e5ab]' : 'text-[#e5b08b]'}`}>{transaction.direction === 'credit' ? '+' : '-'}{formatAmount(transaction.amount)}</p><p className="mt-1 text-[10px] text-[#6f8979]">{t(`status.${transaction.status === 'completed' ? 'completedShort' : 'pending'}` as 'status.completedShort')}</p></div></div>)}</div>}
        </section>
      </div>
    </div>
  );
}