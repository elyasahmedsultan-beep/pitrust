import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Languages, Send } from 'lucide-react';
import {
  getGetContractQueryKey,
  getListContractMessagesQueryKey,
  useGetContract,
  useListContractMessages,
  useSendContractMessage,
} from '@workspace/api-client-react';
import { useI18n } from '@/i18n';

export default function ContractChat() {
  const { id = '' } = useParams<{ id: string }>();
  const { t, language } = useI18n();
  const queryClient = useQueryClient();
  const contract = useGetContract(id, {
    query: { enabled: Boolean(id), queryKey: getGetContractQueryKey(id) },
  });
  const messages = useListContractMessages(id, {
    query: {
      enabled: Boolean(id),
      queryKey: [...getListContractMessagesQueryKey(id), language],
      refetchInterval: (query) => query.state.status === 'error' ? false : 3000,
    },
    request: { headers: { 'X-Target-Language': language } },
  });
  const send = useSendContractMessage();
  const [text, setText] = useState('');
  const [translationVisible, setTranslationVisible] = useState<Record<string, boolean>>({});

  useEffect(() => setTranslationVisible({}), [id, language]);

  const retry = () => {
    void contract.refetch();
    void messages.refetch();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = text.trim();
    if (!content || send.isPending) return;
    send.mutate(
      { id, data: { content, targetLanguage: language } },
      {
        onSuccess: () => {
          setText('');
          void queryClient.invalidateQueries({ queryKey: getListContractMessagesQueryKey(id) });
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-4xl animate-rise-in">
      <Link href={`/contracts/${id}`} className="inline-flex items-center gap-2 text-xs text-[#9bb09f]" data-testid="link-back-from-chat">
        <ArrowLeft size={15} />{t('common.back')}
      </Link>
      <div className="mt-6 flex items-center justify-between border-b border-[#354338] pb-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#1DE9B6]">{contract.data?.reference}</p>
          <h1 className="mt-2 font-['Syne'] text-3xl">{t('chat.conversation')}</h1>
          <p className="mt-2 text-sm text-[#97a99b]">{contract.data?.title}</p>
        </div>
        <Languages className="text-[#1DE9B6]" />
      </div>

      {contract.isError || messages.isError ? (
        <div className="mt-6 rounded-xl border border-[#5b3b38] p-6 text-sm text-[#ff988d]">
          {t('errors.network')}
          <button className="ms-3 text-[#1DE9B6]" onClick={retry} data-testid="button-retry-chat">{t('common.retry')}</button>
        </div>
      ) : messages.isLoading ? (
        <div className="skeleton mt-7 h-96 rounded-xl" />
      ) : (
        <div className="mt-6 min-h-[400px] space-y-4" aria-live="polite">
          {messages.data?.length ? messages.data.map((message) => {
            const original = message.sourceText || message.content;
            const hasTranslation = Boolean(message.translatedText);
            const showTranslation = translationVisible[message.id] !== false;
            const senderName = message.senderId === contract.data?.buyerId
              ? contract.data?.buyerName
              : message.senderId === contract.data?.sellerId
                ? contract.data?.sellerName
                : t('chat.participant');
            return (
              <article key={message.id} className="rounded-xl border border-[#314038] bg-[#1A1A1A] p-5" data-testid={`message-${message.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1DE9B6]">{senderName}</span>
                  <time className="text-xs text-[#81998a]" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{original}</p>
                {hasTranslation && showTranslation && (
                  <div className="mt-3 border-t border-[#2e4034] pt-3 text-[#b9cdbd]">
                    <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#8daa96]">
                      <Languages size={12} />{t('chat.translatedMessage')}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.translatedText}</p>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3">
                  {hasTranslation ? (
                    <button
                      onClick={() => setTranslationVisible((previous) => ({ ...previous, [message.id]: !showTranslation }))}
                      className="inline-flex items-center gap-1.5 text-xs text-[#1DE9B6]"
                      data-testid={`button-translate-${message.id}`}
                    >
                      <Languages size={13} />{showTranslation ? t('chat.hideTranslation') : t('chat.showTranslation')}
                    </button>
                  ) : message.sourceLanguage && message.sourceLanguage !== language ? (
                    <span className="text-xs text-[#879b8d]">{t('chat.translationFallback')}</span>
                  ) : null}
                </div>
              </article>
            );
          }) : (
            <div className="rounded-xl border border-dashed border-[#34503e] p-14 text-center text-sm text-[#9cae9f]">{t('chat.noMessages')}</div>
          )}
        </div>
      )}

      <form onSubmit={submit} className="mt-7 rounded-xl border border-[#35483b] bg-[#1A1A1A] p-4">
        <label className="sr-only" htmlFor="message-input">{t('chat.messagePlaceholder')}</label>
        <textarea
          id="message-input"
          maxLength={5000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('chat.messagePlaceholder')}
          className="h-24 w-full resize-none bg-transparent text-sm outline-none placeholder:text-[#728b79]"
          data-testid="input-chat-message"
        />
        <div className="flex items-center justify-between border-t border-[#2e4034] pt-4">
          <p className="text-xs text-[#84998a]">{t('chat.translationReady')}</p>
          <button disabled={send.isPending || !text.trim()} className="inline-flex items-center gap-2 rounded-lg bg-[#00C853] px-5 py-2.5 text-sm font-semibold text-[#07150a] disabled:opacity-50" data-testid="button-send-message">
            <Send size={16} />{t('chat.sendMessage')}
          </button>
        </div>
      </form>
      {send.isError && <p className="mt-3 text-sm text-[#ff998d]">{t('errors.network')}</p>}
    </div>
  );
}