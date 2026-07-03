/**
 * NotificationBell — Header notification icon with unread badge and popover list.
 * Includes a Socket.io integration placeholder for real-time notifications.
 *
 * @param {{ style?: object }} props
 */
import { useState, useEffect } from 'react';
import { Badge, Popover, List, Typography, Button, Empty, Space } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import { getSocket } from '../../services/socket';

const { Text } = Typography;

export default function NotificationBell({ style }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  /**
   * Subscribe to real-time review notifications. The backend emits 'review:new'
   * to recruiter/HR rooms whenever a duplicate resume needs review.
   */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const onReview = (job) => {
      setNotifications((prev) => [{
        id: `${job?.id || Date.now()}-${Date.now()}`,
        title: 'Duplicate resume needs review',
        description: `${job?.candidate_name || 'A candidate'}${job?.vendor_name ? ` — vendor: ${job.vendor_name}` : ''}`,
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        read: false,
      }, ...prev].slice(0, 50));
    };

    socket.on('review:new', onReview);
    return () => socket.off('review:new', onReview);
  }, []);

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markOneRead = (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  };

  const content = (
    <div style={{ width: 360 }}>
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
            onClick={markAllRead}
            style={{ fontSize: 12 }}
          >
            Mark all read
          </Button>
        )}
      </div>

      {/* List */}
      {notifications.length === 0 ? (
        <Empty description="No notifications" style={{ padding: '24px 0' }} />
      ) : (
        <List
          dataSource={notifications}
          style={{ maxHeight: 380, overflowY: 'auto' }}
          renderItem={(item) => (
            <List.Item
              key={item.id}
              onClick={() => markOneRead(item.id)}
              style={{
                cursor: 'pointer',
                padding: '10px 8px',
                borderRadius: 8,
                background: item.read ? 'transparent' : 'var(--gold-subtle)',
                transition: 'background 0.2s',
                marginBottom: 2,
              }}
            >
              <List.Item.Meta
                title={
                  <Space size={6}>
                    {!item.read && (
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
                    <Text strong={!item.read} style={{ fontSize: 13 }}>{item.title}</Text>
                  </Space>
                }
                description={
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>{item.description}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 11, opacity: 0.6 }}>{item.time}</Text>
                  </div>
                }
              />
            </List.Item>
          )}
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
