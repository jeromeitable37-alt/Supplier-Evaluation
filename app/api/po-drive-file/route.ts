import { NextResponse } from "next/server";
import { PoDriveAuthError, requirePoDriveAdmin, schoolPoWebhook } from "../../../lib/server/schoolPoAuth";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const ALLOWED_MIME=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);

/** Only active Purchasing admins can read bounded 1MiB pieces of a private PO.
 * The client reconstructs a local Blob URL, never an unrestricted Drive link.
 */
export async function GET(request:Request){
  try{
    if(process.env.PO_DRIVE_UPLOAD_ENABLED!=="true"){
      return NextResponse.json({ok:false,message:"School Drive integration is not enabled."},{
        status:503,headers:{"Cache-Control":"no-store"},
      });
    }
    await requirePoDriveAdmin(request);
    const query=new URL(request.url).searchParams;
    const fileId=query.get("fileId")||"";
    const chunkIndex=Number(query.get("chunkIndex")||"0");
    if(!/^[A-Za-z0-9_-]{15,150}$/.test(fileId)||
      !Number.isInteger(chunkIndex)||chunkIndex<0||chunkIndex>7){
      return NextResponse.json({ok:false,message:"Invalid private PO request."},{status:400});
    }
    const chunk=await schoolPoWebhook("get_po_chunk",{fileId,chunkIndex});
    if(!ALLOWED_MIME.has(String(chunk.mimeType||""))||
      !Number.isInteger(Number(chunk.chunkCount))||
      Number(chunk.chunkCount)<1||Number(chunk.chunkCount)>8||
      !Number.isInteger(Number(chunk.totalBytes))||
      Number(chunk.totalBytes)>8*1024*1024||
      chunk.chunkIndex!==chunkIndex||
      typeof chunk.base64!=="string"||chunk.base64.length>1500000){
      throw new Error("School Drive returned invalid file content.");
    }
    return NextResponse.json({
      ok:true,mimeType:chunk.mimeType,chunkIndex,
      chunkCount:chunk.chunkCount,totalBytes:chunk.totalBytes,
      base64:chunk.base64,
    },{headers:{
      "Cache-Control":"private,no-store,max-age=0",
      "X-Content-Type-Options":"nosniff",
      "Referrer-Policy":"no-referrer",
    }});
  }catch(error){
    const status=error instanceof PoDriveAuthError?error.status:502;
    console.error("School PO preview:",error instanceof Error?error.name:"unknown");
    return NextResponse.json({ok:false,message:status===401||status===403?
      "Purchasing administrator access required.":"Could not open private school Drive PO."},
      {status,headers:{"Cache-Control":"no-store"}});
  }
}
