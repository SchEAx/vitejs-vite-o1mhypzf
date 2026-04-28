import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY eksik.");
}

const db = createClient(SUPABASE_URL || "", SUPABASE_SERVICE_ROLE_KEY || "", {
  auth: { persistSession: false }
});

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function ok(res, data = {}) { return res.status(200).json({ success: true, ...data }); }
function fail(res, status, message) { return res.status(status).json({ success: false, message }); }

function toDb(p = {}) {
  const ops = Array.isArray(p.YapilacakIslem) ? p.YapilacakIslem : safeJson(p.YapilacakIslem, []);
  const kontrol = Array.isArray(p.KontrolJSON) ? p.KontrolJSON : safeJson(p.KontrolJSON, []);
  const out = {
    musteri_adi: p.MusteriAdi ?? p.musteri_adi,
    telefon: p.Telefon ?? p.telefon ?? "",
    plaka: p.Plaka ?? p.plaka ?? "",
    sasi_no: p.SasiNo ?? p.sasi_no ?? "",
    arac_marka: p.AracMarka ?? p.arac_marka ?? "",
    arac_model: p.AracModel ?? p.arac_model ?? "",
    arac_tip: p.AracTip ?? p.arac_tip ?? "",
    yapilacak_islem: ops,
    ucret: Number(p.Ucret ?? p.ucret ?? totalOps(ops) ?? 0),
    notlar: p.Notlar ?? p.notlar ?? "",
    durum: p.Durum ?? p.durum ?? "Beklemede",
    fotograf: p.Fotograf ?? p.fotograf ?? "",
    final_fotograf: p.FinalFotograf ?? p.final_fotograf ?? "",
    teknisyen: p.Teknisyen ?? p.teknisyen ?? "",
    arac_kusurlari: p.AracKusurlari ?? p.arac_kusurlari ?? "",
    imza: p.Imza ?? p.imza ?? "",
    usta_imza: p.UstaImza ?? p.usta_imza ?? "",
    kvkk_onay: !!(p.KvkkOnay ?? p.kvkk_onay),
    musteri_onay: !!(p.MusteriOnay ?? p.musteri_onay),
    kontrol_json: kontrol,
    kontrol_notu: p.KontrolNotu ?? p.kontrol_notu ?? ""
  };
  Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
  return out;
}

function fromDb(r) {
  return {
    id: r.id,
    ID: r.id,
    recordNo: r.record_no,
    KayitNo: r.record_no,
    createdAt: r.created_at,
    TarihSaat: r.created_at,
    updatedAt: r.updated_at,
    MusteriAdi: r.musteri_adi,
    Telefon: r.telefon,
    Plaka: r.plaka,
    SasiNo: r.sasi_no,
    AracMarka: r.arac_marka,
    AracModel: r.arac_model,
    AracTip: r.arac_tip,
    YapilacakIslem: r.yapilacak_islem || [],
    Ucret: Number(r.ucret || 0),
    Notlar: r.notlar,
    Durum: r.durum,
    Fotograf: r.fotograf,
    FinalFotograf: r.final_fotograf,
    Teknisyen: r.teknisyen,
    AracKusurlari: r.arac_kusurlari,
    Imza: r.imza,
    UstaImza: r.usta_imza,
    KvkkOnay: r.kvkk_onay,
    MusteriOnay: r.musteri_onay,
    KontrolJSON: r.kontrol_json || [],
    KontrolNotu: r.kontrol_notu,
    KontrolTarihi: r.kontrol_tarihi,
    sheetSyncedAt: r.sheet_synced_at,
    sheetSyncError: r.sheet_sync_error
  };
}

function safeJson(v, fallback) {
  if (Array.isArray(v) || typeof v === "object") return v || fallback;
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function totalOps(ops) { return (ops || []).reduce((s, o) => s + Number(o.fee || o.ucret || 0), 0); }

async function syncSheet(record) {
  if (!APPS_SCRIPT_URL) return;
  try {
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "upsertRecord", record })
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
    await db.from("service_records").update({ sheet_synced_at: new Date().toISOString(), sheet_sync_error: null }).eq("id", record.id);
  } catch (e) {
    await db.from("service_records").update({ sheet_sync_error: e.message || "Sheet sync hata" }).eq("id", record.id);
  }
}

async function audit(recordId, action, payload) {
  await db.from("audit_logs").insert({ record_id: recordId || null, action, payload });
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    if (req.method === "GET") {
      const action = req.query.action || "list";
      if (action === "get") {
        const { data, error } = await db.from("service_records").select("*").eq("id", req.query.id).is("deleted_at", null).single();
        if (error) return fail(res, 404, error.message);
        return ok(res, { record: fromDb(data) });
      }

      let q = db.from("service_records").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(Number(req.query.limit || 200));
      if (req.query.date) {
        const start = new Date(req.query.date + "T00:00:00+03:00");
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        q = q.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
      }
      if (req.query.q) {
        const s = `%${String(req.query.q).trim()}%`;
        q = q.or(`musteri_adi.ilike.${s},telefon.ilike.${s},plaka.ilike.${s},arac_marka.ilike.${s},arac_model.ilike.${s},teknisyen.ilike.${s}`);
      }
      const { data, error } = await q;
      if (error) return fail(res, 500, error.message);
      return ok(res, { records: (data || []).map(fromDb), total: data?.length || 0 });
    }

    if (req.method !== "POST") return fail(res, 405, "Method not allowed");
    const body = await readBody(req);
    const action = body.action;

    if (action === "add") {
      const payload = toDb(body);
      const { data, error } = await db.from("service_records").insert(payload).select("*").single();
      if (error) return fail(res, 500, error.message);
      await audit(data.id, "add", payload);
      syncSheet(data);
      return ok(res, { record: fromDb(data) });
    }

    if (action === "update") {
      const id = body.ID || body.id;
      if (!id) return fail(res, 400, "ID boş");
      const payload = toDb(body);
      Object.keys(payload).forEach(k => (payload[k] === "" && body.keepEmpty !== true) && delete payload[k]);
      const { data, error } = await db.from("service_records").update(payload).eq("id", id).select("*").single();
      if (error) return fail(res, 500, error.message);
      await audit(id, "update", payload);
      syncSheet(data);
      return ok(res, { record: fromDb(data) });
    }

    if (action === "saveControl") {
      const id = body.ID || body.id;
      if (!id) return fail(res, 400, "ID boş");
      const payload = {
        kontrol_json: safeJson(body.KontrolJSON, []),
        kontrol_notu: body.KontrolNotu || "",
        final_fotograf: body.FinalFotograf || "",
        kontrol_tarihi: new Date().toISOString(),
        durum: body.Durum || "Montaj Bitti"
      };
      const { data, error } = await db.from("service_records").update(payload).eq("id", id).select("*").single();
      if (error) return fail(res, 500, error.message);
      await audit(id, "saveControl", payload);
      syncSheet(data);
      return ok(res, { record: fromDb(data) });
    }

    if (action === "delete") {
      const id = body.ID || body.id;
      const { error } = await db.from("service_records").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) return fail(res, 500, error.message);
      await audit(id, "delete", {});
      return ok(res);
    }

    return fail(res, 400, "Geçersiz action");
  } catch (err) {
    return fail(res, 500, err.message || "Sunucu hatası");
  }
}
