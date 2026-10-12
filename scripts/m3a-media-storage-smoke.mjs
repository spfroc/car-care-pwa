/**
 * Layer-1 smoke for M3-A private media Storage (disposable project only).
 * Uses anon key + Auth — never service_role.
 * Refuses production ref tqjowsffppgoqtdokbzp.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const URL = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_SUPABASE_ANON;
const EMAIL = process.env.SMOKE_EMAIL || "m2smoke@carcare.test";
const PASS = process.env.SMOKE_PASS;
const BUCKET = "car-care-media";
const PROD = "tqjowsffppgoqtdokbzp";

if (!URL || !ANON || !PASS) {
  console.error("Need SMOKE_SUPABASE_URL, SMOKE_SUPABASE_ANON, and SMOKE_PASS (no hardcoded defaults)");
  process.exit(2);
}
if (URL.includes(PROD)) {
  console.error("Refusing production Supabase project");
  process.exit(2);
}

const results = [];
function ok(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log("PASS", name, detail);
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error("FAIL", name, detail);
}
function finish(code) {
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(code);
}

async function main() {
  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sign, error: signErr } = await client.auth.signInWithPassword({
    email: EMAIL,
    password: PASS,
  });
  if (signErr || !sign.user) {
    fail("auth.signIn", signErr?.message || "no user");
    return finish(1);
  }
  const uid = sign.user.id;
  ok("auth.signIn", uid);

  // Bucket probe via upload of tiny object
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 28 }, (_, i) => i)]);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const key = `${uid}/m3a-smoke/${sha}.jpg`;

  const { error: upErr } = await client.storage.from(BUCKET).upload(key, bytes, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (upErr) {
    fail("storage.upload", upErr.message);
    return finish(1);
  }
  ok("storage.upload", key);

  const { data: dl, error: dlErr } = await client.storage.from(BUCKET).download(key);
  if (dlErr || !dl) {
    fail("storage.download", dlErr?.message || "empty");
    return finish(1);
  }
  const ab = Buffer.from(await dl.arrayBuffer());
  if (ab.length !== bytes.length) {
    fail("storage.verify_size", `${ab.length}!=${bytes.length}`);
    return finish(1);
  }
  ok("storage.download_verify", `size=${ab.length}`);

  // Cross-user path must fail (different uid prefix)
  const badKey = `00000000-0000-0000-0000-000000000000/m3a-smoke/x.jpg`;
  const { error: badErr } = await client.storage.from(BUCKET).upload(badKey, bytes, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (!badErr) {
    fail("storage.rls_block_other_user", "upload to other uid unexpectedly allowed");
    await client.storage.from(BUCKET).remove([badKey]);
    return finish(1);
  }
  ok("storage.rls_block_other_user", badErr.message);

  // Row with storageKey (no base64)
  const payload = {
    id: "m3a-smoke-media",
    mimeType: "image/jpeg",
    byteSize: bytes.length,
    createdAt: "2026-10-12T00:00:00.000Z",
    schemaVersion: 2,
    storageKey: key,
    contentSha256: sha,
  };
  const { data: rpc, error: rpcErr } = await client.rpc("car_care_upsert_lww", {
    p_entity: "media",
    p_id: "m3a-smoke-media",
    p_payload: payload,
    p_updated_at: "2026-10-12T05:00:00.000Z",
    p_deleted_at: null,
    p_device_id: "m3a-smoke",
  });
  if (rpcErr || rpc !== "applied") {
    fail("rpc.media_storage_row", rpcErr?.message || String(rpc));
    return finish(1);
  }
  ok("rpc.media_storage_row", String(rpc));

  const { data: keys, error: listErr } = await client.rpc("car_care_list_media_storage_keys");
  if (listErr) {
    fail("rpc.list_media_keys", listErr.message);
    return finish(1);
  }
  const hit = (keys || []).some((r) => r.storage_key === key);
  if (!hit) {
    fail("rpc.list_media_keys", "expected key missing");
    return finish(1);
  }
  ok("rpc.list_media_keys", `n=${(keys || []).length}`);

  // Cleanup
  await client.from("car_care_rows").delete().eq("entity", "media").eq("id", "m3a-smoke-media");
  await client.storage.from(BUCKET).remove([key]);
  ok("cleanup", "row+object");

  const failed = results.filter((r) => !r.ok);
  finish(failed.length ? 1 : 0);
}

main().catch((e) => {
  fail("unhandled", e instanceof Error ? e.message : String(e));
  finish(1);
});
