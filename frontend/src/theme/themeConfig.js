/**
 * AntD 5.x Theme Configuration
 * Maps AAPNA design tokens to Ant Design's token system.
 * Supports both light and dark mode, using the violet brand system sourced from the
 * mera.work product chrome (primary #4f2fb8, hover/accent #6c62d2 → #8b7bea).
 *
 * NOTE: `--gold` / `--green` are historical alias names kept to avoid a repo-wide
 * rename (see theme/brands.js). Read them as brand roles, not as hues.
 *
 * Design Tokens:
 *   --ink: #f8f7fc     (light bg)
 *   --gold: #4f2fb8    (primary brand)
 *   --ink-2: #ffffff   (card bg)
 *   --gold-light: #6c62d2 (primary hover)
 *   --text: #2b2b2b    (primary text)
 *   --text-2: #5f6664  (secondary text)
 *   --green: #4f2fb8   (brand companion — avatars/gradients, NOT success)
 *   --red: #c0392b     (error)
 */
import { theme } from 'antd';

/** Shared tokens across both modes */
const sharedTokens = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyCode: "'DM Mono', 'Fira Code', 'Courier New', monospace",
  // Radius scale — one family, mirrors theme/index.css (--radius-sm/md/lg).
  borderRadius: 8,
  borderRadiusLG: 14,
  borderRadiusSM: 8,
  wireframe: false,
  motion: true,
};

/** Light mode theme */
export const lightTheme = {
  token: {
    ...sharedTokens,
    colorPrimary: '#4f2fb8',
    colorPrimaryHover: '#6c62d2',
    colorPrimaryActive: '#3d2196',
    colorPrimaryBg: '#e7e3f7',
    colorPrimaryBgHover: '#dbd5f2',
    colorSuccess: '#17c653',
    colorError: '#c0392b',
    colorWarning: '#d4a017',
    // Blue, not violet: the brand primary is violet, so an "info" state in violet
    // would be indistinguishable from a primary action. This is mera.work's own
    // link/utility blue, which sits alongside its violet chrome for exactly this role.
    colorInfo: '#1b84ff',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f8f7fc',
    colorBgSpotlight: '#4f2fb8',
    colorText: '#2b2b2b',
    colorTextSecondary: '#5f6664',
    colorTextTertiary: '#6f7671',
    colorTextQuaternary: '#b4bcba',
    colorBorder: '#e0dcec',
    colorBorderSecondary: '#ebe8f4',
    colorFill: 'rgba(79, 47, 184, 0.06)',
    colorFillSecondary: 'rgba(79, 47, 184, 0.04)',
    controlHeight: 40,
    controlHeightLG: 48,
    controlHeightSM: 32,
    fontSize: 14,
    fontSizeLG: 16,
    fontSizeHeading1: 32,
    fontSizeHeading2: 26,
    fontSizeHeading3: 22,
    fontSizeHeading4: 18,
    lineHeight: 1.6,
    boxShadow: '0 1px 3px rgba(22, 16, 40, 0.06)',
    boxShadowSecondary: '0 10px 28px rgba(22, 16, 40, 0.10)',
  },
  components: {
    Button: {
      primaryShadow: '0 4px 14px rgba(79, 47, 184, 0.30)',
      controlHeight: 40,
      borderRadius: 8,
      fontWeight: 600,
    },
    Card: {
      borderRadiusLG: 14,
      boxShadowTertiary: '0 1px 3px rgba(22, 16, 40, 0.06)',
    },
    Table: {
      headerBg: '#f8f7fc',
      headerColor: '#2b2b2b',
      rowHoverBg: 'rgba(79, 47, 184, 0.04)',
      borderColor: '#ebe8f4',
      cellPaddingBlock: 12,
    },
    Menu: {
      itemBg: 'transparent',
      // Selected nav row is a solid brand pill with white text (see aurora-glass.css).
      itemSelectedBg: '#4f2fb8',
      itemSelectedColor: '#ffffff',
      itemHoverBg: 'rgba(79, 47, 184, 0.05)',
      itemHoverColor: '#6c62d2',
      itemActiveBg: 'rgba(79, 47, 184, 0.15)',
      iconSize: 18,
      itemBorderRadius: 8,
    },
    Layout: {
      siderBg: '#ffffff',
      headerBg: '#ffffff',
      bodyBg: '#f8f7fc',
    },
    Input: {
      activeBorderColor: '#4f2fb8',
      hoverBorderColor: '#6c62d2',
      activeShadow: '0 0 0 2px rgba(79, 47, 184, 0.15)',
    },
    Select: {
      optionSelectedBg: 'rgba(79, 47, 184, 0.10)',
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Badge: {
      dotSize: 8,
    },
    Tabs: {
      inkBarColor: '#4f2fb8',
      itemSelectedColor: '#4f2fb8',
      itemHoverColor: '#6c62d2',
    },
    Breadcrumb: {
      lastItemColor: '#2b2b2b',
      linkColor: '#5f6664',
      linkHoverColor: '#4f2fb8',
      separatorColor: '#b4bcba',
    },
  },
};

/** Dark mode theme */
export const darkTheme = {
  // Derives dark-correct values for every token NOT explicitly set below
  // (status backgrounds like colorErrorBg, Tag preset palettes, disabled
  // fills). Explicit token entries still override the algorithm output.
  algorithm: theme.darkAlgorithm,
  token: {
    ...sharedTokens,
    colorPrimary: '#a99cf0',
    colorPrimaryHover: '#c4baf7',
    colorPrimaryActive: '#8b7bea',
    colorPrimaryBg: 'rgba(169, 156, 240, 0.12)',
    colorPrimaryBgHover: 'rgba(169, 156, 240, 0.18)',
    colorSuccess: '#3ddc7f',
    colorError: '#e74c3c',
    colorWarning: '#f0b429',
    // See lightTheme colorInfo — blue keeps info distinct from the violet primary.
    colorInfo: '#4d9fff',
    colorBgContainer: '#161327',
    colorBgElevated: '#1e1a33',
    colorBgLayout: '#0d0b16',
    // Tooltip background — dark neutral (brand violet + white text fails contrast on dark).
    colorBgSpotlight: '#2a2545',
    colorBgMask: 'rgba(0, 0, 0, 0.6)',
    colorText: '#eaeae6',
    colorTextSecondary: '#9ca5a2',
    colorTextTertiary: '#6f7875',
    colorTextQuaternary: '#454e4b',
    colorTextPlaceholder: '#6f7875',
    colorIcon: '#9ca5a2',
    colorIconHover: '#eaeae6',
    colorLink: '#a99cf0',
    colorLinkHover: '#c4baf7',
    colorLinkActive: '#8b7bea',
    colorBorder: '#2b2547',
    colorBorderSecondary: '#1c1833',
    colorSplit: '#1c1833',
    colorFill: 'rgba(169, 156, 240, 0.10)',
    colorFillSecondary: 'rgba(169, 156, 240, 0.06)',
    colorFillTertiary: 'rgba(169, 156, 240, 0.04)',
    colorFillQuaternary: 'rgba(255, 255, 255, 0.03)',
    controlItemBgHover: 'rgba(169, 156, 240, 0.08)',
    controlItemBgActive: 'rgba(169, 156, 240, 0.18)',
    controlHeight: 40,
    controlHeightLG: 48,
    controlHeightSM: 32,
    fontSize: 14,
    fontSizeLG: 16,
    fontSizeHeading1: 32,
    fontSizeHeading2: 26,
    fontSizeHeading3: 22,
    fontSizeHeading4: 18,
    lineHeight: 1.6,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
    boxShadowSecondary: '0 6px 20px rgba(0, 0, 0, 0.35)',
  },
  components: {
    Button: {
      primaryShadow: '0 4px 14px rgba(169, 156, 240, 0.30)',
      controlHeight: 40,
      borderRadius: 8,
      fontWeight: 600,
    },
    Card: {
      borderRadiusLG: 14,
      boxShadowTertiary: '0 1px 3px rgba(0, 0, 0, 0.22)',
    },
    Table: {
      headerBg: '#191630',
      headerColor: '#eaeae6',
      rowHoverBg: 'rgba(169, 156, 240, 0.06)',
      borderColor: '#2b2547',
      cellPaddingBlock: 12,
    },
    Menu: {
      itemBg: 'transparent',
      // Solid pill in dark mode too; the light-violet primary takes dark ink.
      itemSelectedBg: '#a99cf0',
      itemSelectedColor: '#16132a',
      itemHoverBg: 'rgba(169, 156, 240, 0.08)',
      itemHoverColor: '#a99cf0',
      itemActiveBg: 'rgba(169, 156, 240, 0.22)',
      darkItemBg: 'transparent',
      darkItemSelectedBg: '#a99cf0',
      darkItemSelectedColor: '#16132a',
      iconSize: 18,
      itemBorderRadius: 8,
    },
    Layout: {
      siderBg: '#161327',
      headerBg: '#161327',
      bodyBg: '#0d0b16',
    },
    Input: {
      activeBorderColor: '#a99cf0',
      hoverBorderColor: '#c4baf7',
      activeShadow: '0 0 0 2px rgba(169, 156, 240, 0.2)',
    },
    Select: {
      optionSelectedBg: 'rgba(169, 156, 240, 0.18)',
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Badge: {
      dotSize: 8,
    },
    Modal: {
      contentBg: '#1e1a33',
      headerBg: '#1e1a33',
    },
    Drawer: {
      colorBgElevated: '#1e1a33',
    },
    Tooltip: {
      colorBgSpotlight: '#2a2545',
      colorTextLightSolid: '#eaeae6',
    },
    Tabs: {
      inkBarColor: '#a99cf0',
      itemSelectedColor: '#a99cf0',
      itemHoverColor: '#c4baf7',
    },
    Breadcrumb: {
      lastItemColor: '#eaeae6',
      linkColor: '#9ca5a2',
      linkHoverColor: '#a99cf0',
      separatorColor: '#454e4b',
    },
  },
};

export default { lightTheme, darkTheme };
