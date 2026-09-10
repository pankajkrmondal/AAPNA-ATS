/**
 * SkillTags — Renders a list of skill tags with overflow handling.
 *
 * The palette used to be eight literal hexes, and it had to be: the tag built its
 * border and fill by concatenating alpha onto the hex (`${c}30`, `${c}10`), which a
 * CSS variable cannot satisfy. So the colours could follow neither a tenant brand nor
 * dark mode — the light values were painted straight onto a dark ground.
 *
 * The hues are `--skill-1..8` now (light/dark pairs in theme/index.css), and the tag
 * mixes its own surfaces with color-mix() from whichever one it is handed. The index
 * is data, so it arrives as a custom property; the stylesheet owns everything else.
 *
 * @param {{ skills: string[], max?: number, style?: object }} props
 */
import { Tag, Tooltip } from 'antd';
import '../../styles/components.css';

/** Eight hues, cycled. They only have to stay apart from each other. */
const TAG_HUES = 8;

export default function SkillTags({ skills = [], max = 3, style }) {
  if (!skills.length) return <span className="st-empty">—</span>;

  const visible = skills.slice(0, max);
  const remaining = skills.slice(max);

  return (
    <div className="st-row" style={style}>
      {visible.map((skill, i) => (
        <Tag
          key={skill}
          className="st-tag"
          style={{ '--st-hue': `var(--skill-${(i % TAG_HUES) + 1})` }}
        >
          {skill}
        </Tag>
      ))}

      {remaining.length > 0 && (
        <Tooltip title={remaining.join(', ')}>
          <Tag className="st-more">
            +{remaining.length}
          </Tag>
        </Tooltip>
      )}
    </div>
  );
}
