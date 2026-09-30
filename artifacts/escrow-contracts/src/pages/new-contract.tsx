import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, FileText, Globe2, Package, ShieldCheck, Store } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useCreateListing, useCreateListingAdPaymentIntent, getSearchListingsQueryKey, getGetMarketStatsQueryKey, getGetListingAdFeeQueryKey, useGetListingAdFee, type ListingInputPipeline } from '@workspace/api-client-react';
import { useI18n, type TranslationKey } from '@/i18n';
import { usePiPayment } from '@/hooks/use-pi-payment';

const pipelineOptions:{value:ListingInputPipeline;key:TranslationKey;description:TranslationKey;icon:typeof FileText}[]=[
 {value:'digital',key:'contractWizard.digital',description:'contractWizard.digitalDescription',icon:FileText},
 {value:'shippable',key:'contractWizard.shippable',description:'contractWizard.shippableDescription',icon:Package},
 {value:'local_property',key:'contractWizard.localProperty',description:'contractWizard.localPropertyDescription',icon:Globe2},
 {value:'custom_terms',key:'contractWizard.customTerms',description:'contractWizard.customTermsDescription',icon:ShieldCheck},
];
const specific:Record<ListingInputPipeline,{key:string;label:TranslationKey}[]>={
 digital:[{key:'scopeOfWork',label:'contractWizard.scopeOfWork'},{key:'deliverables',label:'contractWizard.deliverables'},{key:'fileFormat',label:'contractWizard.fileFormat'},{key:'licenseTerms',label:'contractWizard.licenseTerms'}],
 shippable:[{key:'itemDescription',label:'contractWizard.itemDescription'},{key:'itemCondition',label:'contractWizard.itemCondition'},{key:'shippingAddress',label:'contractWizard.shippingAddress'},{key:'shippingMethod',label:'contractWizard.shippingMethod'}],
 local_property:[{key:'serviceAddress',label:'contractWizard.serviceAddress'},{key:'appointmentDate',label:'contractWizard.appointmentDate'},{key:'serviceDescription',label:'contractWizard.serviceDescription'},{key:'permitOrReference',label:'contractWizard.permitOrReference'}],
 custom_terms:[{key:'customTerms',label:'contractWizard.customTermsLabel'},{key:'milestones',label:'contractWizard.milestones'},{key:'termsAndConditions',label:'contractWizard.termsAndConditions'}],
};

export default function NewContract(){
  const {t}=useI18n();const qc=useQueryClient();const [,navigate]=useLocation();const create=useCreateListing();const createPaymentIntent=useCreateListingAdPaymentIntent();const listingFee=useGetListingAdFee({query:{queryKey:getGetListingAdFeeQueryKey(),retry:false}});const pi=usePiPayment();
 const [step,setStep]=useState(0);const [pipeline,setPipeline]=useState<ListingInputPipeline>('digital');
  const [form,setForm]=useState({title:'',description:'',amount:''});const [feeReview,setFeeReview]=useState<number|null>(null);const [draftListingId,setDraftListingId]=useState<string|null>(null);
 const [metadata,setMetadata]=useState<Record<string,string>>({});const [error,setError]=useState('');
  const submit=async(e:FormEvent)=>{
   e.preventDefault();setError('');
    if(step===1&&(!form.title.trim()||!form.description.trim()||!Number.isFinite(Number(form.amount))||Number(form.amount)<=0)){setError(t('errors.required'));return}
    if(step===1&&!listingFee.data){setError(t('contractWizard.adPublicationFeeUnavailable'));return}
    if(step===3&&!listingFee.data&&!feeReview){setError(t('contractWizard.adPublicationFeeUnavailable'));return}
   if(step<3){setStep(step+1);return}
    try{
      let listingId=draftListingId;
      if(!listingId){
        const listing=await create.mutateAsync({data:{title:form.title.trim(),description:form.description.trim(),amount:Number(form.amount),currency:'PI',pipeline,metadata:Object.fromEntries(Object.entries(metadata).map(([key,value])=>[key,value.trim()]).filter(([,value])=>value))}});
        listingId=listing.id;setDraftListingId(listingId);
      }
      const paymentIntent=await createPaymentIntent.mutateAsync({id:listingId});
      if(paymentIntent.listingId!==listingId||paymentIntent.metadata.type!=='listing_ad'||paymentIntent.metadata.listingId!==listingId||!paymentIntent.metadata.intentId)throw new Error('Unexpected listing publication payment intent');
      const displayedFee=feeReview??listingFee.data?.listingAdFeePi;
      if(displayedFee===undefined)throw new Error('Listing publication fee is unavailable');
      if(paymentIntent.amount!==displayedFee){setFeeReview(paymentIntent.amount);setError(t('contractWizard.adPublicationFeeChanged'));void listingFee.refetch();return}
      setFeeReview(paymentIntent.amount);
      await pi.pay(paymentIntent);
     void qc.invalidateQueries({queryKey:getSearchListingsQueryKey()});
     void qc.invalidateQueries({queryKey:getGetMarketStatsQueryKey()});
     navigate('/marketplace');
    }catch(error){setError(error instanceof Error?error.message:t('errors.generic'))}
 };
 return <div className="mx-auto max-w-5xl animate-rise-in">
  <Link href="/marketplace" className="inline-flex items-center gap-2 text-xs text-[#9bae9e]" data-testid="link-back-dashboard"><ArrowLeft size={15}/>{t('landing.browseMarketplace')}</Link>
  <div className="mt-8 flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.22em] text-[#1DE9B6]">{t('marketplace.seller')} / {t('marketplace.listing')}</p><h1 className="mt-3 font-['Syne'] text-4xl sm:text-5xl">{t('common.submit')} {t('marketplace.listing')}<span className="text-[#00C853]">.</span></h1><p className="mt-3 max-w-xl text-sm text-[#a0b0a2]">{t('marketplace.subtitle')}</p><Link href="/marketplace" className="mt-4 inline-flex items-center gap-2 text-sm text-[#1DE9B6]"><Store size={15}/>{t('landing.browseMarketplace')} <ArrowRight size={14}/></Link></div><p className="font-mono text-xs text-[#1DE9B6]">{t('contractWizard.stepOf',{current:step+1,total:4})}</p></div>
  <div className="mt-8 flex gap-2">{[0,1,2,3].map(i=><div key={i} className={`h-1 flex-1 rounded-full ${i<=step?'bg-[#00C853]':'bg-[#34463a]'}`}/>)}</div>
  <form onSubmit={submit} className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_270px]"><div className="rounded-xl border border-[#344238] bg-[#1A1A1A] p-6 sm:p-8"><h2 className="font-['Syne'] text-2xl">{step===0?t('contractWizard.choosePipeline'):step===1?t('marketplace.listingTitle'):step===2?t(pipelineOptions.find(p=>p.value===pipeline)!.key):t('contractWizard.termsAndConditions')}</h2><p className="mt-2 text-sm text-[#9cad9d]">{step===0?t('contractWizard.pipelineDescription'):t('contractWizard.detailsVisibleToParties')}</p>
  {step===0&&<div className="mt-7 grid gap-3 sm:grid-cols-2">{pipelineOptions.map(({value,key,description,icon:Icon})=><button type="button" onClick={()=>setPipeline(value)} key={value} className={`rounded-xl border p-5 text-start transition-colors ${pipeline===value?'border-[#00C853] bg-[#173021]':'border-[#344439] bg-[#111613] hover:border-[#54705a]'}`} data-testid={`button-pipeline-${value}`}><Icon size={22} className="text-[#1DE9B6]"/><strong className="mt-5 block text-sm">{t(key)}</strong><p className="mt-2 text-xs leading-relaxed text-[#94a99a]">{t(description)}</p></button>)}</div>}
  {step===1&&<div className="mt-7 grid gap-5 sm:grid-cols-2"><label className="block text-xs text-[#a8bbaa]">{t('marketplace.listingTitle')}<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})} className="mt-2 w-full rounded-lg border border-[#37463b] bg-[#111513] px-4 py-3 text-sm" data-testid="input-contract-title"/></label><label className="block text-xs text-[#a8bbaa]">{t('contractWizard.amount')} · PI<input required type="number" min="0.00000001" step="0.00000001" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} className="mt-2 w-full rounded-lg border border-[#37463b] bg-[#111513] px-4 py-3 text-sm" data-testid="input-contract-amount"/></label><div className="block text-xs text-[#a8bbaa]" data-testid="listing-ad-fee"><span>{t('contractWizard.adPublicationFee')}</span><p className="mt-2 rounded-lg border border-[#37463b] bg-[#111513] px-4 py-3 text-sm font-mono text-[#1DE9B6]">{feeReview??listingFee.data?.listingAdFeePi??t('common.loading')}{listingFee.data||feeReview?' Pi':''}</p><span className="mt-2 block text-[11px] leading-relaxed text-[#8fa397]">{listingFee.isError?<><span>{t('contractWizard.adPublicationFeeUnavailable')} </span><button type="button" onClick={()=>void listingFee.refetch()} className="text-[#1DE9B6] underline">{t('common.retry')}</button></>:t('contractWizard.adPublicationFeeHelp')}</span></div><label className="block text-xs text-[#a8bbaa] sm:col-span-2">{t('marketplace.description')}<textarea required value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="mt-2 min-h-28 w-full rounded-lg border border-[#37463b] bg-[#111513] px-4 py-3 text-sm" data-testid="input-listing-description"/></label></div>}
  {step===2&&<div className="mt-7 grid gap-5 sm:grid-cols-2">{specific[pipeline].map(({key,label})=><label key={key} className="block text-xs text-[#a8bbaa]">{t(label)}<textarea value={metadata[key]??''} onChange={e=>setMetadata({...metadata,[key]:e.target.value})} className="mt-2 min-h-24 w-full rounded-lg border border-[#37463b] bg-[#111513] px-4 py-3 text-sm text-[#f2f5f3] outline-none focus:border-[#00C853]" data-testid={`input-pipeline-${key}`}/></label>)}</div>}
  {step===3&&<div className="mt-7 space-y-4 rounded-xl border border-[#314539] bg-[#111813] p-6 text-sm"><p><span className="text-[#8ba393]">{t('marketplace.listingTitle')} / </span>{form.title}</p><p><span className="text-[#8ba393]">{t('contractWizard.amount')} / </span>{form.amount} PI</p><p><span className="text-[#8ba393]">{t('contractWizard.adPublicationFee')} / </span>{feeReview??listingFee.data?.listingAdFeePi??'—'} PI</p><p><span className="text-[#8ba393]">{t('contractWizard.choosePipeline')} / </span>{t(pipelineOptions.find(p=>p.value===pipeline)!.key)}</p><p className="border-t border-[#314539] pt-4 text-[#9db3a3]">{t('marketplace.description')} / {form.description}</p><p className="text-[#1DE9B6]">{t('landing.browseMarketplace')} → {t('navigation.createContract')}</p></div>}
  {(error||(step===3&&pi.error))&&<p className="mt-5 text-sm text-[#ff9e91]" role="alert" data-testid="state-contract-error">{error||pi.error}</p>}{step===3&&pi.state==='unavailable'&&<p className="mt-3 text-xs text-[#ff9e91]" role="status">{t('common.notAvailable')}</p>}<div className="mt-9 flex justify-between border-t border-[#334438] pt-6"><button type="button" onClick={()=>setStep(Math.max(0,step-1))} disabled={step===0||create.isPending||createPaymentIntent.isPending||pi.state==='paying'} className="px-3 text-sm text-[#a7baa9] disabled:opacity-30" data-testid="button-wizard-previous">{t('common.previous')}</button><button type="submit" disabled={create.isPending||createPaymentIntent.isPending||pi.state==='paying'||(step===1&&(!listingFee.data||listingFee.isError))||(step===3&&((!listingFee.data&&!feeReview)||listingFee.isError&&!feeReview||pi.state!=='ready'))} className="flex items-center gap-2 rounded-lg bg-[#00C853] px-5 py-3 text-sm font-bold text-[#07150b] disabled:opacity-50" data-testid="button-wizard-next">{create.isPending||createPaymentIntent.isPending||pi.state==='paying'?t('common.loading'):step===3?`${t('common.submit')} ${t('marketplace.listing')}`:t('common.continue')}{step===3?<Check size={16}/>:<ArrowRight size={16}/>}</button></div></div>
  <aside className="h-fit rounded-xl border border-[#2e5038] bg-[#14241a] p-6"><Store className="text-[#1DE9B6]"/><h2 className="mt-5 font-semibold">{t('marketplace.listing')}</h2><p className="mt-3 text-xs leading-relaxed text-[#a5b8a7]">{t('marketplace.subtitle')}</p><div className="my-5 border-t border-[#375344]"/><p className="text-xs leading-relaxed text-[#a5b8a7]">{t('landing.stepOneDescription')}</p><Link href="/marketplace" className="mt-6 inline-flex items-center gap-2 text-xs text-[#1DE9B6]">{t('landing.browseMarketplace')}<ArrowRight size={14}/></Link></aside></form>
 </div>;
}