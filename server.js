const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config();
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, maxHttpBufferSize: 8 * 1024 * 1024 });
const PORT = process.env.PORT || 3000;
const DATA_DIR = __dirname;
const DB_FILE = path.join(__dirname, "data.json");
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/three", express.static(path.join(__dirname, "node_modules/three/build")));
app.get("/healthz", (req,res)=>res.status(200).json({ok:true,service:"k-cathedral"}));

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { users: {}, sessions: {}, candleCount: 0, prayerWall: [] }; }
}
const db = loadDB();
if (!Array.isArray(db.meetingRecordings)) db.meetingRecordings=[];
if (!Array.isArray(db.youthEvents)) db.youthEvents=[];
if (!Array.isArray(db.youthBookings)) db.youthBookings=[];
if (!Array.isArray(db.youthAnnouncements)) db.youthAnnouncements=[];
if (!Array.isArray(db.memberActivity)) db.memberActivity=[];
if (!Array.isArray(db.qrAttendance)) db.qrAttendance=[];
if (!Array.isArray(db.qrTokens)) db.qrTokens=[];
if (!Array.isArray(db.feePayments)) db.feePayments=[];
if (!Array.isArray(db.feeExpenses)) db.feeExpenses=[];
if (!Array.isArray(db.pushSubscriptions)) db.pushSubscriptions=[];
if (!Array.isArray(db.youthPolls)) db.youthPolls=[];
if (!Array.isArray(db.youthAlbum)) db.youthAlbum=[];
if (!Array.isArray(db.youthBoard)) db.youthBoard=[];
if (!Array.isArray(db.youthBirthdays)) db.youthBirthdays=[];
if (!Array.isArray(db.youthChatHistory)) db.youthChatHistory=[];
for (const u of Object.values(db.users)) { if (u.approved === undefined) u.approved = true; }
if (!db.sessions) db.sessions = {};
for (const u of Object.values(db.users)) {
  if (!Array.isArray(u.friends)) u.friends=[];
  if (!Array.isArray(u.friendRequests)) u.friendRequests=[];
}
if (!Array.isArray(db.messages)) db.messages=[];
if (Object.keys(db.users).length && !Object.values(db.users).some(u => u.role === "admin")) { const first = Object.values(db.users)[0]; first.role = "admin"; try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {} }
const sessions = new Map(Object.entries(db.sessions || {}));
const requestBuckets = new Map();
function rateLimit(key, limit=12, windowMs=60000) {
  const now=Date.now(); const item=requestBuckets.get(key);
  if(!item || now-item.start>windowMs){requestBuckets.set(key,{start:now,count:1});return true;}
  item.count++; return item.count<=limit;
}
app.use("/api", (req,res,next)=>{
  const key=(req.ip||req.socket.remoteAddress||"unknown")+":"+req.path;
  if(!rateLimit(key, req.path==="/login"||req.path==="/register"?8:60)) return res.status(429).json({error:"요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."});
  next();
});
const players = new Map();
let massMode = false;
const massPhases = [
  {id:"entrance",title:"입당 예식",detail:"모두 자리에서 경건하게 미사를 시작합니다."},
  {id:"word",title:"말씀 전례",detail:"성경 말씀을 함께 읽고 묵상합니다."},
  {id:"homily",title:"강론",detail:"말씀의 의미를 되새기는 시간입니다."},
  {id:"prayers",title:"보편 지향 기도",detail:"공동체와 세상을 위해 함께 기도합니다."},
  {id:"closing",title:"마침 예식",detail:"평화로운 마음으로 일상에 돌아갑니다."}
];
let massPhaseIndex = 0;

function saveDB() {
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}
function cleanName(value) {
  const name = String(value || "순례자").replace(/[<>]/g, "").trim().slice(0, 14);
  return name || "순례자";
}
function cleanEmail(value) { return String(value || "").trim().toLowerCase().slice(0, 120); }
function validPassword(p) { return typeof p === "string" && p.length >= 8 && p.length <= 72; }
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function authUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const email = sessions.get(token);
  return email && db.users[email]?.approved !== false ? db.users[email] : null;
}
function publicProfile(user) {
  return { email: user.email, name: user.name, color: user.color, outfit: user.outfit || "casual", role: user.role || "member", createdAt: user.createdAt, bio:user.bio||"",avatar:user.avatar||"" };
}
function authAdmin(req) { const user = authUser(req); return user && user.role === "admin" ? user : null; }
app.post("/api/register", (req, res) => {
  const email = cleanEmail(req.body.email), password = req.body.password;
  const name = cleanName(req.body.name);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "올바른 이메일 주소를 입력해 주세요." });
  if (!validPassword(password)) return res.status(400).json({ error: "비밀번호는 8~72자로 입력해 주세요." });
  if (db.users[email]) return res.status(409).json({ error: "이미 가입된 이메일입니다." });
  const secret = hashPassword(password);
  const user = { email, name, color: /^#[0-9a-fA-F]{6}$/.test(req.body.color) ? req.body.color : "#b9c9e8", outfit: "casual",
    role: Object.keys(db.users).length === 0 ? "admin" : "member",
    approved: Object.keys(db.users).length === 0,
    salt: secret.salt, passwordHash: secret.hash, createdAt: new Date().toISOString(), prayers: 0 };
  db.users[email] = user; saveDB();
  const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, email); db.sessions[token]=email; saveDB();
  res.json({ token, profile: publicProfile(user) });
});
app.post("/api/login", (req, res) => {
  const email = cleanEmail(req.body.email), user = db.users[email];
  if (!user || typeof req.body.password !== "string") return res.status(401).json({ error: "이메일 또는 비밀번호를 확인해 주세요." });
  const hash = crypto.scryptSync(req.body.password, user.salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex"), b = Buffer.from(user.passwordHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "이메일 또는 비밀번호를 확인해 주세요." });
  if (user.approved === false) return res.status(403).json({ error: "관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다." });
  const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, email); db.sessions[token]=email; saveDB();
  res.json({ token, profile: publicProfile(user) });
});
const RECORDING_DIR=path.join(DATA_DIR,"recordings");
fs.mkdirSync(RECORDING_DIR,{recursive:true});
let s3Client=null, s3Commands=null;
function cloudRecordingEnabled(){return !!(process.env.S3_BUCKET&&process.env.S3_REGION&&process.env.S3_ACCESS_KEY_ID&&process.env.S3_SECRET_ACCESS_KEY);}
function getS3(){
  if(!cloudRecordingEnabled())return null;
  if(!s3Client){
    const {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand}=require("@aws-sdk/client-s3");
    s3Client=new S3Client({region:process.env.S3_REGION,endpoint:process.env.S3_ENDPOINT||undefined,forcePathStyle:process.env.S3_FORCE_PATH_STYLE==="true",credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
    s3Commands={PutObjectCommand,GetObjectCommand,DeleteObjectCommand};
  }
  return s3Client;
}
function safeRecordingName(v){return String(v||"회의 녹화").replace(/[\\\\/:*?"<>|]/g,"_").slice(0,100)||"회의 녹화";}
function canViewRecording(user,record){return user&&(user.role==="admin"||record.ownerEmail===user.email||record.groupId&&record.groupMembers?.includes(user.email));}
let webPush=null;
function getWebPush(){if(!webPush)webPush=require("web-push");return webPush;}
function vapidConfigured(){return !!(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY);}
function pushNotify(payload){
  if(!vapidConfigured())return;
  try{
    const wp=getWebPush();wp.setVapidDetails(process.env.VAPID_SUBJECT||"mailto:admin@example.com",process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
    for(const item of db.pushSubscriptions)wp.sendNotification(item.subscription,JSON.stringify(payload)).catch(err=>{
      if(err.statusCode===404||err.statusCode===410){db.pushSubscriptions=db.pushSubscriptions.filter(x=>x.endpoint!==item.endpoint);saveDB();}
    });
  }catch(err){console.error("Push notification error:",err.message);}
}
app.get("/api/push/key",(req,res)=>res.json({publicKey:process.env.VAPID_PUBLIC_KEY||null}));
app.post("/api/push/subscribe",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const sub=req.body.subscription;if(!sub?.endpoint||!sub?.keys?.p256dh||!sub?.keys?.auth)return res.status(400).json({error:"유효하지 않은 푸시 구독입니다."});
  db.pushSubscriptions=db.pushSubscriptions.filter(x=>x.endpoint!==sub.endpoint);
  db.pushSubscriptions.push({email:user.email,endpoint:sub.endpoint,subscription:sub,createdAt:Date.now()});saveDB();res.json({ok:true,enabled:vapidConfigured()});
});
app.delete("/api/push/subscribe",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  db.pushSubscriptions=db.pushSubscriptions.filter(x=>x.email!==user.email);saveDB();res.json({ok:true});
});
app.post("/api/youth/checkin-token",async(req,res)=>{
  const user=authUser(req);if(!user||!["admin","priest"].includes(user.role))return res.status(403).json({error:"관리자 또는 사제 권한이 필요합니다."});
  const event=db.youthEvents.find(e=>e.id===req.body.eventId);if(!event)return res.status(404).json({error:"일정을 찾을 수 없습니다."});
  const token=crypto.randomBytes(24).toString("hex"),expiresAt=Math.min(event.endAt+86400000,Date.now()+86400000);
  db.qrTokens=db.qrTokens.filter(t=>t.expiresAt>Date.now());db.qrTokens.push({token,eventId:event.id,createdBy:user.email,expiresAt});saveDB();
  const url=`${req.protocol}://${req.get("host")}/?checkin=${token}`;
  const qrDataUrl=await require("qrcode").toDataURL(url,{width:320,margin:2});
  res.json({token,url,qrDataUrl,expiresAt});
});

app.post("/api/youth/checkin-quick-token",async(req,res)=>{
  const user=authUser(req);if(!user||!["admin","priest"].includes(user.role))return res.status(403).json({error:"관리자 또는 사제 권한이 필요합니다."});
  const title=String(req.body.title||"현장 출석").replace(/[<>]/g,"").trim().slice(0,100);
  if(title.length<2)return res.status(400).json({error:"출석 모임 이름을 2자 이상 입력해 주세요."});
  const now=Date.now();
  const event={id:crypto.randomUUID(),title,description:"관리자 QR 빠른 출석",place:"",startAt:now,endAt:now+86400000,createdBy:user.email,createdAt:now,quickCheckin:true};
  db.youthEvents.push(event);
  const token=crypto.randomBytes(24).toString("hex"),expiresAt=now+86400000;
  db.qrTokens=db.qrTokens.filter(t=>t.expiresAt>Date.now());
  db.qrTokens.push({token,eventId:event.id,createdBy:user.email,expiresAt});saveDB();
  const url=`${req.protocol}://${req.get("host")}/?checkin=${token}`;
  const qrDataUrl=await require("qrcode").toDataURL(url,{width:360,margin:2});
  res.json({token,url,qrDataUrl,expiresAt,event});
});

app.post("/api/youth/checkin",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const token=String(req.body.token||"");const qr=db.qrTokens.find(t=>t.token===token&&t.expiresAt>Date.now());
  if(!qr)return res.status(400).json({error:"QR 코드가 만료되었거나 올바르지 않습니다."});
  if(db.qrAttendance.some(a=>a.eventId===qr.eventId&&a.email===user.email))return res.status(409).json({error:"이미 출석 처리되었습니다."});
  const event=db.youthEvents.find(e=>e.id===qr.eventId);if(!event)return res.status(404).json({error:"모임 일정을 찾을 수 없습니다."});
  const record={id:crypto.randomUUID(),eventId:event.id,eventTitle:event.title,email:user.email,name:user.name,checkedAt:Date.now()};
  db.qrAttendance.push(record);logMemberActivity(user,"QR 출석",event.title);saveDB();res.json({ok:true,record});
});
app.get("/api/youth/checkins",(req,res)=>{
  const user=authUser(req);if(!user||user.role!=="admin")return res.status(403).json({error:"관리자 권한이 필요합니다."});
  res.json({checkins:db.qrAttendance.slice().sort((a,b)=>b.checkedAt-a.checkedAt)});
});
app.get("/api/youth/finance",(req,res)=>{
  const user=authUser(req);if(!user||user.role!=="admin")return res.status(403).json({error:"관리자 권한이 필요합니다."});
  const income=db.feePayments.reduce((n,p)=>n+(p.status==="paid"?p.amount:0),0),expenses=db.feeExpenses.reduce((n,e)=>n+e.amount,0);
  res.json({payments:db.feePayments.slice().sort((a,b)=>b.createdAt-a.createdAt),expenses:db.feeExpenses.slice().sort((a,b)=>b.createdAt-a.createdAt),income,expensesTotal:expenses,balance:income-expenses});
});
app.post("/api/youth/finance/payment",(req,res)=>{
  const user=authUser(req);if(!user||user.role!=="admin")return res.status(403).json({error:"관리자 권한이 필요합니다."});
  const email=cleanEmail(req.body.email),member=db.users[email],month=String(req.body.month||"").slice(0,7),amount=Number(req.body.amount);
  if(!member||!/^[0-9]{4}-[0-9]{2}$/.test(month)||!Number.isSafeInteger(amount)||amount<0||amount>100000000)return res.status(400).json({error:"회원, 납부월, 금액을 확인해 주세요."});
  const item={id:crypto.randomUUID(),email,name:member.name,month,amount,status:req.body.status==="unpaid"?"unpaid":"paid",createdAt:Date.now()};
  db.feePayments.push(item);logMemberActivity(user,"회비 기록",`${member.name} ${month} ${amount}원`);saveDB();res.json({payment:item});
});
app.post("/api/youth/finance/expense",(req,res)=>{
  const user=authUser(req);if(!user||user.role!=="admin")return res.status(403).json({error:"관리자 권한이 필요합니다."});
  const title=String(req.body.title||"").trim().slice(0,100),amount=Number(req.body.amount);
  if(title.length<2||!Number.isSafeInteger(amount)||amount<1||amount>100000000)return res.status(400).json({error:"지출 항목과 금액을 확인해 주세요."});
  const item={id:crypto.randomUUID(),title,amount,note:String(req.body.note||"").slice(0,200),createdAt:Date.now()};
  db.feeExpenses.push(item);logMemberActivity(user,"회비 지출",`${title} ${amount}원`);saveDB();res.json({expense:item});
});
app.delete("/api/youth/finance/:type/:id",(req,res)=>{
  const user=authUser(req);if(!user||user.role!=="admin")return res.status(403).json({error:"관리자 권한이 필요합니다."});
  const key=req.params.type==="payment"?"feePayments":req.params.type==="expense"?"feeExpenses":null;if(!key)return res.status(400).json({error:"잘못된 항목입니다."});
  const i=db[key].findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"항목을 찾을 수 없습니다."});
  db[key].splice(i,1);saveDB();res.json({ok:true});
});
app.get("/api/youth/admin-dashboard",(req,res)=>{
  const user=authUser(req);if(!user||user.role!=="admin")return res.status(403).json({error:"관리자 권한이 필요합니다."});
  const now=new Date(),months=Array.from({length:6},(_,i)=>{const d=new Date(now.getFullYear(),now.getMonth()-5+i,1);const key=d.toISOString().slice(0,7);return {month:key,checkins:db.qrAttendance.filter(a=>new Date(a.checkedAt).toISOString().slice(0,7)===key).length,events:db.youthEvents.filter(e=>new Date(e.startAt).toISOString().slice(0,7)===key).length};});
  const income=db.feePayments.filter(p=>p.status==="paid").reduce((n,p)=>n+p.amount,0),expenses=db.feeExpenses.reduce((n,e)=>n+e.amount,0);
  res.json({members:Object.keys(db.users).length,events:db.youthEvents.length,reservations:db.youthBookings.length,announcements:db.youthAnnouncements.length,checkins:db.qrAttendance.length,income,expenses,balance:income-expenses,months});
});
const AVATAR_DIR=path.join(DATA_DIR,"uploads","avatars");fs.mkdirSync(AVATAR_DIR,{recursive:true});
app.use("/uploads/avatars", express.static(AVATAR_DIR));
app.put("/api/profile/avatar",express.raw({type:["image/jpeg","image/png","image/webp"],limit:"3mb"}),(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:"이미지 파일을 선택해 주세요."});
  const ext=({"image/jpeg":"jpg","image/png":"png","image/webp":"webp"})[req.headers["content-type"]];
  if(!ext)return res.status(415).json({error:"JPG, PNG, WEBP 이미지만 업로드할 수 있습니다."});
  const signature=req.body.subarray(0,12);
  const valid=ext==="jpg"?signature[0]===0xff&&signature[1]===0xd8:ext==="png"?signature.toString("hex",0,8)==="89504e470d0a1a0a":signature.toString("ascii",0,4)==="RIFF"&&signature.toString("ascii",8,12)==="WEBP";
  if(!valid)return res.status(400).json({error:"이미지 파일 형식이 올바르지 않습니다."});
  const filename=crypto.createHash("sha256").update(user.email).digest("hex")+"-"+Date.now()+"."+ext;
  fs.writeFileSync(path.join(AVATAR_DIR,filename),req.body);user.avatar="/uploads/avatars/"+filename;saveDB();res.json({avatar:user.avatar,profile:publicProfile(user)});
});
app.get("/api/youth/polls",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  res.json({polls:db.youthPolls.slice().sort((a,b)=>b.createdAt-a.createdAt).map(p=>({...p,myVote:p.votes?.[user.email]??null,results:p.closed||p.showResults? p.options.map((o,i)=>({option:o,count:Object.values(p.votes||{}).filter(v=>v===i).length})):null}))});
});
app.post("/api/youth/polls",(req,res)=>{
  const user=authUser(req);if(!user||!["admin","priest"].includes(user.role))return res.status(403).json({error:"관리자 또는 사제 권한이 필요합니다."});
  const question=String(req.body.question||"").trim().slice(0,180),options=[...new Set((Array.isArray(req.body.options)?req.body.options:[]).map(x=>String(x).trim().slice(0,100)).filter(Boolean))];
  if(question.length<3||options.length<2||options.length>8)return res.status(400).json({error:"질문과 2~8개의 선택지를 입력해 주세요."});
  const poll={id:crypto.randomUUID(),question,options,createdBy:user.email,author:user.name,createdAt:Date.now(),closed:false,showResults:!!req.body.showResults,votes:{}};
  db.youthPolls.unshift(poll);db.youthPolls=db.youthPolls.slice(0,100);logMemberActivity(user,"투표 생성",question);saveDB();res.json({poll:{...poll,votes:undefined}});
});
app.post("/api/youth/polls/:id/vote",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const poll=db.youthPolls.find(p=>p.id===req.params.id);if(!poll)return res.status(404).json({error:"투표를 찾을 수 없습니다."});
  if(poll.closed)return res.status(400).json({error:"종료된 투표입니다."});
  const choice=Number(req.body.choice);if(!Number.isInteger(choice)||choice<0||choice>=poll.options.length)return res.status(400).json({error:"선택 항목이 올바르지 않습니다."});
  if(poll.votes[user.email]!==undefined)return res.status(409).json({error:"이미 투표했습니다."});
  poll.votes[user.email]=choice;logMemberActivity(user,"투표 참여",poll.question);saveDB();
  res.json({ok:true});
});
app.patch("/api/youth/polls/:id/close",(req,res)=>{
  const user=authUser(req);if(!user||!["admin","priest"].includes(user.role))return res.status(403).json({error:"관리자 또는 사제 권한이 필요합니다."});
  const poll=db.youthPolls.find(p=>p.id===req.params.id);if(!poll)return res.status(404).json({error:"투표를 찾을 수 없습니다."});
  poll.closed=true;saveDB();res.json({ok:true});
});
function logMemberActivity(user,type,detail=""){
  db.memberActivity.push({id:crypto.randomUUID(),email:user.email,name:user.name,type,detail:String(detail).slice(0,120),at:Date.now()});
  db.memberActivity=db.memberActivity.slice(-5000);
}
app.get("/api/youth/portal",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  res.json({events:db.youthEvents.slice().sort((a,b)=>a.startAt-b.startAt),announcements:db.youthAnnouncements.slice().sort((a,b)=>b.createdAt-a.createdAt),bookings:db.youthBookings.filter(b=>b.email===user.email||user.role==="admin").sort((a,b)=>a.startAt-b.startAt),isAdmin:user.role==="admin"});
});
app.post("/api/youth/events",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  if(user.role!=="admin"&&user.role!=="priest")return res.status(403).json({error:"일정 등록 권한이 없습니다."});
  const title=String(req.body.title||"").trim().slice(0,100),startAt=Date.parse(req.body.startAt),endAt=Date.parse(req.body.endAt),place=String(req.body.place||"").trim().slice(0,100);
  if(title.length<2||!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt<=startAt)return res.status(400).json({error:"일정 제목과 올바른 시작·종료 시간을 입력해 주세요."});
  const event={id:crypto.randomUUID(),title,description:String(req.body.description||"").slice(0,500),place,startAt,endAt,createdBy:user.email,createdAt:Date.now()};
  db.youthEvents.push(event);logMemberActivity(user,"일정 등록",title);saveDB();pushNotify({title:"청년회 새 일정",body:title,url:"/"});res.json({event});
});
app.delete("/api/youth/events/:id",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  if(user.role!=="admin"&&user.role!=="priest")return res.status(403).json({error:"삭제 권한이 없습니다."});
  const i=db.youthEvents.findIndex(e=>e.id===req.params.id);if(i<0)return res.status(404).json({error:"일정을 찾을 수 없습니다."});
  db.youthEvents.splice(i,1);saveDB();res.json({ok:true});
});
app.post("/api/youth/bookings",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const event=db.youthEvents.find(e=>e.id===req.body.eventId);if(!event)return res.status(404).json({error:"예약할 일정을 찾을 수 없습니다."});
  if(db.youthBookings.some(b=>b.eventId===event.id&&b.email===user.email))return res.status(409).json({error:"이미 예약한 일정입니다."});
  const booking={id:crypto.randomUUID(),eventId:event.id,email:user.email,name:user.name,startAt:event.startAt,createdAt:Date.now()};
  db.youthBookings.push(booking);logMemberActivity(user,"모임 예약",event.title);saveDB();res.json({booking});
});
app.delete("/api/youth/bookings/:id",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const i=db.youthBookings.findIndex(b=>b.id===req.params.id&&(b.email===user.email||user.role==="admin"));
  if(i<0)return res.status(404).json({error:"예약을 찾을 수 없습니다."});
  db.youthBookings.splice(i,1);saveDB();res.json({ok:true});
});
app.post("/api/youth/announcements",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  if(user.role!=="admin"&&user.role!=="priest")return res.status(403).json({error:"공지 작성 권한이 없습니다."});
  const title=String(req.body.title||"").trim().slice(0,100),body=String(req.body.body||"").trim().slice(0,2000);
  if(title.length<2||body.length<2)return res.status(400).json({error:"공지 제목과 내용을 입력해 주세요."});
  const item={id:crypto.randomUUID(),title,body,author:user.name,createdAt:Date.now(),pinned:!!req.body.pinned};
  db.youthAnnouncements.unshift(item);db.youthAnnouncements=db.youthAnnouncements.slice(0,100);logMemberActivity(user,"공지 등록",title);saveDB();pushNotify({title:"청년회 새 공지",body:title,url:"/"});res.json({announcement:item});
});
app.delete("/api/youth/announcements/:id",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  if(user.role!=="admin"&&user.role!=="priest")return res.status(403).json({error:"삭제 권한이 없습니다."});
  db.youthAnnouncements=db.youthAnnouncements.filter(a=>a.id!==req.params.id);saveDB();res.json({ok:true});
});
app.get("/api/youth/members/:email/activity",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const email=cleanEmail(req.params.email);if(user.role!=="admin"&&user.email!==email)return res.status(403).json({error:"본인 활동 또는 관리자만 조회할 수 있습니다."});
  const member=db.users[email];if(!member)return res.status(404).json({error:"회원을 찾을 수 없습니다."});
  const activity=(db.memberActivity||[]).filter(a=>a.email===email).sort((a,b)=>b.at-a.at).slice(0,100).map(({email,...a})=>a);
  res.json({member:{name:member.name,email:member.email,role:member.role||"member",createdAt:member.createdAt},activity});
});
app.get("/api/youth/members",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  if(user.role!=="admin")return res.status(403).json({error:"관리자 권한이 필요합니다."});
  res.json({members:Object.values(db.users).map(u=>({name:u.name,email:u.email,role:u.role||"member",createdAt:u.createdAt}))});
});
app.get("/api/youth/stats",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  if(user.role!=="admin")return res.status(403).json({error:"관리자 권한이 필요합니다."});
  const groups=["a","b","c"].map(id=>{
    const records=Object.values(db.youthGroupAttendance[id]||{});
    return {id,name:id.toUpperCase()+" 소그룹",members:records.length,visits:records.reduce((n,r)=>n+(r.visits||0),0),active:records.filter(r=>Date.now()-r.lastSeen<30*86400000).length};
  });
  res.json({groups,totalMembers:groups.reduce((n,g)=>n+g.members,0),totalVisits:groups.reduce((n,g)=>n+g.visits,0),recordings:(db.meetingRecordings||[]).length,storage:cloudRecordingEnabled()?"cloud":"local"});
});
app.get("/api/recordings", (req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const items=(db.meetingRecordings||[]).filter(r=>canViewRecording(user,r)).sort((a,b)=>b.createdAt-a.createdAt).map(({storageKey,ownerEmail,groupMembers,...r})=>r);
  res.json({recordings:items,storage:cloudRecordingEnabled()?"cloud":"local"});
});
app.post("/api/recordings", (req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const title=safeRecordingName(req.body?.title),groupId=["a","b","c"].includes(req.body?.groupId)?req.body.groupId:null;
  const id=crypto.randomUUID(),record={id,title,groupId,ownerEmail:user.email,groupMembers:groupId?Object.values(db.youthGroupAttendance[groupId]||{}).map(x=>x.email).filter(Boolean):[],createdAt:Date.now(),size:0,mime:"video/webm",storage:cloudRecordingEnabled()?"cloud":"local",status:"uploading"};
  db.meetingRecordings.unshift(record);saveDB();res.json({id,uploadUrl:"/api/recordings/"+id+"/file",storage:record.storage});
});
app.put("/api/recordings/:id/file", express.raw({type:["video/webm","application/octet-stream"],limit:"500mb"}), async(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const record=db.meetingRecordings.find(r=>r.id===req.params.id);if(!record||record.ownerEmail!==user.email)return res.status(404).json({error:"녹화 파일을 찾을 수 없습니다."});
  if(!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:"녹화 파일이 비어 있습니다."});
  try{
    const key="meeting-recordings/"+record.id+".webm";
    if(cloudRecordingEnabled()){
      const client=getS3();await client.send(new s3Commands.PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:req.body,ContentType:"video/webm",ServerSideEncryption:process.env.S3_SSE||undefined}));
      record.storage="cloud";record.storageKey=key;
    }else{
      const file=path.join(RECORDING_DIR,record.id+".webm");fs.writeFileSync(file,req.body);record.storage="local";record.storageKey=file;
    }
    record.size=req.body.length;record.status="ready";saveDB();res.json({ok:true,storage:record.storage,size:record.size});
  }catch(err){record.status="failed";saveDB();console.error("Recording upload failed:",err);res.status(500).json({error:"녹화 파일 보관에 실패했습니다. 저장소 설정을 확인해 주세요."});}
});
app.get("/api/recordings/:id/file",async(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const record=db.meetingRecordings.find(r=>r.id===req.params.id);if(!record||!canViewRecording(user,record)||record.status!=="ready")return res.status(404).json({error:"녹화 파일을 찾을 수 없습니다."});
  res.setHeader("Content-Type","video/webm");res.setHeader("Content-Disposition",`inline; filename="meeting-${record.id}.webm"`);
  try{
    if(record.storage==="cloud"&&cloudRecordingEnabled()){
      const result=await getS3().send(new s3Commands.GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:record.storageKey}));
      result.Body.pipe(res);
    }else{
      const file=record.storageKey||path.join(RECORDING_DIR,record.id+".webm");
      if(!fs.existsSync(file))return res.status(404).end();
      fs.createReadStream(file).pipe(res);
    }
  }catch(err){console.error("Recording read failed:",err);res.status(500).end("Recording unavailable");}
});
app.delete("/api/recordings/:id",async(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const i=db.meetingRecordings.findIndex(r=>r.id===req.params.id);if(i<0)return res.status(404).json({error:"녹화 파일을 찾을 수 없습니다."});
  const record=db.meetingRecordings[i];if(record.ownerEmail!==user.email&&user.role!=="admin")return res.status(403).json({error:"삭제 권한이 없습니다."});
  try{if(record.storage==="cloud"&&cloudRecordingEnabled()&&record.storageKey)await getS3().send(new s3Commands.DeleteObjectCommand({Bucket:process.env.S3_BUCKET,Key:record.storageKey}));else if(record.storageKey&&fs.existsSync(record.storageKey))fs.unlinkSync(record.storageKey);}catch(err){return res.status(500).json({error:"파일 삭제에 실패했습니다."});}
  db.meetingRecordings.splice(i,1);saveDB();res.json({ok:true});
});
app.get("/api/me", (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: "로그인이 필요합니다." });
  res.json({ profile: publicProfile(user), candleCount: db.candleCount, prayers: user.prayers });
});
app.patch("/api/profile", (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: "로그인이 필요합니다." });
  if (req.body.name) user.name = cleanName(req.body.name);
  if (/^#[0-9a-fA-F]{6}$/.test(req.body.color)) user.color = req.body.color;
  if (["casual","formal","choir","priest"].includes(req.body.outfit)) user.outfit = req.body.outfit;
  if(typeof req.body.bio==="string")user.bio=req.body.bio.replace(/[<>]/g,"").trim().slice(0,240);
  saveDB();
  for (const player of players.values()) {
    if (player.email === user.email) { player.name = user.name; player.color = user.color; player.outfit = user.outfit || "casual"; io.emit("player-profile-updated", player); }
  }
  res.json({ profile: publicProfile(user) });
});
app.post("/api/logout", (req, res) => {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  sessions.delete(token); delete db.sessions[token]; saveDB(); res.json({ ok: true });
});
app.get("/api/health", (_req, res) => res.json({ ok: true, app: "K-Cathedral Metaverse v5", players: players.size, registeredUsers: Object.keys(db.users).length }));
app.get("/api/admin/overview", (req, res) => {
  if (!authAdmin(req)) return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  const users = Object.values(db.users).map(u => ({ email:u.email, name:u.name, role:u.role||"member", prayers:u.prayers||0, createdAt:u.createdAt }));
  res.json({ users, online: players.size, candles: db.candleCount, prayerPosts: db.prayerWall.length, massMode, massPhase: massPhases[massPhaseIndex] });
});
app.patch("/api/admin/role", (req, res) => {
  if (!authAdmin(req)) return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  const target = db.users[cleanEmail(req.body.email)];
  if (!target) return res.status(404).json({ error: "회원을 찾을 수 없습니다." });
  if (target.email === authAdmin(req).email) return res.status(400).json({ error: "본인의 관리자 권한은 이 화면에서 변경할 수 없습니다." });
  target.role = ["admin","priest","member"].includes(req.body.role) ? req.body.role : "member"; logMemberActivity(target,"권한 변경",target.role); saveDB();
  res.json({ ok:true, role:target.role });
});
app.get("/api/community", (_req, res) => res.json({ candleCount: db.candleCount, prayerWall: db.prayerWall.slice(-20).reverse() }));
app.post("/api/prayer-intention", (req,res) => {
  const user=authUser(req);
  if(!user) return res.status(401).json({error:"로그인이 필요합니다."});
  const text=String(req.body.text||"").replace(/[<>]/g,"").replace(/[\\r\\n]+/g," ").trim().slice(0,120);
  if(text.length<2) return res.status(400).json({error:"기도 지향을 두 글자 이상 입력해 주세요."});
  const now=Date.now(); user.lastPrayerPost=user.lastPrayerPost||0;
  if(now-user.lastPrayerPost<30000) return res.status(429).json({error:"기도 지향은 30초에 한 번 등록할 수 있습니다."});
  user.lastPrayerPost=now;
  db.prayerWall.push({name:user.name,at:new Date().toISOString(),text});
  db.prayerWall=db.prayerWall.slice(-100); saveDB();
  io.emit("prayer-wall-updated",db.prayerWall.slice(-20).reverse());
  res.json({ok:true,prayerWall:db.prayerWall.slice(-20).reverse()});
});


function friendPublic(email){
  const u=db.users[email]; return u?{email:u.email,name:u.name,color:u.color,online:[...players.values()].some(p=>p.email===email)}:null;
}
app.get("/api/friends", (req,res)=>{
  const user=authUser(req); if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const friends=(user.friends||[]).map(friendPublic).filter(Boolean);
  const requests=(user.friendRequests||[]).map(friendPublic).filter(Boolean);
  res.json({friends,requests});
});
app.post("/api/friends/request",(req,res)=>{
  const user=authUser(req); if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const query=String(req.body.query||"").trim().toLowerCase();
  if(query.length<2)return res.status(400).json({error:"이메일 또는 닉네임을 두 글자 이상 입력해 주세요."});
  const target=Object.values(db.users).find(u=>u.email!==user.email && (u.email===query || u.name.toLowerCase()===query));
  if(!target)return res.status(404).json({error:"일치하는 회원을 찾지 못했습니다. 이메일 또는 정확한 닉네임을 확인해 주세요."});
  if((user.friends||[]).includes(target.email))return res.status(409).json({error:"이미 친구입니다."});
  if((target.friendRequests||[]).includes(user.email))return res.status(409).json({error:"이미 친구 요청을 보냈습니다."});
  if((user.friendRequests||[]).includes(target.email)){
    user.friendRequests=user.friendRequests.filter(x=>x!==target.email);
    target.friends.push(user.email); user.friends.push(target.email);
  } else target.friendRequests.push(user.email);
  saveDB(); res.json({ok:true,autoAccepted:(user.friends||[]).includes(target.email)});
});
app.post("/api/friends/respond",(req,res)=>{
  const user=authUser(req); if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const email=cleanEmail(req.body.email), accept=!!req.body.accept;
  if(!(user.friendRequests||[]).includes(email))return res.status(404).json({error:"친구 요청을 찾지 못했습니다."});
  user.friendRequests=user.friendRequests.filter(x=>x!==email);
  if(accept){user.friends.push(email);const other=db.users[email];if(other&&!other.friends.includes(user.email))other.friends.push(user.email);}
  saveDB();res.json({ok:true});
});
app.get("/api/messages/:email",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const other=cleanEmail(req.params.email);if(!(user.friends||[]).includes(other))return res.status(403).json({error:"친구에게만 메시지를 조회할 수 있습니다."});
  const messages=db.messages.filter(m=>(m.from===user.email&&m.to===other)||(m.from===other&&m.to===user.email)).slice(-200);
  res.json({messages:messages.map(m=>({...m,fromName:db.users[m.from]?.name||"회원"}))});
});
app.post("/api/messages",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const to=cleanEmail(req.body.to), message=String(req.body.message||"").replace(/[<>]/g,"").trim().slice(0,500);
  if(!(user.friends||[]).includes(to))return res.status(403).json({error:"친구에게만 메시지를 보낼 수 있습니다."});
  if(message.length<1)return res.status(400).json({error:"메시지를 입력해 주세요."});
  const item={id:crypto.randomUUID(),from:user.email,to,message,at:new Date().toISOString()};
  db.messages.push(item);db.messages=db.messages.slice(-5000);saveDB();
  const payload={id:item.id,from: user.email,fromName:user.name,to,message,at:item.at};
  const targetSocket=[...players.entries()].find(([,p])=>p.email===to);
  if(targetSocket)io.to(targetSocket[0]).emit("private-message",payload);
  res.json({message:payload});
});
let streamState={active:false,url:"",title:"온라인 미사 영상"};
let youthAgenda=[];
let karaokeQueue=[];
let movieState={url:"",title:"",host:""};
let smallGroups=[{id:"a",name:"A 소모임",members:[]},{id:"b",name:"B 소모임",members:[]},{id:"c",name:"C 소모임",members:[]}];
let groupMessages={a:[],b:[],c:[]};
let groupLeaders={a:null,b:null,c:null};
let groupPresentations={a:null,b:null,c:null};
let groupAttendance={a:new Map(),b:new Map(),c:new Map()};
if(!db.youthGroupAttendance||typeof db.youthGroupAttendance!=="object")db.youthGroupAttendance={a:{},b:{},c:{}};
for(const gid of ["a","b","c"])if(!db.youthGroupAttendance[gid])db.youthGroupAttendance[gid]={};
let groupRaisedHands={a:new Set(),b:new Set(),c:new Set()};
let youthTtt={board:Array(9).fill(""),turn:"X",players:{X:null,O:null},status:"대기 중"};
const youthRpsChoices=new Map();
function isInYouthRoom(player){
  return !!player && player.x>=13 && player.x<=27 && player.z>=-7 && player.z<=7;
}
function rpsWinner(a,b){
  if(a===b)return "draw";
  return ((a==="rock"&&b==="scissors")||(a==="scissors"&&b==="paper")||(a==="paper"&&b==="rock"))?"win":"lose";
}
function safeEmbedUrl(value){
  try{
    const u=new URL(String(value||""));
    if(u.hostname==="youtu.be"){const id=u.pathname.slice(1).split("/")[0];return /^[\w-]{11}$/.test(id)?`https://www.youtube-nocookie.com/embed/${id}`:null;}
    if(["youtube.com","www.youtube.com","m.youtube.com"].includes(u.hostname)){
      const id=u.searchParams.get("v") || (u.pathname.match(/\/(?:live|embed)\/([\w-]{11})/)||[])[1];
      return id&&/^[\w-]{11}$/.test(id)?`https://www.youtube-nocookie.com/embed/${id}`:null;
    }
  }catch{}
  return null;
}
app.get("/api/stream",(_req,res)=>res.json(streamState));
app.post("/api/stream",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  if(!["admin","priest"].includes(user.role))return res.status(403).json({error:"영상 송출 설정은 관리자 또는 사제만 할 수 있습니다."});
  const active=!!req.body.active;
  if(!active){streamState={active:false,url:"",title:"온라인 미사 영상"};io.emit("stream-state",streamState);return res.json(streamState);}
  const url=safeEmbedUrl(req.body.url);
  if(!url)return res.status(400).json({error:"유효한 YouTube 영상 또는 라이브 주소를 입력해 주세요."});
  streamState={active:true,url,title:String(req.body.title||"온라인 미사 영상").replace(/[<>]/g,"").slice(0,60)};
  io.emit("stream-state",streamState);res.json(streamState);
});


// v9.4.0: 청년회 커뮤니티(앨범, 게시판, 생일, 가입 승인)
const YOUTH_UPLOAD_DIR=path.join(__dirname,"public","uploads","youth-album");
fs.mkdirSync(YOUTH_UPLOAD_DIR,{recursive:true});
app.get("/api/youth/community",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const members=Object.values(db.users).filter(u=>u.approved!==false);
  res.json({
    album:db.youthAlbum.slice().sort((a,b)=>b.createdAt-a.createdAt).slice(0,100),
    board:db.youthBoard.slice().sort((a,b)=>b.createdAt-a.createdAt).slice(0,100),
    birthdays:members.filter(u=>u.birthday).map(u=>({name:u.name,birthday:u.birthday})).sort((a,b)=>a.birthday.slice(5).localeCompare(b.birthday.slice(5))),
    pending:user.role==="admin"||user.role==="priest" ? Object.values(db.users).filter(u=>u.approved===false).map(u=>({email:u.email,name:u.name,createdAt:u.createdAt})) : []
  });
});
app.patch("/api/profile/birthday",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const birthday=String(req.body.birthday||"");
  if(birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday))return res.status(400).json({error:"생년월일 형식이 올바르지 않습니다."});
  user.birthday=birthday;saveDB();res.json({ok:true});
});
app.post("/api/youth/album",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const title=String(req.body.title||"").replace(/[<>]/g,"").trim().slice(0,80);
  const data=String(req.body.image||"");
  const m=data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if(!m)return res.status(400).json({error:"JPG, PNG, WEBP 사진을 선택해 주세요."});
  const buf=Buffer.from(m[2],"base64");if(buf.length>3*1024*1024)return res.status(413).json({error:"사진은 3MB 이하로 올려 주세요."});
  const sig=buf.subarray(0,12);const valid=(m[1]==="jpeg"&&sig[0]===0xff&&sig[1]===0xd8)||(m[1]==="png"&&sig.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(m[1]==="webp"&&sig.toString("ascii",0,4)==="RIFF"&&sig.toString("ascii",8,12)==="WEBP");
  if(!valid)return res.status(400).json({error:"이미지 파일 형식을 확인해 주세요."});
  const ext=m[1]==="jpeg"?"jpg":m[1],name=crypto.randomUUID()+"."+ext;
  fs.writeFileSync(path.join(YOUTH_UPLOAD_DIR,name),buf);
  const item={id:crypto.randomUUID(),title,author:user.name,email:user.email,image:"/uploads/youth-album/"+name,comments:[],createdAt:Date.now()};
  db.youthAlbum.unshift(item);db.youthAlbum=db.youthAlbum.slice(0,100);saveDB();res.json({item});
});
app.post("/api/youth/album/:id/comments",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const item=db.youthAlbum.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:"사진을 찾을 수 없습니다."});
  const body=String(req.body.body||"").replace(/[<>]/g,"").trim().slice(0,300);if(!body)return res.status(400).json({error:"댓글 내용을 입력해 주세요."});
  item.comments.push({id:crypto.randomUUID(),author:user.name,email:user.email,body,createdAt:Date.now()});item.comments=item.comments.slice(-100);saveDB();res.json({ok:true});
});
app.post("/api/youth/board",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const title=String(req.body.title||"").replace(/[<>]/g,"").trim().slice(0,100),body=String(req.body.body||"").replace(/[<>]/g,"").trim().slice(0,3000);
  if(title.length<2||body.length<2)return res.status(400).json({error:"제목과 내용을 입력해 주세요."});
  const item={id:crypto.randomUUID(),title,body,author:user.name,email:user.email,comments:[],createdAt:Date.now()};
  db.youthBoard.unshift(item);db.youthBoard=db.youthBoard.slice(0,200);saveDB();res.json({item});
});
app.post("/api/youth/board/:id/comments",(req,res)=>{
  const user=authUser(req);if(!user)return res.status(401).json({error:"로그인이 필요합니다."});
  const item=db.youthBoard.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:"게시글을 찾을 수 없습니다."});
  const body=String(req.body.body||"").replace(/[<>]/g,"").trim().slice(0,500);if(!body)return res.status(400).json({error:"댓글 내용을 입력해 주세요."});
  item.comments.push({id:crypto.randomUUID(),author:user.name,email:user.email,body,createdAt:Date.now()});item.comments=item.comments.slice(-100);saveDB();res.json({ok:true});
});
app.post("/api/admin/members/:email/approve",(req,res)=>{
  const admin=authUser(req);if(!admin||!["admin","priest"].includes(admin.role))return res.status(403).json({error:"관리자 권한이 필요합니다."});
  const member=db.users[cleanEmail(req.params.email)];if(!member)return res.status(404).json({error:"회원을 찾을 수 없습니다."});
  member.approved=true;saveDB();res.json({ok:true});
});
app.post("/api/admin/members/:email/reject",(req,res)=>{
  const admin=authUser(req);if(!admin||admin.role!=="admin")return res.status(403).json({error:"최고 관리자 권한이 필요합니다."});
  const email=cleanEmail(req.params.email),member=db.users[email];if(!member)return res.status(404).json({error:"회원을 찾을 수 없습니다."});
  if(member.role==="admin")return res.status(400).json({error:"관리자 계정은 거절할 수 없습니다."});
  delete db.users[email];saveDB();res.json({ok:true});
});

io.on("connection", (socket) => {
  socket.on("join-world", (payload = {}) => {
    const email = sessions.get(String(payload.token || ""));
    const user = email && db.users[email];
    if (!user || user.approved === false) { socket.emit("auth-error", "관리자 승인 후 입장할 수 있습니다."); return; }
    const player = { id: socket.id, email, name: user.name, color: user.color, outfit: user.outfit || "casual", x: 0, y: 0, z: 7, rot: 0, action: "idle" };
    players.set(socket.id, player);
    socket.emit("world-state", Array.from(players.values()).filter(p => p.id !== socket.id));
    socket.broadcast.emit("player-joined", player);
    socket.emit("welcome", { id: socket.id, candleCount: db.candleCount, massMode, massPhase: massPhases[massPhaseIndex] });
    socket.emit("candle-count", db.candleCount);
    socket.emit("youth-agenda-state",youthAgenda);
    socket.emit("youth-karaoke-state",karaokeQueue);
    socket.emit("youth-movie-state",movieState);
    socket.emit("youth-groups-state",smallGroups.map(g=>({...g,members:g.members.map(id=>players.get(id)?.name).filter(Boolean)})));
    socket.emit("youth-ttt-state",youthTtt);
    socket.emit("youth-room-count",Array.from(players.values()).filter(isInYouthRoom).length);
  });
  socket.on("player-move", (data = {}) => {
    const p = players.get(socket.id);
    if (!p || !data || ![data.x,data.y,data.z].every(Number.isFinite) || Math.abs(data.x)>80 || Math.abs(data.z)>80) return;
    p.x = Math.max(-28, Math.min(28, data.x)); p.y = 0; p.z = Math.max(-34, Math.min(48, data.z));
    p.rot = Number.isFinite(data.rot) ? data.rot : 0;
    p.action = ["idle","walk","run","pray","sit","wave","bow","kneel"].includes(data.action) ? data.action : "idle";
    socket.broadcast.emit("player-moved", p);
    io.emit("youth-room-count",Array.from(players.values()).filter(isInYouthRoom).length);
  });
  socket.on("youth-chat-history-request",()=>{const p=players.get(socket.id);if(!isInYouthRoom(p))return;socket.emit("youth-chat-history",db.youthChatHistory.slice(-100));});
   socket.on("youth-agenda-request",()=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    socket.emit("youth-agenda-state",youthAgenda);
  });
  socket.on("youth-room-chat",(raw)=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    const message=String(raw||"").replace(/[<>]/g,"").trim().slice(0,180);
    if(message){const item={name:p.name,email:p.email,message,time:Date.now()};db.youthChatHistory.push(item);db.youthChatHistory=db.youthChatHistory.slice(-300);saveDB();io.emit("youth-room-chat",item);}
  });
  socket.on("youth-agenda-add",(raw)=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    const text=String(raw||"").replace(/[<>]/g,"").trim().slice(0,100);if(!text)return;
    const item={id:crypto.randomUUID(),name:p.name,text,votes:0,voters:[]};
    youthAgenda.push(item);youthAgenda=youthAgenda.slice(-30);io.emit("youth-agenda-state",youthAgenda);
  });
  socket.on("youth-agenda-vote",(id)=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    const item=youthAgenda.find(x=>x.id===String(id));if(!item||item.voters.includes(p.email))return;
    item.voters.push(p.email);item.votes++;io.emit("youth-agenda-state",youthAgenda);
  });
  socket.on("youth-rps-play",(choice)=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    if(!["rock","paper","scissors"].includes(choice))return;
    youthRpsChoices.set(socket.id,{choice,name:p.name});
    const waiting=[...youthRpsChoices.entries()].filter(([id])=>players.has(id));
    if(waiting.length>=2){
      const [a,b]=waiting.slice(0,2);youthRpsChoices.delete(a[0]);youthRpsChoices.delete(b[0]);
      const resultA=rpsWinner(a[1].choice,b[1].choice),resultB=rpsWinner(b[1].choice,a[1].choice);
      io.to(a[0]).emit("youth-rps-result",{opponent:b[1].name,result:resultA,choice:a[1].choice,opponentChoice:b[1].choice});
      io.to(b[0]).emit("youth-rps-result",{opponent:a[1].name,result:resultB,choice:b[1].choice,opponentChoice:a[1].choice});
    }else socket.emit("youth-rps-waiting");
  });
  socket.on("youth-karaoke-add",(raw)=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    const title=String(raw?.title||"").replace(/[<>]/g,"").trim().slice(0,80);
    const url=String(raw?.url||"").trim().slice(0,500);
    if(!title)return;
    karaokeQueue.push({id:crypto.randomUUID(),title,url,name:p.name});
    karaokeQueue=karaokeQueue.slice(-25);io.emit("youth-karaoke-state",karaokeQueue);
  });
  socket.on("youth-karaoke-remove",(id)=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    karaokeQueue=karaokeQueue.filter(x=>x.id!==String(id));io.emit("youth-karaoke-state",karaokeQueue);
  });
  socket.on("youth-movie-set",(raw)=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    const title=String(raw?.title||"").replace(/[<>]/g,"").trim().slice(0,80);
    const url=String(raw?.url||"").trim().slice(0,500);
    const match=url.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    if(!title||!match)return;
    movieState={title,url:"https://www.youtube.com/embed/"+match[1],host:p.name};
    io.emit("youth-movie-state",movieState);
  });
  socket.on("youth-group-join",(id)=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    const group=smallGroups.find(g=>g.id===String(id));if(!group)return;
    const previous=smallGroups.find(g=>g.members.includes(socket.id));
    if(previous){
      socket.leave("youth-group-"+previous.id);
      socket.to("youth-group-"+previous.id).emit("youth-group-video-user-left",{id:socket.id});
      previous.members=previous.members.filter(x=>x!==socket.id);
      if(groupLeaders[previous.id]===socket.id){
        groupLeaders[previous.id]=previous.members[0]||null;
        io.to("youth-group-"+previous.id).emit("youth-group-leader-state",{leaderId:groupLeaders[previous.id],leaderName:players.get(groupLeaders[previous.id])?.name||""});
      }
      io.to("youth-group-"+previous.id).emit("youth-group-member-roster",previous.members.map(id=>({id,name:players.get(id)?.name||"참여자"})));
    }
    smallGroups.forEach(g=>g.members=g.members.filter(x=>x!==socket.id));
    group.members.push(socket.id);
    const joinedAt=Date.now();
    const memberKey=p.email||p.name;
    const oldAttendance=db.youthGroupAttendance[group.id][memberKey]||{};
    const attendance={id:socket.id,email:p.email||"",name:p.name,firstSeen:oldAttendance.firstSeen||joinedAt,lastSeen:joinedAt,visits:(oldAttendance.visits||0)+1,totalMinutes:oldAttendance.totalMinutes||0};
    db.youthGroupAttendance[group.id][memberKey]=attendance;
    const account=p.email&&db.users[p.email];if(account)logMemberActivity(account,"소그룹 참여",group.name||group.id.toUpperCase());
    groupAttendance[group.id].set(socket.id,attendance);
    try{saveDB();}catch(err){console.error("Attendance persistence failed:",err.message);}
    if(!groupLeaders[group.id])groupLeaders[group.id]=socket.id;
    socket.join("youth-group-"+group.id);
    socket.emit("youth-group-chat-history",groupMessages[group.id]||[]);
    socket.emit("youth-group-leader-state",{leaderId:groupLeaders[group.id],leaderName:players.get(groupLeaders[group.id])?.name||""});
    socket.emit("youth-group-presentation",groupPresentations[group.id]);
    socket.emit("youth-group-hands-state",[...groupRaisedHands[group.id]]);
    socket.emit("youth-group-attendance-state",Object.values(db.youthGroupAttendance[group.id]||{}).sort((a,b)=>b.lastSeen-a.lastSeen));
    socket.emit("youth-group-video-users",group.members.filter(id=>id!==socket.id));
    socket.to("youth-group-"+group.id).emit("youth-group-video-user-joined",{id:socket.id,name:p.name});
    io.to("youth-group-"+group.id).emit("youth-group-leader-state",{leaderId:groupLeaders[group.id],leaderName:players.get(groupLeaders[group.id])?.name||""});
    io.to("youth-group-"+group.id).emit("youth-group-member-roster",group.members.map(id=>({id,name:players.get(id)?.name||"참여자"})));
    io.to("youth-group-"+group.id).emit("youth-group-attendance-state",Object.values(db.youthGroupAttendance[group.id]||{}).sort((a,b)=>b.lastSeen-a.lastSeen));
    io.emit("youth-groups-state",smallGroups.map(g=>({...g,members:g.members.map(id=>players.get(id)?.name).filter(Boolean)})));
  });
  socket.on("youth-group-attendance-request",()=>{
    const group=smallGroups.find(g=>g.members.includes(socket.id));
    if(!group||groupLeaders[group.id]!==socket.id)return;
    const records=Object.values(db.youthGroupAttendance[group.id]||{}).sort((a,b)=>b.lastSeen-a.lastSeen);
    socket.emit("youth-group-attendance-state",records);
  });
  socket.on("youth-group-recording-state",(state)=>{
    const group=smallGroups.find(g=>g.members.includes(socket.id));if(!group)return;
    io.to("youth-group-"+group.id).emit("youth-group-recording-state",{active:!!state?.active,by:players.get(socket.id)?.name||"",at:Date.now()});
  });
  socket.on("youth-group-hand-raise",(raised)=>{
    const group=smallGroups.find(g=>g.members.includes(socket.id));if(!group)return;
    if(raised)groupRaisedHands[group.id].add(socket.id);else groupRaisedHands[group.id].delete(socket.id);
    io.to("youth-group-"+group.id).emit("youth-group-hands-state",[...groupRaisedHands[group.id]]);
  });
  socket.on("youth-group-pointer",(point={})=>{
    const group=smallGroups.find(g=>g.members.includes(socket.id));
    if(!group||groupLeaders[group.id]!==socket.id)return;
    const x=Math.max(0,Math.min(1,Number(point.x)||0));
    const y=Math.max(0,Math.min(1,Number(point.y)||0));
    io.to("youth-group-"+group.id).emit("youth-group-pointer",{x,y,visible:!!point.visible});
  });
  socket.on("youth-group-assign-leader",(targetId)=>{
    const group=smallGroups.find(g=>g.members.includes(socket.id));
    if(!group||groupLeaders[group.id]!==socket.id||!group.members.includes(String(targetId)))return;
    groupLeaders[group.id]=String(targetId);
    io.to("youth-group-"+group.id).emit("youth-group-leader-state",{leaderId:groupLeaders[group.id],leaderName:players.get(groupLeaders[group.id])?.name||""});
  });
  socket.on("youth-group-presentation-share",(payload={})=>{
    const group=smallGroups.find(g=>g.members.includes(socket.id));
    if(!group||groupLeaders[group.id]!==socket.id)return;
    const name=String(payload.name||"자료").replace(/[<>]/g,"").slice(0,100);
    const type=String(payload.type||"");
    const data=String(payload.data||"");
    if(!["application/pdf","image/png","image/jpeg","image/webp"].includes(type)||data.length>6_000_000||!data.startsWith("data:"+type+";base64,"))return;
    groupPresentations[group.id]={name,type,data,by:players.get(socket.id)?.name||"",at:Date.now()};
    io.to("youth-group-"+group.id).emit("youth-group-presentation",groupPresentations[group.id]);
  });
  socket.on("youth-group-presentation-clear",()=>{
    const group=smallGroups.find(g=>g.members.includes(socket.id));
    if(!group||groupLeaders[group.id]!==socket.id)return;
    groupPresentations[group.id]=null;io.to("youth-group-"+group.id).emit("youth-group-presentation",null);
  });
  socket.on("youth-group-chat",(raw)=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    const group=smallGroups.find(g=>g.members.includes(socket.id));if(!group)return;
    const message=String(raw||"").replace(/[<>]/g,"").trim().slice(0,300);if(!message)return;
    const item={name:p.name,message,time:Date.now()};groupMessages[group.id].push(item);groupMessages[group.id]=groupMessages[group.id].slice(-100);
    io.to("youth-group-"+group.id).emit("youth-group-chat",item);
  });
  socket.on("youth-group-video-roster",()=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    const group=smallGroups.find(g=>g.members.includes(socket.id));if(!group)return;
    socket.emit("youth-group-video-users",group.members.filter(id=>id!==socket.id));
  });
  socket.on("youth-group-video-stop",()=>{
    const group=smallGroups.find(g=>g.members.includes(socket.id));if(!group)return;
    socket.to("youth-group-"+group.id).emit("youth-group-video-user-left",{id:socket.id});
  });
  socket.on("youth-group-screen-stop",()=>{
    const group=smallGroups.find(g=>g.members.includes(socket.id));if(!group||groupLeaders[group.id]!==socket.id)return;
    socket.to("youth-group-"+group.id).emit("youth-group-screen-user-left",{id:socket.id});
  });
  socket.on("youth-group-video-signal",(payload={})=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p))return;
    const group=smallGroups.find(g=>g.members.includes(socket.id));
    const to=String(payload.to||"");if(!group||!group.members.includes(to)||!players.has(to))return;
    const type=["offer","answer","ice","screen-offer","screen-answer","screen-ice"].includes(payload.type)?payload.type:null;if(!type)return;
    if(type==="screen-offer"&&groupLeaders[group.id]!==socket.id)return;
    io.to(to).emit("youth-group-video-signal",{from:socket.id,type,data:payload.data});
  });
  socket.on("youth-group-leave",()=>{
    const currentGroup=smallGroups.find(g=>g.members.includes(socket.id));
    if(currentGroup){socket.leave("youth-group-"+currentGroup.id);socket.to("youth-group-"+currentGroup.id).emit("youth-group-video-user-left",{id:socket.id});}
    smallGroups.forEach(g=>{
      g.members=g.members.filter(x=>x!==socket.id);
      groupRaisedHands[g.id].delete(socket.id);io.to("youth-group-"+g.id).emit("youth-group-hands-state",[...groupRaisedHands[g.id]]);
      if(groupLeaders[g.id]===socket.id){groupLeaders[g.id]=g.members[0]||null;io.to("youth-group-"+g.id).emit("youth-group-leader-state",{leaderId:groupLeaders[g.id],leaderName:players.get(groupLeaders[g.id])?.name||""});}
    });
    if(currentGroup){
      const leaving=players.get(socket.id);const memberKey=leaving?.email||leaving?.name;
      const rec=memberKey&&db.youthGroupAttendance[currentGroup.id][memberKey];
      if(rec){rec.lastSeen=Date.now();try{saveDB();}catch(err){console.error("Attendance save failed:",err.message);}}
      io.to("youth-group-"+currentGroup.id).emit("youth-group-member-roster",currentGroup.members.map(id=>({id,name:players.get(id)?.name||"참여자"})));
    }
    io.emit("youth-groups-state",smallGroups.map(g=>({...g,members:g.members.map(id=>players.get(id)?.name).filter(Boolean)})));
  });
  socket.on("youth-ttt-move",(index)=>{
    const p=players.get(socket.id);if(!isInYouthRoom(p)||!Number.isInteger(index)||index<0||index>8||youthTtt.board[index])return;
    if(!youthTtt.players.X)youthTtt.players.X=socket.id;
    if(!youthTtt.players.O&&youthTtt.players.X!==socket.id)youthTtt.players.O=socket.id;
    const mark=Object.keys(youthTtt.players).find(k=>youthTtt.players[k]===socket.id);
    if(!mark||mark!==youthTtt.turn||!youthTtt.players.O)return;
    youthTtt.board[index]=mark;
    const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    const won=wins.some(line=>line.every(i=>youthTtt.board[i]===mark));
    youthTtt.status=won?`${mark} 승리`:youthTtt.board.every(Boolean)?"무승부":"진행 중";
    if(youthTtt.status==="진행 중")youthTtt.turn=mark==="X"?"O":"X";
    io.emit("youth-ttt-state",youthTtt);
  });
  socket.on("youth-ttt-reset",()=>{
    if(!isInYouthRoom(players.get(socket.id)))return;
    youthTtt={board:Array(9).fill(""),turn:"X",players:{X:null,O:null},status:"대기 중"};
    io.emit("youth-ttt-state",youthTtt);
  });
  socket.on("mass-mode", (enabled) => {
    const p = players.get(socket.id); if (!p || !db.users[p.email] || !["admin","priest"].includes(db.users[p.email].role)) { socket.emit("permission-error", "미사 진행은 관리자 또는 사제 권한이 필요합니다."); return; }
    massMode = !!enabled;
    if(massMode) massPhaseIndex=0;
    io.emit("mass-mode", { enabled: massMode, host: p.name, phase: massPhases[massPhaseIndex] });
  });
  socket.on("mass-phase", (index) => {
    const p=players.get(socket.id);
    if(!p || !db.users[p.email] || !["admin","priest"].includes(db.users[p.email].role)) { socket.emit("permission-error","미사 진행 권한이 없습니다."); return; }
    if(!massMode) { socket.emit("permission-error","먼저 미사를 시작해 주세요."); return; }
    if(!Number.isInteger(index) || index<0 || index>=massPhases.length) return;
    massPhaseIndex=index;
    io.emit("mass-phase", {phase:massPhases[index], index, host:p.name});
  });
  socket.on("light-candle", () => {
    const p = players.get(socket.id); if (!p) return;
    db.candleCount = Math.min(db.candleCount + 1, 100000000);
    const user = db.users[p.email]; if (user) user.prayers = (user.prayers || 0) + 1;
    db.prayerWall.push({ name: p.name, at: new Date().toISOString(), text: "평화와 사랑을 위한 기도" });
    db.prayerWall = db.prayerWall.slice(-100); saveDB();
    io.emit("candle-count", db.candleCount);
    io.emit("chat-message", { id: "system", name: "성당 안내", message: `${p.name}님이 기도 초를 봉헌했습니다.`, time: Date.now() });
  });
  socket.on("chat-message", (text) => {
    const p = players.get(socket.id); if (!p) return;
    const message = String(text || "").replace(/[<>]/g, "").trim().slice(0, 180);
    if (message) io.emit("chat-message", { id: socket.id, name: p.name, message, time: Date.now() });
  });
  socket.on("voice-offer", ({to,offer}={}) => { if(players.has(to)) io.to(to).emit("voice-offer",{from:socket.id,offer}); });
  socket.on("voice-answer", ({to,answer}={}) => { if(players.has(to)) io.to(to).emit("voice-answer",{from:socket.id,answer}); });
  socket.on("voice-ice", ({to,candidate}={}) => { if(players.has(to)) io.to(to).emit("voice-ice",{from:socket.id,candidate}); });
  socket.on("voice-leave", () => socket.broadcast.emit("voice-leave",{id:socket.id}));
  socket.on("disconnect", () => { const leavingPlayer=players.get(socket.id);youthRpsChoices.delete(socket.id);smallGroups.forEach(g=>{if(g.members.includes(socket.id)){const key=leavingPlayer?.email||leavingPlayer?.name;const rec=key&&db.youthGroupAttendance[g.id][key];if(rec){rec.lastSeen=Date.now();try{saveDB();}catch(err){console.error("Attendance save failed:",err.message);}}socket.to("youth-group-"+g.id).emit("youth-group-video-user-left",{id:socket.id});}g.members=g.members.filter(x=>x!==socket.id);groupRaisedHands[g.id].delete(socket.id);io.to("youth-group-"+g.id).emit("youth-group-hands-state",[...groupRaisedHands[g.id]]);if(groupLeaders[g.id]===socket.id){groupLeaders[g.id]=g.members[0]||null;io.to("youth-group-"+g.id).emit("youth-group-leader-state",{leaderId:groupLeaders[g.id],leaderName:players.get(groupLeaders[g.id])?.name||""});}io.to("youth-group-"+g.id).emit("youth-group-member-roster",g.members.map(id=>({id,name:players.get(id)?.name||"참여자"})));io.to("youth-group-"+g.id).emit("youth-group-attendance-state",Object.values(db.youthGroupAttendance[g.id]||{}).sort((a,b)=>b.lastSeen-a.lastSeen));});players.delete(socket.id);if(Object.values(youthTtt.players).includes(socket.id)){youthTtt={board:Array(9).fill(""),turn:"X",players:{X:null,O:null},status:"대기 중"};io.emit("youth-ttt-state",youthTtt);}io.emit("youth-groups-state",smallGroups.map(g=>({...g,members:g.members.map(id=>players.get(id)?.name).filter(Boolean)})));io.emit("youth-room-count",Array.from(players.values()).filter(isInYouthRoom).length); socket.broadcast.emit("player-left",socket.id); socket.broadcast.emit("voice-leave",{id:socket.id}); });
});
server.listen(PORT, "0.0.0.0", () => console.log(`K-Cathedral v8 running at http://localhost:${PORT}`));
