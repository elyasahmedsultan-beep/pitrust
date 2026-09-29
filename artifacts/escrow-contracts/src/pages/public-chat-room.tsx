import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronUp, Languages, MessageCircle, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react';
import {
  getListPublicChatMessagesQueryKey,
  getListPublicChatRoomsQueryKey,
  useListPublicChatMessages,
  useListPublicChatRooms,
  useModeratePublicChatMessage,
  useSendPublicChatMessage,
  type PublicChatMessage,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { useI18n, type Language } from '@/i18n';

const supportedLanguages = new Set<Language>(['en', 'ar', 'zh-CN', 'id', 'vi']);

function formatTime(value: string, language: Language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar' : language, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function PublicChatRoomPage() {
  const { roomId = '' } = useParams();
  const { language, t } = useI18n();
  const targetLanguage = supportedLanguages.has(language) ? language : 'en';
  const queryClient = useQueryClient();
  const rooms = useListPublicChatRooms({ query: { queryKey: getListPublicChatRoomsQueryKey() } });
  const room = rooms.data?.find(item => item.id === roomId);
  const params = useMemo(() => ({ roomId, targetLanguage, limit: 40 as number }), [roomId, targetLanguage]);
  const messageQuery = useListPublicChatMessages(params, { query: { queryKey: getListPublicChatMessagesQueryKey(params), enabled: Boolean(roomId), retry: 1, refetchInterval: 8_000 } });
  const send = useSendPublicChatMessage();
  const moderate = useModeratePublicChatMessage();
  const [messages, setMessages] = useState<PublicChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const requestCursorRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestCursorRef.current = undefined;
    setMessages([]);
    setNextCursor(null);
    setText('');
    setError('');
    setSuccess('');
  }, [roomId, targetLanguage]);

  useEffect(() => {
    if (!messageQuery.data) return;
    const incoming = [...messageQuery.data.messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const shouldStickToBottom = !messages.length ||
      (bottomRef.current !== null && bottomRef.current.getBoundingClientRect().bottom <= window.innerHeight + 120);
    setMessages(previous => {
      const merged = new Map(previous.map(message => [message.id, message]));
      for (const message of incoming) merged.set(message.id, message);
      return [...merged.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
    if (shouldStickToBottom && !requestCursorRef.current) {
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
    }
    setNextCursor(messageQuery.data.nextCursor);
  }, [messageQuery.data, messages.length]);

  const handleSend = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = text.trim();
    if (!content || send.isPending || !roomId) return;
    setError('');
    setSuccess('');
    send.mutate({ roomId, data: { content, targetLanguage } }, {
      onSuccess: () => {
        setText('');
        setSuccess(t('chat.messageSent'));
        void queryClient.invalidateQueries({ queryKey: getListPublicChatMessagesQueryKey(params) });
      },
      onError: () => setError(t('chat.sendError')),
    });
  };

  const loadOlder = () => {
    if (!nextCursor || messageQuery.isFetching || loadingOlder) return;
    setLoadingOlder(true);
    requestCursorRef.current = nextCursor;
    const nextParams = { ...params, cursor: nextCursor };
    void queryClient.fetchQuery({ queryKey: getListPublicChatMessagesQueryKey(nextParams), queryFn: () => import('@workspace/api-client-react').then(api => api.listPublicChatMessages(nextParams)) }).then(page => {
      const incoming = [...page.messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setMessages(previous => [...incoming, ...previous.filter(existing => !incoming.some(item => item.id === existing.id))]);
      setNextCursor(page.nextCursor);
      requestCursorRef.current = undefined;
      setLoadingOlder(false);
    }).catch(() => {
      requestCursorRef.current = undefined;
      setLoadingOlder(false);
      setError(t('chat.loadOlderError'));
    });
  };

  const removeMessage = (messageId: string) => {
    if (!window.confirm(t('chat.deleteConfirm')) || moderate.isPending) return;
    setError('');
    setSuccess('');
    moderate.mutate({ messageId }, {
      onSuccess: () => {
        setMessages(previous => previous.map(message => message.id === messageId ? { ...message, isDeleted: true, content: null, translatedText: null } : message));
        setSuccess(t('chat.messageRemoved'));
        void queryClient.invalidateQueries({ queryKey: getListPublicChatMessagesQueryKey(params) });
      },
      onError: () => setError(t('chat.deleteError')),
    });
  };

  if (rooms.isLoading || messageQuery.isLoading) return <div className="space-y-4" data-testid="loading-public-chat-room"><div className="skeleton h-24 rounded-2xl" /><div className="skeleton h-[560px] rounded-2xl" /></div>;
  if (rooms.isError || messageQuery.isError || !room) return <section className="mx-auto max-w-xl rounded-2xl border border-[#60403c] bg-[#211716] p-8 text-center" data-testid="error-public-chat-room"><MessageCircle className="mx-auto text-[#f0a68e]" size={28} /><h1 className="mt-4 font-['Syne'] text-2xl font-semibold">{room ? t('chat.messagesUnavailable') : t('chat.roomNotFound')}</h1><p className="mt-2 text-sm leading-6 text-[#cbb0a7]">{t('chat.messagesUnavailableBody')}</p><Link href="/chat" className="admin-soft-button mt-6" data-testid="link-back-chat-rooms"><ArrowLeft size={15} />{t('chat.backToRooms')}</Link></section>;

  return <div className="animate-rise-in pb-10" data-testid={`page-public-chat-room-${roomId}`}>
    <header className="flex flex-wrap items-start justify-between gap-5"><div><Link href="/chat" className="inline-flex items-center gap-2 text-xs text-[#8ed8a4] hover:text-[#c8f4d0]" data-testid="link-back-chat"><ArrowLeft size={14} className="rtl:rotate-180" />{t('chat.backToRooms')}</Link><div className="mt-5 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl border border-[#3e7551] bg-[#193524] text-[#1de9b6]"><Languages size={21} /></span><div><p className="admin-label">{t('chat.conversation')}</p><h1 className="mt-1 font-['Syne'] text-3xl font-semibold sm:text-4xl" data-testid="heading-public-chat-room">{room.name}</h1></div></div></div><div className="max-w-md rounded-xl border border-[#3c5645] bg-[#15231a] px-4 py-3 text-xs leading-5 text-[#b7d0bd]" role="note" data-testid="notice-public-chat-gemini"><ShieldCheck size={15} className="me-2 inline text-[#1de9b6]" />{t('chat.geminiNotice')}</div></header>
    <section className="mt-7 overflow-hidden rounded-2xl border border-[#2d4435] bg-[#111a14] shadow-[0_22px_70px_rgba(0,0,0,.2)]"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2d4435] bg-[#17251b] px-4 py-3 sm:px-6"><div className="flex items-center gap-2 text-xs text-[#8eaa96]"><span className="h-2 w-2 rounded-full bg-[#00c853]" />{t('chat.translationReady')}</div><label className="flex cursor-pointer items-center gap-2 text-xs text-[#c3d6c6]"><input type="checkbox" checked={showOriginal} onChange={event => setShowOriginal(event.target.checked)} className="accent-[#00c853]" data-testid="toggle-show-original" />{t('chat.showOriginal')}</label></div>
      <div className="flex min-h-[470px] flex-col px-4 py-5 sm:px-7" data-testid="list-public-chat-messages">
        {nextCursor && <button onClick={loadOlder} disabled={messageQuery.isFetching || loadingOlder} className="mx-auto mb-5 inline-flex items-center gap-2 rounded-lg border border-[#3d6148] px-3 py-2 text-xs text-[#a6dcb2] hover:bg-[#1a3022] disabled:opacity-50" data-testid="button-load-older-messages"><ChevronUp size={14} />{loadingOlder ? t('common.loading') : t('chat.loadOlder')}</button>}
        {!messages.length ? <div className="m-auto max-w-sm text-center"><MessageCircle className="mx-auto text-[#65bc82]" size={30} /><h2 className="mt-4 font-['Syne'] text-xl">{t('chat.noMessages')}</h2><p className="mt-2 text-sm leading-6 text-[#8fa596]">{t('chat.noMessagesBody')}</p></div> : <div className="mt-auto space-y-4">{messages.map(message => { const translated = Boolean(message.translatedText) && message.translationStatus === 'translated'; const displayText = showOriginal ? (message.content ?? t('chat.deletedMessage')) : (message.translatedText || message.content || t('chat.translationUnavailable')); return <article key={message.id} className={`group flex ${message.isOwn ? 'justify-end' : 'justify-start'}`} data-testid={`message-chat-${message.id}`}><div className={`max-w-[min(88%,620px)] ${message.isOwn ? 'items-end' : 'items-start'} flex flex-col`}><div className={`rounded-2xl border px-4 py-3 ${message.isDeleted ? 'border-[#4a4b42] bg-[#20231d] text-[#8d968a]' : message.isOwn ? 'border-[#39734e] bg-[#193923] text-[#eef8ef]' : 'border-[#334c3a] bg-[#1b281e] text-[#dce9de]'}`}><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.isDeleted ? t('chat.deletedMessage') : displayText}</p>{!message.isDeleted && !showOriginal && !translated && <p className="mt-2 text-[11px] text-[#e1bc82]" data-testid={`status-translation-unavailable-${message.id}`}>{t('chat.translationUnavailable')}</p>}</div><div className="mt-1 flex items-center gap-2 px-1 text-[10px] text-[#789181]"><span>{message.senderName}</span><span>·</span><time dateTime={message.createdAt}>{formatTime(message.createdAt, language)}</time>{!message.isDeleted && (message.isOwn || messageQuery.data?.canModerate) && <button onClick={() => removeMessage(message.id)} className="ms-1 inline-flex items-center gap-1 text-[#d89480] opacity-0 transition-opacity hover:text-[#ffc0a8] group-hover:opacity-100 focus:opacity-100" aria-label={t('chat.deleteMessage')} data-testid={`button-delete-chat-message-${message.id}`}><Trash2 size={12} />{t('common.delete')}</button>}</div></div></article>; })}</div>}
        <div ref={bottomRef} />
      </div>
      {error && <p className="border-t border-[#5b4136] bg-[#271a17] px-5 py-3 text-xs text-[#f1b09a]" role="alert" data-testid="error-public-chat">{error}</p>}
      {success && !error && <p className="border-t border-[#355f43] bg-[#172b1d] px-5 py-3 text-xs text-[#a9e5b5]" role="status" data-testid="status-public-chat">{success}</p>}
      {room.active ? <form onSubmit={handleSend} className="flex items-end gap-3 border-t border-[#2d4435] bg-[#17251b] p-4 sm:p-5"><label className="sr-only" htmlFor="chat-message-input">{t('chat.messagePlaceholder')}</label><textarea id="chat-message-input" value={text} onChange={event => setText(event.target.value)} maxLength={2000} rows={2} placeholder={t('chat.messagePlaceholder')} className="admin-field min-h-[52px] resize-none" data-testid="input-chat-message" /><button type="submit" disabled={!text.trim() || send.isPending} className="admin-primary-button h-[52px] shrink-0 px-4" data-testid="button-send-chat-message"><Send size={16} />{send.isPending ? t('chat.sending') : t('chat.sendMessage')}</button></form> : <div className="border-t border-[#5b4136] bg-[#271d18] px-5 py-4 text-sm text-[#e3c39c]" role="status" data-testid="status-chat-inactive">{t('chat.roomInactive')}</div>}
    </section>
  </div>;
}