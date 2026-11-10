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
      setError(e instanceof Error?e.message:"Unable to open the PO document.");
    }finally{setLoading(false);}
  }
  return <div className="public-official-page">
    <div className="public-official-page-label">
      OFFICIAL PO DOCUMENT · PAGE {index+1} OF {total}
    </div>
    <div className="public-attachment-toolbar">
      <span className="public-attachment-name">{name}</span>
      {url?
        <a href={url} target="_blank" rel="noreferrer" className="public-document-action secondary">Open document in a new tab</a>:
        <button type="button" onClick={()=>void open()} disabled={loading} className="public-document-action primary">
          {loading?"Opening document…":"View document"}
        </button>
      }
    </div>
    {error&&<p role="alert" className="public-document-error">{error}</p>}
    {url&&((mimeType||"").startsWith("image/")?
      <img src={url} alt={"Official purchase order page "+(index+1)}
        className="public-official-image"/>:
      <iframe src={url} title={"Official purchase order "+(index+1)}
        className="public-po-frame"/>)}
  </div>;
}
