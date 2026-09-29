import { useEffect, useRef, useState } from 'react';
import { useApprovePiPayment, useCompletePiPayment, type PaymentIntent, type MonthlyBadgeIntent, type EscrowServiceDepositIntent } from '@workspace/api-client-react';
import { useI18n } from '@/i18n';
import { initializePiSdk, type PiPayment, type PiSdk } from '@/lib/pi-sdk';
import { getPiIframeSessionToken } from '@/lib/pi-iframe-session';

type PiIntent = PaymentIntent | MonthlyBadgeIntent | EscrowServiceDepositIntent;

export function usePiPayment(onConfirmed?:()=>void){
  const {t}=useI18n();
  const approve=useApprovePiPayment();const complete=useCompletePiPayment();
  const [state,setState]=useState<'loading'|'ready'|'unavailable'|'paying'>('loading');
  const [error,setError]=useState('');
  const sdk=useRef<PiSdk|null>(null);
  const onConfirmedRef=useRef(onConfirmed);onConfirmedRef.current=onConfirmed;
  const approveRef=useRef(approve.mutateAsync);approveRef.current=approve.mutateAsync;
  const completeRef=useRef(complete.mutateAsync);completeRef.current=complete.mutateAsync;
  const readyRef=useRef(false);
  useEffect(()=>{
    let active=true;
    const start=async()=>{
      try{
        const pi=await initializePiSdk();
        const auth=await pi.authenticate(['payments'],payment=>{
          if(!payment.identifier)return;
          // A recovered payment is reconciled only by the server's Pi verification.
          const purpose=payment.metadata?.type==='escrow'?'escrow_service_deposit' as const:undefined;
          void approveRef.current({data:{paymentId:payment.identifier,...(purpose?{purpose}:{})}})
            .then(()=>completeRef.current({
              data:{
                paymentId:payment.identifier,
                ...(payment.transaction?.txid?{txid:payment.transaction.txid}:{}),
                ...(purpose?{purpose}:{})
              }
            }))
            .then(result=>{
              if(purpose&&!result.confirmed)throw new Error('Escrow service deposit is not confirmed');
              onConfirmedRef.current?.();
            })
            .catch(()=>{if(active)setError(t('escrow.piPaymentPending'))});
        });
        if(!auth?.accessToken)throw new Error('Pi authentication unavailable');
        const iframeToken=getPiIframeSessionToken();
        const path=`${import.meta.env.BASE_URL.replace(/\/?$/,'/')}api/pi/link`;
        const response=await fetch(path,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',...(iframeToken?{Authorization:`Bearer ${iframeToken}`}:{})},body:JSON.stringify({accessToken:auth.accessToken})});
        if(!response.ok)throw new Error('Pi identity verification failed');
        const linked=await response.json() as {linked?:boolean};
        if(linked.linked!==true)throw new Error('Pi identity not linked');
        if(active){sdk.current=pi;readyRef.current=true;setState('ready');setError('')}
      }catch{if(active){setState('unavailable');setError(t('common.notAvailable'))}}
    };
    void start();return()=>{active=false};
  },[t]);
  const pay=async(intent:PiIntent)=>{
    if(!sdk.current||!readyRef.current||state!=='ready')throw new Error('Pi identity unavailable');
    if(!Number.isFinite(intent.amount)||intent.amount<=0)throw new Error('Invalid payment intent');
    const purpose='type' in intent.metadata&&intent.metadata.type==='escrow'?'escrow_service_deposit' as const:undefined;
    setError('');setState('paying');
    try{
      await sdk.current.createPayment({amount:intent.amount,memo:intent.memo,metadata:intent.metadata},{
        onReadyForServerApproval:async paymentId=>{await approveRef.current({data:{paymentId,...(purpose?{purpose}:{})}})},
        onReadyForServerCompletion:async(paymentId,txid)=>{
          const result=await completeRef.current({data:{paymentId,txid,...(purpose?{purpose}:{})}});
          if(purpose&&!result.confirmed)throw new Error('Escrow service deposit is not confirmed');
          if('contractId' in intent.metadata && !intent.metadata.feeType && !result.funded)throw new Error('Funding unconfirmed');
          onConfirmedRef.current?.();
          setState('ready');
        },
        onCancel:()=>{setError(t('escrow.piPaymentPending'));setState('ready')},
        onError:()=>{setError(t('escrow.piPaymentFailed'));setState('ready')},
      });
    }catch{setError(t('escrow.piPaymentFailed'));setState('ready');throw new Error('Pi payment failed')}
  };
  return {state,error,pay,clearError:()=>setError('')};
}