import { useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, ShieldCheck } from 'lucide-react';
import { getListContractEvidenceQueryKey, getDownloadContractEvidenceQueryKey, useCreateEvidenceUploadUrl, useConfirmEvidenceUpload, useListContractEvidence, useDownloadContractEvidence, type EvidenceUploadInputCategory, type EvidenceUploadInputContentType } from '@workspace/api-client-react';
import { useI18n } from '@/i18n';

const accepted = ['application/pdf','image/avif','image/gif','image/jpeg','image/png','image/webp'] as const;
const categories: EvidenceUploadInputCategory[] = ['deliverable','receipt','deed','title'];

function EvidenceDownload({contractId,evidenceId,name}:{contractId:string;evidenceId:string;name:string}){
  const {t}=useI18n();
  const file=useDownloadContractEvidence(contractId,evidenceId,{query:{enabled:false,queryKey:getDownloadContractEvidenceQueryKey(contractId,evidenceId)}});
  const download=async()=>{const result=await file.refetch();if(!result.data)return;const url=URL.createObjectURL(result.data);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60000)};
  return <button type="button" onClick={download} disabled={file.isFetching} className="flex items-center gap-2 text-xs text-[#1DE9B6] disabled:opacity-40" data-testid={`button-download-evidence-${evidenceId}`}><Download size={15}/>{file.isFetching?t('common.loading'):t('common.copy')}{file.isError&&<span className="text-[#ff9a8d]">{t('errors.network')}</span>}</button>;
}

export default function ContractEvidence({id,canUpload=false}:{id:string;canUpload?:boolean}){
  const {t}=useI18n();const qc=useQueryClient();
  const upload=useCreateEvidenceUploadUrl();const confirm=useConfirmEvidenceUpload();
  const list=useListContractEvidence(id,{query:{queryKey:getListContractEvidenceQueryKey(id),enabled:!!id}});
  const [category,setCategory]=useState<EvidenceUploadInputCategory>('deliverable');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const onFile=async(event:ChangeEvent<HTMLInputElement>)=>{
    if(!canUpload){setError(t('errors.permissionDenied'));return}
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(file.size<1||file.size>10485760){setError(t('errors.fileTooLarge'));return}
    if(!accepted.includes(file.type as EvidenceUploadInputContentType)){setError(t('errors.unsupportedFile'));return}
    setError('');setBusy(true);
    try{
      const data={category,filename:file.name,contentType:file.type as EvidenceUploadInputContentType,sizeBytes:file.size};
      const signed=await upload.mutateAsync({id,data});
      const target=new URL(signed.uploadUrl,window.location.href);
      if(!['https:','http:'].includes(target.protocol))throw new Error('Unsupported upload URL');
      const response=await fetch(target.toString(),{method:'PUT',headers:{'Content-Type':file.type},body:file});
      if(!response.ok)throw new Error('Upload failed');
      await confirm.mutateAsync({id,data:{...data,objectKey:signed.objectKey}});
      await qc.invalidateQueries({queryKey:getListContractEvidenceQueryKey(id)});
    }catch{setError(t('errors.network'))}finally{setBusy(false)}
  };
  return <section className="rounded-xl border border-[#324139] bg-[#1A1A1A] p-6 sm:p-8"><div className="flex items-center gap-3"><FileUp className="text-[#1DE9B6]"/><h2 className="font-['Syne'] text-xl">{t('disputes.evidence')}</h2></div><p className="mt-3 text-xs text-[#9db19e]">{t('delivery.uploadFiles')} · PDF, AVIF, GIF, JPEG, PNG, WEBP · 10 MB</p><div className="mt-6 flex flex-col gap-3 sm:flex-row"><select value={category} onChange={event=>setCategory(event.target.value as EvidenceUploadInputCategory)} disabled={!canUpload} className="rounded-lg border border-[#35483b] bg-[#111513] px-3 py-3 text-sm disabled:opacity-40" data-testid="select-evidence-category">{categories.map(c=><option key={c} value={c}>{c}</option>)}</select><label className={`flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#3a6747] px-4 py-3 text-sm text-[#1DE9B6] ${busy||!canUpload?'opacity-40':''}`}><FileUp size={16}/>{busy?t('common.loading'):t('disputes.uploadEvidence')}<input type="file" accept={accepted.join(',')} disabled={busy||!canUpload} onChange={onFile} className="sr-only" data-testid="input-evidence-file"/></label></div>{!canUpload&&<p className="mt-3 text-xs text-[#d9b697]">{t('errors.permissionDenied')}</p>}{error&&<p className="mt-3 text-sm text-[#ff998d]" role="alert">{error}</p>}
  {list.isLoading?<div className="skeleton mt-6 h-28 rounded-lg"/>:list.isError?<p className="mt-6 text-sm text-[#ff9b8f]">{t('errors.network')} <button onClick={()=>list.refetch()} className="text-[#1DE9B6]" data-testid="button-retry-evidence">{t('common.retry')}</button></p>:!list.data?.evidence.length?<p className="mt-6 rounded-lg border border-dashed border-[#3c513f] p-6 text-center text-sm text-[#91a694]">{t('common.notAvailable')}</p>:<div className="mt-6 divide-y divide-[#314138]">{list.data.evidence.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="flex min-w-0 items-center gap-3"><ShieldCheck size={16} className="shrink-0 text-[#1DE9B6]"/><div className="min-w-0"><p className="truncate text-sm">{item.file_name}</p><p className="mt-1 font-mono text-[10px] uppercase text-[#91a895]">{item.category} · {(item.size_bytes/1024).toFixed(1)} KB</p></div></div><EvidenceDownload contractId={id} evidenceId={item.id} name={item.file_name}/></div>)}</div>}</section>;
}