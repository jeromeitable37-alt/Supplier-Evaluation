import { NextResponse } from "next/server";
import { appPool,appSession,requireAdmin,errorResponse,AppAccessError } from "../../../lib/server/neonAppAuth";
import { neonSchoolDeliveryEnabled,retryPendingNeonSheetSync } from "../../../lib/server/neonSheetSync";

export const runtime="nodejs";
export const dynamic="force-dynamic";

async function summary() {
  const rows=await appPool().query(
    "SELECT state,count(*)::integer AS total FROM se_sheet_sync GROUP BY state",
  );
  const counts:{queued:number;processing:number;done:number;failed:number}={
    queued:0,processing:0,done:0,failed:0,
  };
  for(const row of rows.rows){
    if(row.state==="processing")counts.processing=Number(row.total);
    if(row.state==="done")counts.done=Number(row.total);
    if(row.state==="failed")counts.failed=Number(row.total);
  }
  counts.queued=counts.failed+counts.processing;
  return {counts,deliveryEnabled:neonSchoolDeliveryEnabled(),
    branch:"migration-preview",readOnly:!neonSchoolDeliveryEnabled()};
}

export async function GET(request:Request) {
  try{
    const session=await appSession(request);requireAdmin(session);
    return NextResponse.json({ok:true,...await summary()},
      {headers:{"Cache-Control":"private,no-store"}});
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request) {
  try{
    const session=await appSession(request);requireAdmin(session);
    if(!neonSchoolDeliveryEnabled()){
      throw new AppAccessError(
        "External Sheet sync is disabled in Preview. No official school rows were changed.",503);
    }
    const raw=await request.text();
    if(raw.length>120)throw new AppAccessError("Invalid request.",400);
    let body:unknown={};
    try{body=JSON.parse(raw);}catch{}
    if(!body||typeof body!=="object"||
      (body as Record<string,unknown>).confirm!=="RETRY_SCHOOL_SHEET"){
      throw new AppAccessError("Explicit retry confirmation required.",400);
    }
    const result=await retryPendingNeonSheetSync(10);
    return NextResponse.json({ok:true,result,...await summary()},
      {headers:{"Cache-Control":"private,no-store"}});
  }catch(error){return errorResponse(error);}
}
