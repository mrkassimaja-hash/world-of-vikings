'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const ROOT=__dirname;
const DBFILE=process.env.DATABASE_PATH||path.join(ROOT,'data','butikk.sqlite');
const PORT=Number(process.env.PORT||3000);
const EMAIL_TO='mrkassimaja@gmail.com';
const POSTAGE=5000; // øre
const ADMIN_KEY=process.env.ADMIN_KEY||'';
if(!ADMIN_KEY||ADMIN_KEY.length<20){console.error('ADMIN_KEY må være satt og ha minst 20 tegn. Se OPPSETT.md');process.exit(1)}
fs.mkdirSync(path.dirname(DBFILE),{recursive:true});
const db=new DatabaseSync(DBFILE);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS products (sku TEXT PRIMARY KEY, name TEXT NOT NULL, price_ore INTEGER, stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), kind TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, customer_json TEXT NOT NULL, items_json TEXT NOT NULL, subtotal_ore INTEGER NOT NULL, shipping_ore INTEGER NOT NULL, total_ore INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ny', mail_status TEXT NOT NULL DEFAULT 'venter', mail_error TEXT);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE TABLE IF NOT EXISTS site_texts (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);`);
const DEFAULT_TERMS=`SALGSBETINGELSER – WORLD OF VIKINGS
Selger: Ståle Edstrøm, privatperson. Kontakt: mrkassimaja@gmail.com. Adresse: Østagrenda 187, 2484 Rendalen.
Prisene er oppgitt i norske kroner. Porto er fast 50 kr per bestilling, og totalbeløpet vises før du bestiller.
Når du bestiller, får du e-post med oversikt og ordrenummer. Selger sender et eget Vipps-krav til telefonnummeret du oppgir. Varen sendes etter mottatt betaling.
Kontakt selger ved spørsmål, feil, retur eller reklamasjon. Dersom salget omfattes av angrerettloven, gjelder normalt 14 dagers angrerett fra mottak, og du får informasjon og standard angrerettskjema. Lovbestemte rettigheter gjelder uansett hva som står her.
VIKTIG: Avklar om ditt løpende nettsalg regnes som næringsvirksomhet. Oppdater teksten etter gjeldende rett før publisering.`;
const DEFAULT_PRIVACY=`PERSONVERNERKLÆRING – WORLD OF VIKINGS
Ansvarlig for personopplysningene: Ståle Edstrøm, Østagrenda 187, 2484 Rendalen. Kontakt: mrkassimaja@gmail.com.
Vi bruker navn, e-post, telefon, leveringsadresse og bestillingsdetaljer for å registrere ordre, sende bekreftelse, avtale betaling og levere varene. Opplysningene lagres hos vår driftstjeneste og deles med nødvendige e-post- og leveringsleverandører. De brukes ikke til reklame uten eget grunnlag.
Opplysningene slettes når de ikke lenger er nødvendige, med unntak av data som må oppbevares etter loven. Du kan kontakte oss for innsyn, retting eller sletting, og klage til Datatilsynet.
Vi bruker nødvendig lagring i nettleseren til handlekurven. [Fyll inn driftstjeneste og konkret sletterutine før publisering.]`;
const getText=db.prepare('SELECT value FROM site_texts WHERE key=?');
const putText=db.prepare('INSERT INTO site_texts(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at');
for(const [k,v] of [['terms',DEFAULT_TERMS],['privacy',DEFAULT_PRIVACY]])if(!getText.get(k))putText.run(k,v,new Date().toISOString());
const texts=()=>({terms:getText.get('terms').value,privacy:getText.get('privacy').value});
const names=JSON.parse(fs.readFileSync(path.join(ROOT,'kortnavn.json'),'utf8'));
const insert=db.prepare('INSERT OR IGNORE INTO products (sku,name,price_ore,stock,kind) VALUES (?,?,?,?,?)');
insert.run('album','World of Vikings album',null,0,'product');
insert.run('pakke','Klistremerkepakke',null,0,'product');
for(const c of names) insert.run('card:'+c.number,c.name,1000,0,'card');
const selectAll=db.prepare("SELECT sku,name,price_ore AS priceOre,stock,kind FROM products ORDER BY CASE WHEN kind='product' THEN 0 ELSE 1 END,sku");
const bySku=db.prepare('SELECT sku,name,price_ore AS priceOre,stock,kind FROM products WHERE sku=?');
const updateStock=db.prepare('UPDATE products SET stock=stock-? WHERE sku=? AND stock>=?');
const saveOrder=db.prepare('INSERT INTO orders(id,created_at,customer_json,items_json,subtotal_ore,shipping_ore,total_ore) VALUES(?,?,?,?,?,?,?)');
const audit=db.prepare('INSERT INTO events(order_id,event,created_at) VALUES(?,?,?)');
const statusUpdate=db.prepare('UPDATE orders SET status=? WHERE id=?');
const mailUpdate=db.prepare('UPDATE orders SET mail_status=?,mail_error=? WHERE id=?');
for(const [name,type] of [['customer_mail_status',"TEXT NOT NULL DEFAULT 'venter'"],['customer_mail_error','TEXT']]){if(!db.prepare('PRAGMA table_info(orders)').all().some(c=>c.name===name))db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}`)}
const customerMailUpdate=db.prepare('UPDATE orders SET customer_mail_status=?,customer_mail_error=? WHERE id=?');
const listOrders=db.prepare('SELECT id,created_at,customer_json,items_json,subtotal_ore,shipping_ore,total_ore,status,mail_status,mail_error,customer_mail_status,customer_mail_error FROM orders ORDER BY created_at DESC LIMIT 500');
const getOrder=db.prepare('SELECT * FROM orders WHERE id=?');
const rate=new Map();
function reply(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
function auth(req){if(!ADMIN_KEY)return false;const a=Buffer.from(req.headers['x-admin-key']||'');const b=Buffer.from(ADMIN_KEY);return a.length===b.length&&crypto.timingSafeEqual(a,b)}
function validStr(s,min,max){return typeof s==='string'&&s.trim().length>=min&&s.trim().length<=max}
async function body(req){let data='';for await (const part of req){data+=part;if(data.length>25000)throw Error('For stor forespørsel')}try{return JSON.parse(data)}catch{throw Error('Ugyldig JSON')}}
function format(n){return (n/100).toFixed(2)+' kr'}
function displayOrder(row){return {...row,customer:JSON.parse(row.customer_json),items:JSON.parse(row.items_json),customer_json:undefined,items_json:undefined}}
function orderMail(row){const o=displayOrder(row);return `NY BESTILLING – WORLD OF VIKINGS\nOrdrenummer: ${o.id}\nDato: ${o.created_at}\n\nKUNDE\nNavn: ${o.customer.name}\nE-post: ${o.customer.email}\nTelefon/Vipps: ${o.customer.phone}\nAdresse: ${o.customer.address}\n${o.customer.postal} ${o.customer.city}\nKommentar: ${o.customer.note||'Ingen'}\n\nVARER\n${o.items.map(i=>`${i.sku} – ${i.name} | ${i.quantity} stk | ${format(i.priceOre*i.quantity)}`).join('\n')}\n\nVarer: ${format(o.subtotal_ore)}\nPorto: ${format(o.shipping_ore)}\nÅ KREVE INN VIA VIPPS: ${format(o.total_ore)}\n\nOrdrestatus: ${o.status}\n`}
function customerMail(row){const o=displayOrder(row);return `TAKK FOR BESTILLINGEN – WORLD OF VIKINGS
Ordrenummer: ${o.id}
Dato: ${o.created_at}

Hei ${o.customer.name}!
Vi har registrert bestillingen din.

${o.items.map(i=>`${i.name} (${i.sku}) – ${i.quantity} stk × ${format(i.priceOre)} = ${format(i.priceOre*i.quantity)}`).join('\n')}

Varer: ${format(o.subtotal_ore)}
Porto: ${format(o.shipping_ore)}
TOTALT: ${format(o.total_ore)}

Du skal ikke betale på nettsiden. Selger sender et separat Vipps-krav til ${o.customer.phone}. Varene sendes etter mottatt betaling.
Leveringsadresse: ${o.customer.address}, ${o.customer.postal} ${o.customer.city}

SALGSBETINGELSER
${texts().terms}

PERSONVERN
${texts().privacy}

Med vennlig hilsen
Ståle Edstrøm
World of Vikings

Ta vare på denne e-posten og ordrenummeret.`}
let transport;
async function notify(id,recipient='both'){const row=getOrder.get(id);if(!row)return false;const host=process.env.SMTP_HOST,user=process.env.SMTP_USER,pass=process.env.SMTP_PASS,from=process.env.SMTP_FROM;
 if(!host||!user||!pass||!from){if(recipient!=='customer')mailUpdate.run('venter','SMTP er ikke konfigurert',id);if(recipient!=='seller')customerMailUpdate.run('venter','SMTP er ikke konfigurert',id);return false}
 try{if(!transport){const nodemailer=require('nodemailer');transport=nodemailer.createTransport({host,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',auth:{user,pass}})}}catch(e){console.error('SMTP-oppsett:',e);return false}
 let ok=true;
 const messages=[['seller',EMAIL_TO,`Ny World of Vikings-bestilling ${id}`,orderMail(row),mailUpdate],['customer',JSON.parse(row.customer_json).email,`Ordrebekreftelse World of Vikings ${id}`,customerMail(row),customerMailUpdate]];
 for(const [target,to,subject,msg,update] of messages){if(recipient!=='both'&&recipient!==target)continue;try{await transport.sendMail({from,to,subject,text:msg});update.run('sendt',null,id)}catch(e){ok=false;console.error('E-post feilet',target,id,String(e));update.run('feilet',String(e).slice(0,250),id)}}return ok}
function processOrder(input){const c=input.customer;if(!c||!validStr(c.name,2,100)||!validStr(c.email,5,150)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)||!validStr(c.phone,8,20)||!validStr(c.address,3,180)||!/^\d{4}$/.test(c.postal)||!validStr(c.city,2,100)||!validStr(c.note||'',0,600))throw Object.assign(new Error('Kontroller kundeopplysningene'),{status:400});
 if(!Array.isArray(input.items)||input.items.length<1||input.items.length>236)throw Object.assign(new Error('Ugyldig varelinjer'),{status:400});
 const normalized=[],seen=new Set();let subtotal=0;
 for(const item of input.items){if(!item||typeof item.sku!=='string'||seen.has(item.sku)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100)throw Object.assign(new Error('Ugyldig varelinje'),{status:400});seen.add(item.sku);const p=bySku.get(item.sku);if(!p||p.priceOre===null)throw Object.assign(new Error('Varen kan ikke bestilles'),{status:409});if(item.sku.startsWith('card:')&&item.quantity>1)throw Object.assign(new Error('Maks ett av hvert enkeltmerke'),{status:400});if(p.stock<item.quantity)throw Object.assign(new Error(`${p.name} har bare ${p.stock} på lager`),{status:409});subtotal+=p.priceOre*item.quantity;if(!Number.isSafeInteger(subtotal)||subtotal>100000000)throw Object.assign(new Error('For stor ordre'),{status:400});normalized.push({sku:p.sku,name:p.name,quantity:item.quantity,priceOre:p.priceOre})}
 const clean={name:c.name.trim(),email:c.email.trim(),phone:c.phone.trim(),address:c.address.trim(),postal:c.postal,city:c.city.trim(),note:(c.note||'').trim()};const id='WOV-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();const date=new Date().toISOString();
 db.exec('BEGIN IMMEDIATE');try{for(const i of normalized){if(updateStock.run(i.quantity,i.sku,i.quantity).changes!==1)throw Object.assign(new Error('Lageret ble endret under bestillingen; prøv igjen'),{status:409})}saveOrder.run(id,date,JSON.stringify(clean),JSON.stringify(normalized),subtotal,POSTAGE,subtotal+POSTAGE);audit.run(id,'opprettet',date);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return {id,totalOre:subtotal+POSTAGE,createdAt:date};}
function limit(req){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();const now=Date.now();let x=rate.get(ip);if(!x||now-x.s>600000)x={s:now,n:0};x.n++;rate.set(ip,x);if(rate.size>3000)for(const[k,v]of rate)if(now-v.s>600000)rate.delete(k);return x.n<=15}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webp':'image/webp','.css':'text/css; charset=utf-8','.ico':'image/x-icon'};
const publicFiles=new Set(['index.html','shop.js','kortnavn.js','butikkdata.js','bilder/albumforside.webp','bilder/klistremerkepakke.webp']);
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const route=url.pathname;
 if(req.method==='GET'&&route==='/api/legal')return reply(res,200,texts());
 if(req.method==='GET'&&route==='/api/products')return reply(res,200,{products:selectAll.all(),shippingOre:POSTAGE});
 if(req.method==='POST'&&route==='/api/orders'){if(!limit(req))return reply(res,429,{error:'For mange forsøk. Prøv igjen senere.'});const input=await body(req);const made=processOrder(input);reply(res,201,{ok:true,...made,notification:'Ordren er registrert. Selger sender Vipps-krav.'});notify(made.id).catch(console.error);return}
 if(route.startsWith('/api/admin/')){if(!auth(req))return reply(res,401,{error:'Feil administrasjonsnøkkel'});
 if(req.method==='GET'&&route==='/api/admin/legal')return reply(res,200,texts());
 if(req.method==='POST'&&route==='/api/admin/legal'){const x=await body(req);if(!x||!['terms','privacy'].includes(x.key)||!validStr(x.value,80,12000))return reply(res,400,{error:'Velg salgsbetingelser eller personvern, minimum 80 tegn og maks 12000 tegn'});putText.run(x.key,x.value.trim(),new Date().toISOString());return reply(res,200,{ok:true})}
 if(req.method==='GET'&&route==='/api/admin/orders')return reply(res,200,{orders:listOrders.all().map(displayOrder)});
 if(req.method==='GET'&&route==='/api/admin/products')return reply(res,200,{products:selectAll.all()});
 if(req.method==='POST'&&route==='/api/admin/products'){const x=await body(req);if(!x||typeof x.sku!=='string'||!bySku.get(x.sku)||!Number.isSafeInteger(x.stock)||x.stock<0||x.stock>100000||!(x.priceOre===null||(Number.isSafeInteger(x.priceOre)&&x.priceOre>=0&&x.priceOre<=10000000)))return reply(res,400,{error:'Ugyldig pris eller lagerantall'});db.prepare('UPDATE products SET price_ore=?,stock=? WHERE sku=?').run(x.priceOre,x.stock,x.sku);return reply(res,200,{ok:true})}
 if(req.method==='POST'&&route==='/api/admin/status'){const x=await body(req);if(!x||!getOrder.get(x.id)||!['ny','vipps_sendt','betalt','sendt','kansellert'].includes(x.status))return reply(res,400,{error:'Ugyldig status'});const old=getOrder.get(x.id);if(x.status==='kansellert'&&old.status!=='kansellert'){db.exec('BEGIN IMMEDIATE');try{for(const item of JSON.parse(old.items_json))db.prepare('UPDATE products SET stock=stock+? WHERE sku=?').run(item.quantity,item.sku);statusUpdate.run(x.status,x.id);audit.run(x.id,'kansellert og lager tilbakeført',new Date().toISOString());db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}else if(old.status!=='kansellert'){statusUpdate.run(x.status,x.id);audit.run(x.id,x.status,new Date().toISOString())}else return reply(res,409,{error:'Kansellert ordre kan ikke gjenåpnes'});return reply(res,200,{ok:true})}
 if(req.method==='POST'&&route==='/api/admin/resend'){const x=await body(req);if(!getOrder.get(x?.id))return reply(res,404,{error:'Ordren finnes ikke'});const sent=await notify(x.id,['both','seller','customer'].includes(x.recipient)?x.recipient:'both');return reply(res,200,{ok:true,sent})}
 return reply(res,404,{error:'Ikke funnet'});}
 if(req.method!=='GET')return reply(res,405,{error:'Ikke tillatt'});
 let file=route==='/'?'index.html':decodeURIComponent(route.slice(1));if(route==='/admin')file='admin.html';if(file==='admin.html'){} else if(!publicFiles.has(file))return reply(res,404,{error:'Ikke funnet'});
 const ext=path.extname(file),filePath=path.join(ROOT,file);if(!fs.existsSync(filePath))return reply(res,404,{error:'Ikke funnet'});res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':ext==='.html'?'no-store':'public, max-age=300','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY'});fs.createReadStream(filePath).pipe(res);
 }catch(e){console.error(e);reply(res,e.status||500,{error:e.status?e.message:'Serverfeil – prøv igjen'})}});
server.listen(PORT,()=>console.log(`World of Vikings kjører på http://localhost:${PORT}`));
module.exports={server,db};
