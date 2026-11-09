import { NextResponse } from "next/server";
import { appPool, AppAccessError, errorResponse, object, s } from "../../../../lib/server/neonAppAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };
const VALID_TOKEN=/^[a-zA-Z0-9]{10,40}$/;
const FOUR=["accurate_delivery","competitive_price","timeliness","after_sales"];
const FIVE=[...FOUR,"compliance"];

async function linkToken(ctx: Context) {
  const {token}=await ctx.params;
  if (!VALID_TOKEN.test(token||"")) throw new AppAccessError("Invalid evaluation link.",400);
  return token;
}

export async function GET(_request: Request,ctx: Context) {
  try {
    const token=await linkToken(ctx);
    const db=appPool();
    const result=await db.query("SELECT payload FROM se_evaluation_links WHERE token=$1",[token]);
    const link=result.rows[0]?.payload;
    if (!link) throw new AppAccessError("Evaluation link is invalid or unavailable.",404);
    return NextResponse.json({ok:true,data:{...link,token}},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return errorResponse(error);}
}

function score(value: unknown):number {
  const n=Number(value);
  if (!Number.isInteger(n)||n<1||n>5) throw new AppAccessError("All ratings must be between 1 and 5.",400);
  return n;
}
function trim(value:unknown,max:number){
  return s(value).trim().slice(0,max);
}
function roleOf(value:unknown){
  return value==="purchaser"||value==="amd_personnel" ? value : "requisitioner";
}

export async function POST(request:Request,ctx:Context){
  try{
    const token=await linkToken(ctx);
    const raw=await request.text();
    if(raw.length>20000)throw new AppAccessError("Evaluation request too large.",413);
    const input=object(JSON.parse(raw));
    const scores=object(input.scores);
    const remarks=input.ratingRemarks===undefined?{}:object(input.ratingRemarks);
    const comments=trim(input.comments,4000);
    const db=appPool(), client=await db.connect();
    try{
      await client.query("BEGIN");
      // Lock link row first: concurrent submissions cannot both succeed.
      const found=await client.query(
        "SELECT link_status,payload FROM se_evaluation_links WHERE token=$1 FOR UPDATE",[token]);
      const stored=found.rows[0];
      if(!stored)throw new AppAccessError("Evaluation link not found.",404);
      if(stored.link_status!=="pending") throw new AppAccessError("This evaluation was already submitted.",409);
      const link=stored.payload as Record<string,unknown>;
      const po=object(link.po);
      const role=roleOf(link.evaluatorRole);
      const criteria=role==="purchaser"?FIVE:FOUR;
      const cleanScores:Record<string,number>={};
      for(const key of criteria){
        cleanScores[key]=score(scores[key]);
        if(cleanScores[key]<4&&!trim(remarks[key],800)){
          throw new AppAccessError("Please explain every rating below 4.",400);
        }
      }
      const overall=Math.round(criteria.reduce((sum,k)=>sum+cleanScores[k],0)/criteria.length*10)/10;
      let customerSatisfaction=null;
      if(role==="requisitioner"){
        const satisfaction=object(input.customerSatisfaction);
        customerSatisfaction={
          timeliness:score(satisfaction.timeliness),
          accuracy:score(satisfaction.accuracy),
          comments:trim(satisfaction.comments,2000),
          evaluatedBy:trim(link.evaluatorName,160)||trim(link.requisitionerName,160),
        };
      }
      const four=FOUR.map(k=>cleanScores[k]||null);
      const five=FIVE.map(k=>cleanScores[k]||null);
      const submittedAt=new Date().toISOString();
      const id="public-"+token;
      const rows=Array.isArray(po.items)?po.items:[];
      const itemsDelivered=rows.map(item=>{
        if(!item||typeof item!=="object")return "";
        const i=item as Record<string,unknown>;
        return [i.qty,i.unit,i.description].map(x=>s(x)||String(typeof x==="number"?x:"")).filter(Boolean).join(" ");
      }).filter(Boolean).join("; ").slice(0,12000);
      const deliveryLeadDays=(()=>{
        const from=s(po.orderDate),to=s(po.actualDeliveryDate);
        if(!from||!to)return null;
        const a=new Date(from).getTime(),b=new Date(to).getTime();
        return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,Math.round((b-a)/86400000)):null;
      })();
      const row={
        id,prfNo:s(po.prfNumber),poNumber:s(po.poNumber),itemsDelivered,
        evaluationDate:submittedAt.slice(0,10),supplier:s(po.vendorName),
        address:s(po.deliveryAddress),remarks:comments,
        purchasing:role==="purchaser"?five:[null,null,null,null,null],
        requisitioner:role==="requisitioner"?four:[null,null,null,null],
        amd:role==="amd_personnel"?four:[null,null,null,null],
        purchasingAvg:role==="purchaser"?overall:0,
        requisitionerAvg:role==="requisitioner"?overall:0,
        amdAvg:role==="amd_personnel"?overall:0,
        finalRating:overall,
        recommendation:overall>=4.5?"Strongly Recommended":overall>=4?"Recommended":overall>=3.5?"Acceptable":overall>=3?"Acceptable w/ some Reservation":"Not Recommended",
        createdAt:submittedAt,
        source:role==="purchaser"?"Purchasing web evaluation":role==="amd_personnel"?"AMD Personnel web evaluation":"Requisitioner web evaluation",
        publicToken:token,evaluatorRole:role,
        evaluatorName:s(link.evaluatorName)||s(link.requisitionerName),
        evaluatorEmail:s(link.evaluatorEmail),
        submittedAt,evaluationLinkId:token,
        scores:cleanScores,
        ratingRemarks:Object.fromEntries(criteria.map(k=>[k,trim(remarks[k],800)])),
        customerSatisfaction,
        orderDate:s(po.orderDate),expectedDeliveryDate:s(po.expectedDate),
        actualDeliveryDate:s(po.actualDeliveryDate),
        deliveryLeadTimeDays:po.deliveryLeadTimeDays??deliveryLeadDays,
      };
      const inserted=await client.query(
        "INSERT INTO se_evaluations (id,po_number,supplier_name,evaluator_role,evaluation_date,final_rating,payload)"+
        " VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",
        [id,row.poNumber,row.supplier,role,row.evaluationDate,overall,JSON.stringify(row)]);
      if(inserted.rowCount!==1)throw new AppAccessError("This evaluation has already been submitted.",409);
      const updatedLink={...link,token,status:"submitted",submittedAt,evaluationId:id};
      await client.query(
        "UPDATE se_evaluation_links SET link_status='submitted',payload=$2::jsonb,imported_at=now() WHERE token=$1",
        [token,JSON.stringify(updatedLink)]);
      await client.query("COMMIT");
      return NextResponse.json({ok:true,evaluationId:id,submittedAt},{headers:{"Cache-Control":"no-store"}});
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }finally{client.release();}
  }catch(error){
    if(error instanceof SyntaxError)return NextResponse.json({ok:false,message:"Invalid evaluation data."},{status:400});
    return errorResponse(error);
  }
}
