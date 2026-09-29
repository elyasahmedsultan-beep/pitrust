import { MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useListPublicChatRooms, getListPublicChatRoomsQueryKey } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { useI18n } from '@/i18n';

const languageNames: Record<string, Record<string, string>> = {
  en: { en: 'English', ar: 'Arabic', 'zh-CN': 'Simplified Chinese', id: 'Indonesian', vi: 'Vietnamese' },
  ar: { en: 'الإنجليزية', ar: 'العربية', 'zh-CN': 'الصينية المبسطة', id: 'الإندونيسية', vi: 'الفيتنامية' },
  'zh-CN': { en: '英语', ar: '阿拉伯语', 'zh-CN': '简体中文', id: '印度尼西亚语', vi: '越南语' },
  id: { en: 'Inggris', ar: 'Arab', 'zh-CN': 'Tionghoa Sederhana', id: 'Indonesia', vi: 'Vietnam' },
  vi: { en: 'Tiếng Anh', ar: 'Tiếng Ả Rập', 'zh-CN': 'Tiếng Trung giản thể', id: 'Tiếng Indonesia', vi: 'Tiếng Việt' },
};

export default function ChatRoomsPage() {
  const { language, t } = useI18n();
  const rooms = useListPublicChatRooms({ query: { queryKey: getListPublicChatRoomsQueryKey(), retry: 1 } });
  const roomItems = rooms.data ?? [];

  if (rooms.isLoading) {
    return <div className="space-y-4" data-testid="loading-chat-rooms"><div className="skeleton h-32 rounded-2xl" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><div className="skeleton h-48 rounded-2xl" /><div className="skeleton h-48 rounded-2xl" /><div className="skeleton h-48 rounded-2xl" /></div></div>;
  }

  if (rooms.isError) {
    return <section className="mx-auto max-w-xl rounded-2xl border border-[#60403c] bg-[#211716] p-8 text-center" data-testid="error-chat-rooms"><MessageCircle className="mx-auto text-[#f0a68e]" size={28} /><h1 className="mt-4 font-['Syne'] text-2xl font-semibold">{t('chat.roomsUnavailable')}</h1><p className="mt-2 text-sm leading-6 text-[#cbb0a7]">{t('chat.roomsUnavailableBody')}</p><button onClick={() => void rooms.refetch()} className="admin-soft-button mt-6" data-testid="button-retry-chat-rooms"><RefreshCw size={15} />{t('common.retry')}</button></section>;
  }

  return <div className="animate-rise-in pb-16" data-testid="page-chat-rooms">
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div><p className="admin-label flex items-center gap-2 text-[#1de9b6]"><span className="h-1.5 w-1.5 rounded-full bg-[#00c853]" />{t('chat.eyebrow')}</p><h1 className="mt-3 font-['Syne'] text-4xl font-semibold tracking-tight sm:text-5xl" data-testid="heading-chat-rooms">{t('chat.roomsTitle')}<span className="text-[#00c853]">.</span></h1><p className="mt-3 max-w-2xl text-sm leading-7 text-[#9fb2a4]">{t('chat.roomsSubtitle')}</p></div>
      <div className="flex items-center gap-2 rounded-xl border border-[#3c5645] bg-[#15231a] px-4 py-3 text-xs text-[#b7d0bd]" role="note" data-testid="notice-chat-translation"><ShieldCheck size={16} className="text-[#1de9b6]" />{t('chat.geminiNotice')}</div>
    </header>

    {!roomItems.length ? <section className="admin-panel mt-10 grid min-h-64 place-content-center p-8 text-center" data-testid="empty-chat-rooms"><MessageCircle className="mx-auto text-[#69c88a]" size={30} /><h2 className="mt-4 font-['Syne'] text-xl font-semibold">{t('chat.noRooms')}</h2><p className="mt-2 max-w-md text-sm leading-6 text-[#91a797]">{t('chat.noRoomsBody')}</p></section> :
      <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{roomItems.map((room, index) => <Link href={`/chat/${room.id}`} key={room.id} className="group admin-panel relative overflow-hidden p-6 transition-transform hover:-translate-y-0.5 hover:border-[#4b8a61]" data-testid={`card-chat-room-${room.id}`}><div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#00c853] via-[#1de9b6] to-transparent" /><div className="flex items-start justify-between gap-3"><span className="font-mono text-[10px] uppercase tracking-[.18em] text-[#6ea980]">0{index + 1} / {t('chat.room')}</span><span className="rounded-full border border-[#3c7850] bg-[#183b27] px-2.5 py-1 text-[10px] font-semibold text-[#9ae2ae]">{t('chat.active')}</span></div><h2 className="mt-12 font-['Syne'] text-2xl font-semibold text-[#f2f5f3] group-hover:text-[#b9f2c8]">{room.name}</h2><p className="mt-2 text-sm text-[#92aa99]">{languageNames[language][room.languageCode] ?? room.languageCode}</p><div className="mt-8 flex items-center justify-between border-t border-[#304838] pt-4 text-xs text-[#77cd95]"><span>{t('chat.enterRoom')}</span><span className="text-lg transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1">→</span></div></Link>)}</div>}
  </div>;
}