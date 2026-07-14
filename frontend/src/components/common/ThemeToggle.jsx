/**
 * ThemeToggle — animated sun/moon button that flips light/dark mode.
 * The morph animation is pure CSS (`.theme-toggle*` in src/theme/index.css);
 * the circular page reveal originates from this button via the click event
 * passed to toggleTheme.
 */
import { Tooltip } from 'antd';
import useTheme from '../../hooks/useTheme';

const RAYS = Array.from({ length: 8 }, (_, i) => i);

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <Tooltip title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <button
        type="button"
        className={`theme-toggle${isDark ? ' theme-toggle--dark' : ''}`}
        aria-label="Toggle theme"
        aria-pressed={isDark}
        onClick={toggleTheme}
      >
        <span className="theme-toggle__orb" aria-hidden="true" />
        <span className="theme-toggle__rays" aria-hidden="true">
          {RAYS.map((i) => (
            <i key={i} style={{ '--i': i }} />
          ))}
        </span>
      </button>
    </Tooltip>
  );
}
