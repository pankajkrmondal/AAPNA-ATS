/**
 * NotificationBell — Header notification icon with unread badge and popover list.
 * Includes a Socket.io integration placeholder for real-time notifications.
 *
 * @param {{ style?: object }} props
 */
import { useState, useEffect } from 'react';
import { Badge, Popover, List, Typography, Button, Empty, Space } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
// import { io } from 'socket.io-client';  // Uncomment when backend is ready

const { Text } = Typography;

/** Mock notifications for demo. Replace with real data from API/socket. */
const MOCK_NOTIFICATIONS = [
  { id: '1', title: '5 new resumes uploaded', description: 'From Vendor: TechStaff Solutions', time: '2 min ago', read: false },
  { id: '2', title: 'MRF-2024-042 approved', description: 'Senior React Developer position approved by VP Engineering', time: '15 min ago', read: false },
  { id: '3', title: 'Interview scheduled', description: 'Priya Sharma — Round 2 with Hiring Manager', time: '1 hour ago', read: true },
  { id: '4', title: 'Candidate shortlisted', description: 'AI score: 92% match for Full-Stack Engineer', time: '3 hours ago', read: true },
];

export default function NotificationBell({ style }) {
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  const [open, setOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  /**
   * Socket.io placeholder — subscribe to real-time notifications.
   * Uncomment and configure when backend socket server is ready.
   */
  useEffect(() => {
    // const socket = io({ path: '/socket.io' });
    // socket.on('notification', (data) => {
    //   setNotifications((prev) => [{ ...data, read: false }, ...prev]);
    // });
    // return () => socket.disconnect();
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
