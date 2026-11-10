import { appPool, AppAccessError, errorResponse } from "../../../lib/server/neonAppAuth";
export const runtime = "nodejs";

// New sign-ins do not receive automatic access to school data. They enter a
// pending queue for an existing Purchasing administrator to approve.
export async function POST(request:Request) {
  try {
    const token=/^Bearer\s+([A-Za-z0-9._-]+)$/.exec(request.headers.get("authorization")||"")?.[1];
    if(!token||token.length<100||token.length>10000) throw new AppAccessError("Please sign in.",401);
    const apiKey=process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if(!apiKey) throw new AppAccessError("Google Authentication is unavailable.",503);
    const response=await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+encodeURIComponent(apiKey),
      {method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({idToken:token}),cache:"no-store",signal:AbortSignal.timeout(10000)},
    );
    if(!response.ok)throw new AppAccessError("Firebase login expired.",401);
    const data=await response.json() as {users?:Array<{
      localId?:string;email?:string;displayName?:string;disabled?:boolean;
    }>};
    const user=data.users?.[0];
    if(!user?.localId||!user.email||user.disabled)throw new AppAccessError("Invalid Firebase account.",403);
    const email=user.email.trim().toLowerCase();
    const profile={
      uid:user.localId,email,displayName:user.displayName||email.split("@")[0],
      role:"staff",permissions:[],department:"Purchasing Office",
      jobTitle:"Pending approval",phone:"",bio:"",photoURL:"",
      active:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    };
    await appPool().query(
      "INSERT INTO se_users(uid,email,display_name,role,active,permissions,payload) "+
      "VALUES($1,$2,$3,'staff',false,'[]'::jsonb,$4::jsonb) ON CONFLICT(uid) DO NOTHING",
      [profile.uid,email,profile.displayName,JSON.stringify(profile)],
    );
    return Response.json({ok:true,pending:true,message:"Your account is pending Purchasing administrator approval."},
      {headers:{"Cache-Control":"no-store"}});
  }catch(error){return errorResponse(error);}
}
