/**
 * StatCard — Premium dashboard stat card with gradient surface, glowing icon tile,
 * animated count-up value, and hover lift. Uses glassmorphism styling.
 *
 * @param {{ icon: React.ReactNode, title: string, value: number|string, trend?: number, trendLabel?: string, color?: string, loading?: boolean, style?: object }} props
 */
import { useEffect, useRef, useState } from 'react';
import { Card, Typography, Space } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animates a number from 0 → target with an ease-out curve (no dependency). */
function useCountUp(target, duration = 1100) {
  const isNumeric = typeof target === 'number' && Number.isFinite(target);
  const [display, setDisplay] = useState(isNumeric ? 0 : target);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!isNumeric) {
      setDisplay(target);
      return undefined;
    }
    if (prefersReducedMotion() || target === 0) {
      setDisplay(target);
      return undefined;
    }

    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(target * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [target, duration, isNumeric]);

  return isNumeric ? display.toLocaleString() : display;
}

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
  const trendColor = isPositive ? '#4a7c59' : isNegative ? '#c0392b' : '#5f6664';
  const displayValue = useCountUp(value);

  return (
    <Card
      loading={loading}
      bordered={false}
      className="premium-stat-card"
      style={{
        overflow: 'hidden',
        position: 'relative',
        borderTop: `3px solid ${color}`,
        background: `linear-gradient(150deg, var(--colorBgContainer) 0%, ${color}0a 100%)`,
        ...style,
      }}
      styles={{
        body: { padding: '22px 24px', position: 'relative', zIndex: 1 },
      }}
    >
      {/* Background accent glow */}
      <div
        style={{
          position: 'absolute',
          top: -30,
          right: -30,
          width: 130,
          height: 130,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color}33 0%, transparent 70%)`,
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {/* Icon tile — filled gradient + glow */}
        <div
          className="premium-stat-icon"
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            color: '#fff',
            boxShadow: `0 6px 16px ${color}55`,
          }}
        >
          {icon}
        </div>

        {/* Label */}
        <Text
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-2)',
          }}
        >
          {title}
        </Text>

        {/* Value */}
        <Title
          level={2}
          style={{
            margin: 0,
            fontSize: 34,
            fontWeight: 800,
            lineHeight: 1.1,
            fontFamily: 'var(--mono)',
            color: 'var(--text)',
          }}
        >
          {displayValue}
        </Title>

        {/* Trend (optional) */}
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
