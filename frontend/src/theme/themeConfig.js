/**
 * AntD 5.x Theme Configuration
 * Maps AAPNA design tokens to Ant Design's token system.
 * Supports both light and dark mode, using the Workable-inspired teal/forest-green color system.
 *
 * Design Tokens:
 *   --ink: #f7f6f3    (light bg)
 *   --gold: #005f56   (primary brand)
 *   --ink-2: #ffffff   (card bg)
 *   --gold-light: #007a6f (primary hover)
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
    colorPrimary: '#005f56',
    colorPrimaryHover: '#007a6f',
    colorPrimaryActive: '#004841',
    colorPrimaryBg: '#e0f0ef',
    colorPrimaryBgHover: '#d0e6e4',
    colorSuccess: '#4a7c59',
    colorError: '#c0392b',
    colorWarning: '#d4a017',
    colorInfo: '#2980b9',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f7f6f3',
    colorBgSpotlight: '#005f56',
    colorText: '#2b2b2b',
    colorTextSecondary: '#5f6664',
    colorTextTertiary: '#808785',
    colorTextQuaternary: '#b4bcba',
    colorBorder: '#dde1df',
    colorBorderSecondary: '#eaebe8',
    colorFill: 'rgba(0, 95, 86, 0.06)',
    colorFillSecondary: 'rgba(0, 95, 86, 0.04)',
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
    boxShadow: '0 2px 8px rgba(0, 95, 86, 0.06)',
    boxShadowSecondary: '0 6px 20px rgba(0, 95, 86, 0.08)',
  },
  components: {
    Button: {
      primaryShadow: '0 2px 8px rgba(0, 95, 86, 0.35)',
      controlHeight: 40,
      borderRadius: 8,
      fontWeight: 600,
    },
    Card: {
      borderRadiusLG: 12,
      boxShadowTertiary: '0 1px 4px rgba(0, 95, 86, 0.06)',
    },
    Table: {
      headerBg: '#f7f6f3',
      headerColor: '#2b2b2b',
      rowHoverBg: 'rgba(0, 95, 86, 0.04)',
      borderColor: '#eaebe8',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(0, 95, 86, 0.10)',
      itemSelectedColor: '#005f56',
      itemHoverBg: 'rgba(0, 95, 86, 0.05)',
      itemHoverColor: '#007a6f',
      itemActiveBg: 'rgba(0, 95, 86, 0.15)',
      iconSize: 18,
      itemBorderRadius: 8,
    },
    Layout: {
      siderBg: '#ffffff',
      headerBg: '#ffffff',
      bodyBg: '#f7f6f3',
    },
    Input: {
      activeBorderColor: '#005f56',
      hoverBorderColor: '#007a6f',
      activeShadow: '0 0 0 2px rgba(0, 95, 86, 0.15)',
    },
    Select: {
      optionSelectedBg: 'rgba(0, 95, 86, 0.10)',
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Badge: {
      dotSize: 8,
    },
    Tabs: {
      inkBarColor: '#005f56',
      itemSelectedColor: '#005f56',
      itemHoverColor: '#007a6f',
    },
    Breadcrumb: {
      lastItemColor: '#2b2b2b',
      linkColor: '#5f6664',
      linkHoverColor: '#005f56',
      separatorColor: '#b4bcba',
    },
  },
};

/** Dark mode theme */
export const darkTheme = {
  token: {
    ...sharedTokens,
    colorPrimary: '#00a294',
    colorPrimaryHover: '#00c2b2',
    colorPrimaryActive: '#008e82',
    colorPrimaryBg: 'rgba(0, 162, 148, 0.12)',
    colorPrimaryBgHover: 'rgba(0, 162, 148, 0.18)',
    colorSuccess: '#5a9c6e',
    colorError: '#e74c3c',
    colorWarning: '#f0b429',
    colorInfo: '#3498db',
    colorBgContainer: '#121816',
    colorBgElevated: '#1a221f',
    colorBgLayout: '#0a0e0c',
    colorBgSpotlight: '#00a294',
    colorText: '#eaeae6',
    colorTextSecondary: '#9ca5a2',
    colorTextTertiary: '#6f7875',
    colorTextQuaternary: '#454e4b',
    colorBorder: '#233330',
    colorBorderSecondary: '#1b2624',
    colorFill: 'rgba(0, 162, 148, 0.10)',
    colorFillSecondary: 'rgba(0, 162, 148, 0.06)',
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
      primaryShadow: '0 2px 8px rgba(0, 162, 148, 0.3)',
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
      rowHoverBg: 'rgba(0, 162, 148, 0.06)',
      borderColor: '#233330',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(0, 162, 148, 0.18)',
      itemSelectedColor: '#00a294',
      itemHoverBg: 'rgba(0, 162, 148, 0.08)',
      itemHoverColor: '#00a294',
      itemActiveBg: 'rgba(0, 162, 148, 0.22)',
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(0, 162, 148, 0.18)',
      darkItemSelectedColor: '#00a294',
      iconSize: 18,
      itemBorderRadius: 8,
    },
    Layout: {
      siderBg: '#121816',
      headerBg: '#121816',
      bodyBg: '#0a0e0c',
    },
    Input: {
      activeBorderColor: '#00a294',
      hoverBorderColor: '#00c2b2',
      activeShadow: '0 0 0 2px rgba(0, 162, 148, 0.2)',
    },
    Select: {
      optionSelectedBg: 'rgba(0, 162, 148, 0.18)',
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Badge: {
      dotSize: 8,
    },
    Tabs: {
      style: { marginBottom: 0 },
      inkBarColor: '#00a294',
      itemSelectedColor: '#00a294',
      itemHoverColor: '#00c2b2',
    },
    Breadcrumb: {
      lastItemColor: '#eaeae6',
      linkColor: '#9ca5a2',
      linkHoverColor: '#00a294',
      separatorColor: '#454e4b',
    },
  },
};

export default { lightTheme, darkTheme };
