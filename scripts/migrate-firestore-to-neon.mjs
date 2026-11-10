/**
 * One-time, READ-only Firebase Firestore -> dedicated SISC Neon Postgres migration.
 * No Firebase deletes and no login/password migration. Never commit credentials.
 *
 * Requirements on an authorized school machine:
 *   npm install --no-save firebase-admin pg
 *   gcloud auth application-default login
 *   FIREBASE_PROJECT_ID=... DATABASE_URL=<direct new SISC Neon URL> node scripts/migrate-firestore-to-neon.mjs --scan
 *   MIGRATION_WRITE_ACK=SISC_APPROVED node scripts/migrate-firestore-to-neon.mjs --apply
 *
 * The school owner must approve copying staff/supplier records to the new
 * organization-controlled database. Source Firestore is always read-only.
 * Run against migration-preview first. Do not point at any Asylum database.
 */
import { createHash } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, Timestamp, GeoPoint, DocumentReference } from "firebase-admin/firestore";
import pg from "pg";

const ROOT_COLLECTIONS = new Set([
  "users", "evaluations", "purchaseOrders",
  "evaluationLinks", "evaluationContacts", "workspace"
]);
const PAGE_SIZE = 125;
const apply = process.argv.includes("--apply");
const scan = process.argv.includes("--scan");
if (apply === scan) throw new Error("Choose exactly one mode: --scan (read-only) OR --apply (migration).");

const firebaseProject = String(process.env.FIREBASE_PROJECT_ID || "").trim();
if (!/^[a-z][a-z0-9-]{5,100}$/.test(firebaseProject)) {
  throw new Error("Set FIREBASE_PROJECT_ID to the original Firestore project ID.");
}
if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: firebaseProject });
const db = getFirestore();
const counts = {};
let total = 0;
let sqlClient = null;
let runId = null;

function serialize(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Timestamp) return { __firestoreType: "Timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof Date) return { __firestoreType: "Date", iso: value.toISOString() };
  if (value instanceof GeoPoint) return { __firestoreType: "GeoPoint", latitude: value.latitude, longitude: value.longitude };
  if (value instanceof DocumentReference) return { __firestoreType: "DocumentReference", path: value.path };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __firestoreType: "Bytes", base64: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { __firestoreType: "NonFiniteNumber", value: String(value) };
    return value;
  }
  if (typeof value === "bigint") return { __firestoreType: "BigInt", value: String(value) };
  if (typeof value === "object") {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) result[key] = serialize(val);
    }
    return result;
  }
  return value;
}
function textValue(value) { return typeof value === "string" ? value : ""; }
function rating(value) {
  const n = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(n) ? null : n;
}
function docKey(doc) {
  // Absolute paths have an even number of segments for documents.
  return doc.ref.path.split("/");
}
function countPath(doc) {
  const names = docKey(doc);
  // Avoid logging sensitive document IDs and email addresses.
  return names.filter((_, i) => i % 2 === 0).join("/");
}
function assertSiscTarget() {
  if (!apply) return;
  if (process.env.MIGRATION_WRITE_ACK !== "SISC_APPROVED") {
    throw new Error("School owner approval required: set MIGRATION_WRITE_ACK=SISC_APPROVED only after review.");
  }
  const uri = String(process.env.DATABASE_URL || "");
  if (!uri) throw new Error("DATABASE_URL required for --apply.");
  const url = new URL(uri);
  if (!url.hostname.endsWith(".neon.tech") || url.pathname !== "/supplier_evaluation" ||
      !/^postgres(?:ql)?:$/.test(url.protocol)) {
    throw new Error("Migration target must be the dedicated SISC Neon supplier_evaluation database.");
  }
}
async function storeDocument(doc) {
  const path = docKey(doc);
  const isKnownRoot = path.length === 2 && ROOT_COLLECTIONS.has(path[0]);
  const collection = doc.ref.parent.id;
  const data = serialize(doc.data());
  const json = JSON.stringify(data);
  const sha = createHash("sha256").update(json).digest("hex");
  if (isKnownRoot) {
    await sqlClient.query(
      `INSERT INTO firestore_snapshots (run_id,collection_name,document_id,payload,content_sha256)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (run_id,collection_name,document_id)
       DO UPDATE SET payload=EXCLUDED.payload,content_sha256=EXCLUDED.content_sha256`,
      [runId, collection, doc.id, json, sha],
    );
  } else {
    await sqlClient.query(
      `INSERT INTO firestore_extra_snapshots (run_id,firestore_path,collection_name,payload,content_sha256)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (run_id,firestore_path)
       DO UPDATE SET payload=EXCLUDED.payload,content_sha256=EXCLUDED.content_sha256`,
      [runId, doc.ref.path, collection, json, sha],
    );
    return;
  }
  if (collection === "users") {
    const role = ["admin","staff","viewer"].includes(data.role) ? data.role : "staff";
    await sqlClient.query(
      `INSERT INTO se_users (uid,email,display_name,role,active,permissions,payload)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
       ON CONFLICT (uid) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,
       role=EXCLUDED.role,active=EXCLUDED.active,permissions=EXCLUDED.permissions,
       payload=EXCLUDED.payload,imported_at=now()`,
      [doc.id, textValue(data.email), textValue(data.displayName), role, data.active===true,
       JSON.stringify(Array.isArray(data.permissions)?data.permissions:[]), json],
    );
  } else if (collection === "purchaseOrders") {
    await sqlClient.query(
      `INSERT INTO se_purchase_orders (id,po_number,prf_number,vendor_name,po_status,document_provider,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (id) DO UPDATE SET po_number=EXCLUDED.po_number,prf_number=EXCLUDED.prf_number,
       vendor_name=EXCLUDED.vendor_name,po_status=EXCLUDED.po_status,
       document_provider=EXCLUDED.document_provider,payload=EXCLUDED.payload,imported_at=now()`,
      [doc.id,textValue(data.poNumber),textValue(data.prfNumber),textValue(data.vendorName),
       textValue(data.status),textValue(data.documentProvider),json],
    );
  } else if (collection === "evaluations") {
    await sqlClient.query(
      `INSERT INTO se_evaluations (id,po_number,supplier_name,evaluator_role,evaluation_date,final_rating,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (id) DO UPDATE SET po_number=EXCLUDED.po_number,supplier_name=EXCLUDED.supplier_name,
       evaluator_role=EXCLUDED.evaluator_role,evaluation_date=EXCLUDED.evaluation_date,
       final_rating=EXCLUDED.final_rating,payload=EXCLUDED.payload,imported_at=now()`,
      [doc.id,textValue(data.poNumber),textValue(data.supplier),
       textValue(data.evaluatorRole),textValue(data.evaluationDate),rating(data.finalRating),json],
    );
  } else if (collection === "evaluationLinks") {
    await sqlClient.query(
      `INSERT INTO se_evaluation_links (token,link_status,evaluator_role,po_number,payload)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (token) DO UPDATE SET link_status=EXCLUDED.link_status,
       evaluator_role=EXCLUDED.evaluator_role,po_number=EXCLUDED.po_number,
       payload=EXCLUDED.payload,imported_at=now()`,
      [doc.id,textValue(data.status)||"pending",textValue(data.evaluatorRole),
       textValue(data.po?.poNumber),json],
    );
  } else if (collection === "evaluationContacts") {
    await sqlClient.query(
      `INSERT INTO se_evaluation_contacts (id,contact_name,email,payload)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (id) DO UPDATE SET contact_name=EXCLUDED.contact_name,email=EXCLUDED.email,
       payload=EXCLUDED.payload,imported_at=now()`,
      [doc.id,textValue(data.name),textValue(data.email),json],
    );
  } else if (collection === "workspace") {
    await sqlClient.query(
      `INSERT INTO se_workspace (id,payload) VALUES ($1,$2::jsonb)
       ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,imported_at=now()`,
      [doc.id,json],
    );
  }
}
async function walk(collectionRef) {
  let last = null;
  while (true) {
    let q = collectionRef.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) return;
    if (!apply) console.log("Scanned page:", page.docs.length, "docs from collection type", collectionRef.id, "- inspecting nested collections…");

    if (apply) {
      await sqlClient.query("BEGIN");
      try {
        for (const doc of page.docs) await storeDocument(doc);
        await sqlClient.query("COMMIT");
      } catch (err) {
        await sqlClient.query("ROLLBACK");
        throw err;
      }
    }
    for (const doc of page.docs) {
      const path = countPath(doc);
      counts[path] = (counts[path] || 0) + 1;
      total++;
      if (total % 25 === 0) console.log("Progress:", total, "Firestore documents checked (including nested collections).");
      const nested = await doc.ref.listCollections();
      for (const sub of nested) await walk(sub);
    }
    last = page.docs[page.docs.length-1];
  }
}
async function verifyRun() {
  const row = await sqlClient.query(
    `SELECT (SELECT count(*) FROM firestore_snapshots WHERE run_id=$1)::bigint
       + (SELECT count(*) FROM firestore_extra_snapshots WHERE run_id=$1)::bigint AS n`,
    [runId],
  );
  const saved = Number(row.rows[0]?.n || 0);
  if (saved !== total) throw new Error("Migration count mismatch; source read " + total + ", database stored " + saved + ".");

  const mappedTables = {
    users: ["se_users", "uid"],
    purchaseOrders: ["se_purchase_orders", "id"],
    evaluations: ["se_evaluations", "id"],
    evaluationLinks: ["se_evaluation_links", "token"],
    evaluationContacts: ["se_evaluation_contacts", "id"],
    workspace: ["se_workspace", "id"],
  };
  const verified = { sourceDocuments: total, retainedSnapshots: saved };
  for (const [collection, [table, idCol]] of Object.entries(mappedTables)) {
    // All SQL identifiers come from this static allowlist, never user input.
    const result = await sqlClient.query(
      `SELECT
         (SELECT count(*) FROM firestore_snapshots s
          WHERE s.run_id = $1 AND s.collection_name = $2)::integer AS source_count,
         (SELECT count(*) FROM ${table})::integer AS target_count,
         (SELECT count(*) FROM firestore_snapshots s
          LEFT JOIN ${table} t ON t.${idCol} = s.document_id
          WHERE s.run_id = $1 AND s.collection_name = $2
            AND (t.${idCol} IS NULL OR t.payload IS DISTINCT FROM s.payload))::integer AS mismatches,
         (SELECT count(*) FROM ${table} t
          WHERE NOT EXISTS
            (SELECT 1 FROM firestore_snapshots s
             WHERE s.run_id = $1 AND s.collection_name = $2
               AND s.document_id = t.${idCol}))::integer AS unexpected_rows`,
      [runId, collection],
    );
    const got = result.rows[0];
    verified[collection] = got;
    const expected = counts[collection] || 0;
    if (Number(got.source_count) !== expected ||
        Number(got.target_count) !== expected ||
        Number(got.mismatches) !== 0 ||
        Number(got.unexpected_rows) !== 0) {
      throw new Error("Table reconciliation failed for " + collection +
        ". Source/target counts or JSON payloads differ. Cutover must remain disabled.");
    }
  }
  const other = await sqlClient.query(
    "SELECT count(*)::integer AS n FROM firestore_extra_snapshots WHERE run_id=$1",
    [runId],
  );
  verified.unmappedDocuments = Number(other.rows[0]?.n || 0);
  await sqlClient.query(
    `UPDATE migration_runs SET state='verified',expected_counts=$2::jsonb,
       imported_counts=$3::jsonb,completed_at=now() WHERE id=$1`,
    [runId, JSON.stringify(counts), JSON.stringify(verified)],
  );
  console.log("Verified Firestore document count:", saved);
  console.log("Verified normalized SQL table counts and payloads:", JSON.stringify(verified));
}
async function main() {
  assertSiscTarget();
  if (apply) {
    sqlClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await sqlClient.connect();
    const check = await sqlClient.query("SELECT current_database() AS name");
    if (check.rows[0]?.name !== "supplier_evaluation") throw new Error("Unexpected PostgreSQL database.");
    const newRun = await sqlClient.query(
      "INSERT INTO migration_runs (source_project_id,state) VALUES ($1,'importing') RETURNING id",
      [firebaseProject],
    );
    runId = Number(newRun.rows[0].id);
    console.log("Created private migration run:", runId);
  }
  try {
    console.log("Connecting to Firestore project:", firebaseProject, "(read-only source access).");
    const roots = await db.listCollections();
    console.log("Root collections found:", roots.map(c => c.id).sort().join(", ") || "(none)");
    for (const col of roots) {
      console.log("Starting collection:", col.id);
      await walk(col);
      console.log("Finished collection:", col.id, "| total documents checked:", total);
    }
    if (apply) await verifyRun();
    console.log(apply ? "Migration snapshot completed." : "Read-only source scan completed.");
    console.log("Total Firestore docs:", total);
    console.log("Counts by collection path:", JSON.stringify(counts, null, 2));
    console.log("Existing Firebase records were NOT changed or deleted.");
  } catch (err) {
    if (apply && runId) {
      try { await sqlClient.query("UPDATE migration_runs SET state='failed', notes=$2,completed_at=now() WHERE id=$1", [runId,"Import stopped; verify source and retry a new run."]); } catch {}
    }
    throw err;
  } finally {
    if (sqlClient) await sqlClient.end();
  }
}
main().catch(err => { console.error("Migration failed:", err?.message || String(err)); process.exitCode=1; });
