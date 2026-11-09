#!/usr/bin/env node
/**
 * Firestore -> SISC Neon migration-preview READ-ONLY comparison.
 *
 * Run with authorized Firestore ADC credentials and an isolated Neon Preview
 * connection. No source or target writes. No document IDs, emails, payloads
 * or credentials are printed. This is an audit, NOT the migration/cutover.
 *
 *   FIREBASE_PROJECT_ID=supplier-evaluation-pro DATABASE_URL=... \
 *     node scripts/audit-firestore-neon.mjs
 *
 * The audit compares each current source document with the latest verified
 * import's immutable JSONB snapshot, including nested collections.
 */
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import {
  getFirestore, FieldPath, Timestamp, GeoPoint, DocumentReference,
} from "firebase-admin/firestore";
import pg from "pg";

const projectId=String(process.env.FIREBASE_PROJECT_ID||"").trim();
if(projectId!=="supplier-evaluation-pro") throw new Error("Wrong Firebase project. Audit refuses to run.");
const connectionString=String(process.env.DATABASE_URL||"");
if(!connectionString) throw new Error("DATABASE_URL must point to the SISC Neon migration-preview branch.");
let connection;
try { connection=new URL(connectionString); }
catch { throw new Error("Malformed private Neon connection URL."); }
if(!["postgres:","postgresql:"].includes(connection.protocol) ||
   connection.pathname!=="/supplier_evaluation" ||
   !/^ep-bitter-haze-b3p8g38w(?:-pooler)?\.c-4\.ap-southeast-1\.aws\.neon\.tech$/.test(connection.hostname)) {
  throw new Error("Wrong destination. Use ONLY the SISC migration-preview database.");
}
if(!getApps().length) initializeApp({ credential:applicationDefault(),projectId });
const firestore=getFirestore();
const sql=new pg.Client({connectionString,connectionTimeoutMillis:15000});
const PAGE_SIZE=125;
const MAX_DOCS=100000;

function serialize(value) {
  if(value===null||value===undefined) return value??null;
  if(value instanceof Timestamp) return {__firestoreType:"Timestamp",seconds:value.seconds,nanoseconds:value.nanoseconds};
  if(value instanceof Date) return {__firestoreType:"Date",iso:value.toISOString()};
  if(value instanceof GeoPoint) return {__firestoreType:"GeoPoint",latitude:value.latitude,longitude:value.longitude};
  if(value instanceof DocumentReference) return {__firestoreType:"DocumentReference",path:value.path};
  if(Buffer.isBuffer(value)||value instanceof Uint8Array) return {__firestoreType:"Bytes",base64:Buffer.from(value).toString("base64")};
  if(Array.isArray(value)) return value.map(serialize);
  if(typeof value==="number") return Number.isFinite(value)?value:{__firestoreType:"NonFiniteNumber",value:String(value)};
  if(typeof value==="bigint") return {__firestoreType:"BigInt",value:String(value)};
  if(typeof value==="object") {
    const obj={};
    for(const [key,item] of Object.entries(value)) if(item!==undefined) obj[key]=serialize(item);
    return obj;
  }
  return value;
}
function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value&&typeof value==="object") {
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  }
  return value;
}
const fingerprint=(value)=>JSON.stringify(canonical(value));
const counts={};
let processed=0;
let unchanged=0;
let changed=0;
let added=0;
const currentKeys=new Set();
const snapshots=new Map();

async function traverse(collectionRef) {
  let last=null;
  while(true) {
    let query=collectionRef.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if(last)query=query.startAfter(last);
    const page=await query.get();
    if(page.empty)break;
    for(const doc of page.docs) {
      processed++;
      if(processed>MAX_DOCS)throw new Error("Read-only audit safety limit reached.");
      const key=doc.ref.path;
      currentKeys.add(key);
      const rootPath=key.split("/").filter((_,idx)=>idx%2===0).join("/");
      counts[rootPath]=(counts[rootPath]||0)+1;
      const previous=snapshots.get(key);
      if(previous===undefined) added++;
      else if(fingerprint(previous)===fingerprint(serialize(doc.data()))) unchanged++;
      else changed++;
      if(processed%100===0)console.log("Read-only audit progress:",processed,"documents checked");
      const subcollections=await doc.ref.listCollections();
      for(const sub of subcollections) await traverse(sub);
    }
    last=page.docs[page.docs.length-1];
  }
}
async function main() {
  try{
    await sql.connect();
    const check=await sql.query("SELECT current_database() AS db");
    if(check.rows[0]?.db!=="supplier_evaluation")throw new Error("Wrong PostgreSQL database.");
    const r=await sql.query(
      "SELECT id FROM migration_runs WHERE state='verified' AND source_project_id=$1 ORDER BY id DESC LIMIT 1",
      [projectId],
    );
    const runId=r.rows[0]?.id;
    if(!runId)throw new Error("No verified source migration found on preview.");
    const source=await sql.query(
      "SELECT collection_name,document_id,payload FROM firestore_snapshots WHERE run_id=$1",
      [runId],
    );
    for(const row of source.rows) snapshots.set(row.collection_name+"/"+row.document_id,row.payload);
    const extras=await sql.query(
      "SELECT firestore_path,payload FROM firestore_extra_snapshots WHERE run_id=$1",[runId],
    );
    for(const row of extras.rows) snapshots.set(row.firestore_path,row.payload);
    console.log("Comparing live Firestore against immutable Neon migration snapshot (READ ONLY).");
    console.log("Verified baseline count:",snapshots.size);
    const roots=await firestore.listCollections();
    for(const root of roots){
      console.log("Checking collection:",root.id);
      await traverse(root);
    }
    const missing=[...snapshots.keys()].filter(key=>!currentKeys.has(key)).length;
    const matches=added===0 && changed===0 && missing===0;
    const report={
      baselineSnapshotDocuments:snapshots.size,
      currentFirestoreDocuments:processed,
      sameDocuments:unchanged,
      newSinceSnapshot:added,
      modifiedSinceSnapshot:changed,
      missingFromCurrentFirestore:missing,
      currentCollections:counts,
      identicalToVerifiedBaseline:matches,
      requiresCatchUp:!matches,
    };
    console.log("READ-ONLY AUDIT REPORT (counts only):");
    console.log(JSON.stringify(report,null,2));
    console.log("No records were written, modified, or deleted in either database.");
    if(!matches)process.exitCode=2;
  }finally{await sql.end().catch(()=>{});}
}
main().catch(error=>{
  console.error("Read-only audit failed:",error instanceof Error?error.message:"unknown error");
  process.exitCode=1;
});
