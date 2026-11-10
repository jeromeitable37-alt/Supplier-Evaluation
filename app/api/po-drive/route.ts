import { NextResponse } from "next/server";
import { PoDriveAuthError, requirePoDriveAdmin, schoolPoWebhook } from "../../../lib/server/schoolPoAuth";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const MAX_SIZE=8*1024*1024;
const CHUNK_SIZE=1024*1024;
const SUPPORTED=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function validMeta(item:Record<string,unknown>) {
  const poNumber=String(item.poNumber||"").trim();
  const prfNumber=String(item.prfNumber||"").trim();
  const name=String(item.name||"").trim();
  const mimeType=String(item.mimeType||"").trim().toLowerCase();
  const uploadId=String(item.uploadId||"").trim().toLowerCase();
  const totalBytes=Number(item.totalBytes);
  const chunkCount=Number(item.chunkCount);
  if(!poNumber||poNumber.length>100||!/^[\w\s#./-]+$/.test(poNumber)||
    prfNumber.length>100||!name||name.length>160||
    !SUPPORTED.has(mimeType)||!UUID.test(uploadId)||
    !Number.isInteger(totalBytes)||totalBytes<1||totalBytes>MAX_SIZE||
    !Number.isInteger(chunkCount)||chunkCount!==Math.ceil(totalBytes/CHUNK_SIZE)) {
    throw new PoDriveAuthError("Invalid school PO file metadata.",400);
  }
  return {poNumber,prfNumber,name,mimeType,uploadId,totalBytes,chunkCount};
}

/** The regular status call reveals no folder IDs or school credentials. */
export async function GET(request:Request){
  const enabled=process.env.PO_DRIVE_UPLOAD_ENABLED==="true";
  if(new URL(request.url).searchParams.get("diagnostic")!=="1"){
    return NextResponse.json({ok:true,provider:"google-drive",uploadEnabled:enabled,
      chunked:true,maxFileBytes:MAX_SIZE},{
      headers:{"Cache-Control":"no-store"},
    });
  }
  try{
    await requirePoDriveAdmin(request);
    let health:"verified"|"unavailable"|"not-installed"="unavailable";
    let note="School Apps Script or Drive folder needs administrator verification.";
    try{
      const result=await schoolPoWebhook("check_po_setup",{});
      if(result?.folderAccessible===true&&result?.folderPrivate===true&&
        result?.chunkUploadAvailable===true&&result?.chunkPreviewAvailable===true){
        health="verified";
        note=enabled?"Secure school-owned Drive integration is ready.":
          "School-owned Drive connection passed. The final upload safety switch is still OFF.";
      }else{
        health="not-installed";note="The school PO Drive script is missing required checks or is not the deployed version.";
      }
    }catch{
      health="unavailable";
      note="The school Apps Script endpoint cannot verify its private folder. Have the owner deploy the current webhook and check folder access.";
    }
    return NextResponse.json({ok:true,provider:"google-drive",uploadEnabled:enabled,
      connection:health,message:note,canUpload:enabled&&health==="verified",
      chunked:true,maxFileBytes:MAX_SIZE},{
      headers:{"Cache-Control":"private,no-store"},
    });
  }catch(error){
    const status=error instanceof PoDriveAuthError?error.status:503;
    return NextResponse.json({ok:false,message:status===401||status===403?
      "Purchasing administrator sign-in required.":"School Drive diagnostic is unavailable."},{
      status,headers:{"Cache-Control":"no-store"},
    });
  }
}

/**
 * Upload one authenticated <=1MiB chunk, or finalize the assembled PO file.
 * No file or secret is directly sent to the user's Google Drive account.
 * Only the school Apps Script executes the Drive write under school ownership.
 */
export async function POST(request:Request){
  try{
    if(process.env.PO_DRIVE_UPLOAD_ENABLED!=="true"){
      throw new PoDriveAuthError("Private school Drive is not enabled by the authorized school account.",503);
    }
    await requirePoDriveAdmin(request);
    const type=String(request.headers.get("content-type")||"").toLowerCase();
    if(type.includes("application/json")){
      const contentLength=Number(request.headers.get("content-length")||0);
      if(contentLength>4096)throw new PoDriveAuthError("Invalid completion request.",413);
      const raw=await request.text();
      if(raw.length>4096)throw new PoDriveAuthError("Invalid completion request.",413);
      let body:Record<string,unknown>={};
      try{body=JSON.parse(raw);}catch{throw new PoDriveAuthError("Invalid completion request.",400);}
      if(body.action!=="finish")throw new PoDriveAuthError("Invalid upload action.",400);
      const meta=validMeta(body);
      const result=await schoolPoWebhook("finish_po_upload",{upload:meta});
      if(!/^[A-Za-z0-9_-]{15,150}$/.test(String(result?.fileId||""))||
        result?.provider!=="google-drive"){
        throw new Error("School Drive did not confirm the official document.");
      }
      return NextResponse.json({ok:true,provider:"google-drive",
        fileId:result.fileId,name:result.name,mimeType:result.mimeType,
        size:Number(result.size||0)},{
        headers:{"Cache-Control":"no-store"},
      });
    }
    if(!type.startsWith("multipart/form-data")){
      throw new PoDriveAuthError("A valid PO file chunk is required.",415);
    }
    const data=await request.formData();
    const file=data.get("file");
    const meta=validMeta({
      poNumber:data.get("poNumber"),prfNumber:data.get("prfNumber"),
      name:data.get("name"),mimeType:data.get("mimeType"),
      uploadId:data.get("uploadId"),totalBytes:data.get("totalBytes"),
      chunkCount:data.get("chunkCount"),
    });
    const chunkIndex=Number(data.get("chunkIndex"));
    if(!Number.isInteger(chunkIndex)||chunkIndex<0||chunkIndex>=meta.chunkCount||
      !(file instanceof File)||file.size<1||file.size>CHUNK_SIZE||
      file.size!==Math.min(CHUNK_SIZE,meta.totalBytes-chunkIndex*CHUNK_SIZE)){
      throw new PoDriveAuthError("Invalid PO chunk position or size.",400);
    }
    const bytes=Buffer.from(await file.arrayBuffer());
    const saved=await schoolPoWebhook("upload_po_chunk",{
      upload:{...meta,chunkIndex,base64:bytes.toString("base64")},
    });
    if(saved?.received!==true||saved?.chunkIndex!==chunkIndex){
      throw new Error("School Drive did not acknowledge this upload chunk.");
    }
    return NextResponse.json({ok:true,chunkIndex,received:true},{
      headers:{"Cache-Control":"no-store"},
    });
  }catch(error){
    const status=error instanceof PoDriveAuthError?error.status:502;
    const message=error instanceof PoDriveAuthError?error.message:
      "School-owned Drive could not accept the PO. Check the private folder and deployed Apps Script.";
    console.error("School PO upload:",error instanceof Error?error.name:"unknown");
    return NextResponse.json({ok:false,message},{status,headers:{"Cache-Control":"no-store"}});
  }
}
