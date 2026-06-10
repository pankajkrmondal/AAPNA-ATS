/**
 * PageHeader — Reusable page header with title, subtitle, breadcrumb context, and action buttons.
 *
 * @param {{ title: string, subtitle?: string, actions?: React.ReactNode, style?: object, children?: React.ReactNode }} props
 */
import { Typography, Space } from 'antd';

const { Title, Text } = Typography;

export default function PageHeader({ title, subtitle, actions, style, children }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 28,
        flexWrap: 'wrap',
        gap: 16,
        ...style,
      }}
    >
      <div>
        <Title
          level={3}
          style={{
            margin: 0,
            fontWeight: 700,
            fontSize: 24,
            lineHeight: 1.3,
          }}
        >
          {title}
        </Title>
        {subtitle && (
          <Text
            type="secondary"
            style={{
              fontSize: 14,
              marginTop: 4,
              display: 'block',
            }}
          >
            {subtitle}
          </Text>
        )}
        {children}
      </div>

      {actions && (
        <Space size={12} wrap>
          {actions}
        </Space>
      )}
    </div>
  );
}
