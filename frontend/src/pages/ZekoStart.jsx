/**
 * ZekoStart.jsx — PUBLIC (no-login) page between our Zeko email and Zeko
 * itself (U08), at /zeko-start/:token.
 *
 * The email's link (/api/z/<token>) comes here only when we hold no phone for
 * the candidate, or when the link is no longer open. Adding a number is
 * optional: Skip goes straight on to Zeko. When the link is closed (expired,
 * cancelled, already completed) the page says so instead.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Button, Input, Result, Spin, Typography } from 'antd';
import { PhoneOutlined } from '@ant-design/icons';
import zekoLinkService from '../services/zekoLinkService';
import PublicPageShell, { BRAND } from '../components/common/PublicPageShell';

const { Text, Paragraph } = Typography;

/** How a link that is not open reads to the candidate. */
const CLOSED = {
  expired: {
    status: 'warning',
    title: 'This interview link has expired',
    text: 'The window for this interview has closed. If you still want to take it, reply to the email we sent you and our HR team will help.',
  },
  cancelled: {
    status: 'info',
    title: 'This interview was cancelled',
    text: 'Our HR team will contact you about next steps. You can also reply to the email we sent you.',
  },
  completed: {
    status: 'success',
    title: 'You have already taken this interview',
    text: 'Thank you. Our team will review it and be in touch.',
  },
  not_scheduled: {
    status: 'info',
    title: 'This interview is not scheduled yet',
    text: 'You will receive an email with your interview link once it is scheduled.',
  },
  unavailable: {
    status: 'warning',
    title: 'This interview is not available right now',
    text: 'Please reply to the email we sent you and our HR team will help.',
  },
};

/** Same rule as the server (zekoLinkModel.parseCandidatePhone): a 10-digit Indian mobile. */
function looksLikeMobile(value) {
  let digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits);
}

export default function ZekoStart() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await zekoLinkService.getInfo(token);
      setInfo(res?.data?.data ?? null);
    } catch (err) {
      setLoadError(err?.message || 'This interview link could not be opened.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) load(); /* eslint-disable-next-line */ }, [token]);

  const goToZeko = (url) => {
    setLeaving(true);
    window.location.assign(url);
  };

  const continueWithPhone = async () => {
    if (!looksLikeMobile(phone)) {
      setPhoneError('Enter a 10-digit mobile number, for example 98765 43210, or choose Skip.');
      return;
    }
    setPhoneError('');
    setSaving(true);
    try {
      const res = await zekoLinkService.savePhone(token, phone);
      goToZeko(res?.data?.data?.zekoUrl || info.zekoUrl);
    } catch (err) {
      setSaving(false);
      // 409: the window closed while the page was open; show why.
      if (err?.status === 409) { load(); return; }
      setPhoneError(err?.message || 'The number could not be saved. You can try again or choose Skip.');
    }
  };

  if (loading) {
    return (
      <PublicPageShell title="Your AI interview" subtitle="Opening your interview link…">
        <div style={{ textAlign: 'center', padding: '32px 0' }}><Spin size="large" /></div>
      </PublicPageShell>
    );
  }

  if (loadError || !info) {
    return (
      <PublicPageShell title="Link unavailable" subtitle="We could not open this interview link.">
        <Result status="error" title="Link unavailable" subTitle={loadError || 'Please use the link in your latest email from us.'} />
      </PublicPageShell>
    );
  }

  if (info.state !== 'open') {
    const closed = CLOSED[info.state] || CLOSED.unavailable;
    return (
      <PublicPageShell title="Your AI interview" subtitle={info.role || undefined}>
        <Result status={closed.status} title={closed.title} subTitle={closed.text} />
      </PublicPageShell>
    );
  }

  const busy = saving || leaving;

  return (
    <PublicPageShell title="Your AI interview" subtitle="One optional step before you start.">
      <Paragraph style={{ fontSize: 15, marginBottom: 14 }}>
        {info.firstName ? `Hi ${info.firstName},` : 'Hello,'}
      </Paragraph>

      {info.role && (
        <div style={{ background: BRAND.page, borderRadius: 10, padding: '12px 16px', marginBottom: 18 }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>POSITION</Text>
          <Text strong>{info.role}</Text>
        </div>
      )}

      <label htmlFor="zeko-phone" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
        Add a phone number so our team can reach you (optional)
      </label>
      <Input
        id="zeko-phone"
        size="large"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        maxLength={20}
        prefix={<PhoneOutlined style={{ color: '#9ca3af' }} />}
        placeholder="98765 43210"
        value={phone}
        status={phoneError ? 'error' : undefined}
        aria-invalid={phoneError ? true : undefined}
        aria-describedby={phoneError ? 'zeko-phone-error' : undefined}
        disabled={busy}
        onChange={(e) => { setPhone(e.target.value); if (phoneError) setPhoneError(''); }}
        onPressEnter={continueWithPhone}
      />
      {phoneError && (
        <Alert id="zeko-phone-error" type="error" showIcon message={phoneError} style={{ marginTop: 10 }} />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
        <Button
          type="primary"
          size="large"
          loading={saving}
          disabled={leaving && !saving}
          onClick={continueWithPhone}
          style={{ flex: '1 1 200px' }}
        >
          Continue to Zeko
        </Button>
        <Button
          size="large"
          disabled={busy}
          onClick={() => goToZeko(info.zekoUrl)}
          style={{ flex: '1 1 120px' }}
        >
          Skip
        </Button>
      </div>

      <Paragraph type="secondary" style={{ fontSize: 12.5, margin: '16px 0 0 0' }}>
        Your interview runs on Zeko, our AI interview partner. We use this number only to contact you about your application.
      </Paragraph>
    </PublicPageShell>
  );
}
