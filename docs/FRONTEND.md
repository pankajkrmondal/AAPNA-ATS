# Frontend Client Documentation

The frontend of the AAPNA ATS is a modern, responsive Single Page Application (SPA). It is built using **React (v18)**, bundled via **Vite**, and styled with **Ant Design (antd v5)** alongside a custom vanilla CSS variables design system.

---

## 🎨 Design System & Theme Engine

The user interface uses a unified custom theme with a curated color palette (olive/gold accents, dark ink backgrounds). The theme automatically adapts to light and dark modes.

### Theme Configurations (`frontend/src/theme/themeConfig.js`)
* **Primary Brand Accent**: `#7a922e` (Light mode gold/olive) and `#8fa840` (Dark mode light olive).
* **Base Typography**: **Sora** (loaded from Google Fonts) for body and headings, and **DM Mono** for code fragments or metrics.
* **Component Specific Overrides**: Custom rounded corners (`borderRadius: 8px`), input field focus glows, table border colors, and layout background colors (`#f5f5f0` for light, `#111408` for dark layout backgrounds).

### HSL Color Tokens (`frontend/src/theme/index.css`)
Theme variables are mapped globally in `index.css` under the `:root` and `[data-theme='dark']` namespaces:
* `--ink`: `#f5f5f0` (light) | `#111408` (dark)
* `--ink-2`: `#ffffff` (light) | `#1a1e10` (dark)
* `--gold`: `#7a922e` (light) | `#8fa840` (dark)
* `--text`: `#1a1e10` (light) | `#f5f5f0` (dark)
* `--text-2`: `#4a5232` (light) | `#c8ccb4` (dark)

---

## 📂 Frontend Directory Layout

Below is the directory structure under `frontend/src` with component-level explanations:

```text
frontend/src/
├── main.jsx                 # Entry point; sets up React Query Provider and imports global styles
├── App.jsx                  # Root App; sets up Theme & Auth Contexts, router configurations, and guards
├── components/              # Shared UI components
│   └── common/              # Reusable presentational components
│       ├── LoadingSkeleton.jsx  # Grid-based skeletons for page-load mockups
│       ├── NotificationBell.jsx # Dropdown bell listing unread candidate emails
│       ├── PageHeader.jsx       # Standardised breadcrumb header with actions
│       ├── SkillTags.jsx        # Standardised green/gold tags for candidate skills
│       ├── StatCard.jsx         # Card component showing statistics with icons
│       └── StatusBadge.jsx      # Maps pipeline statuses to colored AntD Badges
├── context/                 # Context providers for global state
│   ├── AuthContext.jsx      # Manages user session state, local token cache, and JWT authentication
│   └── ThemeContext.jsx     # Controls dark/light mode toggles and data-theme CSS updates
├── hooks/                   # Custom React hooks
│   ├── useAuth.jsx          # Context helper to consume user identity
│   └── useTheme.jsx         # Context helper to toggle and retrieve visual theme
├── layouts/                 # Page skeleton shells
│   ├── AuthLayout.jsx       # Split-pane layout for login screens with glassmorphism forms
│   └── MainLayout.jsx       # Main layout including sidebar navigation, top header, and page enter transitions
├── pages/                   # Main page components
│   ├── AdminDashboard.jsx   # Grid workspace for user verification and permission updates
│   ├── AdminLogin.jsx       # Security gate for administrative staff
│   ├── Analytics.jsx        # Data visualization charts (recharts) for recruitment KPIs
│   ├── CandidateDetail.jsx  # Candidate profile view, structured fields, and email conversation tabs
│   ├── CandidateScreening.jsx # Core recruiter workspace: MRF matching, scoring, and Zeko triggers
│   ├── Candidates.jsx       # Table list of CVs with multi-filter searches
│   ├── Dashboard.jsx        # Landing summary panel displaying statistics and recent activity
│   ├── EmailManagement.jsx  # Outlook template editor and outbound tracking history
│   ├── HRUpload.jsx         # File uploading, processing logs, and duplicate merge workspace
│   ├── Login.jsx            # General Recruiter/HR login portal
│   ├── MRF.jsx              # Submission form and status log for manpower requirements
│   ├── NotFound.jsx         # Styled 404 page with route correction redirects
│   ├── Settings.jsx         # Microsoft Graph client configurations and intervals editor
│   └── VendorPortal.jsx     # Independent interface for candidate submissions
├── services/                # Axios API requests
│   ├── api.js               # Central Axios client configuration with token injection interceptors
│   └── [feature]Service.js  # Feature-specific API endpoints wrappers
└── theme/                   # Stylesheets
    ├── index.css            # Global CSS variables, animations, scrollbars, and keyframes
    └── themeConfig.js       # JSON styling configurations matching Ant Design 5 tokens
```

---

## 🚦 Routing & Access Guards

The application uses client-side routing via **React Router (v6)**. Access to pages is guarded based on authentication status and user roles.

### 1. Guard Components (`frontend/src/App.jsx`)
* **`ProtectedRoute`**: 
  Checks if `isAuthenticated` is true. If false, redirects standard paths to `/login` and admin paths to `/admin/login`. Shows a full-screen loading spinner while the auth state is loading.
* **`PublicRoute`**: 
  Guards authentication screens. If an authenticated user tries to access `/login`, they are redirected to `/dashboard` (or `/admin/dashboard` for admins).
* **`AdminRoute`**: 
  Restricts administrative pages. Checks `user.role` against `['admin', 'superadmin']`. Non-admins are redirected back to the standard recruiter `/dashboard`.

### 2. Client Routing Structure

| Path | Layout | Route Guard | Page Component |
| :--- | :--- | :--- | :--- |
| `/login` | `AuthLayout` | `PublicRoute` | `Login` |
| `/admin/login` | `AuthLayout` | `PublicRoute` | `AdminLogin` |
| `/dashboard` | `MainLayout` | `ProtectedRoute` | `Dashboard` |
| `/admin/dashboard`| `MainLayout` | `AdminRoute` | `AdminDashboard` |
| `/candidates` | `MainLayout` | `ProtectedRoute` | `Candidates` |
| `/candidates/:id` | `MainLayout` | `ProtectedRoute` | `CandidateDetail` |
| `/hr-upload` | `MainLayout` | `ProtectedRoute` | `HRUpload` |
| `/mrf` | `MainLayout` | `ProtectedRoute` | `MRF` |
| `/vendor` | `MainLayout` | `ProtectedRoute` | `VendorPortal` |
| `/filtering` | `MainLayout` | `ProtectedRoute` | `CandidateScreening` |
| `/analytics` | `MainLayout` | `ProtectedRoute` | `Analytics` |
| `/email` | `MainLayout` | `ProtectedRoute` | `EmailManagement` |
| `/settings` | `MainLayout` | `ProtectedRoute` | `Settings` |

---

## 🛰️ API Integration Client (`frontend/src/services/api.js`)

Centralized HTTP communication is managed via a configured **Axios** instance:
1. **Base URL**: Set to `/api` (automatically proxied to `http://localhost:5000` during local development by Vite's dev server configuration).
2. **Request Interceptor**: Automatically inspects `localStorage` for `ats_token`. If present, injects it into the request header as `Authorization: Bearer <token>`.
3. **Response Interceptor**: normalizes errors into a consistent format (`status`, `message`, `data`).
4. **401 Unauthorized handling**: If a response returns status `401` (invalid or expired token), the interceptor automatically clears the token from `localStorage` and redirects the user to the login screen.
