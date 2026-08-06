/**
 * NotificationBell — header bell backed by rpa_notifications.
 *
 * Previously this held notifications in local React state: they vanished on
 * refresh and never reached anyone who was logged out when the event fired.
 * The list and unread count now come from /api/notifications, so a recruiter
 * who was away still finds the work waiting. The socket is only a live nudge —
 * the row is written first, so a missed push costs nothing.
 *
 * @param {{ style?: object }} props
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Popover, List, Typography, Button, Empty, Space, Spin } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import { getSocket } from '../../services/socket';
import notificationService from '../../services/notificationService';

const { Text } = Typography;

const NOTIFICATIONS_KEY = ['notifications'];

/** Relative age for the list, e.g. "just now" / "12m" / "3h" / "2d". */
function timeAgo(iso) {
  if (!iso) return '';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationBell({ style }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => notificationService.list({ limit: 30 }),
    select: (res) => res?.data?.data ?? res?.data ?? { items: [], unread: 0 },
    // A missed socket push shouldn't leave the bell stale forever.
    refetchOnWindowFocus: true,
  });

  const notifications = data?.items || [];
  const unreadCount = data?.unread ?? 0;

  /**
   * Live push. The backend writes the row first and emits second, so this only
   * decides how quickly it appears — never whether it survives.
   */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const onNew = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    socket.on('notification:new', onNew);
    return () => socket.off('notification:new', onNew);
  }, [queryClient]);

  const markReadMutation = useMutation({
    mutationFn: (id) => notificationService.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationService.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  /** Mark read, then follow the deep link when the event carries one. */
  const handleClick = (item) => {
    if (!item.read_at) markReadMutation.mutate(item.id);
    if (item.link_path) {
      setOpen(false);
      navigate(item.link_path);
    }
  };

  const content = (
    <div style={{ width: 380 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 0 12px',
          borderBottom: '1px solid var(--border-light)',
          marginBottom: 8,
        }}
      >
        <Text strong style={{ fontSize: 15 }}>Notifications</Text>
        {unreadCount > 0 && (
          <Button
            type="link"
            size="small"
            icon={<CheckOutlined />}
            onClick={() => markAllReadMutation.mutate()}
            loading={markAllReadMutation.isPending}
            style={{ fontSize: 12 }}
          >
            Mark all read
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}><Spin /></div>
      ) : notifications.length === 0 ? (
        <Empty description="No notifications" style={{ padding: '24px 0' }} />
      ) : (
        <List
          dataSource={notifications}
          style={{ maxHeight: 400, overflowY: 'auto' }}
          renderItem={(item) => {
            const unread = !item.read_at;
            return (
              <List.Item
                key={item.id}
                onClick={() => handleClick(item)}
                style={{
                  cursor: 'pointer',
                  padding: '10px 8px',
                  borderRadius: 8,
                  background: unread ? 'var(--gold-subtle)' : 'transparent',
                  transition: 'background 0.2s',
                  marginBottom: 2,
                }}
              >
                <List.Item.Meta
                  title={
                    <Space size={6}>
                      {unread && (
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: 'var(--gold)',
                            display: 'inline-block',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <Text strong={unread} style={{ fontSize: 13 }}>{item.title}</Text>
                    </Space>
                  }
                  description={
                    <div>
                      {item.description && (
                        <Text type="secondary" style={{ fontSize: 12 }}>{item.description}</Text>
                      )}
                      <br />
                      <Text type="secondary" style={{ fontSize: 11, opacity: 0.6 }}>
                        {timeAgo(item.created_at)}
                      </Text>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      arrow={false}
      overlayStyle={{ padding: 0 }}
      overlayInnerStyle={{ borderRadius: 12, padding: '12px 16px' }}
    >
      <Badge count={unreadCount} size="small" offset={[-2, 4]}>
        <Button
          type="text"
          icon={<BellOutlined style={{ fontSize: 20 }} />}
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...style,
          }}
        />
      </Badge>
    </Popover>
  );
}
