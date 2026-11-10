import { NextResponse } from "next/server";
import { appPool } from "../../../lib/server/neonAppAuth";
import { schoolPoWebhook } from "../../../lib/server/schoolPoAuth";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const ALLOWED_MIME=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
const noStore={"Cache-Control":"private,no-store,max-age=0",
  "Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff",
  "Cross-Origin-Resource-Policy":"same-origin"};
type LinkPo={documentProvider?:string;documentFileId?:string;
  documentPages?:{fileId?:string;mimeType?:string}[]};

/** One authenticated-by-evaluation-token *chunk* of its own private PO.
 * The link can never be used to read another PO file in the school Drive.
 * Browser assembles chunks into a local Blob for PDF/image preview.
 */
export async function GET(request:Request) {
  try{
    if(process.env.NEXT_PUBLIC_DATA_BACKEND!=="neon"||
      process.env.PO_DRIVE_UPLOAD_ENABLED!=="true"){
      return NextResponse.json({ok:false,message:"Private PO preview is not enabled."},
        {status:503,headers:noStore});
    }
    const params=new URL(request.url).searchParams;
    const token=params.get("token")||"";
    const fileId=params.get("fileId")||"";
    const chunkIndex=Number(params.get("chunkIndex")||"0");
    if(!/^[A-Za-z0-9]{10,40}$/.test(token)||
      !/^[A-Za-z0-9_-]{15,150}$/.test(fileId)||
      !Number.isInteger(chunkIndex)||chunkIndex<0||chunkIndex>7){
      return NextResponse.json({ok:false,message:"Invalid evaluation document request."},
        {status:400,headers:noStore});
    }
    const result=await appPool().query(
      "SELECT payload,link_status FROM se_evaluation_links WHERE token=$1 LIMIT 1",[token]);
    const saved=result.rows[0] as {payload?:{
      expiresAt?:string;po?:LinkPo;
    };link_status?:string}|undefined;
    if(!saved?.payload||!["pending","submitted"].includes(saved.link_status||"")){
      return NextResponse.json({ok:false,message:"Evaluation link not found."},
        {status:404,headers:noStore});
    }
    const expiry=saved.payload.expiresAt?Date.parse(saved.payload.expiresAt):NaN;
    if(Number.isFinite(expiry)&&expiry<=Date.now()){
      return NextResponse.json({ok:false,message:"Evaluation link has expired."},
        {status:410,headers:noStore});
    }
    const po=saved.payload.po;
    const ids=[po?.documentFileId,...(po?.documentPages||[]).map(x=>x.fileId)]
      .filter(Boolean);
    if(po?.documentProvider!=="google-drive"||!ids.includes(fileId)){
      return NextResponse.json({ok:false,message:"PO file does not belong to this evaluation."},
        {status:403,headers:noStore});
    }
    // The school webhook independently checks the approved private folder.
    const chunk=await schoolPoWebhook("get_po_chunk",{fileId,chunkIndex});
    if(!ALLOWED_MIME.has(String(chunk.mimeType||""))||
      !Number.isInteger(Number(chunk.chunkCount))||
      Number(chunk.chunkCount)<1||Number(chunk.chunkCount)>8||
      !Number.isInteger(Number(chunk.totalBytes))||
      Number(chunk.totalBytes)>8*1024*1024||
      chunk.chunkIndex!==chunkIndex||
      typeof chunk.base64!=="string"||chunk.base64.length>1500000){
      throw new Error("Invalid PO chunk response.");
    }
    return NextResponse.json({
      ok:true,mimeType:chunk.mimeType,chunkIndex,
      chunkCount:chunk.chunkCount,totalBytes:chunk.totalBytes,
      base64:chunk.base64,
    },{headers:noStore});
  }catch(error){
    console.error("Evaluator private PO preview:",
      error instanceof Error?error.name:"unknown");
    return NextResponse.json({ok:false,message:"Private PO preview is temporarily unavailable."},
      {status:502,headers:noStore});
  }
}
