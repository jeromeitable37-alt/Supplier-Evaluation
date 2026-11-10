import { appPool, AppAccessError } from "./neonAppAuth";

/**
 * Neon-only, server-to-school-Apps-Script delivery. The initial evaluation is
 * committed first; failure to reach the school Sheet never loses the response.
 * All data is re-read from trusted Neon tables, not from a public POST body.
 *
 * Do not enable NEON_PREVIEW_EXTERNAL_WRITES_ENABLED on a Preview branch
 * unless the school owner has configured a separate approved test destination.
 * Official production sheets are never used for speculative QA.
 */
export type NeonSheetSyncResult={
  state:"synced"|"already_synced"|"processing";
  sheet:string;
  evaluationId:string;
};

const safeText=(value:unknown)=>typeof value==="string"?value:"";
const asObject=(value:unknown):Record<string,unknown> =>
  value&&typeof value==="object"&&!Array.isArray(value)
    ? value as Record<string,unknown>:{};

export function neonSchoolDeliveryEnabled():boolean {
  return process.env.NEXT_PUBLIC_DATA_BACKEND==="neon" &&
    process.env.NEON_PREVIEW_EXTERNAL_WRITES_ENABLED==="true";
}

export async function syncNeonEvaluationToSheet(token:string):Promise<NeonSheetSyncResult> {
  if(!neonSchoolDeliveryEnabled()){
    throw new AppAccessError("School Sheet delivery is disabled in Neon Preview.",503);
  }
  if(!/^[A-Za-z0-9]{10,40}$/.test(token)){
    throw new AppAccessError("Invalid evaluation token.",400);
  }
  const db=appPool();
  const [savedLink,savedEvaluation]=await Promise.all([
    db.query("SELECT payload,link_status FROM se_evaluation_links WHERE token=$1 LIMIT 1",[token]),
    db.query("SELECT payload FROM se_evaluations WHERE id=$1 LIMIT 1",["public-"+token]),
  ]);
  const link=asObject(savedLink.rows[0]?.payload);
  const evaluation=asObject(savedEvaluation.rows[0]?.payload);
  if(savedLink.rows[0]?.link_status!=="submitted" ||
    safeText(evaluation.publicToken)!==token ||
    safeText(evaluation.poNumber)!==safeText(asObject(link.po).poNumber) ||
    safeText(evaluation.evaluatorRole)!==(safeText(link.evaluatorRole)||"requisitioner")){
    throw new AppAccessError("The evaluation is not ready for school Sheet sync.",409);
  }

  const url=String(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL||"").trim();
  const secret=String(process.env.PMS_WEBHOOK_SECRET||
    process.env.GOOGLE_APPS_SCRIPT_SECRET||"").trim();
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec(?:\?.*)?$/.test(url)||
    secret.length<24){
    throw new AppAccessError("The school Apps Script destination is not configured.",503);
  }

  const id=safeText(evaluation.id);
  const score=asObject(evaluation.scores);
  const payload={
    id,poNumber:evaluation.poNumber,prfNo:evaluation.prfNo,
    supplier:evaluation.supplier,address:evaluation.address,
    itemsDelivered:evaluation.itemsDelivered,evaluatorRole:evaluation.evaluatorRole,
    evaluatorName:evaluation.evaluatorName,evaluatorEmail:evaluation.evaluatorEmail,
    submittedAt:evaluation.submittedAt,finalRating:evaluation.finalRating,
    remarks:evaluation.remarks,scores:score,ratingRemarks:asObject(evaluation.ratingRemarks),
    customerSatisfaction:evaluation.customerSatisfaction,
  };
  const claimed=await db.query(
    "INSERT INTO se_sheet_sync(evaluation_id,state,attempts,lock_expires_at) "+
    "VALUES($1,'processing',1,now()+interval '2 minutes') "+
    "ON CONFLICT(evaluation_id) DO UPDATE SET "+
    "state='processing',attempts=se_sheet_sync.attempts+1,"+
    "lock_expires_at=now()+interval '2 minutes',updated_at=now(),last_error='' "+
    "WHERE se_sheet_sync.state <> 'done' "+
    "AND (se_sheet_sync.lock_expires_at IS NULL OR se_sheet_sync.lock_expires_at < now()) "+
    "AND se_sheet_sync.attempts < 12 RETURNING evaluation_id",
    [id],
  );
  if(claimed.rowCount!==1){
    const current=await db.query(
      "SELECT state,sheet_name,attempts FROM se_sheet_sync WHERE evaluation_id=$1",
      [id],
    );
    if(current.rows[0]?.state==="done")return {
      state:"already_synced",sheet:safeText(current.rows[0]?.sheet_name)||"WEB_EVALUATIONS",
      evaluationId:id,
    };
    if(Number(current.rows[0]?.attempts||0)>=12){
      throw new AppAccessError("This evaluation needs administrator review before further retries.",409);
    }
    return {state:"processing",sheet:"WEB_EVALUATIONS",evaluationId:id};
  }

  try {
    const response=await fetch(url,{
      method:"POST",cache:"no-store",
      headers:{"Content-Type":"application/json",Accept:"application/json"},
      body:JSON.stringify({action:"sync_evaluation",secret,evaluation:payload}),
      signal:AbortSignal.timeout(25000),
    });
    const raw=await response.text();
    let parsed:unknown={};
    try {parsed=JSON.parse(raw);}catch{ /* reject non-JSON responses */ }
    const result=asObject(parsed);
    if(!response.ok||result.ok!==true)throw new Error(
      "School webhook delivery rejected the evaluation.");
    const sheet=safeText(result.sheet)||"WEB_EVALUATIONS";
    await db.query(
      "UPDATE se_sheet_sync SET state='done',lock_expires_at=NULL,"+
      "sheet_name=$2,last_error='',updated_at=now() WHERE evaluation_id=$1",
      [id,sheet.slice(0,120)],
    );
    return {state:"synced",sheet,evaluationId:id};
  }catch(error){
    await db.query(
      "UPDATE se_sheet_sync SET state='failed',lock_expires_at=NULL,"+
      "last_error=$2,updated_at=now() WHERE evaluation_id=$1",
      [id,error instanceof Error?error.message.slice(0,150):"School webhook failed"],
    );
    throw new AppAccessError(
      "Evaluation saved in Neon; school Sheet sync was queued for retry.",503);
  }
}

export async function retryPendingNeonSheetSync(max=20) {
  if(!neonSchoolDeliveryEnabled())return {
    enabled:false,checked:0,synced:0,failed:0,processing:0,
  };
  const db=appPool();
  const cap=Math.max(1,Math.min(30,Math.trunc(max)));
  const pending=await db.query(
    "SELECT e.payload->>'publicToken' AS token "+
    "FROM se_sheet_sync s JOIN se_evaluations e ON e.id=s.evaluation_id "+
    "WHERE s.state='failed' AND s.attempts < 12 "+
    "AND COALESCE(s.lock_expires_at,now()-interval '1 second')<now() "+
    "AND e.payload ? 'publicToken' "+
    "ORDER BY s.updated_at ASC LIMIT $1",
    [cap],
  );
  const stats={enabled:true,checked:pending.rows.length,synced:0,failed:0,processing:0};
  for(const row of pending.rows){
    const token=safeText(row.token);
    if(!/^[A-Za-z0-9]{10,40}$/.test(token)){stats.failed++;continue;}
    try{
      const outcome=await syncNeonEvaluationToSheet(token);
      if(outcome.state==="processing")stats.processing++;
      else stats.synced++;
    }catch{stats.failed++;}
  }
  return stats;
}
