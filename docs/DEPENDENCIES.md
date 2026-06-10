# Project Dependencies & Setup Guide

This guide details the system requirements, configuration variables, and installation steps necessary to successfully deploy and run the AAPNA ATS project (Frontend, Backend, and Database).

---

## 🛠️ Software Prerequisites

Ensure you have the following software installed on your host system:

| Dependency | Required Version | Purpose |
| :--- | :--- | :--- |
| **Node.js** | `>= 20.0.0` (LTS recommended) | JavaScript runtime for running backend API and building frontend. |
| **npm** | `>= 10.0.0` | Node.js package manager. |
| **PostgreSQL** | `>= 15.0` | Primary relational database. |
| **pgvector Extension** | Matching PostgreSQL version | Native vector database support for candidate semantic embeddings. |
| **Redis** | `>= 7.0` | In-memory store for BullMQ background queues and caching. |

---

## 📦 Setup & Installation Steps

### 1. Database Setup (PostgreSQL & pgvector)
1. **Install PostgreSQL** on your server.
2. **Enable pgvector**:
   Run the following query in your database tool (e.g., pgAdmin, psql) as superuser to enable vector support:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. **Database URL format**:
   Your PostgreSQL connection string should follow this format:
   ```text
   postgresql://<username>:<password>@<host>:<port>/<database_name>?schema=public
   ```

### 2. Redis Setup
* **Windows (Development)**:
  * Open a command prompt/PowerShell in `E:\ATS-Migration\redis`.
  * Start the Redis server using the provided executable:
    ```powershell
    .\redis-server.exe .\redis.windows.conf
    ```
* **Linux (Production)**:
  * Install redis-server via your package manager:
    ```bash
    sudo apt update
    sudo apt install redis-server
    ```
  * Enable and start the service:
    ```bash
    sudo systemctl enable redis-server
    sudo systemctl start redis-server
    ```

### 3. Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd E:\ATS-Migration\backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment template file:
   ```bash
   copy .env.example .env
   ```
4. Update the `.env` file with your credentials (see configuration table below).
5. Run Prisma migrations to pull/push the database schema and generate the client:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

### 4. Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd E:\ATS-Migration\frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Review `vite.config.js` to ensure the API proxy routes point to your local backend (defaults to `http://localhost:5000`).

---

## 🔑 Environment Variables Configuration

The backend reads its configurations from the `.env` file located in the `backend/` root directory.

### Backend `.env` Mappings

| Variable Name | Description | Default / Example | Required? |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Mode of runtime execution (`development`, `production`, `test`). | `development` | Yes |
| `PORT` | Local port for Express API server. | `5000` | Yes |
| `DATABASE_URL` | PostgreSQL connection string (must have pgvector enabled). | `postgresql://user:pass@localhost:5432/ats_db` | Yes |
| `REDIS_HOST` | Host address of Redis Server. | `localhost` | Yes |
| `REDIS_PORT` | Port of Redis Server. | `6379` | Yes |
| `REDIS_PASSWORD` | Password for Redis Server (leave empty if none). | `your_redis_password` | No |
| `JWT_SECRET` | Secret key used to sign JSON Web Tokens. | `random-jwt-secret-string-here` | Yes |
| `JWT_EXPIRES_IN` | Validity window of the JWT Access Token. | `24h` | Yes |
| `JWT_REFRESH_EXPIRES_IN`| Validity window of the JWT Refresh Token. | `7d` | Yes |
| `GEMINI_API_KEY` | Google AI Studio API Key for Gemini. | `AIzaSy...` | Yes |
| `GEMINI_MODEL` | Google Gemini model to use. | `gemini-2.5-flash` | Yes |
| `MS_TENANT_ID` | Microsoft Azure Tenant ID. | `3a18a...` | Yes (for Graph) |
| `MS_CLIENT_ID` | Microsoft Azure Registered Client ID. | `f28d8...` | Yes (for Graph) |
| `MS_CLIENT_SECRET` | Microsoft Azure Registered Client Secret. | `abc12~...` | Yes (for Graph) |
| `MS_REDIRECT_URI` | Redirect URI matching Azure App setup. | `http://localhost:5000/api/auth/callback` | Yes (for Graph) |
| `MS_ONEDRIVE_PARENT_ID` | Target folder ID in OneDrive where resumes are uploaded. | `01MS5H25CFWZA7J3...` | Yes (for upload) |
| `MS_DEFAULT_SENDER_EMAIL`| Microsoft Account email used to send outbound emails. | `recruitment@yourdomain.com` | Yes (for Graph) |
| `EMAIL_STAGING_RECIPIENTS`| Redirect target for staging (comma-separated emails). | `dev@yourdomain.com` | Yes (in dev/staging)|
| `EMAIL_HR_ALERTS_RECIPIENTS`| Target recipients for HR Alerts (comma-separated). | `hr@yourdomain.com` | Yes |
| `ZEKO_API_URL` | Base API URL for Zeko AI interview platform. | `https://api.zeko.ai/v1` | Yes (for Zeko) |
| `ZEKO_API_KEY` | API authentication key for Zeko AI. | `zeko_api_key_here` | Yes (for Zeko) |
| `UPLOAD_MAX_SIZE` | Maximum file size allowed for resume uploads. | `50mb` | Yes |
| `UPLOAD_DIR` | Local storage directory for uploads before OneDrive sync. | `./uploads` | Yes |
| `FRONTEND_URL` | URL of the frontend client (for CORS configuration). | `http://localhost:5173` | Yes |
| `LOG_LEVEL` | Application logger severity (`debug`, `info`, `warn`, `error`).| `debug` | Yes |
| `LOG_DIR` | Folder to save application logs. | `./logs` | Yes |

---

## 📂 Microsoft Graph API App Registration Setup

To enable Microsoft Graph integration for sending emails, syncing calendars, and uploading files to OneDrive, you must register an application in the Microsoft Azure portal.

### Steps to Register:
1. Log in to the [Microsoft Azure Portal](https://portal.azure.com/).
2. Navigate to **Microsoft Entra ID** (formerly Azure Active Directory) -> **App registrations** -> **New registration**.
3. Fill in the details:
   - **Name**: `AAPNA ATS Portal`
   - **Supported Account Types**: "Accounts in this organizational directory only" (Single tenant) or "Accounts in any organizational directory" (Multitenant).
   - **Redirect URI**: Select **Web** and enter `http://localhost:5000/api/auth/callback` (or your production API callback URL).
4. Click **Register**.
5. Copy the **Application (client) ID**, **Directory (tenant) ID** and save them in the backend `.env`.

### Generating Client Secret:
1. Under your app registration page, go to **Certificates & secrets** -> **Client secrets** -> **New client secret**.
2. Add a description, set an expiration period, and click **Add**.
3. Copy the **Value** immediately (this value will be hidden once you navigate away). Set this as `MS_CLIENT_SECRET` in your `.env`.

### API Permissions:
Navigate to **API permissions** -> **Add a permission** -> **Microsoft Graph**. Select **Application permissions** (not Delegated) and add:
- `Mail.Send` (to send out notifications and follow-up emails)
- `Mail.ReadWrite` (to read email streams and track replies)
- `Files.ReadWrite.All` (to write uploaded resumes to Microsoft OneDrive/SharePoint)

Click **Grant admin consent for <your-organization-name>** to activate these permissions.

---

## 🏃 Running the Application Locally

To test and run the application in a local development environment, open two separate command terminals:

### Terminal 1: Backend Server
```bash
cd E:\ATS-Migration\backend

# 1. Generate Prisma Client
npm run prisma:generate

# 2. Start Nodemon Dev Server
npm run dev
```
The server will boot on `http://localhost:5000` and watch for code edits.

### Terminal 2: Frontend Client
```bash
cd E:\ATS-Migration\frontend

# Start Vite Development Server
npm run dev
```
The developer client will boot on `http://localhost:5173`. Opening this URL in your browser will automatically proxy API calls to the running backend.
