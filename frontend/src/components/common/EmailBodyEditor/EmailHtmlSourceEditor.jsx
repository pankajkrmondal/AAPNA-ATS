import CodeMirror from '@uiw/react-codemirror';
import { html as cmHtml } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';

const CM_EXTENSIONS = [cmHtml(), EditorView.lineWrapping];

/**
 * Raw HTML source view/edit for an email body. Dumb `{value, onChange}`
 * component — pretty-print-on-tab-entry and remount-key policy stay
 * caller-owned (mirrors the Email Templates page's existing `htmlView`
 * rev-tracking approach).
 */
export default function EmailHtmlSourceEditor({ value, onChange, theme = 'light', autoHeight = false }) {
  return (
    <div className="email-html-editor">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={CM_EXTENSIONS}
        theme={theme}
        // "100%" fills a fixed-height pane (the modals); "auto" grows with the
        // source so this page has no dead space under a short template.
        height={autoHeight ? 'auto' : '100%'}
        basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: true }}
        aria-label="Raw email HTML source"
      />
    </div>
  );
}
