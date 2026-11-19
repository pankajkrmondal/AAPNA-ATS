/**
 * Settings › Interviews › chain strip.
 *
 * The four interview automations run as one chain: book the meeting → remind
 * people → confirm it was held → capture the recording. The strip shows each
 * link's live state and jumps to its card, so the section reads as a sequence
 * rather than four unrelated boxes.
 *
 * Every value is derived from the config the page already holds; the tags use
 * the same wording and colours as the cards' own header tags.
 */
import { Tag } from 'antd';
import { ArrowRightOutlined, BellOutlined, CheckCircleOutlined, UsergroupAddOutlined, VideoCameraOutlined } from '@ant-design/icons';

/** Ids on the four interview cards in Settings.jsx — the strip scrolls to these. */
export const INTERVIEW_CARD_IDS = {
  book: 'settings-interview-book',
  remind: 'settings-interview-remind',
  confirm: 'settings-interview-confirm',
  record: 'settings-interview-record',
};

function scrollToCard(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

export default function InterviewChainStrip({ attendeeCfg, interviewCfg, occurrenceCfg, recordingCfg, loading }) {
  const onOff = (on) => ({ text: on ? 'ON' : 'OFF', color: on ? 'green' : 'default' });
  const added = attendeeCfg.emails.length;

  const steps = [
    {
      key: 'book',
      label: 'Book',
      detail: 'Recruiters on the meeting',
      icon: UsergroupAddOutlined,
      tag: { text: added ? `${added} ADDED` : 'NONE', color: added ? 'green' : 'default' },
    },
    {
      key: 'remind',
      label: 'Remind',
      detail: 'Email before it starts',
      icon: BellOutlined,
      tag: onOff(interviewCfg.enabled),
    },
    {
      key: 'confirm',
      label: 'Confirm held',
      detail: 'Check it took place',
      icon: CheckCircleOutlined,
      tag: onOff(occurrenceCfg.enabled),
    },
    {
      key: 'record',
      label: 'Record',
      detail: 'Link the Teams recording',
      icon: VideoCameraOutlined,
      tag: recordingCfg.fetch_enabled
        ? onOff(recordingCfg.enabled)
        : { text: 'UNAVAILABLE', color: 'default' },
    },
  ];

  // The wrapper is the size container the strip's own @container rule reads, so
  // it reflows on the column's width rather than the window's (the app sidebar
  // can be open or collapsed at the same window width).
  return (
    <div className="interview-chain-wrap">
      <ol className="interview-chain" aria-label="Interview automation chain">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const on = s.tag.color === 'green';
          return (
            <li key={s.key} className="interview-chain-item">
              {i > 0 && <ArrowRightOutlined className="interview-chain-arrow" aria-hidden="true" />}
              <button
                type="button"
                className={`interview-chain-step${on ? ' is-on' : ''}`}
                onClick={() => scrollToCard(INTERVIEW_CARD_IDS[s.key])}
              >
                <span className="interview-chain-top">
                  <span className="interview-chain-icon"><Icon /></span>
                  {!loading && (
                    <Tag color={s.tag.color} className="interview-chain-tag">{s.tag.text}</Tag>
                  )}
                </span>
                <span className="interview-chain-label">{i + 1}. {s.label}</span>
                <span className="interview-chain-detail">{s.detail}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
