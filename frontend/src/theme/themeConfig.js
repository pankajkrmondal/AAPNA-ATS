/**
 * AntD 5.x Theme Configuration
 * Maps AAPNA design tokens to Ant Design's token system.
 * Supports both light and dark mode, using the Workable-inspired teal/forest-green color system.
 *
 * Design Tokens:
 *   --ink: #f7f6f3    (light bg)
 *   --gold: #7a922e   (primary brand)
 *   --ink-2: #ffffff   (card bg)
 *   --gold-light: #92a63c (primary hover)
 *   --text: #2b2b2b   (primary text)
 *   --text-2: #5f6664  (secondary text)
 *   --green: #4a7c59   (success)
 *   --red: #c0392b     (error)
 */

/** Shared tokens across both modes */
const sharedTokens = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
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
    colorPrimaryHover: '#92a63c',
    colorPrimaryActive: '#5f7424',
    colorPrimaryBg: '#eef3da',
    colorPrimaryBgHover: '#e3ecc8',
    colorSuccess: '#4a7c59',
    colorError: '#c0392b',
    colorWarning: '#d4a017',
    colorInfo: '#2980b9',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f7f6f3',
    colorBgSpotlight: '#7a922e',
    colorText: '#2b2b2b',
    colorTextSecondary: '#5f6664',
    colorTextTertiary: '#808785',
    colorTextQuaternary: '#b4bcba',
    colorBorder: '#dde1df',
    colorBorderSecondary: '#eaebe8',
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
    boxShadow: '0 2px 8px rgba(122, 146, 46, 0.06)',
    boxShadowSecondary: '0 6px 20px rgba(122, 146, 46, 0.08)',
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
      boxShadowTertiary: '0 1px 4px rgba(122, 146, 46, 0.06)',
    },
    Table: {
      headerBg: '#f7f6f3',
      headerColor: '#2b2b2b',
      rowHoverBg: 'rgba(122, 146, 46, 0.04)',
      borderColor: '#eaebe8',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(122, 146, 46, 0.10)',
      itemSelectedColor: '#7a922e',
      itemHoverBg: 'rgba(122, 146, 46, 0.05)',
      itemHoverColor: '#92a63c',
      itemActiveBg: 'rgba(122, 146, 46, 0.15)',
      iconSize: 18,
      itemBorderRadius: 8,
    },
    Layout: {
      siderBg: '#ffffff',
      headerBg: '#ffffff',
      bodyBg: '#f7f6f3',
    },
    Input: {
      activeBorderColor: '#7a922e',
      hoverBorderColor: '#92a63c',
      activeShadow: '0 0 0 2px rgba(122, 146, 46, 0.15)',
    },
    Select: {
      optionSelectedBg: 'rgba(122, 146, 46, 0.10)',
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
      itemHoverColor: '#92a63c',
    },
    Breadcrumb: {
      lastItemColor: '#2b2b2b',
      linkColor: '#5f6664',
      linkHoverColor: '#7a922e',
      separatorColor: '#b4bcba',
    },
  },
};

/** Dark mode theme */
export const darkTheme = {
  token: {
    ...sharedTokens,
    colorPrimary: '#a8c24a',
    colorPrimaryHover: '#bcd566',
    colorPrimaryActive: '#94ad3f',
    colorPrimaryBg: 'rgba(168, 194, 74, 0.12)',
    colorPrimaryBgHover: 'rgba(168, 194, 74, 0.18)',
    colorSuccess: '#5a9c6e',
    colorError: '#e74c3c',
    colorWarning: '#f0b429',
    colorInfo: '#3498db',
    colorBgContainer: '#121816',
    colorBgElevated: '#1a221f',
    colorBgLayout: '#0a0e0c',
    colorBgSpotlight: '#a8c24a',
    colorText: '#eaeae6',
    colorTextSecondary: '#9ca5a2',
    colorTextTertiary: '#6f7875',
    colorTextQuaternary: '#454e4b',
    colorBorder: '#233330',
    colorBorderSecondary: '#1b2624',
    colorFill: 'rgba(168, 194, 74, 0.10)',
    colorFillSecondary: 'rgba(168, 194, 74, 0.06)',
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
      primaryShadow: '0 2px 8px rgba(168, 194, 74, 0.3)',
      controlHeight: 40,
      borderRadius: 8,
      fontWeight: 600,
    },
    Card: {
      borderRadiusLG: 12,
      boxShadowTertiary: '0 1px 4px rgba(0, 0, 0, 0.2)',
    },
    Table: {
      headerBg: '#151e1b',
      headerColor: '#eaeae6',
      rowHoverBg: 'rgba(168, 194, 74, 0.06)',
      borderColor: '#233330',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(168, 194, 74, 0.18)',
      itemSelectedColor: '#a8c24a',
      itemHoverBg: 'rgba(168, 194, 74, 0.08)',
      itemHoverColor: '#a8c24a',
      itemActiveBg: 'rgba(168, 194, 74, 0.22)',
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(168, 194, 74, 0.18)',
      darkItemSelectedColor: '#a8c24a',
      iconSize: 18,
      itemBorderRadius: 8,
    },
    Layout: {
      siderBg: '#121816',
      headerBg: '#121816',
      bodyBg: '#0a0e0c',
    },
    Input: {
      activeBorderColor: '#a8c24a',
      hoverBorderColor: '#bcd566',
      activeShadow: '0 0 0 2px rgba(168, 194, 74, 0.2)',
    },
    Select: {
      optionSelectedBg: 'rgba(168, 194, 74, 0.18)',
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Badge: {
      dotSize: 8,
    },
    Tabs: {
      style: { marginBottom: 0 },
      inkBarColor: '#a8c24a',
      itemSelectedColor: '#a8c24a',
      itemHoverColor: '#bcd566',
    },
    Breadcrumb: {
      lastItemColor: '#eaeae6',
      linkColor: '#9ca5a2',
      linkHoverColor: '#a8c24a',
      separatorColor: '#454e4b',
    },
  },
};

export default { lightTheme, darkTheme };
