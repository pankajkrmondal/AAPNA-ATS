/**
 * PublicPageShell — the AAPNA-branded frame for the public, token-linked pages a
 * candidate or interviewer reaches from an email (document upload, interviewer
 * scorecard, MRF submission and approval).
 *
 * These pages are the only AAPNA surface most external people ever see, and they were
 * unbranded white cards on grey — visually unrelated to the branded email that sent
 * the person there. This reproduces that email's shell (green band, logo, white card,
 * grey footer) so clicking through feels like one continuous journey rather than a
 * hand-off to some unrelated tool.
 *
 * WHAT THE V3 CONVERSION CHANGED, AND WHAT IT DELIBERATELY DID NOT
 * The composition is untouched — band, logo, card, footer, in that order — because
 * mirroring the email is the entire point of this component and a "nicer" layout would
 * defeat it. What changed is that the values are now tokens instead of a private
 * palette and Arial:
 *
 *   - It rendered app UI in `Arial, Helvetica, sans-serif`. That was the single
 *     largest typographic outlier in the product: eight font stacks existed for three
 *     loaded families, and this was the only one that was not a token at all.
 *     (The EMAIL templates stay Arial — mail clients support neither webfonts nor CSS
 *     variables. That is `backend/emailLayout.service.js` and `utils/emailPreview.js`,
 *     and it is correct there.)
 *   - It carried its own frozen BRAND object — a second source of brand truth that a
 *     tenant palette could never reach.
 *   - Its shadow was raw black. The depth ramp is brand-hued for a measured reason:
 *     on a light ground a grey shadow reads as dirt where a brand-tinted one reads as
 *     glow.
 *
 * BRAND is still exported because backend/src/services/emailLayout.service.js is kept
 * in step with it by convention and other modules import the accent. It now derives
 * from the same tokens rather than restating them.
 */
import { Typography } from 'antd';

const { Text } = Typography;

/**
 * Kept for the modules that import it (email preview, MRF pages). The values are the
 * shipped AAPNA defaults so nothing that consumes this outside a themed React tree
 * changes; inside one, the CSS below uses tokens and follows the brand.
 */
export const BRAND = Object.freeze({
  accent: '#7a922e',
  page: '#f4f6f9',
  card: '#ffffff',
  footerBg: '#f3f4f6',
  footerText: '#9ca3af',
  logo: 'https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png',
});

/**
 * @param {object} props
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.subtitle] the one-line "what this page is for"
 * @param {number} [props.maxWidth=680]
 */
export default function PublicPageShell({ title, subtitle, maxWidth = 680, children }) {
  return (
    <div className="pps">
      {/* The measure is the one per-instance value, and it is data (how wide this
          particular form wants to be), so it goes through a custom property rather
          than an inline width — the pattern the design law prescribes. */}
      <div className="pps__card" style={{ '--pps-max': `${maxWidth}px` }}>
        {/* Green band — same composition as the branded email header. */}
        <div className="pps__band">
          <img
            src={BRAND.logo}
            alt="AAPNA Infotech"
            width={180}
            className="pps__logo"
          />
          {title && <h1 className="pps__title">{title}</h1>}
          {subtitle && <p className="pps__subtitle">{subtitle}</p>}
        </div>

        <div className="pps__body">{children}</div>

        <div className="pps__footer">
          <Text className="pps__footer-text">
            © {new Date().getFullYear()} AAPNA Infotech. All rights reserved.
          </Text>
        </div>
      </div>
    </div>
  );
}
