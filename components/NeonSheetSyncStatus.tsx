"use client";

import { useCallback,useEffect,useState } from "react";
import { Database,RefreshCw,ShieldCheck,TriangleAlert } from "lucide-react";
import { auth } from "../lib/firebase";

type Counts={queued:number;processing:number;done:number;failed:number};
type Status={ok:true;branch:string;readOnly:boolean;deliveryEnabled:boolean;counts:Counts};
type Retry={ok:true;result:{checked:number;synced:number;failed:number;processing:number}};
const defaultCounts:Counts={queued:0,processing:0,done:0,failed:0};

export default function NeonSheetSyncStatus(){
  const [status,setStatus]=useState<Status|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [retrying,setRetrying]=useState(false);
  const [lastRetry,setLastRetry]=useState<Retry["result"]|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const user=auth?.currentUser;
      if(!user)throw new Error("Please sign in with an authorized Purchasing administrator account.");
      const response=await fetch("/api/neon-sync-status",{
        cache:"no-store",headers:{Authorization:"Bearer "+await user.getIdToken()},
      });
      const body=await response.json() as Status|{ok:false;message:string};
      if(!response.ok||!body.ok)throw new Error(!body.ok?body.message:"Unable to check sync status.");
      setStatus(body);
    }catch(error){
      setError(error instanceof Error?error.message:"Could not read school Sheet sync state.");
    }finally{setLoading(false);}
  },[]);

  useEffect(()=>{void load();},[load]);

  async function retry(){
    if(!status?.deliveryEnabled||retrying)return;
    setRetrying(true);setError("");
    try{
      const user=auth?.currentUser;
      if(!user)throw new Error("Admin login required.");
      const response=await fetch("/api/neon-sync-status",{
        method:"POST",cache:"no-store",
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+await user.getIdToken()},
        body:JSON.stringify({confirm:"RETRY_SCHOOL_SHEET"}),
      });
      const body=await response.json() as Retry|{ok:false;message:string};
      if(!response.ok||!body.ok)throw new Error(!body.ok?body.message:"Retry failed.");
      setLastRetry(body.result);
      await load();
    }catch(error){
      setError(error instanceof Error?error.message:"Could not retry the school webhook.");
    }finally{setRetrying(false);}
  }

  const counts=status?.counts||defaultCounts;
  return (
    <section className="panel" aria-label="Neon evaluation Sheet delivery status"
      style={{marginBottom:18,padding:22}}>
      <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",alignItems:"center",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <Database size={21} color="#14b8a6"/>
          <div>
            <div className="section-kicker">GOOGLE SHEET AUTO-SYNC</div>
            <h2 style={{margin:0,fontSize:18}}>Evaluation delivery status</h2>
          </div>
        </div>
        <span style={{fontSize:12,color:status?.deliveryEnabled?"#047857":"#92400e",fontWeight:700}}>
          {status?.deliveryEnabled?"Approved integration enabled":"School delivery paused in Preview"}
        </span>
      </div>
      <p style={{fontSize:13,opacity:.82,marginTop:12,lineHeight:1.55}}>
        Submissions are saved to Neon before the school Sheet webhook is called.
        Failed deliveries stay queued for authorized retry. Original DATABASE and
        historical supplier data are never replaced.
      </p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",
        gap:10,margin:"14px 0"}}>
        {[["Queued",counts.queued],["Synced",counts.done],["Processing",counts.processing],
          ["Failed attempts",counts.failed]].map(([label,value])=>(
          <div key={label} style={{border:"1px solid #ced6d5",borderRadius:9,padding:12}}>
            <div style={{fontSize:11,opacity:.8}}>{label}</div>
            <strong style={{fontSize:22}}>{Number(value).toLocaleString()}</strong>
          </div>
        ))}
      </div>
      {error&&<p role="alert" style={{color:"#b45309",fontSize:13,display:"flex",alignItems:"center",gap:8}}>
        <TriangleAlert size={15}/>{error}
      </p>}
      {lastRetry&&<p role="status" style={{fontSize:13}}>
        Retry completed: {lastRetry.synced} synced, {lastRetry.failed} failed,
        {lastRetry.processing} already processing.
      </p>}
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <button className="btn secondary btn-sm" onClick={()=>void load()} disabled={loading}>
          <RefreshCw size={14}/>{loading?"Checking…":"Refresh delivery status"}
        </button>
        {status?.deliveryEnabled &&
          <button className="btn secondary btn-sm" onClick={()=>void retry()} disabled={retrying}>
            <ShieldCheck size={14}/>{retrying?"Retrying…":"Retry queued evaluations"}
          </button>}
      </div>
    </section>
  );
}
