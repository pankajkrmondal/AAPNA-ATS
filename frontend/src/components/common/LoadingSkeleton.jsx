/**
 * LoadingSkeleton — shimmer placeholders shaped like the thing that is loading.
 *
 * The rollout plan's rule (Phase 2): a skeleton matches the shape of what is
 * arriving, rather than a centred `<Spin>` that collapses the layout and then
 * snaps it back when data lands. The app still has ~25 bare spinners; the
 * shapes they need live here so converting a page is a swap, not an invention.
 *
 * `list`, `board`, `chart` and `form` were added in Phase 2 alongside the
 * original `table` / `cards` / `detail`.
 *
 * @param {object} props
 * @param {'table'|'cards'|'detail'|'list'|'board'|'chart'|'form'} [props.type]
 * @param {number} [props.rows]     table/list/form rows
 * @param {number} [props.cards]    cards count
 * @param {number} [props.columns]  board columns
 * @param {number} [props.height]   chart height, px
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

/** A dense stack of rows — the screening results list, a drawer's activity feed. */
function ListSkeleton({ rows = 6 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 'var(--row-py) var(--row-px)',
            border: '1px solid var(--border-light)',
            borderRadius: 12,
            animation: `fadeIn 0.3s ease ${i * 0.05}s both`,
          }}
        >
          <ShimmerBlock width={36} height={36} borderRadius={18} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <ShimmerBlock width="34%" height={12} />
            <ShimmerBlock width="52%" height={10} />
          </div>
          <ShimmerBlock width={64} height={22} borderRadius={11} />
        </div>
      ))}
    </div>
  );
}

/** The pipeline board: columns of cards, so the horizontal rhythm is there
    before the data is and the board does not jump width on arrival. */
function BoardSkeleton({ columns = 5, rows = 3 }) {
  return (
    <div style={{ display: 'flex', gap: 16, overflow: 'hidden' }}>
      {Array.from({ length: columns }).map((_, c) => (
        <div
          key={c}
          style={{
            flex: '0 0 280px',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--card-pad-compact)',
            animation: `fadeIn 0.3s ease ${c * 0.06}s both`,
          }}
        >
          <ShimmerBlock width="55%" height={13} style={{ marginBottom: 14 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: rows }).map((_, r) => (
              <div
                key={r}
                style={{
                  border: '1px solid var(--border-light)',
                  borderRadius: 10,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <ShimmerBlock width="70%" height={11} />
                <ShimmerBlock width="45%" height={9} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A chart well. Bars of varied height rather than one flat block: a single
    grey rectangle reads as a broken image, a silhouette reads as "a chart". */
function ChartSkeleton({ height = 240 }) {
  const bars = [52, 74, 41, 88, 63, 96, 58, 79, 45, 84, 68, 92];
  return (
    <div style={{ padding: '8px 0' }}>
      <ShimmerBlock width="28%" height={12} style={{ marginBottom: 18 }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          height,
          padding: '0 4px',
          borderBottom: '1px solid var(--border-light)',
        }}
      >
        {bars.map((h, i) => (
          <ShimmerBlock
            key={i}
            width="100%"
            height={`${h}%`}
            borderRadius="6px 6px 0 0"
            style={{ animation: `fadeIn 0.3s ease ${i * 0.03}s both` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Label + field pairs — settings panels, the MRF form. */
function FormSkeleton({ rows = 5 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            animation: `fadeIn 0.3s ease ${i * 0.05}s both`,
          }}
        >
          <ShimmerBlock width={`${18 + ((i * 7) % 14)}%`} height={11} />
          <ShimmerBlock width="100%" height="var(--control-h)" borderRadius={8} />
        </div>
      ))}
    </div>
  );
}

export default function LoadingSkeleton({
  type = 'table',
  rows = 5,
  cards = 4,
  columns = 5,
  height = 240,
}) {
  switch (type) {
    case 'cards':
      return <CardsSkeleton cards={cards} />;
    case 'detail':
      return <DetailSkeleton />;
    case 'list':
      return <ListSkeleton rows={rows} />;
    case 'board':
      return <BoardSkeleton columns={columns} rows={rows} />;
    case 'chart':
      return <ChartSkeleton height={height} />;
    case 'form':
      return <FormSkeleton rows={rows} />;
    case 'table':
    default:
      return <TableSkeleton rows={rows} />;
  }
}
