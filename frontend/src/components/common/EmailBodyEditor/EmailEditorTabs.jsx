import { useRef, useState } from 'react';
import { Tabs } from 'antd';
import { EditOutlined, CodeOutlined, EyeOutlined } from '@ant-design/icons';
import EmailBodyEditor from './EmailBodyEditor';
import EmailHtmlSourceEditor from './EmailHtmlSourceEditor';
import EmailPreviewPane from './EmailPreviewPane';
import { formatHtml } from './sanitize';
import { DEFAULT_TOOLBAR } from './Toolbar';

/**
 * The full Editor / HTML Code / Live Preview tab set — the same three-tab
 * experience the Email Templates page pioneered, now shared by every
 * email-editing surface (Candidate Screening's shortlist/reject modal, the
 * Pipeline drawer's outcome and interview-schedule/cancel modals) instead of
 * each one growing its own bespoke subset.
 *
 * `bodyHtml`/`onBodyChange` are the controlled source of truth at the CALLER
 * level (unlike the bare EmailBodyEditor, which is uncontrolled-after-mount)
 * — this component needs the current value on tab entry (to pretty-print
 * into the HTML tab) and to build the Preview tab, neither of which a
 * write-only child can provide.
 *
 * `fillHeight` opts into the Email Templates page's flex-fill layout classes
 * (email-editor-tabs/email-tabpane) for its full-page split view; modals
 * (default) size each pane by its own explicit `height`/CSS default instead,
 * since they aren't flex-column-filling a viewport-height card.
 */
export default function EmailEditorTabs({
  bodyHtml,
  onBodyChange,
  subject,
  wrapper,
  placeholders = [],
  toolbar = DEFAULT_TOOLBAR,
  compact = false,
  height,
  isDark = false,
  fillHeight = false,
  to,
  htmlExtra,
  // The Live Preview tab shows these instead of the raw editable subject/body
  // when provided — for callers that compile placeholder tokens into sample
  // values (e.g. {candidate_name} -> "John Doe") for previewing. Defaults to
  // the raw values, which is already correct for callers whose body arrives
  // pre-compiled with real values server-side (nothing left to substitute).
  previewSubject,
  previewBodyHtml,
  // Let each pane grow to its content rather than sit in a fixed-height box.
  // Opt-in so modal callers, which size their panes explicitly, are unaffected.
  autoHeight = false,
}) {
  const [activeTab, setActiveTab] = useState('1');
  const [editorRev, setEditorRev] = useState(0);
  const [htmlView, setHtmlView] = useState({ rev: 0, text: '' });
  const htmlDirtyRef = useRef(false);
  const bodyRef = useRef(bodyHtml);
  bodyRef.current = bodyHtml;

  const handleTabChange = (key) => {
    // Entering the code tab: pretty-print so the source is readable
    // (whitespace-only change — doesn't force an editor reload on its own).
    if (key === '2') {
      setHtmlView((v) => ({ rev: v.rev + 1, text: formatHtml(bodyRef.current) }));
    }
    // Entering the visual editor after raw-HTML edits: remount it from the
    // latest body so it picks up those edits.
    if (key === '1' && htmlDirtyRef.current) {
      htmlDirtyRef.current = false;
      setEditorRev((r) => r + 1);
    }
    setActiveTab(key);
  };

  const handleHtmlChange = (value) => {
    onBodyChange(value);
    htmlDirtyRef.current = true;
  };

  const pane = (extraClass, children) => (
    <div className={fillHeight ? `email-tabpane ${extraClass}` : undefined}>{children}</div>
  );

  return (
    <Tabs
      activeKey={activeTab}
      onChange={handleTabChange}
      type="card"
      size="small"
      className={fillHeight ? 'email-editor-tabs' : undefined}
      items={[
        {
          key: '1',
          label: <span><EditOutlined /> Editor</span>,
          children: pane('email-editor-pane', (
            <EmailBodyEditor
              key={`ed-${editorRev}`}
              initialHtml={bodyHtml}
              onChange={onBodyChange}
              wrapper={wrapper}
              subject={subject}
              placeholders={placeholders}
              toolbar={toolbar}
              compact={compact}
              height={height}
              autoHeight={autoHeight}
            />
          )),
        },
        {
          key: '2',
          label: <span><CodeOutlined /> HTML Code</span>,
          children: pane('email-html-pane', (
            <>
              {htmlExtra && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>{htmlExtra}</div>
              )}
              <EmailHtmlSourceEditor
                key={`html-${htmlView.rev}`}
                value={htmlView.text}
                onChange={handleHtmlChange}
                theme={isDark ? 'dark' : 'light'}
                autoHeight={autoHeight}
              />
            </>
          )),
        },
        {
          key: '3',
          label: <span><EyeOutlined /> Live Preview</span>,
          children: pane('email-preview-pane', (
            <EmailPreviewPane
              subject={previewSubject ?? subject}
              bodyHtml={previewBodyHtml ?? bodyHtml}
              wrapper={wrapper}
              to={to}
              autoHeight={autoHeight}
            />
          )),
        },
      ]}
    />
  );
}