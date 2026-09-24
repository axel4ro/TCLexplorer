(function(){
  const API='https://api.multiversx.com';
  const GATEWAY='https://gateway.multiversx.com';
  const TOKEN='TCL-fe459d';
  const cache=new Map();
  const inflight=new Map();
  const requestTimes=[];

  async function throttle(){
    const now=Date.now();
    while(requestTimes.length&&now-requestTimes[0]>1100)requestTimes.shift();
    if(requestTimes.length>=2)await new Promise(r=>setTimeout(r,1100-(now-requestTimes[0])));
    requestTimes.push(Date.now());
  }
  async function getJSON(url,{ttl=30000,signal}={}){
    const saved=cache.get(url);
    if(saved&&Date.now()-saved.time<ttl)return structuredClone(saved.data);
    if(inflight.has(url))return inflight.get(url);
    const task=(async()=>{
      await throttle();
      const response=await fetch(url,{headers:{Accept:'application/json'},signal});
      if(!response.ok)throw new Error(`MultiversX ${response.status}: ${response.statusText}`);
      const data=await response.json();
      cache.set(url,{time:Date.now(),data});
      return structuredClone(data);
    })().finally(()=>inflight.delete(url));
    inflight.set(url,task);return task;
  }
  const validAddress=a=>/^erd1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(String(a||''));
  const bech32ToHex=address=>{
    if(!validAddress(address))throw new Error('Invalid MultiversX address');
    const charset='qpzry9x8gf2tvdw0s3jn54khce6mua7l',data=address.slice(address.lastIndexOf('1')+1,-6);
    let acc=0,bits=0,out='';
    for(const char of data){acc=(acc<<5)|charset.indexOf(char);bits+=5;while(bits>=8){bits-=8;out+=((acc>>bits)&255).toString(16).padStart(2,'0')}}return out;
  };
  async function queryContract(scAddress,funcName,args=[]){
    await throttle();const response=await fetch(`${API}/query`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({scAddress,funcName,args})});
    if(!response.ok)throw new Error(`MultiversX query ${response.status}`);const data=await response.json();if(data.returnCode!=='ok')throw new Error(data.returnMessage||data.returnCode||'Contract query failed');return data.returnData||[];
  }
  const base64BigInt=value=>{if(!value)return 0n;const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return bytes.reduce((n,b)=>(n<<8n)+BigInt(b),0n)};
  window.MultiversXAPI={
    API,GATEWAY,TOKEN,validAddress,bech32ToHex,queryContract,base64BigInt,
    getToken:()=>getJSON(`${API}/tokens/${TOKEN}`,{ttl:20000}),
    getSupply:async()=>{const r=await getJSON(`${GATEWAY}/network/esdt/supply/${TOKEN}`,{ttl:60000});return r.data},
    getTokenAccountsCount:()=>getJSON(`${API}/tokens/${TOKEN}/accounts/count`,{ttl:30000}),
    getTokenTransactionsCount:()=>getJSON(`${API}/transactions/count?token=${TOKEN}`,{ttl:30000}),
    getEpochStatus:async()=>{
      const response=await getJSON(`${GATEWAY}/network/status/4294967295`,{ttl:5000});
      const status=response?.data?.status||{};
      const roundsPerEpoch=Number(status.erd_rounds_per_epoch);
      const roundsPassed=Number(status.erd_rounds_passed_in_current_epoch);
      const blockTimestamp=Number(status.erd_block_timestamp_ms||Number(status.erd_block_timestamp)*1000);
      if(!Number.isFinite(roundsPerEpoch)||!Number.isFinite(roundsPassed)||!Number.isFinite(blockTimestamp))throw new Error('Invalid MultiversX epoch status');
      return {epoch:Number(status.erd_epoch_number),startsAt:blockTimestamp-roundsPassed*6000,endsAt:blockTimestamp+Math.max(0,roundsPerEpoch-roundsPassed)*6000};
    },
    getAccount:address=>{if(!validAddress(address))throw new Error('Invalid MultiversX address');return getJSON(`${API}/accounts/${address}`,{ttl:15000})},
    getTCLBalance:async address=>{if(!validAddress(address))throw new Error('Invalid MultiversX address');const list=await getJSON(`${API}/accounts/${address}/tokens?identifier=${TOKEN}&size=1`,{ttl:15000});const row=Array.isArray(list)?list[0]:null;return row?Number(row.balance)/10**(row.decimals||18):0},
    getAccountNFTs:address=>{if(!validAddress(address))throw new Error('Invalid MultiversX address');return getJSON(`${API}/accounts/${address}/nfts?from=0&size=100`,{ttl:20000})},
    getNFT:identifier=>getJSON(`${API}/nfts/${encodeURIComponent(identifier)}`,{ttl:60000}),
    clearCache(){cache.clear()}
  };
})();
