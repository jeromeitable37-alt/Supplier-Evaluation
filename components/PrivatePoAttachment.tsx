"use client";
import { useEffect,useState } from "react";
import { readPrivatePoChunks } from "../lib/privatePoReader";

type Props={token:string;fileId:string;name:string;mimeType?:string;index:number;total:number};

/** A school Drive document is fetched only after the evaluator opens it.
 * It can never access an unrelated Drive file; the API verifies token+fileId.
 */
export default function PrivatePoAttachment({token,fileId,name,mimeType,index,total}:Props){
  const [url,setUrl]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);

  async function open(){
    if(loading)return;
    setLoading(true);setError("");
    try{
      const file=await readPrivatePoChunks(i=>
        "/api/public-po-file?token="+encodeURIComponent(token)+
        "&fileId="+encodeURIComponent(fileId)+"&chunkIndex="+i);
      setUrl(URL.createObjectURL(file.blob));
    }catch(e){
      setError(e instanceof Error?e.message:"Cannot open this private PO.");
    }finally{setLoading(false);}
  }
  return <div className="public-official-page">
    <div className="public-official-page-label">
      PRIVATE SCHOOL DRIVE · DOCUMENT {index+1} OF {total}
    </div>
    <div style={{padding:14,display:"flex",flexWrap:"wrap",gap:10,
      justifyContent:"space-between",alignItems:"center",background:"#f8fafc"}}>
      <span style={{fontSize:12,color:"#334155",wordBreak:"break-word"}}>{name}</span>
      {url?
        <a href={url} target="_blank" rel="noreferrer" style={{
          padding:"8px 13px",color:"#0f766e",border:"1px solid #14b8a6",
          borderRadius:8,fontSize:12,fontWeight:700}}>Open official PO</a>:
        <button type="button" onClick={()=>void open()} disabled={loading} style={{
          padding:"9px 14px",borderRadius:8,border:"1px solid #0f766e",
          background:"#0f766e",color:"#fff",fontWeight:700}}>
          {loading?"Retrieving private PO…":"View official PO"}
        </button>
      }
    </div>
    {error&&<p role="alert" style={{color:"#b91c1c",padding:12,fontSize:12}}>{error}</p>}
    {url&&((mimeType||"").startsWith("image/")?
      <img src={url} alt={"Official purchase order page "+(index+1)}
        className="public-official-image"/>:
      <iframe src={url} title={"Official purchase order "+(index+1)}
        className="public-po-frame"/>)}
  </div>;
}
