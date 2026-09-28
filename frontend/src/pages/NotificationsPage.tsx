import React from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';
import type { NotificationItem, Paginated } from '@/lib/types';
import { formatRelative } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Pagination,
  SegmentedControl,
  Skeleton,
  cn,
} from '@/components/ui';
import { PageHeader } from '@/components/ui/badges';
import { useToast } from '@/context/ToastContext';

/**
 * FR-NTF-01 — the notification centre.
 * Server-paged at 25 per page with All / Unread filters, mark-all-read and
 * per-item mark-read; items deep-link to the record they describe.
 */

const PAGE_SIZE = 25;

interface NotificationsResult extends Paginated<NotificationItem> {
  unread: number;
}

const messageOf = (error: unknown): string =>
  error instanceof ApiError ? error.message : 'The request could not be completed.';

const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [filter, setFilter] = React.useState<'all' | 'unread'>('all');
  const [page, setPage] = React.useState(1);

  const notificationsQuery = useQuery({
    queryKey: ['notifications', 'list', page, filter],
    queryFn: () =>
      api.get<NotificationsResult>('/notifications', {
        page,
        size: PAGE_SIZE,
        unreadOnly: filter === 'unread',
      }),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch<{ updated: number }>('/notifications/read', { ids: [id] }),
    onSuccess: () => {
      void invalidate();
    },
    onError: (error) => toast.error('Could not mark the notification as read', messageOf(error)),
  });

  const markAllMutation = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: (result) => {
      toast.success(
        'All notifications marked as read',
        `${result.updated} notification${result.updated === 1 ? '' : 's'} updated.`,
      );
      void invalidate();
    },
    onError: (error) => toast.error('Could not mark notifications as read', messageOf(error)),
  });

  const openItem = (item: NotificationItem) => {
    if (item.status === 'UNREAD') markReadMutation.mutate(item.id);
    if (item.deepLink) navigate(item.deepLink);
  };

  const data = notificationsQuery.data;
  const unread = data?.unread ?? 0;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={
          unread > 0
            ? `${unread} unread notification${unread === 1 ? '' : 's'} (FR-NTF-01).`
            : 'You have no unread notifications (FR-NTF-01).'
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={markAllMutation.isPending}
            disabled={unread === 0}
            onClick={() => markAllMutation.mutate()}
          >
            Mark all as read
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          items={[
            { key: 'all', label: 'All' },
            { key: 'unread', label: 'Unread', count: unread },
          ]}
          value={filter}
          onChange={(key) => {
            setFilter(key === 'unread' ? 'unread' : 'all');
            setPage(1);
          }}
          ariaLabel="Notification filters"
        />
        {notificationsQuery.isFetching && !notificationsQuery.isPending ? (
          <span className="text-caption text-ink-muted">Updating…</span>
        ) : null}
      </div>

      {notificationsQuery.isError ? (
        <ErrorState message={messageOf(notificationsQuery.error)} onRetry={() => void notificationsQuery.refetch()} />
      ) : (
        <>
          <Card padded={false}>
            {notificationsQuery.isPending ? (
              <div className="space-y-4 p-4 sm:p-6">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            ) : !data?.items.length ? (
              <EmptyState
                title={filter === 'unread' ? 'You are all caught up' : 'No notifications yet'}
                description={
                  filter === 'unread'
                    ? 'Every notification has been read. Switch to All to look back.'
                    : 'Updates about your KPIs, approvals and account appear here.'
                }
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-edge/70">
                {data.items.map((item) => {
                  const isUnread = item.status === 'UNREAD';
                  return (
                    <li key={item.id} className={cn('px-4 py-3 sm:px-5', isUnread && 'bg-navy-50/60')}>
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            'mt-2 h-2 w-2 shrink-0 rounded-full',
                            isUnread ? 'bg-info' : 'bg-transparent',
                          )}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={item.severity}>{item.code}</Badge>
                            {isUnread ? <span className="text-caption font-semibold text-info">Unread</span> : null}
                            <span className="text-caption text-ink-muted">{formatRelative(item.createdAt)}</span>
                          </div>
                          <button type="button" onClick={() => openItem(item)} className="mt-1 block w-full text-left">
                            <p className={cn('text-body', isUnread ? 'font-semibold text-ink' : 'font-medium text-ink')}>
                              {item.title}
                            </p>
                            <p className="mt-0.5 whitespace-pre-line text-caption text-ink-secondary">{item.body}</p>
                            {item.deepLink ? (
                              <span className="mt-1 inline-block text-caption font-medium text-navy-600">
                                Open record
                              </span>
                            ) : null}
                          </button>
                        </div>
                        {isUnread ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={markReadMutation.isPending && markReadMutation.variables === item.id}
                            onClick={() => markReadMutation.mutate(item.id)}
                          >
                            Mark read
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {data && data.total > 0 ? (
            <Pagination
              page={data.page}
              size={data.size}
              total={data.total}
              totalPages={data.totalPages}
              onPage={setPage}
            />
          ) : null}
        </>
      )}
    </>
  );
};

export default NotificationsPage;
