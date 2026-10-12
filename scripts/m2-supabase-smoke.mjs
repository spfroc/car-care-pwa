/**
 * Real disposable-project smoke for M2 (no Contabo deploy).
 * Uses anon key + Auth only — never service_role.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SMOKE_SUPABASE_URL;
const ANON = process.env.SMOKE_SUPABASE_ANON;
const EMAIL = process.env.SMOKE_EMAIL || "m2smoke@carcare.test";
const PASS = process.env.SMOKE_PASS;

if (!URL || !ANON || !PASS) {
  console.error("Need SMOKE_SUPABASE_URL, SMOKE_SUPABASE_ANON, and SMOKE_PASS (no hardcoded defaults)");
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
  ok("auth.signIn", sign.user.id);

  const { count, error: probeErr } = await client
    .from("car_care_rows")
    .select("id", { count: "exact", head: true });
  if (probeErr) {
    fail("table.probe", probeErr.message);
    return finish(1);
  }
  ok("table.probe", `rows=${count ?? 0}`);

  const payloadA = {
    id: "smoke-v1",
    name: "DeviceA",
    plate: "TEST-A",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-10-12T01:00:00.000Z",
  };
  const { data: rpc1, error: rpc1Err } = await client.rpc("car_care_upsert_lww", {
    p_entity: "vehicles",
    p_id: "smoke-v1",
    p_payload: payloadA,
    p_updated_at: payloadA.updatedAt,
    p_deleted_at: null,
    p_device_id: "device-a",
  });
  if (rpc1Err || rpc1 !== "applied") {
    fail("rpc.lww.apply", rpc1Err?.message || String(rpc1));
    return finish(1);
  }
  ok("rpc.lww.apply", String(rpc1));

  const older = { ...payloadA, name: "Older", updatedAt: "2026-01-01T00:00:00.000Z" };
  const { data: rpc2, error: rpc2Err } = await client.rpc("car_care_upsert_lww", {
    p_entity: "vehicles",
    p_id: "smoke-v1",
    p_payload: older,
    p_updated_at: older.updatedAt,
    p_deleted_at: null,
    p_device_id: "device-b",
  });
  if (rpc2Err || rpc2 !== "skipped_cloud_newer") {
    fail("rpc.lww.skip_older", rpc2Err?.message || String(rpc2));
  } else {
    ok("rpc.lww.skip_older", String(rpc2));
  }

  const newer = { ...payloadA, name: "DeviceB", updatedAt: "2026-10-12T02:00:00.000Z" };
  const { data: rpc3, error: rpc3Err } = await client.rpc("car_care_upsert_lww", {
    p_entity: "vehicles",
    p_id: "smoke-v1",
    p_payload: newer,
    p_updated_at: newer.updatedAt,
    p_deleted_at: null,
    p_device_id: "device-b",
  });
  if (rpc3Err || rpc3 !== "applied") {
    fail("rpc.lww.apply_newer", rpc3Err?.message || String(rpc3));
  } else {
    ok("rpc.lww.apply_newer", String(rpc3));
  }

  const { data: rows, error: pullErr } = await client
    .from("car_care_rows")
    .select("entity,id,payload,updated_at,deleted_at,device_id")
    .eq("user_id", sign.user.id);
  if (pullErr) {
    fail("pull", pullErr.message);
  } else {
    const v = rows.find((r) => r.id === "smoke-v1");
    if (v?.payload?.name === "DeviceB" && v.device_id === "device-b") {
      ok("cross_device_ish.pull", `name=${v.payload.name} device=${v.device_id}`);
    } else {
      fail("cross_device_ish.pull", JSON.stringify(v));
    }
  }

  const anonClient = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: insErr } = await anonClient.from("car_care_rows").insert({
    user_id: "00000000-0000-0000-0000-000000000001",
    entity: "vehicles",
    id: "x",
    payload: {},
    updated_at: new Date().toISOString(),
  });
  if (insErr) {
    ok("rls.block_anon_insert", insErr.message);
  } else {
    fail("rls.block_anon_insert", "insert unexpectedly allowed");
  }

  await client.from("car_care_rows").delete().eq("id", "smoke-v1");
  ok("cleanup", "deleted smoke-v1");

  return finish(results.some((r) => !r.ok) ? 1 : 0);
}

function finish(code) {
  console.log(JSON.stringify({ summary: results, exit: code }, null, 2));
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
