import { useMemo, useState } from 'react';
import { Check, Edit3, Plus, Search, Shield, UserMinus, UserPlus, WifiOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListAdminChatRoomsQueryKey,
  getListPublicChatRoomsQueryKey,
  getSearchAdminChatMembersQueryKey,
  useAddAdminChatModerator,
  useCreateAdminChatRoom,
  useListAdminChatRooms,
  useRemoveAdminChatModerator,
  useSearchAdminChatMembers,
  useUpdateAdminChatRoom,
  type ChatLanguage,
} from '@workspace/api-client-react';
import { useI18n } from '@/i18n';

const languages: Array<{ code: ChatLanguage; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'vi', label: 'Tiếng Việt' },
];

export default function ChatAdminManagement() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const roomsQuery = useListAdminChatRooms({ query: { queryKey: getListAdminChatRoomsQueryKey(), retry: 1 } });
  const createRoom = useCreateAdminChatRoom();
  const updateRoom = useUpdateAdminChatRoom();
  const addModerator = useAddAdminChatModerator();
  const removeModerator = useRemoveAdminChatModerator();
  const [languageCode, setLanguageCode] = useState<ChatLanguage>('en');
  const [roomName, setRoomName] = useState('');
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [memberSearch, setMemberSearch] = useState<Record<string, string>>({});
  const [selectedMember, setSelectedMember] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');

  const rooms = roomsQuery.data ?? [];
  const missingLanguages = useMemo(() => languages.filter(language => !rooms.some(room => room.languageCode === language.code)), [rooms]);

  const invalidateRooms = () => {
    void queryClient.invalidateQueries({ queryKey: getListAdminChatRoomsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListPublicChatRoomsQueryKey() });
  };

  const create = () => {
    const name = roomName.trim();
    if (!name || createRoom.isPending) return;
    createRoom.mutate({ data: { name, languageCode } }, {
      onSuccess: () => { setRoomName(''); setFeedback(t('chat.adminCreated')); invalidateRooms(); },
      onError: () => setFeedback(t('chat.adminActionError')),
    });
  };

  const saveName = (roomId: string) => {
    const name = (draftNames[roomId] ?? '').trim();
    if (name.length < 2 || updateRoom.isPending) return;
    updateRoom.mutate({ roomId, data: { name } }, {
      onSuccess: () => { setEditingRoom(null); setFeedback(t('chat.adminSaved')); invalidateRooms(); },
      onError: () => setFeedback(t('chat.adminActionError')),
    });
  };

  const toggleRoom = (roomId: string, active: boolean) => {
    updateRoom.mutate({ roomId, data: { active: !active } }, {
      onSuccess: () => { setFeedback(active ? t('chat.adminDeactivated') : t('chat.adminReactivated')); invalidateRooms(); },
      onError: () => setFeedback(t('chat.adminActionError')),
    });
  };

  if (roomsQuery.isLoading) return <section className="mt-12" data-testid="loading-admin-chat"><div className="skeleton h-64 rounded-2xl" /></section>;
  if (roomsQuery.isError) return <section className="admin-panel mt-12 p-6" data-testid="error-admin-chat"><p className="text-sm text-[#ffc19b]">{t('chat.adminUnavailable')}</p><button onClick={() => void roomsQuery.refetch()} className="admin-soft-button mt-4" data-testid="button-retry-admin-chat">{t('common.retry')}</button></section>;

  return <section className="mt-14" aria-labelledby="admin-chat-title" data-testid="section-admin-chat">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="admin-label text-[#1de9b6]">03 / {t('chat.adminEyebrow')}</p><h2 id="admin-chat-title" className="mt-2 font-['Syne'] text-2xl font-semibold sm:text-3xl">{t('chat.adminTitle')}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#96a99c]">{t('chat.adminSubtitle')}</p></div><Shield className="text-[#6ed192]" size={26} /></div>
    {feedback && <p className="mb-4 rounded-lg border border-[#3f7651] bg-[#173322] px-4 py-3 text-sm text-[#a9e5b5]" role="status" data-testid="status-admin-chat">{feedback}</p>}
    <div className="admin-panel p-5 sm:p-6"><div className="mb-5 flex items-center gap-2"><Plus size={16} className="text-[#1de9b6]" /><h3 className="font-semibold">{t('chat.adminCreateTitle')}</h3></div><div className="grid gap-3 md:grid-cols-[180px_1fr_auto]"><label className="sr-only" htmlFor="admin-chat-language">{t('chat.language')}</label><select id="admin-chat-language" value={languageCode} onChange={event => setLanguageCode(event.target.value as ChatLanguage)} className="admin-field" data-testid="select-admin-chat-language">{languages.map(language => <option key={language.code} value={language.code} disabled={!missingLanguages.some(item => item.code === language.code)}>{language.label}{!missingLanguages.some(item => item.code === language.code) ? ` — ${t('chat.adminAlreadyCreated')}` : ''}</option>)}</select><label className="sr-only" htmlFor="admin-chat-room-name">{t('chat.roomName')}</label><input id="admin-chat-room-name" value={roomName} onChange={event => setRoomName(event.target.value)} maxLength={60} placeholder={t('chat.roomNamePlaceholder')} className="admin-field" data-testid="input-admin-chat-room-name" /><button onClick={create} disabled={!roomName.trim() || !missingLanguages.some(item => item.code === languageCode) || createRoom.isPending} className="admin-primary-button" data-testid="button-create-admin-chat-room"><Plus size={15} />{createRoom.isPending ? t('common.loading') : t('chat.adminCreate')}</button></div></div>
    {!rooms.length ? <div className="admin-panel mt-4 grid min-h-36 place-content-center p-8 text-center" data-testid="empty-admin-chat"><WifiOff className="mx-auto text-[#6dbb82]" size={26} /><p className="mt-3 text-sm text-[#9fb3a4]">{t('chat.adminNoRooms')}</p></div> : <div className="mt-4 grid gap-4 lg:grid-cols-2">{rooms.map(room => <AdminRoomCard key={room.id} room={room} editingRoom={editingRoom} setEditingRoom={setEditingRoom} draftName={draftNames[room.id] ?? room.name} setDraftName={value => setDraftNames(previous => ({ ...previous, [room.id]: value }))} onSave={() => saveName(room.id)} onToggle={() => toggleRoom(room.id, room.active)} search={memberSearch[room.id] ?? ''} onSearch={value => setMemberSearch(previous => ({ ...previous, [room.id]: value }))} selectedMember={selectedMember[room.id] ?? ''} onSelectMember={value => setSelectedMember(previous => ({ ...previous, [room.id]: value }))} onAdd={async () => { const memberId = selectedMember[room.id]; if (!memberId) return; try { await addModerator.mutateAsync({ roomId: room.id, userId: memberId }); setSelectedMember(previous => ({ ...previous, [room.id]: '' })); setFeedback(t('chat.adminModeratorAdded')); invalidateRooms(); } catch { setFeedback(t('chat.adminActionError')); } }} onRemove={async userId => { try { await removeModerator.mutateAsync({ roomId: room.id, userId }); setFeedback(t('chat.adminModeratorRemoved')); invalidateRooms(); } catch { setFeedback(t('chat.adminActionError')); } }} pending={addModerator.isPending || removeModerator.isPending || updateRoom.isPending} t={t} />)}</div>}
  </section>;
}

type CardProps = {
  room: { id: string; name: string; languageCode: ChatLanguage; active: boolean; moderators: Array<{ userId: string; displayName: string }> };
  editingRoom: string | null;
  setEditingRoom: (id: string | null) => void;
  draftName: string;
  setDraftName: (value: string) => void;
  onSave: () => void;
  onToggle: () => void;
  search: string;
  onSearch: (value: string) => void;
  selectedMember: string;
  onSelectMember: (value: string) => void;
  onAdd: () => void;
  onRemove: (userId: string) => void;
  pending: boolean;
  t: ReturnType<typeof useI18n>['t'];
};

function AdminRoomCard({ room, editingRoom, setEditingRoom, draftName, setDraftName, onSave, onToggle, search, onSearch, selectedMember, onSelectMember, onAdd, onRemove, pending, t }: CardProps) {
  const params = { search: search.trim() };
  const members = useSearchAdminChatMembers(params, { query: { queryKey: getSearchAdminChatMembersQueryKey(params), enabled: search.trim().length >= 2, retry: false } });
  return <article className="admin-panel overflow-hidden" data-testid={`card-admin-chat-room-${room.id}`}><div className="flex items-start justify-between gap-3 border-b border-[#34463a] bg-[#1d2920] p-5"><div className="min-w-0 flex-1"><p className="admin-label">{room.languageCode}</p>{editingRoom === room.id ? <div className="mt-2 flex gap-2"><input value={draftName} onChange={event => setDraftName(event.target.value)} className="admin-field min-w-0 py-2" data-testid={`input-edit-admin-chat-room-${room.id}`} /><button onClick={onSave} disabled={pending} className="admin-primary-button shrink-0 px-3" aria-label={t('common.save')} data-testid={`button-save-admin-chat-room-${room.id}`}><Check size={15} /></button></div> : <h3 className="mt-2 truncate font-['Syne'] text-xl font-semibold">{room.name}</h3>}</div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] ${room.active ? 'border-[#3c7850] text-[#89dba0]' : 'border-[#6f5340] text-[#e1b885]'}`}>{room.active ? t('chat.active') : t('chat.inactive')}</span></div><div className="space-y-5 p-5"><div className="flex flex-wrap gap-2"><button onClick={() => { setEditingRoom(editingRoom === room.id ? null : room.id); setDraftName(room.name); }} className="admin-soft-button" data-testid={`button-edit-admin-chat-room-${room.id}`}><Edit3 size={14} />{t('common.edit')}</button><button onClick={onToggle} disabled={pending} className="admin-soft-button" data-testid={`button-toggle-admin-chat-room-${room.id}`}>{room.active ? <WifiOff size={14} /> : <Check size={14} />}{room.active ? t('chat.deactivate') : t('chat.reactivate')}</button></div><div className="border-t border-[#304238] pt-4"><p className="admin-label">{t('chat.moderators')}</p>{!room.moderators.length ? <p className="mt-3 text-xs text-[#879d8e]">{t('chat.noModerators')}</p> : <div className="mt-3 space-y-2">{room.moderators.map(mod => <div key={mod.userId} className="flex items-center justify-between gap-3 rounded-lg border border-[#334b3b] bg-[#162218] px-3 py-2"><span className="min-w-0 truncate text-sm text-[#d3e3d5]">{mod.displayName}</span><button onClick={() => onRemove(mod.userId)} disabled={pending} className="inline-flex shrink-0 items-center gap-1 text-xs text-[#e39c86] hover:text-[#ffc0a8]" data-testid={`button-remove-admin-moderator-${room.id}-${mod.userId}`}><UserMinus size={13} />{t('chat.removeModerator')}</button></div>)}</div>}<div className="mt-4 flex gap-2"><div className="relative min-w-0 flex-1"><Search size={15} className="pointer-events-none absolute start-3 top-3 text-[#718c79]" /><input value={search} onChange={event => onSearch(event.target.value)} placeholder={t('chat.searchMembers')} className="admin-field py-2 ps-9" data-testid={`input-search-admin-members-${room.id}`} /></div><button onClick={onAdd} disabled={!selectedMember || pending} className="admin-soft-button shrink-0" data-testid={`button-add-admin-moderator-${room.id}`}><UserPlus size={14} />{t('chat.assignModerator')}</button></div>{search.trim().length >= 2 && <div className="mt-2 rounded-lg border border-[#334c3b] bg-[#142018] p-2">{members.isLoading ? <p className="px-2 py-2 text-xs text-[#89a392]">{t('common.loading')}</p> : members.data?.length ? members.data.map(member => <button key={member.userId} onClick={() => onSelectMember(member.userId)} className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-start text-xs ${selectedMember === member.userId ? 'bg-[#285239] text-[#c7f3ce]' : 'text-[#c0d4c4] hover:bg-[#203a29]'}`} data-testid={`button-select-admin-member-${room.id}-${member.userId}`}><span>{member.displayName}</span>{selectedMember === member.userId && <Check size={14} />}</button>) : <p className="px-2 py-2 text-xs text-[#899f8f]">{t('chat.noMembersFound')}</p>}</div>}</div></div></article>;
}