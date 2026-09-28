import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { NotificationItem } from '@/lib/types';
import { Badge, EmptyState, cn } from '@/components/ui';
import { formatRelative } from '@/lib/format';

/**
 * Notification bell with the unread count — FR-NTF-01.
 * The dropdown lists the latest items, supports mark read / mark all read, and
 * deep-links to the record.
 */
export const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const { data, refetch } = useQuery({
    queryKey: ['notifications', 'preview'],
    queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>('/notifications', { page: 1, size: 8 }),
    refetchInterval: 90_000,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const unread = data?.unread ?? 0;

  const markAll = async () => {
    await api.post('/notifications/read-all');
    await refetch();
  };

  const openItem = async (item: NotificationItem) => {
    if (item.status === 'UNREAD') {
      await api.patch('/notifications/read', { ids: [item.id] });
      void refetch();
    }
    setOpen(false);
    if (item.deepLink) navigate(item.deepLink);
  };

  const tone = (severity: string) =>
    severity === 'danger' ? 'danger' : severity === 'warning' ? 'warning' : severity === 'success' ? 'success' : 'info';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-control p-2 text-ink-secondary hover:bg-navy-50 hover:text-navy-900"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M10 20a2 2 0 004 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-danger px-1 text-[10px] font-semibold text-white tnum">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-1 w-[360px] max-w-[92vw] animate-slide-up overflow-hidden rounded-card border border-edge bg-surface shadow-raised" role="menu">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <p className="text-body font-semibold text-navy-900">Notifications</p>
            {unread > 0 ? (
              <button type="button" onClick={markAll} className="text-caption font-medium text-navy-600 hover:underline">
                Mark all as read
              </button>
            ) : null}
          </div>

          <div className="anwar-scroll max-h-[380px]">
            {!data?.items?.length ? (
              <EmptyState title="No notifications yet" description="Updates about your KPIs appear here." className="py-8" />
            ) : (
              <ul>
                {data.items.map((item) => (
                  <li key={item.id} className="border-b border-edge/70 last:border-0">
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={cn('w-full px-3 py-2.5 text-left hover:bg-navy-50', item.status === 'UNREAD' && 'bg-navy-50/60')}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                            item.status === 'UNREAD' ? 'bg-info' : 'bg-transparent',
                          )}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Badge tone={tone(item.severity) as never}>{item.code}</Badge>
                            <span className="text-[11px] text-ink-muted">{formatRelative(item.createdAt)}</span>
                          </div>
                          <p className="mt-1 truncate text-caption font-semibold text-ink">{item.title}</p>
                          <p className="line-clamp-2 text-[11px] text-ink-secondary">{item.body}</p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-edge bg-canvas px-3 py-2 text-center">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/notifications');
              }}
              className="text-caption font-medium text-navy-600 hover:underline"
            >
              Open the notification centre
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
