/**
 * StatCard — Animated dashboard stat card with icon, value, trend indicator.
 * Uses glassmorphism styling and entrance animation.
 *
 * @param {{ icon: React.ReactNode, title: string, value: number|string, trend?: number, trendLabel?: string, color?: string, loading?: boolean, style?: object }} props
 */
import { Card, Typography, Space } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

export default function StatCard({
  icon,
  title,
  value,
  trend,
  trendLabel = 'vs last month',
  color = '#7a922e',
  loading = false,
  style,
}) {
  const isPositive = trend > 0;
  const isNegative = trend < 0;
  const trendColor = isPositive ? '#4a7c59' : isNegative ? '#c0392b' : '#4a5232';

  return (
    <Card
      loading={loading}
      bordered={false}
      className="glass-card"
      style={{
        overflow: 'hidden',
        position: 'relative',
        ...style,
      }}
      styles={{
        body: { padding: '24px', position: 'relative', zIndex: 1 },
      }}
    >
      {/* Background accent circle */}
      <div
        style={{
          position: 'absolute',
          top: -20,
          right: -20,
          width: 100,
          height: 100,
          borderRadius: '50%',
          background: color,
          opacity: 0.06,
          zIndex: 0,
        }}
      />

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {/* Icon row */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: `${color}14`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            color,
          }}
        >
          {icon}
        </div>

        {/* Label */}
        <Text
          style={{
            fontSize: 13,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            opacity: 0.65,
          }}
        >
          {title}
        </Text>

        {/* Value */}
        <Title
          level={2}
          style={{
            margin: 0,
            fontSize: 32,
            fontWeight: 700,
            lineHeight: 1.1,
            fontFamily: "'DM Mono', monospace",
          }}
        >
          {typeof value === 'number' ? value.toLocaleString() : value}
        </Title>

        {/* Trend */}
        {trend !== undefined && trend !== null && (
          <Space size={4} style={{ fontSize: 13 }}>
            <span style={{ color: trendColor, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2 }}>
              {isPositive ? <ArrowUpOutlined /> : isNegative ? <ArrowDownOutlined /> : <MinusOutlined />}
              {Math.abs(trend)}%
            </span>
            <Text type="secondary" style={{ fontSize: 12 }}>{trendLabel}</Text>
          </Space>
        )}
      </Space>
    </Card>
  );
}
