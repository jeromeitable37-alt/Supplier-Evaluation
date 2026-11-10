/** Client-only assembly of bounded private school Drive document chunks.
 * Each request remains below Vercel's 4.5 MiB Function payload limit.
 * No school Drive bearer token, credentials or public file URL is returned.
 */
export type PrivatePoBytes={blob:Blob;mimeType:string;size:number};
type Reply={ok?:boolean;message?:string;mimeType?:string;
  chunkIndex?:number;chunkCount?:number;totalBytes?:number;base64?:string};

function decodeBase64(input:string):Uint8Array<ArrayBuffer> {
  const decoded=atob(input);
  const bytes=new Uint8Array(new ArrayBuffer(decoded.length));
  for(let index=0;index<decoded.length;index++)bytes[index]=decoded.charCodeAt(index);
  return bytes;
}

export async function readPrivatePoChunks(
  urlForChunk:(index:number)=>string,
  bearerToken?:string,
  signal?:AbortSignal,
):Promise<PrivatePoBytes>{
  const MAX_CHUNKS=8;
  const CHUNK_SIZE=1024*1024;
  const parts:Uint8Array<ArrayBuffer>[]=[];
  let count=0,size=0,mimeType="";
  for(let index=0;index<MAX_CHUNKS;index++){
    const headers=bearerToken?{Authorization:"Bearer "+bearerToken}:undefined;
    const response=await fetch(urlForChunk(index),{
      cache:"no-store",headers,signal,
    });
    const body=await response.json() as Reply;
    if(!response.ok||body.ok!==true){
      throw new Error(body.message||"Unable to open the private school PO.");
    }
    if(index===0){
      count=Number(body.chunkCount);
      size=Number(body.totalBytes);
      mimeType=String(body.mimeType||"");
      if(!Number.isInteger(count)||count<1||count>MAX_CHUNKS||
        !Number.isInteger(size)||size<1||size>8*CHUNK_SIZE||
        !["application/pdf","image/jpeg","image/png","image/webp"].includes(mimeType)||
        Math.ceil(size/CHUNK_SIZE)!==count){
        throw new Error("The private PO document metadata is invalid.");
      }
    }
    if(body.chunkIndex!==index||body.chunkCount!==count||
      body.totalBytes!==size||body.mimeType!==mimeType||
      typeof body.base64!=="string"){
      throw new Error("The private PO contains an unexpected file chunk.");
    }
    const bytes=decodeBase64(body.base64);
    const expected=Math.min(CHUNK_SIZE,size-index*CHUNK_SIZE);
    if(bytes.length!==expected)throw new Error("The private PO file appears incomplete.");
    parts.push(bytes);
    if(index+1===count)break;
  }
  return {blob:new Blob(parts,{type:mimeType}),mimeType,size};
}
