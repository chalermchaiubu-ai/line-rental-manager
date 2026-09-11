# LINE OA Rental Manager — Complete Setup Guide 🚀

**Status**: ✅ Credentials Ready | ⏳ Awaiting Supabase SQL Setup | ⏳ Local Test Pending

---

## 📋 What's Ready

✅ Backend code (server.js)
✅ Database schema (schema.sql)  
✅ .env configuration (pre-filled with your credentials)
✅ package.json (dependencies listed)

---

## ⏭️ Your Action Required: Setup Supabase SQL (5 minutes)

### Step 1: Copy SQL Schema

You have two files to run in Supabase SQL Editor:

**File 1: Main Tables + Indexes**
```bash
# Copy from: schema.sql (lines 1-90)
```

**File 2: Row Level Security (Optional, but recommended)**
```bash
# Copy from: schema.sql (lines 92-end)
```

### Step 2: Run in Supabase SQL Editor

1. Open: https://supabase.com/dashboard/project/aaftuxnkjkkhrbctegga/sql/new
2. Click **New Query**
3. Copy-paste the SQL schema (the whole thing)
4. Click **Run** button (green button top-right)
5. Wait for: `SUCCESS` message

**Expected output:**
```
CREATE TABLE
CREATE INDEX
...
(multiple success messages)
```

### Step 3: Verify Tables Created

In Supabase dashboard, go to **Table Editor** (left sidebar):
- [ ] `users` table exists
- [ ] `rooms` table exists
- [ ] `repair_tickets` table exists
- [ ] `bills` table exists
- [ ] `broadcasts` table exists

✅ **Done with Supabase!**

---

## 🖥️ Step 3: Setup Local Environment

### 3.1 Download & Extract

```bash
# If you haven't extracted yet:
tar -xzf line-rental-manager.tar.gz
cd line-rental-manager
```

### 3.2 Install Dependencies

```bash
npm install
```

**Output should show:**
```
added XX packages in Xs
```

### 3.3 .env File (Already Prepared!)

Your `.env` file is already configured with:
- ✅ LINE credentials
- ✅ Supabase URL & API key
- ✅ PORT=3000

**Verify it exists:**
```bash
cat .env
```

Should show your credentials (no need to edit).

---

## ✅ Step 4: Test Local

### 4.1 Start Server

```bash
npm start
```

**You should see:**
```
🚀 LINE Rental Manager server running on port 3000
📍 Webhook URL: http://localhost:3000/webhook/line
```

### 4.2 Test Health Check (in another terminal)

```bash
curl http://localhost:3000/health
```

**Expected response:**
```json
{"status":"OK","timestamp":"2024-09-10T..."}
```

✅ **Server is working!**

### 4.3 Stop Server

```
Press Ctrl+C
```

---

## 🚀 Step 5: Deploy to Production

### 5.1 Push to GitHub

```bash
# Initialize git (if not done)
git init
git add .
git commit -m "Initial LINE OA Rental Manager setup"
git remote add origin https://github.com/YOUR_USERNAME/line-rental-manager.git
git push -u origin main
```

**⚠️ Replace `YOUR_USERNAME` with your GitHub username**

### 5.2 Deploy to Render

1. Go to [render.com](https://render.com)
2. Click **New → Web Service**
3. Select GitHub repo: `line-rental-manager`
4. Fill in:
   - **Name**: `line-rental-manager`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Port**: `3000`

5. Add environment variables (from your `.env` file):
   ```
   LINE_CHANNEL_ID = 2011332212
   LINE_CHANNEL_SECRET = 3691f75aeb1fa06d29a489f82d23c926
   LINE_CHANNEL_ACCESS_TOKEN = q5IVte9Npu9BBFZ3+HYQF9oZMN73Axc777ClN1nh0VQrJMaI17kUES+AcXkiO9tsH4zutRGgOCiqnMhHnFt8w58UsJbGecv2ESgM37QCl/42NWXP1W0c130BSZg9GWDkLWG5i2CF+FU+Xm2W07JE6AdB04t89/1O/w1cDnyilFU=
   SUPABASE_URL = https://aaftuxnkjkkhrbctegga.supabase.co
   SUPABASE_ANON_KEY = sb_publishable_AkbYc-JlC0tNYotTT5H3Tw_g3RjG9Pj
   NODE_ENV = production
   ```

6. Click **Deploy**
7. Wait 3-5 minutes...

**When deployment finishes:**
```
Deploying...
✓ Build successful
✓ Your site is live!
```

Copy your Render URL: `https://line-rental-manager-xxx.onrender.com`

### 5.3 Configure LINE Webhook

1. Go to LINE Developers Console: https://developers.line.biz/
2. Select your channel → **Messaging API**
3. Find **Webhook Settings**
4. Set **Webhook URL**: 
   ```
   https://line-rental-manager-xxx.onrender.com/webhook/line
   ```
   (Replace `xxx` with your Render URL)

5. Click **Verify** → Should see ✅ Success

---

## 🤖 Step 6: Test Bot

### 6.1 Add Bot as Friend

1. Open LINE app on your phone
2. Search for your Official Account
3. Click **Add** → Bot is now your friend

### 6.2 Send Test Message

Send: `/help`

**Bot should reply:**
```
Available commands:
/แจ้งซ่อม - Report repair
/สร้างบิล - Create bill
/ประกาศ - Make announcement
```

✅ **Bot is working!**

### 6.3 Test Repair Command

Send: `/แจ้งซ่อม`

Bot should ask for repair category.

---

## ✅ Checklist - Mark When Complete

- [ ] SQL schema imported to Supabase
- [ ] Tables verified in Supabase
- [ ] Local npm install done
- [ ] Local server test (`npm start` works)
- [ ] Health check responded (curl test)
- [ ] Code pushed to GitHub
- [ ] Deployed to Render
- [ ] LINE Webhook configured
- [ ] Bot responds to `/help`
- [ ] Bot responds to `/แจ้งซ่อม`

---

## 🐛 Troubleshooting

### Q: npm install fails?
```bash
# Try clearing cache
npm cache clean --force
npm install
```

### Q: Local server won't start?
**Check:**
1. Is port 3000 in use? (Change PORT in .env to 3001)
2. Are environment variables loaded? (`cat .env`)
3. Is Supabase connection working? (Try: curl $SUPABASE_URL)

### Q: Render deployment fails?
**Check logs in Render dashboard:**
1. Click **Logs** tab
2. Look for error messages
3. Verify all environment variables are set

### Q: Webhook shows "Failed" in LINE Console?
1. Verify URL is correct (no typos)
2. Wait 2 minutes for Render to stabilize
3. Try clicking **Verify** again
4. Check Render logs for errors

---

## 🎉 You're Done!

Your LINE OA Rental Manager is now:
- ✅ Deployed to production
- ✅ Connected to Supabase
- ✅ Running on LINE Messaging API

**Next steps:**
1. Add owner & tenant users (via Supabase)
2. Create sample rooms
3. Test repair report workflow
4. Test bill creation

---

## 📞 Need Help?

Check these:
1. Render logs: `https://dashboard.render.com/`
2. Supabase logs: `https://supabase.com/dashboard/project/aaftuxnkjkkhrbctegga/logs`
3. LINE Developers: `https://developers.line.biz/`

---

**Congratulations! You built a LINE OA rental manager! 🎊**
