import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Pencil, UserRound, WalletCards, X } from 'lucide-react';
import { getGetProfileQueryKey, getGetTestnetWalletQueryKey, useGetProfile, useGetReferralSummary, useGetTestnetWallet, useUpdateProfile } from '@workspace/api-client-react';
import { IdentityLinkingPanel } from '@/components/identity-linking-panel';
import MonthlyBadge from '@/components/monthly-badge';
import { useI18n } from '@/i18n';
import { useToast } from '@/hooks/use-toast';
import { usePiAppSession } from '@/lib/pi-app-session';
import { usePiIframeSession } from '@/lib/pi-iframe-session';
import { isPiBrowserRuntime, PI_SANDBOX } from '@/lib/pi-sdk';

function IdentityLinkingEntry({ onEnableClerk }: { onEnableClerk?: () => void }) {
  const { signedIn: piSignedIn } = usePiAppSession();
  const { session: piIframeSession } = usePiIframeSession();
  if (
    onEnableClerk ||
    isPiBrowserRuntime() ||
    piSignedIn ||
    Boolean(piIframeSession)
  ) return null;
  return <IdentityLinkingPanel />;
}

function TestnetWalletProfileCard() {
  const { t } = useI18n();
  const wallet = useGetTestnetWallet({ query: { queryKey: getGetTestnetWalletQueryKey(), enabled: PI_SANDBOX } });
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!wallet.data?.address) return;
    try {
      await navigator.clipboard.writeText(wallet.data.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  if (!PI_SANDBOX) return null;
  return <section className="rounded-xl border border-[#2f5c45] bg-[#14251b] p-6" data-testid="card-profile-testnet-wallet">
    <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#1a4730] text-[#8ff0c9]"><WalletCards size={19} /></span><div><h2 className="font-['Syne'] text-lg">{t('profile.testnetWalletAddress')}</h2><p className="mt-1 text-xs text-[#91b29e]">{t('profile.testnetWalletAddressNote')}</p></div></div>
    {wallet.isLoading ? <div className="skeleton mt-5 h-12 rounded-lg" /> : wallet.isError || !wallet.data ? <p className="mt-5 text-xs text-[#ff9c91]">{t('errors.network')}</p> : <div className="mt-5 flex items-center gap-2 rounded-lg border border-[#385743] bg-[#101713] p-3"><p className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-[#d1e4d6]" data-testid="text-profile-testnet-address">{wallet.data.address}</p><button onClick={copy} className="shrink-0 rounded-md bg-[#21412d] p-2 text-[#8ff0c9]" aria-label={t('wallet.copyAddress')} data-testid="button-copy-profile-testnet-address">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>}
    {copied && <p className="mt-2 text-xs text-[#8ff0c9]">{t('wallet.addressCopied')}</p>}
  </section>;
}

export default function ProfilePage({ onEnableClerk }: { onEnableClerk?: () => void } = {}){
 const {t}=useI18n();const qc=useQueryClient();const {toast}=useToast();
 const [isEditing,setIsEditing]=useState(false);
 const profile=useGetProfile({query:{
  queryKey:getGetProfileQueryKey(),
  enabled:!isEditing,
  refetchInterval:isEditing?false:undefined,
  refetchOnMount:isEditing?false:undefined,
  refetchOnWindowFocus:isEditing?false:undefined,
  refetchOnReconnect:isEditing?false:undefined,
 }});
 const referral=useGetReferralSummary();const update=useUpdateProfile();
 const [form,setForm]=useState({displayName:'',bio:'',walletAddress:''});
 const initialized=useRef<string|null>(null);
 const [copied,setCopied]=useState<'code'|'link'|null>(null);
 useEffect(()=>{if(!isEditing&&profile.data&&initialized.current!==profile.data.userId){initialized.current=profile.data.userId;setForm({displayName:profile.data.displayName,bio:profile.data.bio,walletAddress:profile.data.walletAddress??''})}},[profile.data,isEditing]);
 const code=referral.data?.referralCode??profile.data?.referralCode;
 const link=code?`${window.location.origin}${import.meta.env.BASE_URL}sign-up?ref=${encodeURIComponent(code)}`:'';
 const walletValue=form.walletAddress.trim();
 const walletShapeInvalid=Boolean(walletValue&&(walletValue.length!==56||!walletValue.startsWith('G')));
 const serverWalletRejected=update.isError&&walletValue&&typeof update.error==='object'&&update.error!==null&&'status'in update.error&&(update.error as {status?:number}).status===400;
 const copyValue=async(value:string,kind:'code'|'link')=>{try{await navigator.clipboard.writeText(value);setCopied(kind);window.setTimeout(()=>setCopied(current=>current===kind?null:current),1800)}catch{setCopied(null)}};
   const beginEdit=()=>{update.reset();void qc.cancelQueries({queryKey:getGetProfileQueryKey()});if(profile.data)setForm({displayName:profile.data.displayName,bio:profile.data.bio,walletAddress:profile.data.walletAddress??''});setIsEditing(true)};
  const save=()=>{const displayName=form.displayName.trim();if(!displayName||walletShapeInvalid)return;update.mutate({data:{displayName,bio:form.bio,...(walletValue?{walletAddress:walletValue}:{})}},{onSuccess:(saved)=>{setForm({displayName:saved.displayName,bio:saved.bio,walletAddress:saved.walletAddress??''});setIsEditing(false);void qc.invalidateQueries({queryKey:getGetProfileQueryKey()});toast({description:t('profile.savedSuccess')})}})};
 const cancelEdit=()=>{if(profile.data)setForm({displayName:profile.data.displayName,bio:profile.data.bio,walletAddress:profile.data.walletAddress??''});update.reset();setIsEditing(false)};
 return <div className="animate-rise-in">
  <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#1DE9B6]">PITRUST / {t('navigation.profile')}</p><h1 className="mt-3 font-['Syne'] text-4xl">{t('profile.title')}<span className="text-[#00C853]">.</span></h1>
     {profile.isLoading&&!profile.data?<div className="skeleton mt-8 h-72 rounded-xl"/>:profile.isError&&!profile.data?<div className="mt-8 grid gap-5 lg:grid-cols-2"><div className="h-fit rounded-xl border border-[#523b37] p-6">{t('errors.network')} <button onClick={()=>profile.refetch()} data-testid="button-retry-profile" className="ms-3 text-[#1DE9B6]">{t('common.retry')}</button></div><IdentityLinkingEntry onEnableClerk={onEnableClerk}/></div>:<div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
     <form data-testid="form-profile" onSubmit={event=>event.preventDefault()} className="h-fit rounded-xl border border-[#324037] bg-[#1A1A1A] p-6 sm:p-8"><div className="flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-xl bg-[#193629] text-[#1DE9B6]"><UserRound size={26}/></div><div className="min-w-0"><h2 className="font-['Syne'] text-xl">{profile.data?.displayName}</h2><p className="truncate font-mono text-xs text-[#849a8b]">{t('profile.accountCode')}: {code??'—'}</p></div></div>
     <div className="mt-8 space-y-5">{([['displayName',t('profile.fullName')],['bio',t('profile.bio')],['walletAddress',t('profile.piWalletAddress')]] as const).map(([key,label])=><label key={key} className="block text-xs text-[#a9b9ab]">{label}<input disabled={!isEditing} required={key==='displayName'} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} className="mt-2 w-full rounded-lg border border-[#35483b] bg-[#111513] px-4 py-3 text-sm text-[#f2f5f3] disabled:cursor-not-allowed disabled:opacity-75" data-testid={`input-profile-${key}`}/>{key==='walletAddress'&&<><span className="mt-2 block leading-5 text-[#87998c]">{t('profile.walletAddressHelp')}</span>{isEditing&&walletShapeInvalid&&<span className="mt-2 block text-xs text-[#ff9b8e]" role="alert" data-testid="error-profile-wallet-address">{t('profile.walletAddressInvalid')}</span>}</>}</label>)}</div>{update.isError&&<p className="mt-4 text-sm text-[#ff9b8e]" role="alert">{serverWalletRejected?t('profile.walletAddressInvalid'):t('errors.saveChanges')}</p>}
      <div className="mt-7 flex flex-wrap gap-3">{isEditing?<><button type="button" onClick={save} disabled={update.isPending||walletShapeInvalid} className="rounded-lg bg-[#00C853] px-6 py-3 text-sm font-bold text-[#08150d] disabled:opacity-50" data-testid="button-save-profile">{update.isPending?t('common.loading'):t('common.save')}</button><button type="button" onClick={cancelEdit} disabled={update.isPending} className="inline-flex items-center gap-2 rounded-lg border border-[#44564a] px-5 py-3 text-sm text-[#bdcbbf] disabled:opacity-50" data-testid="button-cancel-profile-edit"><X size={15}/>{t('profile.cancelEdit')}</button></>:<button type="button" onClick={beginEdit} className="inline-flex items-center gap-2 rounded-lg bg-[#21412d] px-5 py-3 text-sm font-semibold text-[#baf2cf]" data-testid="button-edit-profile"><Pencil size={15}/>{t('profile.editDetails')}</button>}</div>
   </form>
       <div className="space-y-5"><IdentityLinkingEntry onEnableClerk={onEnableClerk}/><TestnetWalletProfileCard/><MonthlyBadge/><section className="rounded-xl border border-[#324037] bg-[#1A1A1A] p-6"><h2 className="font-['Syne'] text-xl">{t('profile.referralProgram')}</h2><p className="mt-2 text-sm text-[#9ba99e]">{t('profile.referralDescription')}</p>{referral.isError?<p className="mt-4 text-sm text-[#ff9b8e]">{t('errors.network')} <button onClick={()=>referral.refetch()} data-testid="button-retry-referral">{t('common.retry')}</button></p>:<><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-lg bg-[#12231a] p-4"><p className="text-xs text-[#99a99d]">{t('profile.referrals')}</p><p className="mt-2 font-mono text-2xl">{referral.data?.invitedUsers??'—'}</p></div><div className="rounded-lg bg-[#12231a] p-4"><p className="text-xs text-[#99a99d]">{t('dashboard.fundsInEscrow')}</p><p className="mt-2 font-mono text-2xl">{referral.data?.referralBalance?.toLocaleString()??'—'}</p></div></div>{code&&<div className="mt-5 flex items-center gap-2 rounded-lg border border-[#34483a] bg-[#111513] p-3"><div className="min-w-0 flex-1"><p className="text-[10px] uppercase tracking-wider text-[#84998a]">{t('profile.accountCode')}</p><p className="mt-1 font-mono text-sm text-[#d9e8dc]" data-testid="text-referral-code">{code}</p></div><button onClick={()=>void copyValue(code,'code')} aria-label={t('profile.copyAccountCode')} data-testid="button-copy-referral-code" className="rounded-lg bg-[#21412a] p-3 text-[#1DE9B6]">{copied==='code'?<Check size={16}/>:<Copy size={16}/>}</button></div>}{link&&<div className="mt-3 flex items-center gap-2"><input readOnly value={link} className="min-w-0 flex-1 rounded-lg border border-[#34483a] bg-[#111513] p-3 text-xs" data-testid="input-referral-link"/><button onClick={()=>void copyValue(link,'link')} aria-label={t('common.copy')} data-testid="button-copy-referral" className="rounded-lg bg-[#21412a] p-3 text-[#1DE9B6]">{copied==='link'?<Check size={16}/>:<Copy size={16}/>}</button></div>}{copied&&<p className="mt-2 text-xs text-[#1DE9B6]" role="status">{copied==='code'?t('profile.accountCodeCopied'):t('profile.referralCopied')}</p>}</>}</section></div>
  </div>}
 </div>;
}