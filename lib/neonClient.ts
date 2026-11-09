import { auth } from "./firebase";

// The backend is selected only in the isolated Vercel upgrade Preview.
// Production intentionally remains on Firestore until the final cutover.
export const neonEnabled = () => process.env.NEXT_PUBLIC_DATA_BACKEND === "neon";

type ApiResult<T>={ok:true;data:T}|{ok:false;message?:string};
async function authHeaders():Promise<HeadersInit>{
  const user=auth?.currentUser;
  if(!user)throw new Error("Please sign in to your Purchasing account.");
  const token=await user.getIdToken();
  return {Authorization:"Bearer "+token};
}

async function parseResponse<T>(response:Response):Promise<T>{
  const body=await response.json() as ApiResult<T>;
  if(!response.ok||!body.ok){
    throw new Error(body.ok?"Database request failed.":body.message||"Database request failed.");
  }
  return body.data;
}

export async function neonRead<T>(op:string,query:Record<string,string>={}):Promise<T>{
  const params=new URLSearchParams({op,...query});
  const response=await fetch("/api/neon-data?"+params.toString(),{
    cache:"no-store",headers:await authHeaders(),
  });
  return parseResponse<T>(response);
}

export async function neonWrite<T=boolean>(action:string,fields:Record<string,unknown>={}):Promise<T>{
  const response=await fetch("/api/neon-data",{
    method:"POST",
    headers:{"Content-Type":"application/json",...await authHeaders()},
    body:JSON.stringify({action,...fields}),
    cache:"no-store",
  });
  const data=await parseResponse<T>(response);
  if(typeof window!=="undefined"){
    window.dispatchEvent(new Event("supplier-neon-changed"));
  }
  return data;
}

export function neonWatch<T>(collection:string,
  callback:(data:T[])=>void,onError?:(error:Error)=>void):()=>void{
  let stopped=false,requesting=false;
  const update=async()=>{
    if(stopped||requesting)return;
    requesting=true;
    try{
      const items=await neonRead<T[]>("list",{collection});
      if(!stopped)callback(items);
    }catch(error){
      if(!stopped)onError?.(error instanceof Error?error:new Error(String(error)));
    }finally{requesting=false;}
  };
  const onChanged=()=>{void update();};
  const onFocus=()=>{void update();};
  const onVisible=()=>{if(typeof document!=="undefined"&&document.visibilityState==="visible")void update();};
  void update();
  // Polling is a temporary compatibility bridge; secure SQL server is source of truth.
  const timer=typeof window!=="undefined"?window.setInterval(()=>void update(),30000):null;
  if(typeof window!=="undefined"){
    window.addEventListener("supplier-neon-changed",onChanged);
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisible);
  }
  return ()=>{
    stopped=true;
    if(timer!==null)window.clearInterval(timer);
    window.removeEventListener("supplier-neon-changed",onChanged);
    window.removeEventListener("focus",onFocus);
    document.removeEventListener("visibilitychange",onVisible);
  };
}

export async function neonPublicGet<T>(token:string):Promise<T>{
  const response=await fetch("/api/neon-public/"+encodeURIComponent(token),{cache:"no-store"});
  return parseResponse<T>(response);
}

export async function neonPublicSubmit(
  token:string,data:Record<string,unknown>,
):Promise<{ok:true;evaluationId:string;submittedAt:string}>{
  const response=await fetch("/api/neon-public/"+encodeURIComponent(token),{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data),cache:"no-store",
  });
  const result=await response.json() as {ok:boolean;message?:string;evaluationId?:string;submittedAt?:string};
  if(!response.ok||!result.ok)throw new Error(result.message||"Evaluation submission failed.");
  return {ok:true,evaluationId:result.evaluationId||"public-"+token,submittedAt:result.submittedAt||""};
}
