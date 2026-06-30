/**
 * CommandPalette — ⌘K / Ctrl-K power-user launcher. Fuzzy-filters navigation commands and
 * runs a debounced candidate quick-search (existing candidateService.search). Selecting a
 * result navigates. Open/close is controlled by the parent (which owns the keyboard shortcut).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Input, Spin, Empty } from 'antd';
import {
  DashboardOutlined,
  SearchOutlined,
  UploadOutlined,
  FileTextOutlined,
  FilterOutlined,
  BarChartOutlined,
  MailOutlined,
  SettingOutlined,
  CloudUploadOutlined,
  UserOutlined,
  EnterOutlined,
} from '@ant-design/icons';
import candidateService from '../../services/candidateService';

const NAV_COMMANDS = [
  { key: 'dashboard', label: 'Dashboard', icon: <DashboardOutlined />, url: '/dashboard' },
  { key: 'search_candidates', label: 'Search Candidates', icon: <SearchOutlined />, url: '/candidates', module: 'search_candidates' },
  { key: 'candidate_screening', label: 'Candidate Screening', icon: <FilterOutlined />, url: '/filtering', module: 'candidate_screening' },
  { key: 'new_mrf', label: 'New MRF Request', icon: <FileTextOutlined />, url: '/mrf', module: 'new_mrf' },
  { key: 'screening_analytics', label: 'Screening Analytics', icon: <BarChartOutlined />, url: '/analytics', module: 'screening_analytics' },
  { key: 'hr_manual_upload', label: 'HR Manual Upload', icon: <UploadOutlined />, url: '/hr-upload', module: 'hr_manual_upload' },
  { key: 'vendor_upload', label: 'Vendor Upload', icon: <CloudUploadOutlined />, url: '/vendor', module: 'vendor_upload' },
  { key: 'email', label: 'Email Templates', icon: <MailOutlined />, url: '/email' },
  { key: 'settings', label: 'Reminder Settings', icon: <SettingOutlined />, url: '/settings' },
];

export default function CommandPalette({ open, onClose, onNavigate, isModuleEnabled }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Reset + focus when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  // Debounced candidate search
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await candidateService.search({ search: q }, 1, 6);
        const list = Array.isArray(res.data?.data)
          ? res.data.data
          : (res.data?.data?.data || res.data?.data?.candidates || res.data?.candidates || []);
        setResults(Array.isArray(list) ? list : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query, open]);

  const navMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NAV_COMMANDS
      .filter((c) => !c.module || isModuleEnabled?.(c.module))
      .filter((c) => !q || c.label.toLowerCase().includes(q));
  }, [query, isModuleEnabled]);

  const go = (url) => { onClose?.(); onNavigate?.(url); };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={600}
      styles={{ body: { padding: 0 } }}
      className="dash-cmdk"
      destroyOnClose
    >
      <div className="dash-cmdk__input">
        <SearchOutlined />
        <Input
          ref={inputRef}
          bordered={false}
          placeholder="Search candidates or jump to a screen…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPressEnter={() => {
            if (results[0]?.id) go(`/candidates/${results[0].id}`);
            else if (navMatches[0]) go(navMatches[0].url);
          }}
        />
        <kbd className="dash-kbd">ESC</kbd>
      </div>

      <div className="dash-cmdk__body">
        {navMatches.length > 0 && (
          <div className="dash-cmdk__group">
            <div className="dash-cmdk__grouphead">Navigation</div>
            {navMatches.map((c) => (
              <div key={c.key} className="dash-cmdk__row" onClick={() => go(c.url)}>
                <span className="dash-cmdk__icon">{c.icon}</span>
                <span className="dash-cmdk__label">{c.label}</span>
                <EnterOutlined className="dash-cmdk__enter" />
              </div>
            ))}
          </div>
        )}

        <div className="dash-cmdk__group">
          <div className="dash-cmdk__grouphead">
            Candidates {searching && <Spin size="small" style={{ marginLeft: 8 }} />}
          </div>
          {query.trim().length < 2 ? (
            <div className="dash-cmdk__hint">Type at least 2 characters to search candidates…</div>
          ) : results.length === 0 && !searching ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No candidates found" style={{ padding: '16px 0' }} />
          ) : (
            results.map((c) => {
              const name = c.Name || c.name || '—';
              const role = c.PositionApplied || c.position || '';
              return (
                <div key={c.id} className="dash-cmdk__row" onClick={() => go(`/candidates/${c.id}`)}>
                  <span className="dash-cmdk__icon"><UserOutlined /></span>
                  <span className="dash-cmdk__label">
                    {name}
                    {role && <span className="dash-cmdk__sub"> · {role}</span>}
                  </span>
                  <EnterOutlined className="dash-cmdk__enter" />
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}