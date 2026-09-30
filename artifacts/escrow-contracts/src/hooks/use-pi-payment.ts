import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetProfileQueryKey, useApprovePiPayment, useCancelPiPayment, useCompletePiPayment, type PaymentIntent, type MonthlyBadgeIntent, type ListingAdPaymentIntent } from '@workspace/api-client-react';
import { useI18n } from '@/i18n';
import { initializePiSdk, type PiPayment, type PiSdk } from '@/lib/pi-sdk';
import { getPiIframeSessionToken } from '@/lib/pi-iframe-session';
import { incompletePiPaymentAction } from '@/lib/pi-payment-recovery';
import { paymentErrorMessage } from '@/lib/pi-payment-error';

type PiIntent = PaymentIntent | MonthlyBadgeIntent | ListingAdPaymentIntent;

function paymentPurpose(metadata?: object): 'listing_ad' | 'contract_funding' | undefined {
  const type = (metadata as { type?: unknown } | undefined)?.type;
  if (type === 'listing_ad') return 'listing_ad';
  if (type === 'contract_funding') return 'contract_funding';
  return undefined;
}

function paymentCancellationPurpose(metadata?: object): 'listing_ad' | 'contract_funding' | undefined {
  const purpose=paymentPurpose(metadata);
  const feeType=(metadata as {feeType?:unknown}|undefined)?.feeType;
  if(purpose==='contract_funding'&&feeType!=null)return undefined;
  return purpose;
}

export function usePiPayment(onConfirmed?:()=>void){
  const {t}=useI18n();
  const queryClient=useQueryClient();
  const approve=useApprovePiPayment();const complete=useCompletePiPayment();const cancel=useCancelPiPayment();
  const [state,setState]=useState<'loading'|'ready'|'unavailable'|'paying'>('loading');
  const [error,setError]=useState('');
  const sdk=useRef<PiSdk|null>(null);
  const onConfirmedRef=useRef(onConfirmed);onConfirmedRef.current=onConfirmed;
  const approveRef=useRef(approve.mutateAsync);approveRef.current=approve.mutateAsync;
  const completeRef=useRef(complete.mutateAsync);completeRef.current=complete.mutateAsync;
  const cancelRef=useRef(cancel.mutateAsync);cancelRef.current=cancel.mutateAsync;
  const readyRef=useRef(false);
  const incompleteRecoveryRef=useRef<{paymentId:string;promise:Promise<'completed'|'cancelled'>}|null>(null);
  const recoverIncompletePaymentRef=useRef<((payment:PiPayment)=>Promise<'completed'|'cancelled'>)|null>(null);
  useEffect(()=>{
    let active=true;
    const start=async()=>{
      try{
        const pi=await initializePiSdk();
        const recoverIncompletePayment=(payment:PiPayment):Promise<'completed'|'cancelled'>=>{
          if(!payment.identifier)return Promise.reject(new Error('Pi incomplete payment did not include a payment ID'));
          const existing=incompleteRecoveryRef.current;
          if(existing?.paymentId===payment.identifier)return existing.promise;
          const purpose=paymentPurpose(payment.metadata);
          const cancelPurpose=paymentCancellationPurpose(payment.metadata);
          const action=incompletePiPaymentAction(payment,cancelPurpose!==undefined);
          const promise=(async()=>{
            if(action==='manual_reconciliation'){
              throw new Error('Pi could not safely recover this incomplete payment automatically. Do not retry it until it has been manually reconciled.');
            }
            if(action==='complete'){
              const txid=payment.transaction?.txid?.trim();
              if(!txid)throw new Error('Pi verified the wallet payment but did not provide its transaction ID.');
              const result=await completeRef.current({data:{paymentId:payment.identifier,txid,...(purpose?{purpose}:{})}});
              if(purpose==='listing_ad'&&!result.confirmed)throw new Error('Pi product payment is not confirmed');
              if(purpose==='contract_funding'&&payment.metadata?.feeType!=='dispute'&&!result.funded)throw new Error('Pi contract funding is not confirmed');
              if(payment.metadata?.badgeAuditId!=null&&!result.confirmed)throw new Error('Pi badge payment is not confirmed');
              onConfirmedRef.current?.();
              void queryClient.invalidateQueries({queryKey:getGetProfileQueryKey()});
              return 'completed' as const;
            }
            if(cancelPurpose){
              const result=await cancelRef.current({data:{paymentId:payment.identifier,purpose:cancelPurpose}});
              if(!result.cancelled)throw new Error('Pi did not confirm cancellation of the incomplete payment');
              return 'cancelled' as const;
            }
            throw new Error('This unverified Pi payment type has no safe automatic cancellation path. Do not retry it until it has been manually reconciled.');
          })();
          incompleteRecoveryRef.current={paymentId:payment.identifier,promise};
          return promise;
        };
        recoverIncompletePaymentRef.current=recoverIncompletePayment;
        const auth=await pi.authenticate(['payments'],payment=>{
          // Pi registers this callback on authenticate and invokes it when createPayment finds an older payment.
          const recovery=recoverIncompletePayment(payment);
          void recovery.catch(error=>{if(active)setError(paymentErrorMessage(error,t('escrow.piPaymentPending')))});
        });
        const initialRecovery=incompleteRecoveryRef.current;
        if(initialRecovery){
          await initialRecovery.promise;
          if(incompleteRecoveryRef.current===initialRecovery)incompleteRecoveryRef.current=null;
        }
        if(!auth?.accessToken)throw new Error('Pi authentication unavailable');
        const iframeToken=getPiIframeSessionToken();
        const path=`${import.meta.env.BASE_URL.replace(/\/?$/,'/')}api/pi/link`;
        const response=await fetch(path,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',...(iframeToken?{Authorization:`Bearer ${iframeToken}`}:{})},body:JSON.stringify({accessToken:auth.accessToken})});
        if(!response.ok)throw new Error('Pi identity verification failed');
        const linked=await response.json() as {linked?:boolean};
        if(linked.linked!==true)throw new Error('Pi identity not linked');
        if(active){sdk.current=pi;readyRef.current=true;setState('ready');setError('')}
      }catch(error){if(active){readyRef.current=false;setState('unavailable');setError(paymentErrorMessage(error,t('common.notAvailable')))}}
    };
    void start();return()=>{active=false;recoverIncompletePaymentRef.current=null};
  },[t]);
  const pay=async(intent:PiIntent)=>{
    if(!sdk.current||!readyRef.current||state!=='ready')throw new Error('Pi identity unavailable');
    if(!Number.isFinite(intent.amount)||intent.amount<=0)throw new Error('Invalid payment intent');
    const purpose=paymentPurpose(intent.metadata);
    const cancelPurpose=paymentCancellationPurpose(intent.metadata);
    setError('');setState('paying');
    const createPaymentAttempt=async(retryAfterCancellation:boolean):Promise<void>=>{
      let completionConfirmed=false;
      let userCancelled=false;
      let callbackFailure:unknown=null;
      let cancelPromise:Promise<void>|null=null;
      const resolveIncompleteRecovery=async(recovery:{paymentId:string;promise:Promise<'completed'|'cancelled'>},allowRetry:boolean):Promise<void>=>{
        const outcome=await recovery.promise;
        if(incompleteRecoveryRef.current===recovery)incompleteRecoveryRef.current=null;
        if(outcome==='completed'){
          setState('ready');
          return;
        }
        if(allowRetry){
          setError('');
          setState('paying');
          return createPaymentAttempt(false);
        }
        throw new Error('Pi cancelled the older payment, but this payment attempt remains blocked. Start the payment again.');
      };
      try{
        await sdk.current!.createPayment({amount:intent.amount,memo:intent.memo,metadata:intent.metadata},{
          onReadyForServerApproval:async paymentId=>{
            try{await approveRef.current({data:{paymentId,...(purpose?{purpose}:{})}})}
            catch(error){callbackFailure=error;setError(paymentErrorMessage(error,t('escrow.piPaymentFailed')));throw error}
          },
          onReadyForServerCompletion:async(paymentId,txid)=>{
            try{
              const result=await completeRef.current({data:{paymentId,txid,...(purpose?{purpose}:{})}});
              if(purpose==='listing_ad'&&!result.confirmed)throw new Error('Pi product payment is not confirmed');
              if('contractId' in intent.metadata&&!intent.metadata.feeType&&!result.funded)throw new Error('Funding unconfirmed');
              if('badgeAuditId' in intent.metadata&&result.confirmed!==true)throw new Error('Pi badge payment is not confirmed');
              completionConfirmed=true;
              onConfirmedRef.current?.();
              void queryClient.invalidateQueries({queryKey:getGetProfileQueryKey()});
              setState('ready');
            }catch(error){callbackFailure=error;setError(paymentErrorMessage(error,t('escrow.piPaymentFailed')));throw error}
          },
          onCancel:paymentId=>{
            userCancelled=true;
            if(cancelPurpose){
              cancelPromise=cancelRef.current({data:{paymentId,purpose:cancelPurpose}})
                .then(result=>{if(!result.cancelled)throw new Error('Pi did not confirm cancellation of this payment')})
                .catch(error=>{callbackFailure=error;setError(paymentErrorMessage(error,t('escrow.piPaymentPending')))})
                .finally(()=>setState('ready'));
              return;
            }
            setError(t('escrow.piPaymentPending'));setState('ready');
          },
          onError:(error,payment)=>{
            if(incompleteRecoveryRef.current)return;
            if(payment&&recoverIncompletePaymentRef.current){
              if(!payment.identifier){
                callbackFailure=new Error(t('escrow.piPaymentPending'));
                setError(t('escrow.piPaymentPending'));
                return;
              }
              const recovery=recoverIncompletePaymentRef.current(payment);
              void recovery.catch(recoveryError=>{
                callbackFailure??=recoveryError;
                setError(paymentErrorMessage(recoveryError,t('escrow.piPaymentPending')));
              });
              return;
            }
            callbackFailure??=error;
            setError(paymentErrorMessage(callbackFailure,t('escrow.piPaymentFailed')));
            setState('ready');
          },
        });
      }catch(error){
        if(completionConfirmed){setState('ready');return}
        const recovery=incompleteRecoveryRef.current;
        if(recovery)return resolveIncompleteRecovery(recovery,retryAfterCancellation);
        throw callbackFailure??error;
      }
      if(completionConfirmed)return;
      const recovery=incompleteRecoveryRef.current;
      if(recovery)return resolveIncompleteRecovery(recovery,retryAfterCancellation);
      if(cancelPromise)await cancelPromise;
      if(callbackFailure)throw callbackFailure;
      if(userCancelled)return;
      throw new Error(t('escrow.piPaymentPending'));
    };
    try{await createPaymentAttempt(true)}
    catch(error){
      const message=paymentErrorMessage(error,t('escrow.piPaymentFailed'));
      setError(message);
      if(incompleteRecoveryRef.current){readyRef.current=false;setState('unavailable')}
      else setState('ready');
      throw new Error(message);
    }
  };
  return {state,error,pay,clearError:()=>setError('')};
}