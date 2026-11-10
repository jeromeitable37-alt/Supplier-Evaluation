import { NextResponse } from "next/server";
import { appPool } from "../../../lib/server/neonAppAuth";
import { schoolPoWebhook } from "../../../lib/server/schoolPoAuth";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const ALLOWED_MIME=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
const headers={
  "Cache-Control":"private, no-store, max-age=0",
  "Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff",
  "Cross-Origin-Resource-Policy":"same-origin",
};
type LinkPo={documentProvider?:string;documentFileId?:string;documentPages?:{
  fileId?:string;mimeType?:string;
}[]};

export async function GET(request:Request) {
  try {
    if(process.env.NEXT_PUBLIC_DATA_BACKEND!=="neon"||
      process.env.PO_DRIVE_UPLOAD_ENABLED!=="true"){
      return NextResponse.json({ok:false,message:"Private PO preview is not enabled."},
        {status:503,headers});
    }
    const params=new URL(request.url).searchParams;
    const token=params.get("token")||"";
    const fileId=params.get("fileId")||"";
    if(!/^[A-Za-z0-9]{10,40}$/.test(token)||
      !/^[A-Za-z0-9_-]{15,150}$/.test(fileId)){
      return NextResponse.json({ok:false,message:"Invalid evaluation document link."},
        {status:400,headers});
    }
    // The random evaluation token is the only bearer credential. Never grant
    // access to a Drive file based solely on its fileId or an arbitrary URL.
    const db=appPool();
    const row=await db.query(
      "SELECT payload,link_status FROM se_evaluation_links WHERE token=$1 LIMIT 1",[token]);
    const saved=row.rows[0] as {payload?:{
      status?:string;expiresAt?:string;po?:LinkPo;
    };link_status?:string}|undefined;
    if(!saved?.payload || !["pending","submitted"].includes(saved.link_status||"")){
      return NextResponse.json({ok:false,message:"Evaluation link not found."},
        {status:404,headers});
    }
    const expiry=saved.payload.expiresAt?Date.parse(saved.payload.expiresAt):NaN;
    if(saved.link_status==="pending"&&Number.isFinite(expiry)&&expiry<=Date.now()){
      return NextResponse.json({ok:false,message:"Evaluation link has expired."},
        {status:410,headers});
    }
    const po=saved.payload.po;
    const ids=[po?.documentFileId,...(po?.documentPages||[]).map(x=>x.fileId)].filter(Boolean);
    if(po?.documentProvider!=="google-drive"||!ids.includes(fileId)){
      return NextResponse.json({ok:false,message:"PO file does not belong to this evaluation."},
        {status:403,headers});
    }

    // The school webhook independently checks the approved private folder.
    // No Drive API credentials or folder access are given to the evaluator.
    const file=await schoolPoWebhook("get_po_file",{fileId});
    const mime=String(file.mimeType||"");
    if(!ALLOWED_MIME.has(mime)||typeof file.base64!=="string"||
      file.base64.length>12*1024*1024){
      throw new Error("Invalid private PO payload.");
    }
    const bytes=Buffer.from(file.base64,"base64");
    if(bytes.length<1||bytes.length>8*1024*1024){
      throw new Error("Private PO is out of allowed size.");
    }
    return new Response(new Uint8Array(bytes),{
      status:200,
      headers:{
        ...headers,
        "Content-Type":mime,
        "Content-Disposition":"inline",
        "Content-Security-Policy":"sandbox",
      },
    });
  }catch(error){
    console.error("Private evaluator PO proxy failed:",
      error instanceof Error?error.name:"unknown");
    return NextResponse.json({ok:false,message:"Private PO preview is temporarily unavailable."},
      {status:502,headers});
  }
}
