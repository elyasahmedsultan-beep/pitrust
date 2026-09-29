import type { ContractStatus, DisputeStatus } from '@workspace/api-client-react';

export const statusMeta: Record<string, { label: string; tone: string; dot: string }> = {
  draft: { label: 'Draft', tone: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  awaiting_funding: { label: 'Awaiting funds', tone: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  funded: { label: 'Funds secured', tone: 'bg-teal-50 text-teal-800 border-teal-200', dot: 'bg-teal-600' },
  in_delivery: { label: 'In delivery', tone: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-600' },
  completed: { label: 'Completed', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-600' },
  disputed: { label: 'Disputed', tone: 'bg-red-50 text-red-800 border-red-200', dot: 'bg-red-600' },
  resolved: { label: 'Resolved', tone: 'bg-indigo-50 text-indigo-800 border-indigo-200', dot: 'bg-indigo-600' },
  cancelled: { label: 'Cancelled', tone: 'bg-stone-100 text-stone-600 border-stone-200', dot: 'bg-stone-400' },
};

export const disputeMeta: Record<string, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'bg-red-50 text-red-800 border-red-200' },
  under_review: { label: 'Under review', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  resolved: { label: 'Resolved', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
};

export function formatMoney(value: number, currency = 'USD') {
  if (currency.toUpperCase() === 'PI') return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 7 }).format(value)} PI`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export function formatDate(value: string | null | undefined, withYear = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) }).format(date);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function getNextActionLabel(status: ContractStatus | string, action?: string | null) {
  if (action) return action;
  const fallback: Record<string, string> = {
    draft: 'Review contract',
    awaiting_funding: 'Fund escrow',
    funded: 'Start delivery',
    in_delivery: 'Confirm delivery',
    completed: 'Payment released',
    disputed: 'Review dispute',
    resolved: 'View resolution',
    cancelled: 'Contract cancelled',
  };
  return fallback[status] ?? 'View contract';
}

export function statusIs(value: string, expected: ContractStatus) {
  return value === expected;
}

export function disputeStatusIs(value: string, expected: DisputeStatus) {
  return value === expected;
}