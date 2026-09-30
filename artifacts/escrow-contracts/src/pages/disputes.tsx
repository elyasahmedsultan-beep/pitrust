import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Gavel, ShieldAlert } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { getGetContractQueryKey, getListDisputesQueryKey, getListActivityQueryKey, useCreateDispute, useCreateDisputeFeeIntent, useGetContract, useListDisputes } from '@workspace/api-client-react';
import { useI18n } from '@/i18n';
import { usePiPayment } from '@/hooks/use-pi-payment';

const empty={reason:'',description:'',requestedResolution:''};
export default function Disputes(){
  const {t}=useI18n();const {id=''}=useParams<{id:string}>();const qc=useQueryClient();
  const contract=useGetContract(id,{query:{enabled:!!id,queryKey:getGetContractQueryKey(id)}});
  const disputes=useListDisputes(id,{query:{enabled:!!id,queryKey:getListDisputesQueryKey(id)}});
   const create=useCreateDispute();const fee=useCreateDisputeFeeIntent();
   const [open,setOpen]=useState(false);const [form,setForm]=useState(empty);const [error,setError]=useState('');
  const pending=useRef<typeof empty|null>(null);
  const refresh=()=>{qc.invalidateQueries({queryKey:getListDisputesQueryKey(id)});qc.invalidateQueries({queryKey:getGetContractQueryKey(id)});qc.invalidateQueries({queryKey:getListActivityQueryKey()})};
  const pi=usePiPayment(()=>{
    if(!pending.current)return;
    const submitted=pending.current;
    create.mutate({id,data:submitted},{onSuccess:()=>{pending.current=null;refresh();setForm(empty);setOpen(false)},onError:()=>setError(t('errors.generic'))});
  });
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(!form.reason.trim()||!form.description.trim()||!form.requestedResolution.trim()){setError(t('errors.required'));return}
    if(pi.state!=='ready'){setError(t('escrow.piPaymentFailed'));return}setError('');
    try{const intent=await fee.mutateAsync({id});if(intent.contractId!==id||intent.metadata.contractId!==id||intent.metadata.feeType!=='dispute')throw new Error('Invalid intent');pending.current={...form};await pi.pay(intent)}
    catch(error){pending.current=null;setError(error instanceof Error?error.message:t('escrow.piPaymentFailed'))}
  };
  if(contract.isLoading||disputes.isLoading)return <div className="mx-auto max-w-4xl space-y-5"><div className="skeleton h-10 w-2/3 rounded"/><div className="skeleton h-72 rounded-xl"/></div>;
  if(contract.isError||disputes.isError||!contract.data)return <div className="mx-auto max-w-4xl rounded-xl border border-[#62413c] p-8">{t('errors.network')} <button onClick={()=>{contract.refetch();disputes.refetch()}} className="ms-3 text-[#1DE9B6]" data-testid="button-retry-disputes">{t('common.retry')}</button></div>;
  const items=disputes.data??[];
  return <div className="mx-auto max-w-4xl animate-rise-in"><Link href={`/contracts/${id}`} className="flex items-center gap-2 text-xs text-[#92a596]" data-testid="link-back-from-disputes"><ArrowLeft size={15}/>{t('common.back')}</Link><div className="mt-8 flex flex-wrap items-end justify-between gap-5"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#1DE9B6]">{contract.data.reference}</p><h1 className="mt-3 font-['Syne'] text-4xl">{t('disputes.title')}<span className="text-[#00C853]">.</span></h1><p className="mt-3 text-sm text-[#9aaf9e]">{contract.data.title}</p></div><button onClick={()=>setOpen(!open)} className="rounded-lg bg-[#00C853] px-5 py-3 text-sm font-semibold text-[#08160c]" data-testid="button-toggle-dispute">{open?t('common.close'):t('disputes.openDispute')}</button></div>
  {open&&<form onSubmit={submit} className="mt-7 rounded-xl border border-[#2e5438] bg-[#17241b] p-6"><div className="flex items-center gap-3"><ShieldAlert size={19} className="text-[#1DE9B6]"/><h2 className="font-['Syne'] text-xl">{t('disputes.openDispute')}</h2></div><div className="mt-6 space-y-4">{([['reason','disputes.disputeReason'],['description','disputes.describeIssue'],['requestedResolution','disputes.proposeResolution']] as const).map(([key,label])=><label key={key} className="block text-xs text-[#aabbab]">{t(label)}<textarea required value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} className="mt-2 min-h-16 w-full rounded-lg border border-[#3b4c3f] bg-[#111513] p-3 text-sm" data-testid={`input-dispute-${key}`}/></label>)}</div><p className="mt-4 text-xs text-[#aebcab]">{t('disputes.feeNotice')}</p><button disabled={fee.isPending||pi.state!=='ready'||create.isPending} className="mt-5 rounded-lg bg-[#00C853] px-5 py-3 text-sm font-semibold text-[#08160c] disabled:opacity-40" data-testid="button-submit-dispute">{fee.isPending||pi.state==='paying'?t('common.loading'):t('disputes.submitDispute')}</button>{pi.state==='unavailable'&&<p className="mt-3 text-xs text-[#e4ae91]">{t('common.notAvailable')}: Pi SDK / identity</p>}{(error||pi.error||create.isError)&&<p className="mt-3 text-sm text-[#ff9c90]" role="alert">{error||pi.error||t('errors.generic')}</p>}</form>}
   {!items.length?<div className="mt-8 rounded-xl border border-dashed border-[#405444] p-14 text-center"><Gavel className="mx-auto text-[#1DE9B6]"/><h2 className="mt-4 text-sm">{t('disputes.noDisputes')}</h2></div>:<div className="mt-8 space-y-4">{items.map(item=><article key={item.id} className="rounded-xl border border-[#344538] bg-[#1A1A1A] p-6" data-testid={`dispute-${item.id}`}><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">{item.reason}</h2><span className="font-mono text-xs uppercase text-[#1DE9B6]">{item.status==='resolved'?t('status.resolved'):t('status.underReview')}</span></div><p className="mt-4 text-sm text-[#9aaf9f]">{item.description}</p><div className="mt-5 border-t border-[#334439] pt-4 text-xs"><p>{t('disputes.proposeResolution')}: {item.requestedResolution}</p><p className="mt-3 text-[#a1b4a2]">{t('disputes.resolution')}: {item.resolution||t('status.underReview')}</p></div></article>)}</div>}</div>;
}