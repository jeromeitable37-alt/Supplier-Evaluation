import { NextResponse } from "next/server";
import type { Pool, PoolClient } from "pg";
import {
  appPool, appSession, requireAdmin, requirePermission,
  hasPermission, AppAccessError, isSafeId, object, s, numberOrNull,
  jsonPayload, errorResponse, type AppSession,
} from "../../../lib/server/neonAppAuth";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// All records remain on the isolated Neon migration-preview database.
// Firebase Authentication verifies identity, Neon se_users enforces RBAC.
const TABLES = {
  evaluations: "se_evaluations",
  purchaseOrders: "se_purchase_orders",
  evaluationLinks: "se_evaluation_links",
  evaluationContacts: "se_evaluation_contacts",
  users: "se_users",
} as const;
type Collection = keyof typeof TABLES;

function collectionName(value: unknown): Collection {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(TABLES,value)) {
    throw new AppAccessError("Unknown collection.", 400);
  }
  return value as Collection;
}
function readPermission(session: AppSession, coll: Collection): void {
  if (coll === "users") { requireAdmin(session); return; }
  if (coll === "evaluations") { 
    if (!hasPermission(session,"view_dashboard") && !hasPermission(session, "view_reports")) requirePermission(session,"view_dashboard");
    return;
  }
  if (coll === "purchaseOrders" || coll === "evaluationLinks") {
    if (!hasPermission(session,"view_dashboard") && !hasPermission(session,"create_evaluations")) requirePermission(session,"view_dashboard");
    return;
  }
  if (coll === "evaluationContacts") {
    if (!hasPermission(session,"create_evaluations") && !hasPermission(session,"edit_evaluations")) requirePermission(session,"create_evaluations");
  }
}

function requireId(value: unknown): string {
  if (!isSafeId(value)) throw new AppAccessError("Invalid record ID.", 400);
  return value;
}

function idKey(coll: Collection): string {
  return coll === "users" ? "uid" : coll === "evaluationLinks" ? "token" : "id";
}

async function findPayload(client: Pool | PoolClient, coll: Collection, id: string): Promise<Record<string, unknown> | null> {
  const table = TABLES[coll];
  const pk = idKey(coll);
  const result = await client.query("SELECT payload FROM " + table + " WHERE " + pk + "=$1 LIMIT 1", [id]);
  return result.rows[0]?.payload ?? null;
}

export async function GET(request: Request) {
  try {
    const session = await appSession(request);
    const db = appPool();
    const params = new URL(request.url).searchParams;
    const action = params.get("op") || "";
    if (action === "settings") {
      const result = await db.query("SELECT payload FROM se_workspace WHERE id='profile' LIMIT 1");
      return NextResponse.json({ok:true,data:result.rows[0]?.payload||null},{headers:{"Cache-Control":"private,no-store"}});
    }
    if (action === "profile") {
      const userId = params.get("id") || session.uid;
      if (userId !== session.uid) requireAdmin(session);
      const result = await db.query("SELECT payload FROM se_users WHERE uid=$1",[userId]);
      return NextResponse.json({ok:true,data:result.rows[0]?.payload||null},{headers:{"Cache-Control":"private,no-store"}});
    }
    if (action === "po") {
      readPermission(session,"purchaseOrders");
      const id = requireId(params.get("id"));
      return NextResponse.json({ok:true,data:await findPayload(db,"purchaseOrders",id)},{headers:{"Cache-Control":"private,no-store"}});
    }
    if (action === "list") {
      const coll = collectionName(params.get("collection"));
      readPermission(session,coll);
      const table = TABLES[coll];
      const pk = idKey(coll);
      // Full view preserves the current React dashboard model. The 4k cap
      // fails closed on growth rather than silently presenting partial records.
      const result = await db.query("SELECT " + pk + " AS document_id,payload FROM " + table + " ORDER BY " + pk + " ASC LIMIT 4001");
      if (result.rows.length > 4000) throw new AppAccessError("More than 4000 records: a paginated dashboard is required.",409);
      const data = result.rows.map((item) => ({...(item.payload as Record<string,unknown>),[pk]:item.document_id}));
      return NextResponse.json({ok:true,data},{headers:{"Cache-Control":"private,no-store"}});
    }
    throw new AppAccessError("Unknown operation.",400);
  } catch(error) {
    return errorResponse(error);
  }
}

async function upsertEvaluation(db: Pool | PoolClient, input: Record<string,unknown>) {
  const id = requireId(input.id);
  const old = await findPayload(db, "evaluations",id);
  const payload: Record<string,unknown> = { ...(old||{}),...input,id };
  await db.query(
    "INSERT INTO se_evaluations (id,po_number,supplier_name,evaluator_role,evaluation_date,final_rating,payload)"+
    " VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO UPDATE SET "+
    "po_number=EXCLUDED.po_number,supplier_name=EXCLUDED.supplier_name,evaluator_role=EXCLUDED.evaluator_role,"+
    "evaluation_date=EXCLUDED.evaluation_date,final_rating=EXCLUDED.final_rating,payload=EXCLUDED.payload,imported_at=now()",
    [id,s(payload.poNumber),s(payload.supplier),s(payload.evaluatorRole),
     s(payload.evaluationDate),numberOrNull(payload.finalRating),JSON.stringify(payload)],
  );
}

async function upsertPO(db: Pool | PoolClient, input: Record<string,unknown>) {
  const id = requireId(input.id);
  const old = await findPayload(db,"purchaseOrders",id);
  const payload: Record<string,unknown> = { ...(old||{}),...input,id };
  await db.query(
    "INSERT INTO se_purchase_orders (id,po_number,prf_number,vendor_name,po_status,document_provider,payload)"+
    " VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO UPDATE SET "+
    "po_number=EXCLUDED.po_number,prf_number=EXCLUDED.prf_number,vendor_name=EXCLUDED.vendor_name,"+
    "po_status=EXCLUDED.po_status,document_provider=EXCLUDED.document_provider,payload=EXCLUDED.payload,imported_at=now()",
    [id,s(payload.poNumber),s(payload.prfNumber),s(payload.vendorName),
     s(payload.status),s(payload.documentProvider),JSON.stringify(payload)],
  );
}

async function upsertLink(db: Pool | PoolClient, token: string, patch: Record<string,unknown>) {
  const previous = await findPayload(db, "evaluationLinks",token);
  if (!previous) throw new AppAccessError("Evaluation link not found.",404);
  const payload: Record<string,unknown> = { ...previous,...patch,token };
  await db.query(
    "UPDATE se_evaluation_links SET link_status=$2,evaluator_role=$3,po_number=$4,payload=$5::jsonb,imported_at=now() WHERE token=$1",
    [token,s(payload.status)||"pending",s(payload.evaluatorRole),
     s((payload.po as Record<string,unknown>|undefined)?.poNumber),JSON.stringify(payload)],
  );
}

async function transaction<T>(db: Pool, fn: (client: PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function POST(request: Request) {
  try {
    const session = await appSession(request);
    const db = appPool();
    const raw = await request.text();
    if (raw.length > 2000000) throw new AppAccessError("Request is too large.",413);
    let parsed: unknown;
    try {parsed=JSON.parse(raw);}catch{throw new AppAccessError("Invalid JSON request.",400);}
    const body=object(parsed);
    const action=s(body.action);
    const data = body.data;
    let result: unknown = true;

    if (action === "saveEvaluation") {
      const item = jsonPayload(data);
      const existing = await findPayload(db,"evaluations",requireId(item.id));
      requirePermission(session, existing ? "edit_evaluations":"create_evaluations");
      await upsertEvaluation(db,item);
    } else if (action === "saveMany") {
      requirePermission(session,"import_excel");
      if (process.env.NEON_PREVIEW_BULK_IMPORT_ENABLED !== "true") {
        throw new AppAccessError("Bulk import is disabled in Neon Preview to protect migrated school records.",403);
      }
      const records = body.items;
      if (!Array.isArray(records) || records.length > 400) throw new AppAccessError("Maximum 400 records per batch.",400);
      await transaction(db,async (client)=>{
        for (const input of records) await upsertEvaluation(client,jsonPayload(input));
      });
    } else if (action === "deleteEvaluation" || action === "clearEvaluations") {
      requirePermission(session,"delete_evaluations");
      if(action==="clearEvaluations") throw new AppAccessError("Clear-all is disabled in Neon Preview to protect the 1,430-record migration snapshot.",403);
      const ids = action === "deleteEvaluation" ? [body.id] : body.ids;
      if (!Array.isArray(ids)||ids.length > 4000) throw new AppAccessError("Invalid deletion selection.",400);
      const normalized=ids.map(requireId);
      await db.query("DELETE FROM se_evaluations WHERE id=ANY($1::text[])",[normalized]);
    } else if (action === "savePo") {
      const item = jsonPayload(data);
      const existing=await findPayload(db,"purchaseOrders",requireId(item.id));
      requirePermission(session,existing?"edit_evaluations":"create_evaluations");
      await upsertPO(db,item);
    } else if (action === "patchPo") {
      requirePermission(session,"edit_evaluations");
      const id=requireId(body.id);
      const patch=jsonPayload(data);
      const old=await findPayload(db,"purchaseOrders",id);
      if (!old) throw new AppAccessError("Purchase order not found.",404);
      // Only attachment metadata is accepted from this operation.
      const allowed=["documentUrl","documentPath","documentName","documentMimeType","documentSize","documentUploadedAt","documentUploadedBy","documentSource","documentProvider","documentPages"];
      const safe=Object.fromEntries(Object.entries(patch).filter(([k])=>allowed.includes(k)));
      await upsertPO(db,{...old,...safe,id});
    } else if (action === "saveSettings" || action === "clearSettings") {
      requirePermission(session,"system_settings");
      if(action==="clearSettings"){
        await db.query("DELETE FROM se_workspace WHERE id='profile'");
      } else {
        const patch=jsonPayload(data);
        await db.query("INSERT INTO se_workspace (id,payload) VALUES ('profile',$1::jsonb)"+
          " ON CONFLICT(id) DO UPDATE SET payload=se_workspace.payload || EXCLUDED.payload,imported_at=now()",
          [JSON.stringify(patch)]);
      }
    } else if (action === "saveProfile") {
      const patch=jsonPayload(data);
      if(s(patch.uid)!==session.uid) throw new AppAccessError("Cannot change another person's profile.",403);
      const old=await findPayload(db,"users",session.uid);
      if (!old) throw new AppAccessError("Account not found.",404);
      const allowed=["displayName","department","jobTitle","phone","bio","photoURL"];
      const changed=Object.fromEntries(Object.entries(patch).filter(([k])=>allowed.includes(k)));
      const updated:Record<string,unknown>={...old,...changed,uid:session.uid,updatedAt:new Date().toISOString()};
      await db.query("UPDATE se_users SET display_name=$2,payload=$3::jsonb,imported_at=now() WHERE uid=$1",
        [session.uid,s(updated.displayName),JSON.stringify(updated)]);
    } else if (action === "manageUser") {
      requireAdmin(session);
      const patch=jsonPayload(data);
      const uid=requireId(patch.uid);
      if(uid===session.uid) throw new AppAccessError("You cannot change your own admin role.",403);
      const old=await findPayload(db,"users",uid);
      if (!old) throw new AppAccessError("User not found.",404);
      const role=["admin","staff","viewer"].includes(s(patch.role)) ? s(patch.role) : s(old.role);
      const permissions = Array.isArray(patch.permissions) ?
         patch.permissions.filter((p):p is string=>typeof p==="string"&&PERMISSIONS.has(p)) :
         (Array.isArray(old.permissions)?old.permissions:[]);
      // Preserve the prior approval state unless an administrator explicitly changes it.
      const nextActive=typeof patch.active==="boolean" ? patch.active : old.active===true;
      const updated={...old,role,permissions,active:nextActive,
        updatedAt:new Date().toISOString()};
      await db.query(
        "UPDATE se_users SET role=$2,permissions=$3::jsonb,active=$4,payload=$5::jsonb,imported_at=now() WHERE uid=$1",
        [uid,role,JSON.stringify(permissions),updated.active,JSON.stringify(updated)],
      );
    } else if (action === "createLink") {
      requirePermission(session,"create_evaluations");
      const input=jsonPayload(data);
      const po=object(input.po);
      const poNumber=s(po.poNumber).trim(),prfNumber=s(po.prfNumber).trim();
      if(!poNumber&&!prfNumber)throw new AppAccessError("A PO or PRF number is required.",400);
      if(poNumber.length>100||prfNumber.length>100){
        throw new AppAccessError("The PO/PRF number is too long.",400);
      }
      const role=["purchaser","amd_personnel","requisitioner"].includes(s(input.evaluatorRole))
        ? s(input.evaluatorRole):"requisitioner";
      const evaluatorName=s(input.evaluatorName)||
        (role==="purchaser"?s(po.buyerName):role==="amd_personnel"?s(po.receivedBy):s(input.requisitionerName)||s(po.requisitioner))||
        "Evaluator";
      const evaluatorEmail=(s(input.evaluatorEmail)||
        (role==="purchaser"?s(po.buyerEmail):role==="amd_personnel"?s(input.amdEmail):s(input.requisitionerEmail))).trim().toLowerCase();
      if(!/^[^\\s@,;]+@[^\\s@,;]+\\.[^\\s@,;]+$/.test(evaluatorEmail)){
        throw new AppAccessError("A verified evaluator email is required before creating a link.",400);
      }
      const workKey=[poNumber.toLowerCase()||"PRF:"+prfNumber.toLowerCase(),role].join("|");
      // This lock serializes simultaneous requests for the same PO/PRF + role
      // without changing any historical Firestore snapshot or table schema.
      result=await transaction(db,async(client)=>{
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[workKey]);
        const existing=await client.query(
          "SELECT payload,link_status FROM se_evaluation_links "+
          "WHERE evaluator_role=$1 "+
          "AND (($2::text<>'' AND lower(btrim(COALESCE(payload->'po'->>'poNumber','')))=$2) "+
          "OR ($2::text='' AND $3::text<>'' AND lower(btrim(COALESCE(payload->'po'->>'prfNumber','')))=$3)) "+
          "ORDER BY CASE WHEN link_status='pending' THEN 0 ELSE 1 END, imported_at DESC LIMIT 1 FOR UPDATE",
          [role,poNumber.toLowerCase(),prfNumber.toLowerCase()],
        );
        const found=existing.rows[0] as
          {payload:Record<string,unknown>;link_status:string}|undefined;
        if(found){
          if(found.link_status!=="pending")throw new AppAccessError(
            "This evaluator role already submitted for this PO/PRF.",409);
          if(s(found.payload.evaluatorEmail).trim().toLowerCase()!==evaluatorEmail){
            throw new AppAccessError(
              "An active evaluation link exists for a different recipient. Review the existing link before sending.",409);
          }
          const expiry=s(found.payload.expiresAt);
          if(expiry&&Date.parse(expiry)<=Date.now()){
            throw new AppAccessError(
              "The earlier evaluation link expired. Ask an administrator to review it before reissuing.",409);
          }
          return {...found.payload,reused:true};
        }
        const token=randomBytes(20).toString("hex");
        const now=new Date();
        const days=Number(process.env.EVALUATION_LINK_TTL_DAYS||"30");
        const ttlDays=Number.isInteger(days)&&days>=1&&days<=90?days:30;
        const link={
          token,status:"pending",po,workspaceName:s(input.workspaceName)||"Southville International School and Colleges",
          requisitionerName:s(input.requisitionerName)||s(po.requisitioner)||"Requisitioner",
          requisitionerEmail:s(input.requisitionerEmail)||s(po.requisitionerEmail),
          evaluatorRole:role,evaluatorName,evaluatorEmail,
          amdName:s(input.amdName)||s(po.receivedBy),
          amdEmail:s(input.amdEmail),buyerName:s(po.buyerName),buyerEmail:s(po.buyerEmail),
          createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+ttlDays*86400000).toISOString(),
          createdBy:session.email,evaluationId:"public-"+token,
        };
        await client.query(
          "INSERT INTO se_evaluation_links (token,link_status,evaluator_role,po_number,payload) "+
          "VALUES($1,'pending',$2,$3,$4::jsonb)",
          [token,role,poNumber,JSON.stringify(link)],
        );
        return link;
      });
    } else if (action==="updateLinkPo" || action==="markEmail") {
      if(action==="updateLinkPo") requirePermission(session,"edit_evaluations");
      else requirePermission(session,"create_evaluations");
      const token=requireId(body.token);
      if(action==="updateLinkPo") {
        await upsertLink(db,token,{po:jsonPayload(data)});
      } else {
        // The email-sending API records real provider acceptance after it
        // completes. A browser cannot claim that a message was successfully
        // delivered, nor bypass the anti-spam cooldown.
        const current=await findPayload(db,"evaluationLinks",token);
        if(!current)throw new AppAccessError("Link not found.",404);
        result={trackedByServer:true};
      }
    } else if(action==="upsertContact"){
      if(!hasPermission(session,"create_evaluations")&&!hasPermission(session,"edit_evaluations")) requirePermission(session,"create_evaluations");
      const input=jsonPayload(data);
      const name=s(input.name).trim(),email=s(input.email).trim().toLowerCase();
      const roles=Array.isArray(input.roles)?[...new Set(input.roles.filter((r)=>["purchaser","requisitioner","amd_personnel"].includes(s(r))))]:[];
      if(!name||!email.includes("@")||!roles.length)throw new AppAccessError("Enter a valid name, email and evaluator role.",400);
      const normalized=name.toLowerCase().replace(/\s+/g," ");
      let hash=0;for(let i=0;i<normalized.length;i++)hash=(hash*31+normalized.charCodeAt(i))|0;
      const slug=normalized.replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,70)||"contact";
      const id=slug+"-"+Math.abs(hash).toString(36);
      const old=await findPayload(db,"evaluationContacts",id);
      const payload={
        id,name,email,roles:input.replaceRoles===true?roles:[...new Set([...(Array.isArray(old?.roles)?old.roles:[]),...roles])],
        department:s(input.department)||s(old?.department),notes:input.notes===undefined?s(old?.notes):s(input.notes),
        createdAt:s(old?.createdAt)||new Date().toISOString(),updatedAt:new Date().toISOString(),
        createdBy:s(input.createdBy)||s(old?.createdBy)||session.email,
      };
      await db.query(
        "INSERT INTO se_evaluation_contacts (id,contact_name,email,payload) VALUES($1,$2,$3,$4::jsonb)"+
        " ON CONFLICT(id) DO UPDATE SET contact_name=EXCLUDED.contact_name,email=EXCLUDED.email,payload=EXCLUDED.payload,imported_at=now()",
        [id,name,email,JSON.stringify(payload)],
      );
      result=payload;
    } else if(action==="deleteContact"){
      requirePermission(session,"edit_evaluations");
      await db.query("DELETE FROM se_evaluation_contacts WHERE id=$1",[requireId(body.id)]);
    } else {
      throw new AppAccessError("Unknown operation.",400);
    }
    return NextResponse.json({ok:true,data:result},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return errorResponse(error);}
}

const PERMISSIONS=new Set([
  "view_dashboard","scan_forms","create_evaluations","edit_evaluations",
  "delete_evaluations","view_suppliers","view_reports","import_excel",
  "export_excel","database_management","user_management","activity_logs",
  "ai_support","system_settings",
]);
