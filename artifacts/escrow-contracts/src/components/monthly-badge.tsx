import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Award, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { getGetMonthlyBadgeStatusQueryKey, useCreateMonthlyBadgePaymentIntent, useGetMonthlyBadgeStatus } from '@workspace/api-client-react';
import { usePiPayment } from '@/hooks/use-pi-payment';
import { useI18n } from '@/i18n';

export default function MonthlyBadge(){
 const {t}=useI18n();const qc=useQueryClient();
 const badge=useGetMonthlyBadgeStatus({query:{queryKey:getGetMonthlyBadgeStatusQueryKey(),refetchInterval:10000}});
 const intent=useCreateMonthlyBadgePaymentIntent();
 const pi=usePiPayment(()=>{void qc.invalidateQueries({queryKey:getGetMonthlyBadgeStatusQueryKey()})});
 const [error,setError]=useState('');
 const verified=badge.data?.confirmed===true&&badge.data.status==='confirmed';
 const unavailable=badge.data?.status==='manual_reconciliation';
 const pay=async()=>{
   if(pi.state!=='ready'||verified||unavailable||badge.data?.status!==null)return;
   setError('');
   try{
     const issued=await intent.mutateAsync();
     if(issued.amount!==2||!issued.intentId||issued.metadata.badgeAuditId!==issued.intentId||issued.metadata.billingMonth!==badge.data?.billingMonth)throw new Error('Invalid monthly badge intent');
     void qc.invalidateQueries({queryKey:getGetMonthlyBadgeStatusQueryKey()});
     await pi.pay(issued);
   }catch{setError(t('escrow.piPaymentFailed'));void qc.invalidateQueries({queryKey:getGetMonthlyBadgeStatusQueryKey()})}
 };
 return <section className="rounded-xl border border-[#324037] bg-[#1A1A1A] p-6" data-testid="section-monthly-badge">
   <div className="flex items-start justify-between gap-4"><div className={`grid h-11 w-11 place-items-center rounded-xl ${verified?'bg-[#21482d] text-[#1DE9B6]':'bg-[#263027] text-[#779789]'}`}><Award size={23}/></div>{badge.data&&<span className="rounded-full border border-[#31503c] px-3 py-1 font-mono text-[10px] text-[#a4c4ac]">{badge.data.billingMonth.slice(0,7)}</span>}</div>
   <h2 className="mt-5 font-['Syne'] text-xl">{t('profile.badges')}</h2>
   {badge.isLoading?<div className="skeleton mt-4 h-20 rounded-lg"/>:badge.isError?<div className="mt-4 text-xs text-[#ff998e]">{t('errors.network')} <button onClick={()=>badge.refetch()} className="ms-2 text-[#1DE9B6]" data-testid="button-retry-badge">{t('common.retry')}</button></div>:<><div className="mt-3 flex items-center gap-2 text-sm"><ShieldCheck size={16} className={verified?'text-[#1DE9B6]':'text-[#7d9182]'}/><span className={verified?'text-[#1DE9B6]':'text-[#a4b3a6]'} data-testid="text-monthly-badge-status">{verified?t('profile.verified'):unavailable?t('status.underReview'):badge.data?.status==='pending'?t('status.pending'):t('profile.noBadges')}</span></div>
     {badge.data?.status===null&&<><p className="mt-4 text-xs leading-relaxed text-[#9daf9f]">{t('profile.badges')} · 2 PI · {t('escrow.payWithPi')}</p><button onClick={pay} disabled={pi.state!=='ready'||intent.isPending} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#3d6746] px-4 py-2.5 text-sm font-semibold text-[#1DE9B6] disabled:cursor-not-allowed disabled:opacity-40" data-testid="button-pay-monthly-badge">{intent.isPending||pi.state==='paying'?t('common.loading'):t('escrow.payWithPi')} <ArrowUpRight size={15}/></button></>}
     {pi.state==='unavailable'&&!verified&&<p className="mt-3 text-xs text-[#d9b697]">{t('common.notAvailable')}: Pi</p>}{(error||pi.error||intent.isError)&&<p className="mt-3 text-xs text-[#ff998e]" role="alert">{error||pi.error||t('errors.network')}</p>}</>}
 </section>;
}