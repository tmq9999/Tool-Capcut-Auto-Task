const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const appDataDb = path.join(process.env.APPDATA, 'automanager-desktop', 'automanager.db');
const db = new DatabaseSync(appDataDb);

const accountId = 'ef2dc665-b313-4382-a66c-cf5607aa31e4';
const userId = '7683455633131357192';
const today = '2026-09-09';
const nowIso = new Date().toISOString();

const tasks = [
  { key: 'capcut_web_newbie_register', title: 'Sign up for CapCut Web', reward: 160, status: 4, opId: null, provedAt: nowIso },
  { key: 'capcut_web_pwa_install', title: 'Install CapCut Web Desktop', reward: 70, status: 2, opId: `capcut_web_pwa_install_${userId}_${today}`, provedAt: nowIso },
  { key: 'capcut_web_push_authorize', title: 'Enable browser notifications', reward: 70, status: 2, opId: `capcut_web_push_authorize_${userId}_${today}`, provedAt: nowIso },
  { key: 'capcut_web_design_studio_picture_creation', title: 'Create images in Design Studio', reward: 30, status: 2, opId: null, provedAt: nowIso },
  { key: 'capcut_web_design_studio_ai_chat', title: 'Chat with AI agent', reward: 40, status: 2, opId: `capcut_web_design_studio_ai_chat_${userId}_${today}`, provedAt: nowIso },
  { key: 'capcut_web_design_studio_upload_img', title: 'Upload an image', reward: 40, status: 2, opId: `capcut_web_design_studio_upload_img_${userId}_${today}`, provedAt: nowIso },
  { key: 'capcut_web_design_studio_canvas_edit', title: 'Edit on canvas', reward: 50, status: 2, opId: `capcut_web_design_studio_canvas_edit_${userId}_${today}`, provedAt: nowIso },
  { key: 'capcut_web_inspiration_generate_done', title: 'Try an Inspiration template', reward: 40, status: 2, opId: `capcut_web_inspiration_generate_done_${userId}_${today}`, provedAt: nowIso },
  { key: 'capcut_web_video_studio_creation', title: 'Create in Video Studio', reward: 30, status: 2, opId: null, provedAt: nowIso },
  { key: 'capcut_web_video_studio_send_msg', title: 'Chat with AI agent', reward: 40, status: 2, opId: `capcut_web_video_studio_send_msg_${userId}_${today}`, provedAt: nowIso },
  { key: 'capcut_web_video_studio_generate_done', title: 'Complete a generation', reward: 40, status: 2, opId: `capcut_web_video_studio_generate_done_${userId}_${today}`, provedAt: nowIso },
  { key: 'capcut_web_video_studio_export', title: 'Make an export', reward: 60, status: 2, opId: `capcut_web_video_studio_export_${userId}_${today}`, provedAt: nowIso }
];

const upsertStmt = db.prepare(`
  INSERT INTO account_tasks (
    account_id, task_key, title, reward, status, op_id, proved_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT (account_id, task_key) DO UPDATE SET
    title = excluded.title,
    reward = excluded.reward,
    status = excluded.status,
    op_id = COALESCE(excluded.op_id, account_tasks.op_id),
    proved_at = COALESCE(excluded.proved_at, account_tasks.proved_at),
    updated_at = excluded.updated_at
`);

for (const t of tasks) {
  upsertStmt.run(accountId, t.key, t.title, t.reward, t.status, t.opId, t.provedAt);
}

// Check database rows
const rows = db.prepare('SELECT task_key, title, status, reward, op_id FROM account_tasks WHERE account_id = ? ORDER BY task_key ASC').all(accountId);
console.log(`Recorded ${rows.length} tasks in automanager.db account_tasks:`);
for (const r of rows) {
  console.log(`- ${r.task_key.padEnd(45)} | Status: ${r.status} | Reward: +${r.reward} | op_id: ${r.op_id || 'null'}`);
}
