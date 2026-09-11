
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// Supabase client — SERVICE ROLE key. The schema has Row Level Security
// enabled on every table, gated on is_staff()/is_owner_or_admin() (Supabase
// Auth users only). Tenants never log into Supabase — they talk to this bot
// over LINE — so this backend must use the service role key to read/write
// on their behalf, bypassing RLS by design.
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

// Legacy env-var fallbacks — only used if the `settings` table has no value
// for the equivalent key yet. Prefer editing the `settings` table in
// Supabase instead of these; nothing transactional/config should live only
// in env vars per the CLT Tenant Hub spec.
const OWNER_CONTACT_NAME = process.env.OWNER_CONTACT_NAME || 'เจ้าของหอพัก';
const OWNER_CONTACT_PHONE = process.env.OWNER_CONTACT_PHONE || '';

// Supabase Storage buckets
const SLIP_BUCKET = 'payment-slips';
const MAINTENANCE_BUCKET = 'maintenance-photos';

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

function replyText(userId, text, quickReplyItems) {
  const msg = { type: 'text', text };
  if (quickReplyItems && quickReplyItems.length) msg.quickReply = { items: quickReplyItems.slice(0, 13) };
  return sendLineMessage(userId, msg);
}

// ----------------------------------------------------------------------------
// Postback / Quick Reply helpers
// ----------------------------------------------------------------------------
function qrPostback(label, data, displayText) {
  return {
    type: 'action',
    action: { type: 'postback', label, data, displayText: displayText || label },
  };
}

function withQuickReply(message, items) {
  if (!items || !items.length) return message;
  return { ...message, quickReply: { items: items.slice(0, 13) } };
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

// Thai Buddhist-Era display, e.g. "30 ก.ย. 2569" — used anywhere a date is
// shown back to a tenant (Gregorian year + 543), per the spec's Thai UX rules.
const THAI_MONTHS_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function formatDateThaiBE(isoDate) {
  if (!isoDate) return '-';
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return '-';
  const day = d.getDate();
  const month = THAI_MONTHS_ABBR[d.getMonth()];
  const beYear = d.getFullYear() + 543;
  return `${day} ${month} ${beYear}`;
}

// Parses a tenant-typed date like "30/09/2569" (BE) or "30/09/2026" (CE) into
// an ISO yyyy-mm-dd string, or null if unparseable. year > 2400 is treated as
// Buddhist Era and converted to Gregorian (BE - 543).
function parseThaiDateInput(text) {
  const m = (text || '').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  if (year > 2400) year -= 543;
  const iso = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const d = new Date(iso);
  if (isNaN(d.getTime()) || d.getDate() !== dd) return null;
  return iso;
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

// Maintenance categories offered in the แจ้งซ่อม Quick Reply. Key is what
// travels in postback data (action=maintenance_category&category=<key>);
// value is the Thai label stored in maintenance_requests.category.
const MAINTENANCE_CATEGORIES = {
  electric: 'ไฟฟ้า',
  water: 'ประปา',
  aircon: 'เครื่องปรับอากาศ',
  furniture: 'เฟอร์นิเจอร์ / ของใช้ในห้อง',
  other: 'อื่น ๆ',
};

// ----------------------------------------------------------------------------
// conversation_state — multi-step flow state, keyed ONLY by LINE userId
// (never an in-process/global variable — that would leak one user's
// in-progress flow into another user's session on a shared server). Backed
// by Supabase so it also survives restarts / multiple server instances.
// ----------------------------------------------------------------------------
async function getConversationState(lineUserId) {
  const { data } = await supabase
    .from('conversation_state')
    .select('*')
    .eq('line_user_id', lineUserId)
    .maybeSingle();
  return data || null;
}

async function setConversationState(lineUserId, state, context = {}) {
  await supabase
    .from('conversation_state')
    .upsert({ line_user_id: lineUserId, state, context, updated_at: new Date().toISOString() }, { onConflict: 'line_user_id' });
}

async function clearConversationState(lineUserId) {
  await supabase.from('conversation_state').delete().eq('line_user_id', lineUserId);
}

// ----------------------------------------------------------------------------
// audit_logs — append-only record of tenant-triggered actions that matter:
// check_bill, payment_submitted, maintenance_created, move_out_requested.
// (payment_verified happens when staff edits Supabase directly, outside the
// bot, so it isn't logged from here.) Never blocks the reply on failure.
// ----------------------------------------------------------------------------
async function logAudit(lineUserId, tenantId, action, entityType, entityId, metadata) {
  try {
    await supabase.from('audit_logs').insert([
      {
        line_user_id: lineUserId,
        tenant_id: tenantId || null,
        action,
        entity_type: entityType || null,
        entity_id: entityId || null,
        metadata: metadata || {},
      },
    ]);
  } catch (e) {
    console.error('❌ Audit log error:', e.message);
  }
}

// ----------------------------------------------------------------------------
// settings — key/value config so contact info / bank details are never
// hard-coded in source or env vars. Edit these in Supabase → Table Editor →
// settings.
// ----------------------------------------------------------------------------
async function getSettings(keys) {
  const { data } = await supabase.from('settings').select('key, value').in('key', keys);
  const map = {};
  (data || []).forEach((r) => {
    map[r.key] = r.value;
  });
  return map;
}

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
    .select('*, rooms(*, room_types(name))')
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

// Every handler below re-derives tenant/room scope from `tenant`/`lease`,
// which are themselves resolved ONLY from the LINE userId that LINE itself
// supplies on the webhook event (never from any client-supplied field in a
// postback or message). The one exception is a slip/maintenance flow's
// `bill_id`/context, which is always re-filtered by .eq('tenant_id', tenant.id)
// before use — see finalizeSlipSubmission / handleCheckBill.

// ----------------------------------------------------------------------------
// Outstanding-bill lookup (shared by check_bill / payment_menu / submit_slip)
// ----------------------------------------------------------------------------
async function findOutstandingBill(tenantId) {
  const { data: bill } = await supabase
    .from('bills')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('status', ['unpaid', 'overdue', 'verifying'])
    .order('billing_month', { ascending: false })
    .limit(1)
    .maybeSingle();
  return bill || null;
}

// ----------------------------------------------------------------------------
// 1) เช็กบิล — check_bill
// ----------------------------------------------------------------------------
async function handleCheckBill(userId, tenant, lease) {
  const bill = await findOutstandingBill(tenant.id);

  if (!bill) {
    await replyText(userId, '🎉 ไม่มีบิลค้างชำระในขณะนี้ ขอบคุณที่ชำระตรงเวลาครับ/ค่ะ', [
      qrPostback('🏠 เมนูหลัก', 'action=main_menu'),
    ]);
    return;
  }

  const { data: items } = await supabase
    .from('bill_items')
    .select('*')
    .eq('bill_id', bill.id)
    .order('created_at', { ascending: true });

  const flex = buildBillFlexMessage(lease.rooms, bill, items || []);
  await sendLineMessage(
    userId,
    withQuickReply(flex, [
      qrPostback('💳 ส่งสลิปตอนนี้', 'action=submit_slip', '💳 ส่งสลิปตอนนี้'),
      qrPostback('🏠 เมนูหลัก', 'action=main_menu'),
    ])
  );
  await logAudit(userId, tenant.id, 'check_bill', 'bill', bill.id, { billing_month: bill.billing_month });
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
            { type: 'text', text: formatDateThaiBE(bill.due_date), size: 'sm', color: '#888888', align: 'end', flex: 2 },
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
        { type: 'text', text: '📎 พร้อมชำระ? กดปุ่ม "ส่งสลิปตอนนี้" ด้านล่าง', size: 'xs', color: '#666666', wrap: true, align: 'center' },
      ],
    },
  };

  return { type: 'flex', altText: `บิลห้อง ${room.room_number} เดือน ${bill.billing_month} ยอดรวม ${formatBaht(bill.total_amount)} บาท`, contents: bubble };
}

// ----------------------------------------------------------------------------
// 2) ชำระ/ส่งสลิป — payment_menu → submit_slip → (image) finalizeSlipSubmission
//    STRICT RULE: the bot NEVER marks a bill as paid itself. Receiving a slip
//    only inserts a `payments` row with status='submitted'; a DB trigger
//    flips the bill to 'verifying', and only a staff member marking the
//    payment 'verified' in Supabase flips it to 'paid'.
// ----------------------------------------------------------------------------
async function handlePaymentMenu(userId, tenant) {
  const bill = await findOutstandingBill(tenant.id);
  if (!bill) {
    await replyText(userId, '🎉 ไม่มีบิลค้างชำระในขณะนี้ครับ/ค่ะ ไม่ต้องส่งสลิปก็ได้', [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]);
    return;
  }

  const settings = await getSettings(['bank_name', 'bank_account_number', 'bank_account_name', 'promptpay_qr_url']);
  const bankLines = [];
  if (settings.bank_name || settings.bank_account_number) {
    bankLines.push('');
    bankLines.push('🏦 ช่องทางโอนเงิน');
    if (settings.bank_name) bankLines.push(`ธนาคาร: ${settings.bank_name}`);
    if (settings.bank_account_number) bankLines.push(`เลขบัญชี: ${settings.bank_account_number}`);
    if (settings.bank_account_name) bankLines.push(`ชื่อบัญชี: ${settings.bank_account_name}`);
    if (settings.promptpay_qr_url) bankLines.push(`📱 QR พร้อมเพย์: ${settings.promptpay_qr_url}`);
  }

  const text =
    `💳 ชำระเงิน\n\n` +
    `บิล: ${bill.bill_number || bill.billing_month}\n` +
    `ยอดที่ต้องชำระ: ${formatBaht(bill.total_amount)} บาท\n` +
    `ครบกำหนด: ${formatDateThaiBE(bill.due_date)}` +
    bankLines.join('\n');

  await replyText(userId, text, [
    qrPostback('💳 ส่งสลิปตอนนี้', 'action=submit_slip', '💳 ส่งสลิปตอนนี้'),
    qrPostback('🏠 เมนูหลัก', 'action=main_menu'),
  ]);
}

async function handleSubmitSlipStart(userId, tenant) {
  const bill = await findOutstandingBill(tenant.id);
  if (!bill) {
    await replyText(userId, '🎉 ไม่มีบิลค้างชำระที่ต้องส่งสลิปในขณะนี้ครับ/ค่ะ', [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]);
    return;
  }
  await setConversationState(userId, 'payment_awaiting_slip', { bill_id: bill.id });
  await replyText(
    userId,
    `📎 กรุณาส่ง "รูปภาพ" สลิปการโอนเงินมาที่แชทนี้ได้เลยครับ/ค่ะ\n\nบิล: ${bill.bill_number || bill.billing_month}\nยอดที่ต้องชำระ: ${formatBaht(bill.total_amount)} บาท\n\n(พิมพ์ "ยกเลิก" เพื่อยกเลิกขั้นตอนนี้)`
  );
}

async function finalizeSlipSubmission(userId, tenant, context, event) {
  // Never trust context.bill_id alone — always re-filter by tenant_id too,
  // so a stale/forged bill_id can never touch another tenant's bill.
  const { data: bill } = await supabase
    .from('bills')
    .select('*')
    .eq('id', context.bill_id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!bill) {
    await clearConversationState(userId);
    await replyText(userId, 'ไม่พบบิลที่จะแนบสลิปนี้แล้วครับ/ค่ะ (อาจถูกอัปเดตไปแล้ว) กรุณากด "เช็กบิล" อีกครั้งครับ/ค่ะ', [
      qrPostback('🧾 เช็กบิล', 'action=check_bill'),
    ]);
    return;
  }

  let slipUrl = null;
  try {
    const contentRes = await axios.get(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      responseType: 'arraybuffer',
    });
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
  // trg_payments_submit auto-flips the bill to 'verifying'. Only staff
  // marking the payment 'verified' in Supabase auto-flips it to 'paid'
  // (trg_payments_verify) — this bot never sets bills.status itself.

  await clearConversationState(userId);
  await logAudit(userId, tenant.id, 'payment_submitted', 'bill', bill.id, { amount: bill.total_amount });

  await replyText(
    userId,
    `✅ ได้รับสลิปการโอนเงินแล้ว\nบิล: ${bill.bill_number || bill.billing_month}\nยอด: ${formatBaht(bill.total_amount)} บาท\nสถานะ: กำลังตรวจสอบ\n\nรอเจ้าของ/พนักงานตรวจสอบและยืนยันการชำระเงินครับ/ค่ะ ระบบจะยังไม่ขึ้นว่า "ชำระแล้ว" จนกว่าจะตรวจสอบเสร็จ`
  );
}

// ----------------------------------------------------------------------------
// 3) แจ้งซ่อม — maintenance_menu → maintenance_category → (text) description
//    → (image or skip) finalizeMaintenanceRequest. Ticket numbers
//    (MR-YYMMDD-NNN) are generated by a DB trigger on insert.
// ----------------------------------------------------------------------------
async function handleMaintenanceMenu(userId) {
  await clearConversationState(userId);
  const items = Object.entries(MAINTENANCE_CATEGORIES).map(([key, label]) =>
    qrPostback(label, `action=maintenance_category&category=${key}`, label)
  );
  await replyText(userId, '🔧 แจ้งซ่อม\n\nกรุณาเลือกประเภทปัญหาที่พบครับ/ค่ะ', items);
}

async function handleMaintenanceCategory(userId, category) {
  const label = MAINTENANCE_CATEGORIES[category];
  if (!label) {
    await replyText(userId, 'ไม่พบประเภทปัญหานี้ครับ/ค่ะ กรุณาเลือกใหม่อีกครั้ง', [qrPostback('🔧 แจ้งซ่อม', 'action=maintenance_menu')]);
    return;
  }
  await setConversationState(userId, 'maintenance_awaiting_description', { category });
  await replyText(userId, `แจ้งซ่อม: ${label}\n\nกรุณาพิมพ์รายละเอียดปัญหาที่พบครับ/ค่ะ (เช่น ไฟดับทั้งห้อง, น้ำไม่ไหล)\n\n(พิมพ์ "ยกเลิก" เพื่อยกเลิก)`);
}

async function continueMaintenanceDescription(userId, state, text) {
  const description = (text || '').trim();
  if (!description) {
    await replyText(userId, 'กรุณาพิมพ์รายละเอียดปัญหาเป็นข้อความครับ/ค่ะ');
    return;
  }
  await setConversationState(userId, 'maintenance_awaiting_photo', { category: state.context.category, description });
  await replyText(
    userId,
    '📷 ต้องการแนบรูปภาพประกอบหรือไม่? ส่งรูปมาที่แชทนี้ได้เลย หรือกด "ข้ามขั้นตอนนี้" เพื่อแจ้งซ่อมโดยไม่แนบรูป',
    [qrPostback('⏭️ ข้ามขั้นตอนนี้', 'action=maintenance_skip_photo')]
  );
}

async function finalizeMaintenanceRequest(userId, tenant, lease, context, event) {
  let imageUrl = null;
  if (event && event.message && event.message.type === 'image') {
    try {
      const contentRes = await axios.get(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, {
        headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
        responseType: 'arraybuffer',
      });
      const fileName = `${tenant.id}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from(MAINTENANCE_BUCKET)
        .upload(fileName, contentRes.data, { contentType: 'image/jpeg', upsert: false });
      if (!uploadError) {
        const { data: pub } = supabase.storage.from(MAINTENANCE_BUCKET).getPublicUrl(fileName);
        imageUrl = pub?.publicUrl || null;
      } else {
        console.error('❌ Maintenance photo upload error:', uploadError.message);
      }
    } catch (err) {
      console.error('❌ Error fetching LINE image content:', err.response?.data || err.message);
    }
  }

  const label = MAINTENANCE_CATEGORIES[context.category] ? MAINTENANCE_CATEGORIES[context.category] : context.category;

  const { data: row } = await supabase
    .from('maintenance_requests')
    .insert([
      {
        room_id: lease.room_id,
        tenant_id: tenant.id,
        category: label,
        description: context.description,
        image_url: imageUrl,
        priority: 'medium',
        status: 'new',
      },
    ])
    .select()
    .maybeSingle();

  await clearConversationState(userId);
  await logAudit(userId, tenant.id, 'maintenance_created', 'maintenance_request', row?.id, {
    category: context.category,
    ticket_number: row?.ticket_number,
  });

  await replyText(
    userId,
    `✅ แจ้งซ่อมสำเร็จ\n\nเลขที่: ${row?.ticket_number || '-'}\nประเภท: ${label}\nรายละเอียด: ${context.description}${imageUrl ? '\nแนบรูปภาพแล้ว ✅' : ''}\n\nเจ้าของ/ช่างจะตรวจสอบและติดต่อกลับเร็ว ๆ นี้ครับ/ค่ะ`,
    [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]
  );
}

// Legacy one-shot handler, kept for the plain-text "แจ้งซ่อม <รายละเอียด>"
// command (see matchIntent below) — inserts immediately without the
// category/photo flow. Still gets a ticket_number from the same DB trigger.
async function handleReportRepairLegacy(userId, tenant, lease, description) {
  const { data: row } = await supabase
    .from('maintenance_requests')
    .insert([
      {
        room_id: lease.room_id,
        tenant_id: tenant.id,
        category: 'ทั่วไป',
        description: description || 'ไม่ระบุรายละเอียด',
        priority: 'medium',
        status: 'new',
      },
    ])
    .select()
    .maybeSingle();
  await logAudit(userId, tenant.id, 'maintenance_created', 'maintenance_request', row?.id, { ticket_number: row?.ticket_number, source: 'legacy_text' });
  await replyText(userId, `✅ แจ้งซ่อมสำเร็จ (เลขที่: ${row?.ticket_number || '-'})\nเจ้าของ/ช่างจะตรวจสอบและติดต่อกลับเร็ว ๆ นี้ครับ/ค่ะ`);
}

// ----------------------------------------------------------------------------
// 4) ประวัติชำระ — payment_history
// ----------------------------------------------------------------------------
async function handlePaymentHistory(userId, tenant) {
  const { data: payments } = await supabase
    .from('payments')
    .select('*, bills(billing_month, bill_number)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!payments || payments.length === 0) {
    await replyText(userId, 'ยังไม่มีประวัติการชำระเงินครับ/ค่ะ', [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]);
    return;
  }

  const STATUS_TH = { submitted: 'ส่งสลิปแล้ว', verifying: 'กำลังตรวจสอบ', verified: 'ยืนยันแล้ว ✅', rejected: 'ถูกปฏิเสธ ❌' };
  const lines = payments.map(
    (p) => `• ${p.bills?.billing_month || '-'} (${p.bills?.bill_number || '-'}) — ${formatBaht(p.amount)} บ. — ${STATUS_TH[p.status] || p.status}`
  );
  await replyText(userId, `📜 ประวัติการชำระเงินล่าสุด:\n\n${lines.join('\n')}`, [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]);
}

// ----------------------------------------------------------------------------
// 5) แจ้งย้ายออก — move_out_menu → (date) → (reason) → (confirm)
//    STRICT RULE: this never touches leases.status/rooms.status. It only
//    inserts a `move_out_requests` row (status='pending'); staff process the
//    actual move-out (final meter reading, final bill, deposit) manually in
//    Supabase and update the lease/room then.
// ----------------------------------------------------------------------------
async function handleMoveOutMenu(userId) {
  await setConversationState(userId, 'move_out_awaiting_date', {});
  await replyText(
    userId,
    '🚚 แจ้งย้ายออก\n\nกรุณาระบุวันที่ต้องการย้ายออก รูปแบบ วัน/เดือน/ปี เช่น 30/09/2569\n\n(พิมพ์ "ยกเลิก" เพื่อยกเลิก)'
  );
}

async function continueMoveOutDate(userId, text) {
  const iso = parseThaiDateInput(text);
  if (!iso) {
    await replyText(userId, '❌ รูปแบบวันที่ไม่ถูกต้อง กรุณาพิมพ์ใหม่ในรูปแบบ วัน/เดือน/ปี เช่น 30/09/2569');
    return;
  }
  await setConversationState(userId, 'move_out_awaiting_reason', { date: iso });
  await replyText(userId, `กำหนดย้ายออก: ${formatDateThaiBE(iso)}\n\nกรุณาระบุเหตุผลการย้ายออก หรือกด "ไม่ระบุเหตุผล"`, [
    qrPostback('ไม่ระบุเหตุผล', 'action=move_out_skip_reason'),
  ]);
}

async function proceedToMoveOutConfirm(userId, date, reason) {
  await setConversationState(userId, 'move_out_awaiting_confirm', { date, reason: reason || null });
  await replyText(
    userId,
    `กรุณายืนยันการแจ้งย้ายออก\n\nวันที่ย้ายออก: ${formatDateThaiBE(date)}\nเหตุผล: ${reason || '(ไม่ระบุ)'}\n\nห้องจะยังไม่ถูกปลดสถานะจนกว่าเจ้าหน้าที่จะดำเนินการตรวจสอบห้อง/มิเตอร์/เงินประกันเรียบร้อย`,
    [qrPostback('✅ ยืนยัน', 'action=move_out_confirm', '✅ ยืนยันแจ้งย้ายออก'), qrPostback('❌ ยกเลิก', 'action=move_out_cancel')]
  );
}

async function continueMoveOutReason(userId, state, text) {
  const reason = (text || '').trim();
  await proceedToMoveOutConfirm(userId, state.context.date, reason);
}

async function handleMoveOutConfirm(userId, tenant, lease, context) {
  const { data: row } = await supabase
    .from('move_out_requests')
    .insert([
      {
        lease_id: lease.id,
        tenant_id: tenant.id,
        room_id: lease.room_id,
        requested_move_out_date: context.date,
        reason: context.reason || null,
        status: 'pending',
      },
    ])
    .select()
    .maybeSingle();

  await clearConversationState(userId);
  await logAudit(userId, tenant.id, 'move_out_requested', 'move_out_request', row?.id, { requested_move_out_date: context.date });

  await replyText(
    userId,
    `✅ ได้รับแจ้งการย้ายออกแล้วครับ/ค่ะ\n\nวันที่แจ้ง: ${formatDateThaiBE(context.date)}\nสถานะ: รอเจ้าหน้าที่ติดต่อกลับเพื่อนัดตรวจห้อง/มิเตอร์/เงินประกัน\n\nห้องพักของคุณยังคงสถานะปกติจนกว่าจะดำเนินการเสร็จสิ้นครับ/ค่ะ`,
    [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]
  );
}

async function handleMoveOutCancel(userId) {
  await clearConversationState(userId);
  await replyText(userId, 'ยกเลิกการแจ้งย้ายออกแล้วครับ/ค่ะ', [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]);
}

// ----------------------------------------------------------------------------
// 6) ติดต่อ/ช่วยเหลือ — help_menu → faq / emergency_contact / my_room / contact_owner
// ----------------------------------------------------------------------------
async function handleHelpMenu(userId) {
  await clearConversationState(userId);
  await replyText(userId, '☎️ ติดต่อ/ช่วยเหลือ\n\nเลือกหัวข้อที่ต้องการครับ/ค่ะ', [
    qrPostback('❓ คำถามที่พบบ่อย', 'action=faq'),
    qrPostback('🚨 เบอร์ฉุกเฉิน', 'action=emergency_contact'),
    qrPostback('🏠 ห้องของฉัน', 'action=my_room'),
    qrPostback('📞 ติดต่อเจ้าของ', 'action=contact_owner'),
  ]);
}

async function handleFaq(userId) {
  const text =
    '❓ คำถามที่พบบ่อย\n\n' +
    'Q: ต้องชำระค่าเช่าภายในวันไหน?\nA: ดูวันครบกำหนดได้จากเมนู "เช็กบิล" ของแต่ละเดือน\n\n' +
    'Q: ส่งสลิปแล้วแต่บิลยังไม่ขึ้นว่าชำระแล้ว?\nA: หลังส่งสลิป ระบบจะขึ้นสถานะ "กำลังตรวจสอบ" รอเจ้าหน้าที่ยืนยันก่อน จึงจะเปลี่ยนเป็น "ชำระแล้ว"\n\n' +
    'Q: แจ้งซ่อมแล้วใช้เวลานานแค่ไหน?\nA: เจ้าหน้าที่จะติดต่อกลับตามลำดับความเร่งด่วน สามารถแจ้งเลขที่ตั๋ว (ticket) เพื่อติดตามได้\n\n' +
    'Q: ต้องการย้ายออกต้องทำอย่างไร?\nA: กดเมนู "แจ้งย้ายออก" แจ้งวันที่ล่วงหน้า เจ้าหน้าที่จะนัดตรวจห้อง/มิเตอร์/เงินประกัน';
  await replyText(userId, text, [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]);
}

async function handleEmergencyContact(userId) {
  const settings = await getSettings(['emergency_contact_phone', 'owner_contact_phone', 'owner_contact_name']);
  const phone = settings.emergency_contact_phone || settings.owner_contact_phone || OWNER_CONTACT_PHONE;
  const text = phone
    ? `🚨 เบอร์ติดต่อฉุกเฉิน\n\nโทร: ${phone}\n\nใช้สำหรับกรณีฉุกเฉินเท่านั้น เช่น ไฟไหม้ น้ำท่วม อุบัติเหตุ`
    : '🚨 ยังไม่ได้ตั้งค่าเบอร์ติดต่อฉุกเฉินในระบบ กรุณาติดต่อเจ้าของหอพักโดยตรงครับ/ค่ะ';
  await replyText(userId, text, [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]);
}

async function handleMyRoom(userId, tenant, lease) {
  const room = lease.rooms;
  const roomType = room?.room_types?.name || '-';
  const text =
    `🏠 ห้องของฉัน\n\n` +
    `ผู้เช่า: ${tenant.first_name} ${tenant.last_name}\n` +
    `ห้อง: ${room?.room_number || '-'}\n` +
    `ประเภทห้อง: ${roomType}\n` +
    `ค่าเช่า/เดือน: ${formatBaht(lease.monthly_rent)} บาท\n` +
    `วันที่เริ่มสัญญา: ${formatDateThaiBE(lease.start_date)}` +
    (lease.end_date ? `\nวันที่สิ้นสุดสัญญา: ${formatDateThaiBE(lease.end_date)}` : '');
  await replyText(userId, text, [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]);
}

async function handleContactOwner(userId) {
  const settings = await getSettings(['owner_contact_name', 'owner_contact_phone']);
  let name = settings.owner_contact_name;
  let phone = settings.owner_contact_phone;

  if (!name || !phone) {
    const { data: owner } = await supabase.from('staff_users').select('*').eq('role', 'owner').eq('active', true).limit(1).maybeSingle();
    name = name || owner?.full_name || OWNER_CONTACT_NAME;
    phone = phone || owner?.phone || OWNER_CONTACT_PHONE;
  }

  await replyText(
    userId,
    phone ? `📞 ติดต่อ${name}\nโทร: ${phone}` : `📞 ติดต่อ${name}\n(ยังไม่ได้ตั้งค่าเบอร์ติดต่อในระบบ)`,
    [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]
  );
}

async function handleMainMenu(userId) {
  await clearConversationState(userId);
  await replyText(userId, '🏠 เมนูหลัก\n\nกดเมนูด้านล่างของแชทเพื่อใช้งาน: เช็กบิล / ชำระ-ส่งสลิป / แจ้งซ่อม / ประวัติชำระ / แจ้งย้ายออก / ติดต่อ-ช่วยเหลือ');
}

async function handleHelp(userId) {
  await replyText(
    userId,
    '📋 วิธีใช้งาน:\n\nกดปุ่มเมนูด้านล่างของหน้าแชท (Rich Menu) เพื่อเลือกรายการ ได้แก่ 🧾 เช็กบิล, 💳 ชำระ/ส่งสลิป, 🔧 แจ้งซ่อม, 📜 ประวัติชำระ, 🚚 แจ้งย้ายออก, ☎️ ติดต่อ/ช่วยเหลือ'
  );
}

// ----------------------------------------------------------------------------
// Postback router — the PRIMARY control path per the spec (Rich Menu /
// Quick Reply buttons all send postback data like "action=check_bill" or
// "action=maintenance_category&category=aircon").
// ----------------------------------------------------------------------------
async function handlePostback(userId, tenant, lease, data) {
  const params = new URLSearchParams(data || '');
  const action = params.get('action');

  switch (action) {
    case 'check_bill':
      return handleCheckBill(userId, tenant, lease);
    case 'payment_menu':
      await clearConversationState(userId);
      return handlePaymentMenu(userId, tenant);
    case 'submit_slip':
      return handleSubmitSlipStart(userId, tenant);
    case 'maintenance_menu':
      return handleMaintenanceMenu(userId);
    case 'maintenance_category':
      return handleMaintenanceCategory(userId, params.get('category'));
    case 'maintenance_skip_photo': {
      const state = await getConversationState(userId);
      if (!state || state.state !== 'maintenance_awaiting_photo') {
        await replyText(userId, 'ไม่พบรายการแจ้งซ่อมที่กำลังดำเนินการอยู่ครับ/ค่ะ', [qrPostback('🔧 แจ้งซ่อม', 'action=maintenance_menu')]);
        return;
      }
      return finalizeMaintenanceRequest(userId, tenant, lease, state.context, null);
    }
    case 'payment_history':
      await clearConversationState(userId);
      return handlePaymentHistory(userId, tenant);
    case 'move_out_menu':
      return handleMoveOutMenu(userId);
    case 'move_out_skip_reason': {
      const state = await getConversationState(userId);
      if (!state || state.state !== 'move_out_awaiting_reason') {
        await replyText(userId, 'ไม่พบรายการแจ้งย้ายออกที่กำลังดำเนินการอยู่ครับ/ค่ะ', [qrPostback('🚚 แจ้งย้ายออก', 'action=move_out_menu')]);
        return;
      }
      return proceedToMoveOutConfirm(userId, state.context.date, null);
    }
    case 'move_out_confirm': {
      const state = await getConversationState(userId);
      if (!state || state.state !== 'move_out_awaiting_confirm') {
        await replyText(userId, 'ไม่พบรายการแจ้งย้ายออกที่รอการยืนยันครับ/ค่ะ', [qrPostback('🚚 แจ้งย้ายออก', 'action=move_out_menu')]);
        return;
      }
      return handleMoveOutConfirm(userId, tenant, lease, state.context);
    }
    case 'move_out_cancel':
      return handleMoveOutCancel(userId);
    case 'help_menu':
      return handleHelpMenu(userId);
    case 'faq':
      return handleFaq(userId);
    case 'emergency_contact':
      return handleEmergencyContact(userId);
    case 'my_room':
      return handleMyRoom(userId, tenant, lease);
    case 'contact_owner':
      return handleContactOwner(userId);
    case 'main_menu':
      return handleMainMenu(userId);
    default:
      console.log('⚠️ Unknown postback action:', data);
      return replyText(userId, 'ขออภัยครับ/ค่ะ ไม่พบรายการนี้ กรุณาลองใหม่จากเมนูด้านล่าง', [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]);
  }
}

// ----------------------------------------------------------------------------
// Legacy text intent matching — kept as a secondary fallback for tenants who
// still type commands directly, NOT the primary control path anymore (the
// Rich Menu now sends Postback actions, handled by handlePostback above).
// ----------------------------------------------------------------------------
function matchIntent(text) {
  const t = text.trim();
  if (/^\/?(เช็คบิล|เช็กบิล|ดูบิล|เช็คยอด)/.test(t)) return 'check_bill';
  if (/^\/?(แจ้งชำระเงิน|ส่งสลิป)/.test(t)) return 'submit_slip_prompt';
  if (/^\/?แจ้งซ่อม/.test(t)) return 'report_repair';
  if (/^\/?(ประวัติการชำระเงิน|ประวัติชำระ|ประวัติ)/.test(t)) return 'payment_history';
  if (/^\/?(ติดต่อเจ้าของ|ติดต่อ)/.test(t)) return 'contact_owner';
  if (/^\/?(ช่วยเหลือ|help|เมนู|\?)$/i.test(t)) return 'help';
  return null;
}

async function handleTextMessage(userId, tenant, lease, text) {
  const intent = matchIntent(text);

  switch (intent) {
    case 'check_bill':
      return handleCheckBill(userId, tenant, lease);
    case 'submit_slip_prompt':
      return handleSubmitSlipStart(userId, tenant);
    case 'report_repair': {
      const description = text.replace(/^\/?แจ้งซ่อม/, '').trim();
      return handleReportRepairLegacy(userId, tenant, lease, description);
    }
    case 'payment_history':
      return handlePaymentHistory(userId, tenant);
    case 'contact_owner':
      return handleContactOwner(userId);
    case 'help':
      return handleHelp(userId);
    default:
      return replyText(userId, 'พิมพ์ "ช่วยเหลือ" หรือกดเมนูด้านล่างของแชทเพื่อดูรายการที่ใช้ได้ครับ/ค่ะ');
  }
}

// ----------------------------------------------------------------------------
// Stateful text/image routing — checked BEFORE the legacy matchIntent path.
// conversation_state is always read fresh per event, keyed by this event's
// own LINE userId only.
// ----------------------------------------------------------------------------
async function handleIncomingText(userId, tenant, lease, text) {
  const state = await getConversationState(userId);
  const activeState = state && state.state && state.state !== 'idle' ? state.state : null;

  if (activeState && text.trim() === 'ยกเลิก') {
    await clearConversationState(userId);
    await replyText(userId, 'ยกเลิกการทำรายการแล้วครับ/ค่ะ', [qrPostback('🏠 เมนูหลัก', 'action=main_menu')]);
    return;
  }

  switch (activeState) {
    case 'maintenance_awaiting_description':
      return continueMaintenanceDescription(userId, state, text);
    case 'maintenance_awaiting_photo':
      return replyText(userId, '📷 กรุณาส่งรูปภาพ หรือกด "ข้ามขั้นตอนนี้" ด้านบน (หรือพิมพ์ "ยกเลิก")');
    case 'payment_awaiting_slip':
      return replyText(userId, '📎 กรุณาส่งรูปภาพสลิปการโอนเงิน (หรือพิมพ์ "ยกเลิก" เพื่อยกเลิก)');
    case 'move_out_awaiting_date':
      return continueMoveOutDate(userId, text);
    case 'move_out_awaiting_reason':
      return continueMoveOutReason(userId, state, text);
    case 'move_out_awaiting_confirm':
      if (/^(ยืนยัน|yes|ok)$/i.test(text.trim())) return handleMoveOutConfirm(userId, tenant, lease, state.context);
      if (/^(ยกเลิก|no|cancel)$/i.test(text.trim())) return handleMoveOutCancel(userId);
      return replyText(userId, 'กรุณากดปุ่ม "ยืนยัน" หรือ "ยกเลิก" ด้านบนครับ/ค่ะ');
    default:
      return handleTextMessage(userId, tenant, lease, text);
  }
}

async function handleIncomingImage(userId, tenant, lease, event) {
  const state = await getConversationState(userId);
  const activeState = state && state.state && state.state !== 'idle' ? state.state : null;

  if (activeState === 'payment_awaiting_slip') {
    return finalizeSlipSubmission(userId, tenant, state.context, event);
  }
  if (activeState === 'maintenance_awaiting_photo') {
    return finalizeMaintenanceRequest(userId, tenant, lease, state.context, event);
  }

  await replyText(userId, 'หากต้องการส่งสลิปการชำระเงิน กรุณากดปุ่ม "💳 ชำระ/ส่งสลิป" จากเมนูด้านล่างก่อนนะครับ/คะ', [
    qrPostback('💳 ชำระ/ส่งสลิป', 'action=payment_menu'),
  ]);
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

  const events = req.body.events || [];

  for (const event of events) {
    // Each event is isolated in its own try/catch so one bad event/DB
    // hiccup can't take down the rest of the batch, and tenants never see a
    // raw stack trace — only a friendly Thai error message.
    try {
      if (event.type !== 'message' && event.type !== 'postback') continue;
      const userId = event.source && event.source.userId;
      if (!userId) continue;

      const tenant = await findTenantByLineId(userId);

      // -------- Not linked yet: try to link by phone number, or ask for it
      if (!tenant) {
        if (event.type === 'message' && event.message.type === 'text' && isPhoneLike(event.message.text)) {
          const linked = await tryLinkByPhone(userId, event.message.text);
          if (linked) {
            await replyText(userId, `✅ เชื่อมบัญชี LINE สำเร็จ ยินดีต้อนรับคุณ${linked.first_name} ${linked.last_name}\n\nกดเมนูด้านล่างของแชทเพื่อเริ่มใช้งานครับ/ค่ะ`);
          } else {
            await replyText(userId, '❌ ไม่พบเบอร์นี้ในระบบผู้เช่า กรุณาตรวจสอบเบอร์อีกครั้ง หรือติดต่อเจ้าของหอพักให้ลงทะเบียนให้ก่อนครับ/ค่ะ');
          }
        } else if (event.type === 'message') {
          await replyText(userId, '👋 สวัสดีครับ/ค่ะ ยินดีต้อนรับสู่ CLT Tenant Hub\n\nกรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้กับเจ้าของหอพัก เพื่อเชื่อมบัญชี LINE ของคุณเข้ากับห้องพัก');
        } else {
          await replyText(userId, 'กรุณาเชื่อมบัญชีก่อนใช้เมนูนี้ครับ/ค่ะ พิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้กับเจ้าของหอพัก');
        }
        continue;
      }

      // -------- Linked: needs an active lease to do anything room-specific
      const lease = await findActiveLeaseForTenant(tenant.id);
      if (!lease) {
        await replyText(userId, 'ไม่พบสัญญาเช่าที่ยังใช้งานอยู่ของคุณในระบบ กรุณาติดต่อเจ้าของหอพักครับ/ค่ะ');
        continue;
      }

      if (event.type === 'postback') {
        await handlePostback(userId, tenant, lease, event.postback.data);
      } else if (event.message.type === 'text') {
        await handleIncomingText(userId, tenant, lease, event.message.text);
      } else if (event.message.type === 'image') {
        await handleIncomingImage(userId, tenant, lease, event);
      }
      // Other message types (sticker, video, location, ...) are ignored for now.
    } catch (error) {
      console.error('❌ Event processing error:', error.message);
      try {
        const userId = event.source && event.source.userId;
        if (userId) {
          await replyText(userId, 'ขออภัยครับ/ค่ะ เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่อีกครั้ง หรือติดต่อเจ้าของหอพักหากยังพบปัญหาซ้ำ');
        }
      } catch (_) {
        // swallow — never let the error handler itself crash the loop
      }
    }
  }
});

// ----------------------------------------------------------------------------
// Temporary admin endpoint — creates/updates the Postback-driven Rich Menu
// via the Messaging API directly (the LINE OA Manager GUI editor has no
// Postback action type, only NONE/URL/COUPON/TEXT/REWARD_CARD, so the GUI
// cannot produce this menu). Protected by the channel secret as a query
// param. Safe to remove once the rich menu has been created — re-running it
// just creates another rich menu, so delete the old one manually in that
// case (LINE Developers Console → Messaging API → Rich menus, or via the
// Messaging API richmenu/list + richmenu/{id} DELETE).
// ----------------------------------------------------------------------------
const RICHMENU_AREAS = [
  { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: 'postback', data: 'action=check_bill', displayText: '🧾 เช็กบิล' } },
  { bounds: { x: 833, y: 0, width: 833, height: 843 }, action: { type: 'postback', data: 'action=payment_menu', displayText: '💳 ชำระ/ส่งสลิป' } },
  { bounds: { x: 1666, y: 0, width: 834, height: 843 }, action: { type: 'postback', data: 'action=maintenance_menu', displayText: '🔧 แจ้งซ่อม' } },
  { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'postback', data: 'action=payment_history', displayText: '📜 ประวัติชำระ' } },
  { bounds: { x: 833, y: 843, width: 833, height: 843 }, action: { type: 'postback', data: 'action=move_out_menu', displayText: '🚚 แจ้งย้ายออก' } },
  { bounds: { x: 1666, y: 843, width: 834, height: 843 }, action: { type: 'postback', data: 'action=help_menu', displayText: '☎️ ติดต่อ/ช่วยเหลือ' } },
];

app.get('/admin/richmenu/setup', async (req, res) => {
  // Uses its own dedicated ADMIN_SETUP_TOKEN env var (set separately in
  // Render) rather than reusing LINE_CHANNEL_SECRET, so this one-off admin
  // action never needs anyone to read a live secret out of a secrets vault.
  if (!process.env.ADMIN_SETUP_TOKEN || req.query.secret !== process.env.ADMIN_SETUP_TOKEN) {
    return res.status(403).send('Forbidden');
  }
  try {
    const imagePath = path.join(__dirname, 'richmenu.png');
    if (!fs.existsSync(imagePath)) {
      return res.status(500).json({ ok: false, error: 'richmenu.png not found next to server.js — commit it first' });
    }

    const createRes = await axios.post(
      'https://api.line.me/v2/bot/richmenu',
      {
        size: { width: 2500, height: 1686 },
        selected: true,
        name: 'CLT Tenant Hub Main Menu',
        chatBarText: 'เมนู',
        areas: RICHMENU_AREAS,
      },
      { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    const richMenuId = createRes.data.richMenuId;

    const imageBuffer = fs.readFileSync(imagePath);
    await axios.post(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, imageBuffer, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'image/png' },
    });

    await axios.post(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {}, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });

    res.json({ ok: true, richMenuId });
  } catch (err) {
    console.error('❌ richmenu setup error:', err.response?.data || err.message);
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
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
