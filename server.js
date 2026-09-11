const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// LINE configuration
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// ============ CRITICAL FIX: Capture raw body for LINE signature verification ============
// Use text parser to capture raw body BEFORE JSON parsing
app.use(express.text({ type: 'application/json' }));

// Then parse JSON manually and keep raw body
app.use((req, res, next) => {
    if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      req.rawBody = req.body; // ✅ Store raw body for signature verification
      req.body = JSON.parse(req.body); // Parse JSON for message processing
      console.log('✅ Request body captured and parsed');
    } catch (e) {
      console.error('❌ JSON parse error:', e.message);
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  next();
});
// ============ END CRITICAL FIX ============

// Verify LINE webhook signature
function verifyLineSignature(body, signature) {
  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

// Send message to LINE
async function sendLineMessage(userId, messages) {
  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: userId,
        messages: Array.isArray(messages) ? messages : [messages],
      },
      {
        headers: {
          'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('✅ Message sent to LINE user:', userId);
  } catch (error) {
    console.error('❌ Error sending LINE message:', error.response?.data || error.message);
  }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];

  // ✅ USE RAW BODY FOR SIGNATURE VERIFICATION (NOT JSON.stringify)
  const body = req.rawBody;

  if (!verifyLineSignature(body, signature)) {
    console.log('❌ Invalid signature - webhook rejected');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  console.log('✅ Signature verified successfully');

  try {
    const events = req.body.events || [];
    console.log(`📨 Received ${events.length} event(s) from LINE`);

    for (const event of events) {
      console.log(`📝 Processing event - Type: ${event.type}, Message type: ${event.message?.type}`);

      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        const text = event.message.text;
        const roomId = event.source.roomId || event.source.groupId;

        console.log(`💬 Message received from ${userId}: "${text}"`);

        // Log user
        const { data: user } = await supabase
          .from('users')
          .select('*')
          .eq('line_id', userId)
          .single();

        if (!user) {
          await supabase
            .from('users')
            .insert([
              {
                line_id: userId,
                room_id: roomId,
                role: 'tenant',
                name: event.source.userId,
              },
            ]);
          console.log('👤 New user registered in database');
        }

        // Command parsing
        if (text.startsWith('/แจ้งซ่อม')) {
          const description = text.substring('/แจ้งซ่อม'.length).trim();

          const { data: room } = await supabase
            .from('rooms')
            .select('*')
            .eq('id', roomId)
            .single();

          if (room) {
            await supabase
              .from('repair_tickets')
              .insert([
                {
                  room_id: room.id,
                  category: 'repair',
                  description: description || 'ไม่ระบุ',
                  status: 'open',
                },
              ]);

            await sendLineMessage(userId, {
              type: 'text',
              text: '✅ แจ้งซ่อมสำเร็จ เจ้าของจะตรวจสอบและติดต่อคุณเร็ว ๆ',
            });
            console.log('📋 Repair ticket created');
          } else {
            await sendLineMessage(userId, {
              type: 'text',
              text: '❌ ไม่พบห้องของคุณ กรุณาติดต่อเจ้าของ',
            });
          }
        } else if (text.startsWith('/สร้างบิล')) {
          const parts = text.substring('/สร้างบิล'.length).trim().split(' ');
          const amount = parseFloat(parts[0]);
          const type = parts.slice(1).join(' ') || 'ค่าน้ำ/ไฟฟ้า';

          const { data: room } = await supabase
            .from('rooms')
            .select('*')
            .eq('id', roomId)
            .single();

          if (room && !isNaN(amount)) {
            await supabase
              .from('bills')
              .insert([
                {
                  room_id: room.id,
                  type: type,
                  amount: amount,
                  status: 'pending',
                  due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                },
              ]);

            await sendLineMessage(userId, {
              type: 'text',
              text: `✅ บิล ${type} จำนวน ${amount} บาท ถูกสร้างเรียบร้อย โปรดชำระภายใน 7 วัน`,
            });
            console.log('💰 Bill created');
          } else {
            await sendLineMessage(userId, {
              type: 'text',
              text: '❌ รูปแบบคำสั่งไม่ถูกต้อง กรุณาใช้: /สร้างบิล จำนวนเงิน ประเภท',
            });
          }
        } else if (text.startsWith('/ประกาศ')) {
          const message = text.substring('/ประกาศ'.length).trim();

          // Get owner
          const { data: owner } = await supabase
            .from('users')
            .select('*')
            .eq('line_id', userId)
            .eq('role', 'owner')
            .single();

          if (owner && message) {
            await supabase
              .from('broadcasts')
              .insert([
                {
                  owner_id: owner.id,
                  message: message,
                  sent_at: new Date().toISOString(),
                },
              ]);

            await sendLineMessage(userId, {
              type: 'text',
              text: '✅ ประกาศเรียบร้อย ผู้เช่าทั้งหมดจะได้รับการแจ้งเตือน',
            });
            console.log('📢 Broadcast created');
          } else {
            await sendLineMessage(userId, {
              type: 'text',
              text: '❌ เฉพาะเจ้าของเท่านั้นที่ส่งประกาศได้',
            });
          }
        } else if (text === '/help' || text === '?') {
          await sendLineMessage(userId, {
            type: 'text',
            text: '📋 **คำสั่งที่ใช้ได้:**\n\n/แจ้งซ่อม - แจ้งปัญหาการซ่อม\n/สร้างบิล - สร้างบิลน้ำ/ไฟฟ้า\n/ประกาศ - ส่งประกาศถึงผู้เช่า\n/help - แสดงคำสั่งนี้',
          });
        } else {
          // Default response for unknown commands
          console.log('⚠️  Unknown command');
        }
      } else {
        console.log(`⏭️  Skipping non-text event: ${event.type}`);
      }
    }

    res.status(200).json({ message: 'OK' });
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📨 Webhook ready at: /webhook`);
});
