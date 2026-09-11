
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
 
require('dotenv').config();
 
const app = express();
const PORT = process.env.PORT || 3000;
 
// ============================================================================
// Supabase client — IMPORTANT: this now uses the SERVICE ROLE key, not the
// anon key. The new schema has Row Level Security enabled on every table,
// gated on is_staff()/is_owner_or_admin() (Supabase Auth users only). Tenants
// never log into Supabase — they talk to this bot over LINE — so this
// backend must use the service role key to read/write on their behalf.
// Set SUPABASE_SERVICE_ROLE_KEY in Render's environment variables
// (Supabase Dashboard → Settings → API → service_role key, "secret").
// ============================================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
 
// LINE configuration
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
 
// Owner contact shown by the "ติดต่อเจ้าของ" intent when no staff_users row
// is set up yet. Optional — set these in Render if you want them shown.
const OWNER_CONTACT_NAME = process.env.OWNER_CONTACT_NAME || 'เจ้าของหอพัก';
const OWNER_CONTACT_PHONE = process.env.OWNER_CONTACT_PHONE || '';
 
// Supabase Storage bucket for payment slip images. Create this bucket
// (Storage → New bucket → name "payment-slips" → Public) before slip
// uploads will work; see the deployment notes sent alongside this file.
const SLIP_BUCKET = 'payment-slips';
 
// ============ Capture raw body for LINE signature verification ============
app.use(express.text({ type: 'application/json' }));
app.use((req, res, next) => {
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      req.rawBody = req.body;
      req.body = JSON.parse(req.body);
    } catch (e) {
      console.error('❌ JSON parse error:', e.message);
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  next();
});
// ============================================================================
 
function verifyLineSignature(body, signature) {
  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}
 
async function sendLineMessage(userId, messages) {
  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: userId, messages: Array.isArray(messages) ? messages : [messages] },
      {
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('❌ Error sending LINE message:', error.response?.data || error.message);
  }
}
 
function replyText(userId, text) {
  return sendLineMessage(userId, { type: 'text', text });
}
 
// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------
function normalizePhone(raw) {
  return (raw || '').replace(/\D/g, '');
}
 
function isPhoneLike(text) {
  const digits = normalizePhone(text);
  return digits.length >= 9 && digits.length <= 10;
}
 
function formatDateThai(isoDate) {
  if (!isoDate) return '-';
  const d = new Date(isoDate);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
 
function formatBaht(n) {
  return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
 
const BILL_STATUS_TH = {
  draft: 'ร่างบิล',
  unpaid: 'ยังไม่ชำระ',
  verifying: 'กำลังตรวจสอบสลิป',
  paid: 'ชำระแล้ว',
  overdue: 'เกินกำหนดชำระ',
  cancelled: 'ยกเลิก',
};
 
const ITEM_TYPE_TH = {
  rent: 'ค่าเช่าห้อง',
  electricity: 'ค่าไฟฟ้า',
  water: 'ค่าน้ำประปา',
  internet: 'ค่าอินเทอร์เน็ต',
  parking: 'ค่าที่จอดรถ',
  late_fee: 'ค่าปรับล่าช้า',
  repair: 'ค่าซ่อมแซม',
  discount: 'ส่วนลด',
  other: 'อื่น ๆ',
};
 
// ----------------------------------------------------------------------------
// Tenant lookup / linking
// ----------------------------------------------------------------------------
async function findTenantByLineId(lineUserId) {
  const { data } = await supabase
    .from('tenants')
    .select('*')
    .eq('line_user_id', lineUserId)
    .maybeSingle();
  return data || null;
}
 
async function findActiveLeaseForTenant(tenantId) {
  const { data } = await supabase
    .from('leases')
    .select('*, rooms(*)')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();
  return data || null;
}
 
// Tenants are created by the owner in Supabase (name, phone, etc.) with
// line_user_id left NULL. The first time someone messages the bot, we ask
// for their registered phone number and use it to link their LINE account
// to that existing tenant row (never auto-creates a tenant).
async function tryLinkByPhone(lineUserId, phoneText) {
  const digits = normalizePhone(phoneText);
  const { data: candidates } = await supabase
    .from('tenants')
    .select('*')
    .is('line_user_id', null)
    .eq('status', 'active');
 
  const match = (candidates || []).find((t) => normalizePhone(t.phone) === digits);
  if (!match) return null;
 
  const { data: updated } = await supabase
    .from('tenants')
    .update({ line_user_id: lineUserId })
    .eq('id', match.id)
    .select()
    .maybeSingle();
  return updated || null;
}
 
// ----------------------------------------------------------------------------
// Intent handlers
// ----------------------------------------------------------------------------
async function handleCheckBill(userId, tenant, lease) {
  const { data: bill } = await supabase
    .from('bills')
    .select('*')
    .eq('tenant_id', tenant.id)
    .in('status', ['unpaid', 'overdue', 'verifying'])
    .order('billing_month', { ascending: false })
    .limit(1)
    .maybeSingle();
 
  if (!bill) {
    await replyText(userId, '🎉 ไม่มีบิลค้างชำระในขณะนี้ ขอบคุณที่ชำระตรงเวลาครับ/ค่ะ');
    return;
  }
 
  const { data: items } = await supabase
    .from('bill_items')
    .select('*')
    .eq('bill_id', bill.id)
    .order('created_at', { ascending: true });
 
  await sendLineMessage(userId, buildBillFlexMessage(lease.rooms, bill, items || []));
}
 
function buildBillFlexMessage(room, bill, items) {
  const itemRows = items.map((it) => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      { type: 'text', text: ITEM_TYPE_TH[it.item_type] || it.description, size: 'sm', color: '#555555', flex: 4 },
      { type: 'text', text: `${formatBaht(it.amount)} บ.`, size: 'sm', color: '#111111', align: 'end', flex: 2 },
    ],
  }));
 
  const bubble = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#2E7D32',
      paddingAll: '16px',
      contents: [
        { type: 'text', text: 'บิลค่าเช่าประจำเดือน', color: '#FFFFFF', size: 'sm' },
        { type: 'text', text: `ห้อง ${room.room_number}  •  ${bill.billing_month}`, color: '#FFFFFF', size: 'xl', weight: 'bold' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        ...itemRows,
        { type: 'separator', margin: 'md' },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'md',
          contents: [
            { type: 'text', text: 'ยอดรวมทั้งสิ้น', weight: 'bold', flex: 4 },
            { type: 'text', text: `${formatBaht(bill.total_amount)} บ.`, weight: 'bold', color: '#2E7D32', align: 'end', flex: 2 },
          ],
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'ครบกำหนดชำระ', size: 'sm', color: '#888888', flex: 4 },
            { type: 'text', text: formatDateThai(bill.due_date), size: 'sm', color: '#888888', align: 'end', flex: 2 },
          ],
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'สถานะ', size: 'sm', color: '#888888', flex: 4 },
            { type: 'text', text: BILL_STATUS_TH[bill.status] || bill.status, size: 'sm', color: '#D32F2F', align: 'end', flex: 2 },
          ],
        },
        { type: 'text', text: `เลขที่บิล: ${bill.bill_number || '-'}`, size: 'xxs', color: '#AAAAAA', margin: 'md' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '📎 ชำระแล้วส่งรูปสลิปมาที่แชทนี้ได้เลย', size: 'xs', color: '#666666', wrap: true, align: 'center' },
      ],
    },
  };
 
  return { type: 'flex', altText: `บิลห้อง ${room.room_number} เดือน ${bill.billing_month} ยอดรวม ${formatBaht(bill.total_amount)} บาท`, contents: bubble };
}
 
async function handleSlipUpload(userId, tenant, lease, event) {
  const { data: bill } = await supabase
    .from('bills')
    .select('*')
    .eq('tenant_id', tenant.id)
    .in('status', ['unpaid', 'overdue', 'verifying'])
    .order('billing_month', { ascending: false })
    .limit(1)
    .maybeSingle();
 
  if (!bill) {
    await replyText(userId, 'ไม่พบบิลค้างชำระที่จะแนบสลิปนี้ครับ/ค่ะ หากคิดว่าผิดพลาด กรุณาติดต่อเจ้าของหอพัก');
    return;
  }
 
  let slipUrl = null;
  try {
    const contentRes = await axios.get(
      `https://api-data.line.me/v2/bot/message/${event.message.id}/content`,
      {
        headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
        responseType: 'arraybuffer',
      }
    );
    const fileName = `${bill.id}/${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(SLIP_BUCKET)
      .upload(fileName, contentRes.data, { contentType: 'image/jpeg', upsert: false });
 
    if (!uploadError) {
      const { data: pub } = supabase.storage.from(SLIP_BUCKET).getPublicUrl(fileName);
      slipUrl = pub?.publicUrl || null;
    } else {
      console.error('❌ Slip upload error:', uploadError.message);
    }
  } catch (err) {
    console.error('❌ Error fetching LINE image content:', err.response?.data || err.message);
  }
 
  await supabase.from('payments').insert([
    {
      bill_id: bill.id,
      tenant_id: tenant.id,
      amount: bill.total_amount,
      payment_method: 'transfer',
      slip_url: slipUrl,
      status: 'submitted',
    },
  ]);
  // A DB trigger (trg_payments_submit) automatically moves the bill to
  // 'verifying'. Staff verifies the payment in Supabase, which auto-flips
  // the bill to 'paid' via trg_payments_verify.
 
  await replyText(
    userId,
    `✅ ได้รับสลิปการโอนเงินแล้ว\nบิล: ${bill.bill_number || bill.billing_month}\nยอด: ${formatBaht(bill.total_amount)} บาท\n\nรอเจ้าของ/พนักงานตรวจสอบและยืนยันการชำระเงินครับ/ค่ะ`
  );
}
 
async function handleReportRepair(userId, tenant, lease, description) {
  await supabase.from('maintenance_requests').insert([
    {
      room_id: lease.room_id,
      tenant_id: tenant.id,
      category: 'ทั่วไป',
      description: description || 'ไม่ระบุรายละเอียด',
      priority: 'medium',
      status: 'new',
    },
  ]);
  await replyText(userId, '✅ แจ้งซ่อมสำเร็จ เจ้าของ/ช่างจะตรวจสอบและติดต่อกลับเร็ว ๆ นี้ครับ/ค่ะ');
}
 
async function handlePaymentHistory(userId, tenant) {
  const { data: payments } = await supabase
    .from('payments')
    .select('*, bills(billing_month, bill_number)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(5);
 
  if (!payments || payments.length === 0) {
    await replyText(userId, 'ยังไม่มีประวัติการชำระเงินครับ/ค่ะ');
    return;
  }
 
  const STATUS_TH = { submitted: 'ส่งสลิปแล้ว', verifying: 'กำลังตรวจสอบ', verified: 'ยืนยันแล้ว ✅', rejected: 'ถูกปฏิเสธ ❌' };
  const lines = payments.map(
    (p) =>
      `• ${p.bills?.billing_month || '-'} (${p.bills?.bill_number || '-'}) — ${formatBaht(p.amount)} บ. — ${STATUS_TH[p.status] || p.status}`
  );
  await replyText(userId, `🧾 ประวัติการชำระเงินล่าสุด:\n\n${lines.join('\n')}`);
}
 
async function handleContactOwner(userId) {
  const { data: owner } = await supabase
    .from('staff_users')
    .select('*')
    .eq('role', 'owner')
    .eq('active', true)
    .limit(1)
    .maybeSingle();
 
  const name = owner?.full_name || OWNER_CONTACT_NAME;
  const phone = owner?.phone || OWNER_CONTACT_PHONE;
 
  await replyText(
    userId,
    phone
      ? `📞 ติดต่อ${name}\nโทร: ${phone}`
      : `📞 ติดต่อ${name}\n(ยังไม่ได้ตั้งค่าเบอร์ติดต่อในระบบ)`
  );
}
 
async function handleHelp(userId) {
  await replyText(
    userId,
    '📋 คำสั่งที่ใช้ได้:\n\n' +
      '• เช็คบิล — ดูบิลค้างชำระล่าสุด\n' +
      '• (ส่งรูปสลิป) — แจ้งชำระเงิน\n' +
      '• แจ้งซ่อม <รายละเอียด> — แจ้งปัญหาในห้อง\n' +
      '• ประวัติการชำระเงิน — ดูประวัติการจ่าย 5 รายการล่าสุด\n' +
      '• ติดต่อเจ้าของ — ดูช่องทางติดต่อเจ้าของหอพัก\n' +
      '• ช่วยเหลือ — แสดงเมนูนี้อีกครั้ง'
  );
}
 
// ----------------------------------------------------------------------------
// Text intent matching (also doubles as the target for Rich Menu postback
// actions later — see richmenu setup notes: point each menu item at either
// a matching text message or a postback with data like "intent=check_bill",
// and extend the switch below to read event.postback.data the same way).
// ----------------------------------------------------------------------------
function matchIntent(text) {
  const t = text.trim();
  if (/^\/?(เช็คบิล|ดูบิล|เช็คยอด)/.test(t)) return 'check_bill';
  if (/^\/?แจ้งซ่อม/.test(t)) return 'report_repair';
  if (/^\/?(ประวัติการชำระเงิน|ประวัติ)/.test(t)) return 'payment_history';
  if (/^\/?(ติดต่อเจ้าของ|ติดต่อ)/.test(t)) return 'contact_owner';
  if (/^\/?(ช่วยเหลือ|help|เมนู|\?)$/i.test(t)) return 'help';
  return null;
}
 
async function handleTextMessage(userId, tenant, lease, text) {
  const intent = matchIntent(text);
 
  switch (intent) {
    case 'check_bill':
      return handleCheckBill(userId, tenant, lease);
    case 'report_repair': {
      const description = text.replace(/^\/?แจ้งซ่อม/, '').trim();
      return handleReportRepair(userId, tenant, lease, description);
    }
    case 'payment_history':
      return handlePaymentHistory(userId, tenant);
    case 'contact_owner':
      return handleContactOwner(userId);
    case 'help':
      return handleHelp(userId);
    default:
      return replyText(userId, 'พิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้ทั้งหมดครับ/ค่ะ');
  }
}
 
// ----------------------------------------------------------------------------
// Webhook
// ----------------------------------------------------------------------------
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  const body = req.rawBody;
 
  if (!verifyLineSignature(body, signature)) {
    console.log('❌ Invalid signature - webhook rejected');
    return res.status(401).json({ error: 'Invalid signature' });
  }
 
  // Reply to LINE immediately; process events after. LINE requires a fast 200.
  res.status(200).json({ message: 'OK' });
 
  try {
    const events = req.body.events || [];
 
    for (const event of events) {
      if (event.type !== 'message') continue;
      const userId = event.source.userId;
      if (!userId) continue;
 
      const tenant = await findTenantByLineId(userId);
 
      // -------- Not linked yet: try to link by phone number, or ask for it
      if (!tenant) {
        if (event.message.type === 'text' && isPhoneLike(event.message.text)) {
          const linked = await tryLinkByPhone(userId, event.message.text);
          if (linked) {
            await replyText(userId, `✅ เชื่อมบัญชี LINE สำเร็จ ยินดีต้อนรับคุณ${linked.first_name} ${linked.last_name}\n\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้ครับ/ค่ะ`);
          } else {
            await replyText(userId, '❌ ไม่พบเบอร์นี้ในระบบผู้เช่า กรุณาตรวจสอบเบอร์อีกครั้ง หรือติดต่อเจ้าของหอพักให้ลงทะเบียนให้ก่อนครับ/ค่ะ');
          }
        } else {
          await replyText(userId, '👋 สวัสดีครับ/ค่ะ ยินดีต้อนรับสู่ CLT Tenant Hub\n\nกรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้กับเจ้าของหอพัก เพื่อเชื่อมบัญชี LINE ของคุณเข้ากับห้องพัก');
        }
        continue;
      }
 
      // -------- Linked: needs an active lease to do anything room-specific
      const lease = await findActiveLeaseForTenant(tenant.id);
      if (!lease) {
        await replyText(userId, 'ไม่พบสัญญาเช่าที่ยังใช้งานอยู่ของคุณในระบบ กรุณาติดต่อเจ้าของหอพักครับ/ค่ะ');
        continue;
      }
 
      if (event.message.type === 'text') {
        await handleTextMessage(userId, tenant, lease, event.message.text);
      } else if (event.message.type === 'image') {
        await handleSlipUpload(userId, tenant, lease, event);
      }
      // Other message types (sticker, video, location, ...) are ignored for now.
    }
  } catch (error) {
    console.error('❌ Webhook processing error:', error.message);
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
 
