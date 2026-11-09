#!/usr/bin/env node
/**
 * Non-destructive HTTP smoke test. No login, test user, database password,
 * write permissions, email or Google Sheet side effects are needed.
 *
 * Run: node scripts/qa-preview-http.mjs
 *
 * Public Vercel Preview ONLY. Refuses to run against Production or arbitrary
 * hosts. This tests access denial and fail-closed external service flags,
 * NOT full authenticated CRUD acceptance.
 */
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
if(args.length)throw new Error("This QA script only permits its pinned Preview hostname (no command-line URL).");

let passed=0,failed=0;
for(const check of checks){
  try{
    const response=await fetch(ROOT+check.path,{
      method:check.method,
      headers:{...(check.body?{"Content-Type":"application/json"}:{})},
      body:check.body?JSON.stringify(check.body):undefined,
      cache:"no-store",
      signal:AbortSignal.timeout(15000),
      redirect:"manual",
    });
    const success=response.status===check.expected;
    console.log((success?"PASS":"FAIL")+" | "+check.name+
      " | HTTP "+response.status+" (expected "+check.expected+")");
    if(success)passed++;else failed++;
  }catch(error){
    console.log("FAIL | "+check.name+" | Request unavailable: "+
      (error instanceof Error?error.name:"unknown"));
    failed++;
  }
}
console.log("Preview HTTP QA summary:",passed,"PASS;",failed,"FAIL; total:",checks.length);
console.log("This test performed no authorized record changes, emails, or Sheet writes.");
if(failed)process.exitCode=1;
