/**
 * LoadingSkeleton — Shimmer-animated loading placeholders for tables and cards.
 *
 * @param {{ type?: 'table'|'cards'|'detail', rows?: number, cards?: number }} props
 */
import { Card, Skeleton, Row, Col } from 'antd';

function ShimmerBlock({ width = '100%', height = 16, borderRadius = 6, style }) {
  return (
    <div
      className="shimmer"
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

function TableSkeleton({ rows = 5 }) {
  return (
    <div style={{ padding: '16px 0' }}>
      {/* Header row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, padding: '0 16px' }}>
        {[120, 180, 140, 100, 160, 80, 100].map((w, i) => (
          <ShimmerBlock key={i} width={w} height={14} />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          style={{
            display: 'flex',
            gap: 16,
            padding: '14px 16px',
            borderBottom: '1px solid var(--border-light)',
            animation: `fadeIn 0.3s ease ${rowIdx * 0.05}s both`,
          }}
        >
          {[120, 180, 140, 100, 160, 80, 100].map((w, i) => (
            <ShimmerBlock key={i} width={w} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CardsSkeleton({ cards = 4 }) {
  return (
    <Row gutter={[20, 20]}>
      {Array.from({ length: cards }).map((_, i) => (
        <Col xs={24} sm={12} lg={6} key={i}>
          <Card
            bordered={false}
            className="glass-card"
            style={{ animation: `fadeIn 0.3s ease ${i * 0.08}s both` }}
            styles={{ body: { padding: 24 } }}
          >
            <ShimmerBlock width={48} height={48} borderRadius={12} style={{ marginBottom: 16 }} />
            <ShimmerBlock width="60%" height={12} style={{ marginBottom: 12 }} />
            <ShimmerBlock width="40%" height={28} style={{ marginBottom: 12 }} />
            <ShimmerBlock width="50%" height={10} />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

function DetailSkeleton() {
  return (
    <div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 32 }}>
        <ShimmerBlock width={80} height={80} borderRadius={40} />
        <div style={{ flex: 1 }}>
          <ShimmerBlock width="30%" height={24} style={{ marginBottom: 12 }} />
          <ShimmerBlock width="20%" height={14} style={{ marginBottom: 8 }} />
          <ShimmerBlock width="40%" height={14} />
        </div>
      </div>
      <Skeleton active paragraph={{ rows: 6 }} />
    </div>
  );
}

export default function LoadingSkeleton({ type = 'table', rows = 5, cards = 4 }) {
  switch (type) {
    case 'cards':
      return <CardsSkeleton cards={cards} />;
    case 'detail':
      return <DetailSkeleton />;
    case 'table':
    default:
      return <TableSkeleton rows={rows} />;
  }
}
