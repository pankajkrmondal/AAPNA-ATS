/**
 * SkillTags — Renders a list of skill tags with overflow handling.
 *
 * @param {{ skills: string[], max?: number, style?: object }} props
 */
import { Tag, Tooltip } from 'antd';

/** Palette of subtle colors for skill tags. */
const TAG_COLORS = [
  '#005f56', '#4a7c59', '#2980b9', '#8e44ad',
  '#d4a017', '#16a085', '#c0392b', '#2c3e50',
];

export default function SkillTags({ skills = [], max = 3, style }) {
  if (!skills.length) return <span style={{ color: 'var(--text-2)', fontSize: 13 }}>—</span>;

  const visible = skills.slice(0, max);
  const remaining = skills.slice(max);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, ...style }}>
      {visible.map((skill, i) => (
        <Tag
          key={skill}
          style={{
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            margin: 0,
            border: `1px solid ${TAG_COLORS[i % TAG_COLORS.length]}30`,
            color: TAG_COLORS[i % TAG_COLORS.length],
            background: `${TAG_COLORS[i % TAG_COLORS.length]}10`,
          }}
        >
          {skill}
        </Tag>
      ))}

      {remaining.length > 0 && (
        <Tooltip title={remaining.join(', ')}>
          <Tag
            style={{
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              margin: 0,
              cursor: 'pointer',
              background: 'var(--gold-subtle)',
              border: '1px solid var(--border)',
            }}
          >
            +{remaining.length}
          </Tag>
        </Tooltip>
      )}
    </div>
  );
}
