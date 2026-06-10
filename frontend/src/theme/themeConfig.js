/**
 * AntD 5.x Theme Configuration
 * Maps AAPNA design tokens to Ant Design's token system.
 * Supports both light and dark mode.
 *
 * Design Tokens:
 *   --ink: #f5f5f0    (light bg)
 *   --gold: #7a922e   (primary brand)
 *   --ink-2: #ffffff   (card bg)
 *   --gold-light: #8fa840 (primary hover)
 *   --text: #1a1e10   (primary text)
 *   --text-2: #4a5232  (secondary text)
 *   --green: #4a7c59   (success)
 *   --red: #c0392b     (error)
 */

/** Shared tokens across both modes */
const sharedTokens = {
  fontFamily: "'Sora', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyCode: "'DM Mono', 'Fira Code', 'Courier New', monospace",
  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  wireframe: false,
  motion: true,
};

/** Light mode theme */
export const lightTheme = {
  token: {
    ...sharedTokens,
    colorPrimary: '#7a922e',
    colorPrimaryHover: '#8fa840',
    colorPrimaryActive: '#6b8025',
    colorPrimaryBg: '#f0f4e4',
    colorPrimaryBgHover: '#e5ebd3',
    colorSuccess: '#4a7c59',
    colorError: '#c0392b',
    colorWarning: '#d4a017',
    colorInfo: '#2980b9',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f5f5f0',
    colorBgSpotlight: '#7a922e',
    colorText: '#1a1e10',
    colorTextSecondary: '#4a5232',
    colorTextTertiary: '#6b7548',
    colorTextQuaternary: '#a0aa84',
    colorBorder: '#d9dcc8',
    colorBorderSecondary: '#e8eade',
    colorFill: 'rgba(122, 146, 46, 0.06)',
    colorFillSecondary: 'rgba(122, 146, 46, 0.04)',
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
    boxShadow: '0 2px 8px rgba(26, 30, 16, 0.06)',
    boxShadowSecondary: '0 6px 20px rgba(26, 30, 16, 0.08)',
  },
  components: {
    Button: {
      primaryShadow: '0 2px 8px rgba(122, 146, 46, 0.35)',
      controlHeight: 40,
      borderRadius: 8,
      fontWeight: 600,
    },
    Card: {
      borderRadiusLG: 12,
      boxShadowTertiary: '0 1px 4px rgba(26, 30, 16, 0.06)',
    },
    Table: {
      headerBg: '#f5f5f0',
      headerColor: '#1a1e10',
      rowHoverBg: 'rgba(122, 146, 46, 0.04)',
      borderColor: '#e8eade',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(122, 146, 46, 0.12)',
      itemSelectedColor: '#7a922e',
      itemHoverBg: 'rgba(122, 146, 46, 0.06)',
      itemHoverColor: '#7a922e',
      itemActiveBg: 'rgba(122, 146, 46, 0.15)',
      iconSize: 18,
      itemBorderRadius: 8,
    },
    Layout: {
      siderBg: '#ffffff',
      headerBg: '#ffffff',
      bodyBg: '#f5f5f0',
    },
    Input: {
      activeBorderColor: '#7a922e',
      hoverBorderColor: '#8fa840',
      activeShadow: '0 0 0 2px rgba(122, 146, 46, 0.15)',
    },
    Select: {
      optionSelectedBg: 'rgba(122, 146, 46, 0.12)',
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Badge: {
      dotSize: 8,
    },
    Tabs: {
      inkBarColor: '#7a922e',
      itemSelectedColor: '#7a922e',
      itemHoverColor: '#8fa840',
    },
    Breadcrumb: {
      lastItemColor: '#1a1e10',
      linkColor: '#4a5232',
      linkHoverColor: '#7a922e',
      separatorColor: '#a0aa84',
    },
  },
};

/** Dark mode theme */
export const darkTheme = {
  token: {
    ...sharedTokens,
    colorPrimary: '#8fa840',
    colorPrimaryHover: '#a0bc4d',
    colorPrimaryActive: '#7a922e',
    colorPrimaryBg: 'rgba(143, 168, 64, 0.12)',
    colorPrimaryBgHover: 'rgba(143, 168, 64, 0.18)',
    colorSuccess: '#5a9c6e',
    colorError: '#e74c3c',
    colorWarning: '#f0b429',
    colorInfo: '#3498db',
    colorBgContainer: '#1a1e10',
    colorBgElevated: '#232818',
    colorBgLayout: '#111408',
    colorBgSpotlight: '#8fa840',
    colorText: '#f5f5f0',
    colorTextSecondary: '#c8ccb4',
    colorTextTertiary: '#8d9470',
    colorTextQuaternary: '#5a6340',
    colorBorder: '#333d1e',
    colorBorderSecondary: '#2a3218',
    colorFill: 'rgba(143, 168, 64, 0.10)',
    colorFillSecondary: 'rgba(143, 168, 64, 0.06)',
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
      primaryShadow: '0 2px 8px rgba(143, 168, 64, 0.3)',
      controlHeight: 40,
      borderRadius: 8,
      fontWeight: 600,
    },
    Card: {
      borderRadiusLG: 12,
      boxShadowTertiary: '0 1px 4px rgba(0, 0, 0, 0.2)',
    },
    Table: {
      headerBg: '#1e2312',
      headerColor: '#f5f5f0',
      rowHoverBg: 'rgba(143, 168, 64, 0.06)',
      borderColor: '#333d1e',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(143, 168, 64, 0.18)',
      itemSelectedColor: '#8fa840',
      itemHoverBg: 'rgba(143, 168, 64, 0.08)',
      itemHoverColor: '#8fa840',
      itemActiveBg: 'rgba(143, 168, 64, 0.22)',
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(143, 168, 64, 0.18)',
      darkItemSelectedColor: '#8fa840',
      iconSize: 18,
      itemBorderRadius: 8,
    },
    Layout: {
      siderBg: '#1a1e10',
      headerBg: '#1a1e10',
      bodyBg: '#111408',
    },
    Input: {
      activeBorderColor: '#8fa840',
      hoverBorderColor: '#a0bc4d',
      activeShadow: '0 0 0 2px rgba(143, 168, 64, 0.2)',
    },
    Select: {
      optionSelectedBg: 'rgba(143, 168, 64, 0.18)',
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Badge: {
      dotSize: 8,
    },
    Tabs: {
      inkBarColor: '#8fa840',
      itemSelectedColor: '#8fa840',
      itemHoverColor: '#a0bc4d',
    },
    Breadcrumb: {
      lastItemColor: '#f5f5f0',
      linkColor: '#c8ccb4',
      linkHoverColor: '#8fa840',
      separatorColor: '#5a6340',
    },
  },
};

export default { lightTheme, darkTheme };
