import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Bell, History } from 'lucide-react';
import { Link } from 'wouter';
import { getListNotificationsQueryKey, useListActivity, useListNotifications, useMarkNotificationRead } from '@workspace/api-client-react';
import { useI18n, type TranslationKey } from '@/i18n';
const tones=['all','positive','neutral','warning','danger'] as const;
const notificationCopy: Record<string, { title: TranslationKey; message: TranslationKey }> = {
  delivery_submitted: { title: 'inAppNotifications.deliveryReadyTitle', message: 'inAppNotifications.deliveryReadyMessage' },
  delivery_submitted_seller: { title: 'inAppNotifications.deliverySubmittedTitle', message: 'inAppNotifications.deliverySubmittedMessage' },
  wallet_link_required: { title: 'inAppNotifications.walletLinkRequiredTitle', message: 'inAppNotifications.walletLinkRequiredMessage' },
  wallet_mismatch: { title: 'inAppNotifications.walletMismatchTitle', message: 'inAppNotifications.walletMismatchMessage' },
  dispute_opened: { title: 'inAppNotifications.disputeOpenedTitle', message: 'inAppNotifications.disputeOpenedMessage' },
  payment_released: { title: 'inAppNotifications.paymentReleasedTitle', message: 'inAppNotifications.paymentReleasedMessage' },
};
export default function ActivityPage() {
  const { t } = useI18n();
  const [tone, setTone] = useState<(typeof tones)[number]>('all');
  const queryClient = useQueryClient();
  const activity = useListActivity();
  const notifications = useListNotifications();
  const markRead = useMarkNotificationRead();
  const items = (activity.data ?? []).filter((event) => tone === 'all' || event.tone === tone);
  const markNotificationRead = (id: string) => markRead.mutate(
    { id },
    { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) },
  );

  return <div className="mx-auto max-w-5xl animate-rise-in">
    <p className="font-mono text-[10px] uppercase tracking-[.2em] text-[#1DE9B6]">PITRUST / LEDGER</p>
    <h1 className="mt-3 font-['Syne'] text-4xl sm:text-5xl">{t('navigation.activity')}<span className="text-[#00C853]">.</span></h1>
    <p className="mt-3 text-sm text-[#94ab9a]">{t('landing.recentActivity')}</p>

    <section id="notifications" className="mt-9">
      <div className="flex items-center gap-3"><Bell className="text-[#1DE9B6]" size={19}/><h2 className="font-['Syne'] text-2xl">{t('inAppNotifications.title')}</h2></div>
      {notifications.isLoading ? <div className="skeleton mt-5 h-32 rounded-xl"/> :
        notifications.isError ? <div className="mt-5 rounded-xl border border-[#574039] p-5 text-sm">{t('errors.network')} <button onClick={() => notifications.refetch()} className="ms-3 text-[#1DE9B6]" data-testid="button-retry-notifications">{t('common.retry')}</button></div> :
          !notifications.data?.length ? <div className="mt-5 rounded-xl border border-dashed border-[#3a503e] p-8 text-center text-sm text-[#9caf9d]">{t('delivery.notificationEmpty')}</div> :
            <div className="mt-5 divide-y divide-[#344139] overflow-hidden rounded-xl border border-[#344139] bg-[#1A1A1A]">
              {notifications.data.map((notification) => {
                const copy = notificationCopy[notification.type];
                return <article key={notification.id} className={`flex gap-4 p-5 ${notification.readAt ? '' : 'bg-[#14251b]'}`} data-testid={`notification-${notification.id}`}>
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? 'bg-[#56685b]' : 'bg-[#00C853]'}`} aria-label={notification.readAt ? undefined : t('inAppNotifications.unread')}/>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{copy ? t(copy.title) : notification.title}</h3><time className="font-mono text-xs text-[#8ca08e]">{new Date(notification.createdAt).toLocaleString()}</time></div>
                  <p className="mt-2 text-sm leading-6 text-[#a1b3a4]">{copy ? t(copy.message) : notification.message}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
                    <Link href={`/contracts/${notification.contractId}`} onClick={() => { if (!notification.readAt) markNotificationRead(notification.id); }} className="flex items-center gap-1 text-[#1DE9B6]" data-testid={`link-notification-${notification.id}`}>{t('inAppNotifications.openContract')}<ArrowUpRight size={14}/></Link>
                    {!notification.readAt && <button onClick={() => markNotificationRead(notification.id)} disabled={markRead.isPending} className="text-[#9eafa4] hover:text-[#1DE9B6] disabled:opacity-50" data-testid={`button-read-${notification.id}`}>{t('inAppNotifications.markRead')}</button>}
                  </div>
                </div>
              </article>;
              })}
            </div>}
    </section>

    <section className="mt-12">
      <h2 className="font-['Syne'] text-2xl">{t('navigation.activity')}</h2>
      <div className="mt-5 flex gap-2 overflow-x-auto pb-2">{tones.map((value) => <button key={value} onClick={() => setTone(value)} className={`rounded-full border px-4 py-2 text-xs capitalize ${tone === value ? 'border-[#00C853] bg-[#193222] text-[#1DE9B6]' : 'border-[#34473b] text-[#9cae9d]'}`} data-testid={`button-filter-${value}`}>{value === 'all' ? t('common.all') : value}</button>)}</div>
      {activity.isLoading ? <div className="skeleton mt-8 h-96 rounded-xl"/> :
        activity.isError ? <div className="mt-8 rounded-xl border border-[#574039] p-6 text-sm">{t('errors.network')} <button onClick={() => activity.refetch()} className="ms-4 text-[#1DE9B6]" data-testid="button-retry-activity">{t('common.retry')}</button></div> :
          !items.length ? <div className="mt-8 rounded-xl border border-dashed border-[#3a503e] p-16 text-center"><History className="mx-auto text-[#1DE9B6]"/><p className="mt-4 text-sm text-[#9caf9d]">{activity.data?.length ? t('search.noResults') : t('dashboard.noActivity')}</p></div> :
            <div className="mt-7 divide-y divide-[#344139] overflow-hidden rounded-xl border border-[#344139] bg-[#1A1A1A]">{items.map((event) => <article key={event.id} className="flex gap-5 p-6" data-testid={`activity-${event.id}`}><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#00C853]"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{event.title}</h3><time className="font-mono text-xs text-[#8ca08e]">{new Date(event.createdAt).toLocaleString()}</time></div><p className="mt-2 text-sm text-[#a1b3a4]">{event.description}</p><div className="mt-4 flex items-center justify-between text-xs"><span className="font-mono text-[#7f9a87]">{event.actor}</span><Link href={`/contracts/${event.contractId}`} className="flex items-center gap-1 text-[#1DE9B6]" data-testid={`link-activity-${event.id}`}>{t('navigation.contracts')}<ArrowUpRight size={14}/></Link></div></div></article>)}</div>}
    </section>
  </div>;
}