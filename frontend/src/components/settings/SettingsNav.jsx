/**
 * Settings › top bar.
 *
 * The page heading, the search box and the category pill bar for /settings.
 * The app already has a left menu, so Settings navigates across the top: one
 * pale track with the open category as a raised pill, and a status dot on the
 * categories whose automations can be on or off. When the pills do not fit,
 * the track scrolls sideways (see "Settings — pill bar" in theme/index.css).
 *
 * The bar owns only its search text. Which section is open lives in the URL
 * (?section=) and belongs to the page; the dots and the summary line are
 * computed by the page from state it already loads, so nothing is fetched here.
 */
import { useState } from 'react';
import { Badge, Input, Tooltip, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { sectionMatches } from './settingsSections';

const { Title, Text } = Typography;

/**
 * @param {object}   props
 * @param {Array}    props.sections  sections this user may see (already role-filtered)
 * @param {string}   props.activeKey the open section
 * @param {Function} props.onSelect  called with a section key
 * @param {object}   props.status    { [sectionKey]: { status: 'success'|'warning'|'default', text } }
 * @param {string}   props.summary   one line under the heading
 */
export default function SettingsNav({ sections, activeKey, onSelect, status = {}, summary }) {
  const [query, setQuery] = useState('');
  const matches = sections.filter((s) => sectionMatches(s, query));

  return (
    <div className="settings-top">
      <div className="settings-top-row">
        <div>
          <Title level={2} style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, margin: '0 0 2px 0' }}>
            Settings
          </Title>
          <Text type="secondary" style={{ fontSize: 13.5 }}>{summary}</Text>
        </div>
        <Input
          className="settings-top-search"
          prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />}
          placeholder="Search settings"
          allowClear
          size="large"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPressEnter={() => matches[0] && onSelect(matches[0].key)}
          aria-label="Search settings"
        />
      </div>

      <nav className="settings-pills" aria-label="Settings categories">
        {matches.map((s) => {
          const active = s.key === activeKey;
          const dot = status[s.key];
          return (
            <button
              key={s.key}
              type="button"
              className={`settings-pill${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
              title={s.hint}
              onClick={() => onSelect(s.key)}
            >
              {s.label}
              {dot && (
                <Tooltip title={dot.text}>
                  <Badge status={dot.status} className="settings-pill-dot" aria-label={dot.text} />
                </Tooltip>
              )}
            </button>
          );
        })}

        {matches.length === 0 && (
          <div className="settings-pills-empty">No settings match &ldquo;{query.trim()}&rdquo;</div>
        )}
      </nav>
    </div>
  );
}
