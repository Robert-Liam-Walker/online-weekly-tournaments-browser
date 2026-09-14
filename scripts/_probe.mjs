import { io } from "socket.io-client";
const API="http://localhost:3001";
const j=async(p,init={},t)=>{const r=await fetch(API+"/api"+p,{...init,headers:{...(init.json?{"Content-Type":"application/json"}:{}),...(t?{Authorization:"Bearer "+t}:{})},body:init.json?JSON.stringify(init.json):undefined});return r.json();};
const ev=(await j("/events/next")).event; console.log("event",ev.status,ev.id);
const bots=[];for(let i=0;i<3;i++){const u="probe"+Date.now().toString(36)+i;const r=await j("/auth/register",{method:"POST",json:{username:u,email:u+"@x.local",password:"probeprobe1"}});await j(`/events/${ev.id}/register`,{method:"POST"},r.token);bots.push({u,t:r.token});}
for(const b of bots){const s=io(API+"/room",{transports:["websocket"],auth:{token:b.t}});s.on("connect",()=>s.emit("room:join",{eventId:ev.id},(w)=>console.log(b.u,"join ack phase",w.phase,"roster",w.roster?.length)));s.on("room:assigned",(a)=>console.log(b.u,"assigned slot",a.slot,"roster",a.roster.length,a.roster.slice(0,2)));s.on("room:roster",(r)=>console.log(b.u,"roster event",r.length));s.on("room:phase",(p)=>{console.log(b.u,"phase",p.phase); if(p.phase==="live"||p.phase==="voided") setTimeout(()=>process.exit(0),500);});}
const a=await j("/auth/login",{method:"POST",json:{identifier:"admin",password:"adminadmin123"}});
console.log("start:",await j(`/events/${ev.id}/start`,{method:"POST"},a.token));
