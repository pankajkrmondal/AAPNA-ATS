/**
 * StatCard — Premium dashboard stat card with gradient surface, glowing icon tile,
 * animated count-up value, and hover lift. Uses glassmorphism styling.
 *
 * @param {{ icon: React.ReactNode, title: string, value: number|string, trend?: number, trendLabel?: string, color?: string, loading?: boolean, style?: object }} props
 */
import { useEffect, useRef, useState } from 'react';
import { Card, Typography } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from '@ant-design/icons';
import Sparkline from '../dashboard/Sparkline';

const { Text } = Typography;

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
  sparklineData = null,
  delta = null, // { value: number (percent), label?: string }
}) {
  const isPositive = trend > 0;
  const isNegative = trend < 0;
  const trendColor = isPositive ? '#4a7c59' : isNegative ? '#c0392b' : '#5f6664';
  const displayValue = useCountUp(value);

  // Week-over-week delta badge (independent of the optional `trend` prop).
  const hasDelta = delta && delta.value !== null && delta.value !== undefined;
  const deltaUp = hasDelta && delta.value > 0;
  const deltaDown = hasDelta && delta.value < 0;

  const hasSpark = Array.isArray(sparklineData) && sparklineData.length > 1;

  return (
    <Card
      loading={loading}
      bordered={false}
      className="premium-stat-card"
      style={{
        '--stat-color': color,
        borderTop: `4px solid ${color}`,
        background: `linear-gradient(160deg, var(--colorBgContainer) 0%, ${color}0a 100%)`,
        ...style,
      }}
      styles={{
        body: { padding: 0, position: 'relative', zIndex: 1, height: '100%' },
      }}
    >
      {/* Soft corner aura — subtle, behind content */}
      <span
        className="premium-stat-aura"
        aria-hidden
        style={{ background: `radial-gradient(circle, ${color}26 0%, transparent 70%)` }}
      />

      <div className="premium-stat-inner">
        {/* Header: icon tile + compact trend chip */}
        <div className="premium-stat-head">
          <div
            className="premium-stat-icon"
            style={{
              background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
              boxShadow: `0 6px 16px ${color}55`,
            }}
          >
            {icon}
          </div>
          {hasDelta && (
            <span
              className={`delta-chip ${deltaUp ? 'is-up' : deltaDown ? 'is-down' : 'is-flat'}`}
              title={delta.label || 'vs last week'}
            >
              {deltaUp ? <ArrowUpOutlined /> : deltaDown ? <ArrowDownOutlined /> : <MinusOutlined />}
              {Math.abs(delta.value)}%
            </span>
          )}
        </div>

        {/* Label + value */}
        <Text className="premium-stat-label">{title}</Text>
        <div className="premium-stat-value">{displayValue}</div>

        {/* Optional legacy trend line */}
        {trend !== undefined && trend !== null && (
          <span className="premium-stat-trend" style={{ color: trendColor }}>
            {isPositive ? <ArrowUpOutlined /> : isNegative ? <ArrowDownOutlined /> : <MinusOutlined />}
            {Math.abs(trend)}%
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>{trendLabel}</Text>
          </span>
        )}

        {/* Full-bleed bottom band — gradient wash on every card for a consistent,
            rich finish; a live sparkline overlays where we have a real series. */}
        <div
          className="premium-stat-band"
          style={{ background: `linear-gradient(180deg, transparent 0%, ${color}14 100%)` }}
        >
          {hasSpark && <Sparkline data={sparklineData} color={color} height={56} />}
        </div>
      </div>
    </Card>
  );
}
