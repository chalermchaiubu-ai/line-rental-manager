# Deployment Checklist ✅

**Status: Ready to Deploy!**

---

## ✅ What's Done (By Claude)

- [x] Backend server code (server.js)
- [x] Database schema (schema.sql)
- [x] Environment configuration (.env pre-filled)
- [x] .gitignore (for Git)
- [x] render.yaml (Render config)
- [x] package.json (dependencies)
- [x] README.md (setup guide)
- [x] This checklist

---

## ⏳ What You Need to Do (3 Simple Steps)

### Step 1: Create GitHub Repository (5 minutes)

```bash
# Navigate to your project folder
cd ~/Downloads/line-rental-manager  # or wherever you extracted

# Initialize git
git init

# Add all files
git add .

# Create first commit
git commit -m "Initial: LINE OA Rental Manager - Ready to Deploy"

# Add GitHub remote
git remote add origin https://github.com/YOUR_USERNAME/line-rental-manager.git

# Push to GitHub
git branch -M main
git push -u origin main
```

**Replace `YOUR_USERNAME` with your actual GitHub username**

### Step 2: Deploy to Render (3 minutes)

1. Go to **https://render.com**
2. Click **New → Web Service**
3. Select: **Connect GitHub repository**
4. Find & select `line-rental-manager`
5. Fill in:
   - **Name**: `line-rental-manager`
   - **Runtime**: `Node`
   - Build Command will auto-fill: `npm install`
   - Start Command will auto-fill: `npm start`

6. **Add Environment Variables** (copy from your `.env` file):
   ```
   LINE_CHANNEL_ID = 2011332212
   LINE_CHANNEL_SECRET = 3691f75aeb1fa06d29a489f82d23c926
   LINE_CHANNEL_ACCESS_TOKEN = q5IVte9Npu9BBFZ3+HYQF9oZMN73Axc777ClN1nh0VQrJMaI17kUES+AcXkiO9tsH4zutRGgOCiqnMhHnFt8w58UsJbGecv2ESgM37QCl/42NWXP1W0c130BSZg9GWDkLWG5i2CF+FU+Xm2W07JE6AdB04t89/1O/w1cDnyilFU=
   SUPABASE_URL = https://aaftuxnkjkkhrbctegga.supabase.co
   SUPABASE_ANON_KEY = sb_publishable_AkbYc-JlC0tNYotTT5H3Tw_g3RjG9Pj
   NODE_ENV = production
   ```

7. Click **Deploy**
8. Wait 3-5 minutes for deployment to complete

**When done, you'll see:**
```
✓ Build successful
✓ Your site is live at: https://line-rental-manager-xxx.onrender.com
```

### Step 3: Configure LINE Webhook (2 minutes)

1. Go to **LINE Developers Console**: https://developers.line.biz/
2. Select your channel → **Messaging API**
3. Find **Webhook Settings**
4. Set **Webhook URL** to:
   ```
   https://line-rental-manager-xxx.onrender.com/webhook/line
   ```
   (Replace `xxx` with your Render URL from Step 2)

5. Click **Verify** → Should see ✅ **Success**

---

## 🤖 Test Your Bot

1. Open LINE app
2. Search for your Official Account
3. Add as friend
4. Send: `/help`

**Bot should reply:**
```
Available commands:
/แจ้งซ่อม - Report repair
/สร้างบิล - Create bill
/ประกาศ - Make announcement
```

✅ **You're Live!**

---

## 📋 Final Checklist

- [ ] Created GitHub account & repo
- [ ] Pushed code to GitHub
- [ ] Deployed to Render
- [ ] Render deployment successful
- [ ] LINE Webhook configured
- [ ] Bot responds to `/help`
- [ ] Bot works on your phone!

---

## 🎉 Congratulations!

Your LINE OA Rental Manager is now **LIVE** and ready to manage properties! 🚀

### Next Steps (Optional Enhancements):

- Add real owner & tenant users in Supabase
- Create sample rooms in database
- Test repair ticket workflow
- Test bill creation workflow
- Customize bot responses (edit server.js)
- Add Rich Menus with buttons
- Setup image uploads
- Integrate payment verification

---

## 🆘 Troubleshooting

### GitHub Push Fails?
```bash
# Verify remote is correct
git remote -v

# If wrong, update it:
git remote set-url origin https://github.com/YOUR_USERNAME/line-rental-manager.git
```

### Render Deployment Fails?
- Check **Logs** tab in Render dashboard
- Verify all environment variables are set
- Wait 5 minutes & retry

### Webhook Won't Verify?
- Make sure Render URL is accessible: `https://your-url/health`
- Wait 2 minutes for Render to fully start
- Check LINE Developers Console for errors

### Bot Doesn't Respond?
- Verify you're following the Official Account
- Check Render logs for webhook errors
- Make sure webhook is enabled in LINE Console

---

**Need help? Check the README.md for more details!**
