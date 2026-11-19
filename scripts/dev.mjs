// Local dev server: the repo root as static files plus a same-origin proxy
// for the NFT backend. The backend's CORS allowlist holds only the deployed
// origins, so a localhost page reaches it through /__nft/* here.
//   node scripts/dev.mjs [port]      (default 8099)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.argv[2] || 8099);
const BACKEND = "https://nft.iqlabs.dev";

// DEV-ONLY preview of the v6 stock-token UI. Live stock collections are gated
// off, so to see the chips/colours/filter locally, open the page with ?mock=1
// and this script (injected into index.html for that request only) fakes a few
// stock collections + one mint/listing by wrapping fetch. Never shipped: the
// production site is served by Cloudflare as static files, not this dev server.
const MOCK = `<script>(function(){
  var _f=window.fetch.bind(window);
  var J=function(o,s){return new Response(JSON.stringify(o),{status:s||200,headers:{"content-type":"application/json"}});};
  window.fetch=async function(u,o){
    var url=typeof u==="string"?u:(u&&u.url)||"";
    if(/\\/c(\\?|$)/.test(url)&&!/\\/c\\//.test(url)){
      var r=await _f(u,o),j;try{j=await r.clone().json();}catch(e){return r;}
      if(!j||!Array.isArray(j.collections))return r;
      var base=j.collections.find(function(c){return (c.chain||"solana")==="solana";})||j.collections[0]||{chain:"solana",collection:"So1111111111111111111111111111111111111111",coverSig:"",owners:7};
      var now=Math.floor(Date.now()/1000);
      var mk=function(sym,dec,iss,price,name){return Object.assign({},base,{slug:"mock-"+sym,name:name,chain:"solana",priceLamports:price,minted:3,maxSupply:100,owners:7,lastMintAt:now-120,startAt:0,endAt:0,currency:{mint:"Mock"+sym+"1111111111111111111111111111",symbol:sym,decimals:dec,issuer:iss}});};
      j=Object.assign({},j,{collections:[
        mk("NVDAx",8,"xStocks",1200000,"NVIDIA xStocks Art"),
        mk("NVDA",6,"Backpack Securities",12000,"NVDA Backpack Set"),
        mk("BLK",6,"Backpack Securities",5000,"BlackRock Pixels"),
        mk("SPY",6,"Backpack Securities",8000,"SPY Index Punks")
      ].concat(j.collections)});
      return J(j,r.status);
    }
    var mr=url.match(/\\/c\\/mock-([^/]+)\\/recent/);
    if(mr)return J({recent:[{kind:"mint",asset:"MockAsset"+mr[1],index:3,inscriptionSig:"",registeredAt:Math.floor(Date.now()/1000)-120}]});
    var ml=url.match(/\\/c\\/mock-([^/]+)\\/listings/);
    if(ml&&ml[1]==="NVDAx")return J({listings:[{asset:"MockAssetNVDAx",index:3,inscriptionSig:"",price:1200000,seller:"MockSeller1111111111111111111111111111111",source:"TENSOR"}]});
    if(ml)return J({listings:[]});
    return _f(u,o);
  };
})();</script>`;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".wasm": "application/wasm",
};

async function proxy(req, res, path) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const upstream = await fetch(BACKEND + path, {
    method: req.method,
    headers: req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : undefined,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

async function serveFile(res, urlPath, mock) {
  const rel = normalize(decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath));
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    if (!(await stat(file)).isFile()) throw new Error("dir");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    if (mock && rel === "/index.html") {
      res.end((await readFile(file, "utf8")).replace("<head>", "<head>\n" + MOCK));
    } else res.end(await readFile(file));
  } catch (e) { res.writeHead(404); res.end("not found: " + rel); }
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/__nft/")) await proxy(req, res, url.pathname.slice(6) + url.search);
    else await serveFile(res, url.pathname, url.searchParams.get("mock") === "1");
  } catch (e) { res.writeHead(502); res.end(String(e.message || e)); }
}).listen(PORT, "127.0.0.1", () => console.log("inscribe.codes dev  http://localhost:" + PORT + "   (nft backend proxied at /__nft)"));
