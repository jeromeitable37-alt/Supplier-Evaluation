#!/usr/bin/env node
/**
 * Read-only security QA against the pinned Vercel Preview hostname.
 *
 * Normal mode: detects Vercel SSO and explicitly reports BLOCKED instead of
 * falsely counting app API failures.
 * Authenticated mode: node scripts/qa-preview-http.mjs --vercel-cli
 * uses the operator's Vercel CLI login to reach protected Preview; it DOES NOT
 * use a bypass token or modify deployment protection. Firebase ID tokens are
 * intentionally omitted to test anonymous application authorization.
 *
 * No school records, emails, or Google Sheets are modified.
 */
import { spawnSync } from "node:child_process";

const HOST="supplier-evaluation-git-upgrad-3d7613-jeromes-projects-ce3c618b.vercel.app";
const ROOT="https://"+HOST;
const checks=[
  {name:"Main website renders",method:"GET",path:"/",expected:200},
  {name:"QA pilot page renders",method:"GET",path:"/neon-pilot",expected:200},
  {name:"Admin audit rejects anonymous access",method:"GET",path:"/api/neon-pilot",expected:401},
  {name:"SQL evaluations reject anonymous access",method:"GET",path:"/api/neon-evaluations",expected:401},
  {name:"SQL POs reject anonymous access",method:"GET",path:"/api/neon-purchase-orders",expected:401},
  {name:"Link summary rejects anonymous access",method:"GET",path:"/api/neon-link-summary",expected:401},
  {name:"Neon records reject anonymous reads",method:"GET",path:"/api/neon-data?op=list&collection=evaluations",expected:401},
  {name:"Neon records reject anonymous writes",method:"POST",path:"/api/neon-data",expected:401,body:{action:"saveEvaluation",data:{id:"qa-no-auth"}}},
  {name:"Unapproved user enrollment is not anonymous",method:"POST",path:"/api/neon-enroll",expected:401},
  {name:"Unrecognized public token returns 404",method:"GET",path:"/api/neon-public/qaMissingToken202611090000000000",expected:404},
  {name:"Preview school email is disabled",method:"POST",path:"/api/send-evaluation",expected:503,body:{}},
  {name:"Preview official Google Sheet writes disabled",method:"POST",path:"/api/sync-evaluation",expected:503,body:{}},
  {name:"Preview reminder delivery disabled",method:"GET",path:"/api/cron/evaluation-reminders",expected:503},
];

const args=process.argv.slice(2);
if(args.some(x=>x!=="--vercel-cli")||new Set(args).size!==args.length){
  throw new Error("Only --vercel-cli is supported. The Preview target is fixed.");
}
const authenticated=args.includes("--vercel-cli");
const guardedLogin=()=>{
  console.log("BLOCKED BY VERCEL SSO | These are protection redirects, not Supplier Evaluation API failures.");
  console.log("Vercel Preview SSO must remain enabled. To authenticate the CLI:");
  console.log("  npm install -g vercel");
  console.log("  vercel login");
  console.log("  vercel whoami");
  console.log("Then run: node scripts/qa-preview-http.mjs --vercel-cli");
  process.exitCode=3;
};

async function rawRequest(check){
  const response=await fetch(ROOT+check.path,{
    method:check.method,
    headers:{...(check.body?{"Content-Type":"application/json"}:{})},
    body:check.body?JSON.stringify(check.body):undefined,
    cache:"no-store",
    signal:AbortSignal.timeout(15000),
    redirect:"manual",
  });
  return {status:response.status,location:response.headers.get("location")};
}

function vercelCliRequest(check) {
  // --deployment is a Vercel option. Everything after -- belongs to system curl.
  // Explicit project/team selection avoids relying on a Cloud Shell local link.
  const argv=[
    "curl",check.path,"--deployment",ROOT,
    "--","-sS","-o","/dev/null","-w","%{http_code}",
    "-X",check.method,
  ];
  if(check.body){
    argv.push("-H","Content-Type: application/json","-d",JSON.stringify(check.body));
  }
  const run=spawnSync("vercel",argv,{
    encoding:"utf8",timeout:25000,maxBuffer:1024*512,windowsHide:true,
    env:{
      ...process.env,
      VERCEL_PROJECT_ID:"prj_gWCHxdOZQU2wCDWYNGAaaYafi3wx",
      VERCEL_ORG_ID:"team_504W4s49QzNJAj6GFkoBsrtJ",
    },
  });
  if(run.error) {
    if(run.error.code==="ENOENT")throw new Error("Vercel CLI is not installed. Run npm install -g vercel.");
    throw new Error("Vercel CLI request unavailable: "+run.error.message);
  }
  if(run.status!==0) {
    // Emit only safe, preselected error categories. Never print raw stderr:
    // Vercel may include request URLs, headers or confidential auth material.
    const stderr=String(run.stderr||"");
    const reason=/unknown option|unknown argument|unsupported option/i.test(stderr)
      ? "Unsupported Vercel CLI argument."
      : /not linked|link your project|could not find project/i.test(stderr)
        ? "Vercel could not resolve the project. Verify the active team and project."
        : /unauthorized|forbidden|permission|not authenticated|login/i.test(stderr)
          ? "Vercel account is missing Preview access or needs authentication."
          : /deployment not found|couldn't find.*deployment/i.test(stderr)
            ? "The pinned Preview deployment is unavailable."
            : "Vercel CLI invocation failed.";
    throw new Error(reason+" Confirm with: vercel curl /api/neon-pilot --deployment "+ROOT+" -- -sS -o /dev/null -w '%{http_code}'");
  }
  const statusText=String(run.stdout||"").trim().match(/\b[1-5][0-9]{2}\s*$/)?.[0]?.trim();
  const status=Number(statusText);
  if(!Number.isInteger(status)||status<100||status>599){
    throw new Error("Vercel CLI did not return a valid HTTP status.");
  }
  return {status,location:null};
}

async function main(){
  if(!authenticated){
    let probe;
    try{probe=await rawRequest(checks[0]);}
    catch(error){
      console.error("Unable to reach Preview:",error instanceof Error?error.name:"unknown");
      process.exitCode=1;return;
    }
    // Vercel Project Settings confirmed SSO on Preview URLs. Any redirect
    // at the homepage in this fixed target is a blocked HTTP smoke test;
    // do NOT follow the redirect and count application-level assertions.
    if(probe.status===301||probe.status===302||probe.status===303||probe.status===307||probe.status===308){
      guardedLogin();return;
    }
  }
  let passed=0,failed=0;
  for(const check of checks){
    try{
      const result=authenticated?vercelCliRequest(check):await rawRequest(check);
      const success=result.status===check.expected;
      console.log((success?"PASS":"FAIL")+" | "+check.name+
        " | HTTP "+result.status+" (expected "+check.expected+")");
      if(success)passed++;else failed++;
    }catch(error){
      console.log("FAIL | "+check.name+" | "+
        (error instanceof Error?error.message:"Request failed"));
      failed++;
    }
  }
  console.log("Preview HTTP QA summary:",passed,"PASS;",failed,"FAIL; total:",checks.length);
  console.log("No authorized record changes, school email deliveries, or Sheet writes were attempted.");
  if(failed)process.exitCode=1;
}
await main();
