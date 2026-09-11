# LINE OA Rental Manager 🏠

LINE Official Account for managing rental properties - Repair tickets, utility bills, and announcements.

## Features ✨

- **Repair Tickets** - Tenants report issues, owners track and update status
- **Utility Bills** - Water & electricity tracking, automatic calculations
- **Announcements** - Owners broadcast messages to all tenants
- **Automatic Notifications** - Push messages for updates

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL)
- **Messaging**: LINE Messaging API
- **Hosting**: Render / Railway / Heroku

---

## Setup Guide

### 1️⃣ Prerequisites

- Node.js 16+
- LINE Official Account (with Messaging API enabled)
- Supabase account (free tier works)
- Vercel/Render/Railway account (for hosting)

### 2️⃣ Clone & Install

```bash
git clone <your-repo-url>
cd line-rental-manager
npm install
```

### 3️⃣ Setup Supabase

1. Create a new project on [supabase.com](https://supabase.com)
2. Copy your **Project URL** and **Anon Key**
3. Run the SQL schema:
   - Open Supabase SQL Editor
   - Paste contents of `schema.sql`
   - Click "Run"

### 4️⃣ Setup LINE Official Account

1. Create/login to [LINE Developers Console](https://developers.line.biz/)
2. Create a new Channel (Messaging API)
3. Copy:
   - **Channel ID** → `LINE_CHANNEL_ID`
   - **Channel Secret** → `LINE_CHANNEL_SECRET`
   - **Channel Access Token** → `LINE_CHANNEL_ACCESS_TOKEN`

### 5️⃣ Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
PORT=3000
NODE_ENV=production

LINE_CHANNEL_ID=your_channel_id
LINE_CHANNEL_SECRET=your_channel_secret
LINE_CHANNEL_ACCESS_TOKEN=your_access_token

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
```

### 6️⃣ Run Locally

```bash
npm start
```

Server runs on `http://localhost:3000`

Test webhook: `http://localhost:3000/health`

### 7️⃣ Deploy to Render/Railway

#### Option A: Render

1. Push code to GitHub
2. Go to [render.com](https://render.com)
3. Create **New → Web Service**
4. Select GitHub repo
5. **Runtime**: Node
6. **Build Command**: `npm install`
7. **Start Command**: `npm start`
8. Add environment variables from `.env`
9. Deploy!

#### Option B: Railway

1. Go to [railway.app](https://railway.app)
2. Create **New Project → Deploy from GitHub**
3. Select repo
4. Add variables from `.env`
5. Deploy!

### 8️⃣ Configure LINE Webhook

After deployment, get your production URL (e.g., `https://your-app.onrender.com`)

1. Go to LINE Developers Console
2. In **Messaging API** settings:
   - **Webhook URL**: `https://your-app.onrender.com/webhook/line`
   - **Use Webhook**: ✅ Enable
   - **Verify Token**: (optional, LINE verifies signature)

3. Click **Verify** → Should see "Success"

---

## Commands 📝

Users interact with the bot via these commands:

### For Tenants 👤

```
/แจ้งซ่อม    - Report a repair issue
/help       - Show available commands
```

### For Owners 🏠

```
/สร้างบิล   - Create water/electricity bill
/ประกาศ    - Send announcement to all tenants
/help       - Show available commands
```

---

## Database Schema 📊

### `users` table
- Line user ID, role (owner/tenant), room assignment

### `rooms` table
- Room number, owner, rent, tenant

### `repair_tickets` table
- Issue category, description, status, images

### `bills` table
- Month, water/electricity readings, charges, payment status

### `broadcasts` table
- Owner announcements sent to tenants

---

## Troubleshooting 🔧

**Q: Webhook not working?**
- Verify URL is accessible: `curl https://your-app.onrender.com/health`
- Check LINE Developers Console for errors
- Ensure environment variables are set

**Q: Database connection error?**
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- Check Supabase project is running

**Q: No messages from bot?**
- Verify `LINE_CHANNEL_ACCESS_TOKEN` is correct
- Check LINE app is following the official account
- Ensure webhook signature verification passes

---

## Development 💻

### Local with auto-reload:
```bash
npm run dev
```

### Test webhook locally (use ngrok):
```bash
npx ngrok http 3000
# Copy ngrok URL to LINE Developers Console Webhook URL
```

---

## Support & License

For issues or questions, contact support.

MIT License - See LICENSE file

---

**Made for managing rentals efficiently via LINE 🎯**
