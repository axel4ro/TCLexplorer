(function(){
  const delay=(value,ms=180,fail=false)=>new Promise((resolve,reject)=>setTimeout(()=>fail?reject(new Error('Mock request failed')):resolve(structuredClone(value)),ms));
  // The xPortal session (shared with TCL Explorer's Swap/Support/Marketplace pages through the
  // same localStorage keys) is the ONLY persisted connection; it is restored at startup. Only a
  // read-only preview address is kept here, under its own key, so a stale copy of a real
  // connection can never outlive a disconnect made on another page.
  localStorage.removeItem('lander:walletAddress');
  const savedAddress=localStorage.getItem('lander:previewAddress')||'';
  // Tracks epochs we've confirmed (via an on-chain rejection, see
  // markClaimedThisEpoch below) are already claimed through a mechanism we
  // can't see in transaction history (e.g. Auto Claim) — the
  // hasClaimedThisEpoch checks below can miss this and let a user attempt
  // (and pay gas for) a claim that the contract will just reject again.
  const confirmedClaimed=new Set(JSON.parse(localStorage.getItem('lander:confirmedClaimed')||'[]'));
  function saveConfirmedClaimed(){
    const trimmed=[...confirmedClaimed].slice(-20); // keep it small; only recent epochs matter
    localStorage.setItem('lander:confirmedClaimed',JSON.stringify(trimmed));
  }
  const state={connected:MultiversXAPI.validAddress(savedAddress),address:savedAddress,network:'Mainnet',reinvest:false,claimLoan:true,autoClaim:402,stake:3000.408,nfts:0,dataMode:'live'};
  const gameCollections=/^(TCLARMOUR|TCLBRACE|TCLEARRING|TCLHELMET|TCLMOUNT|TCLNECK|TCLPLATE|TCLSHIELD|TCLSHOES|TCLSUIT|TCLSWORD|TCLBOOST|DRAGONE|ORCASMOUNT)-/;
  const typeOf=item=>({TCLARMOUR:'Armor',TCLPLATE:'Armor',TCLSUIT:'Armor',TCLBRACE:'Bracelet',TCLEARRING:'Earrings',TCLHELMET:'Helmet',TCLMOUNT:'Mount',TCLNECK:'Necklace',TCLSHIELD:'Shield',TCLSHOES:'Shoes',TCLSWORD:'Weapon',TCLBOOST:'Boost',DRAGONE:'Pet',ORCASMOUNT:'Mount'}[item.collection?.split('-')[0]||item.identifier?.split('-')[0]]||item.name||'NFT');
  // entry (when present) is a real on-chain getEquippedNfts/getLoanedNfts
  // parsed result: {staked,max} in TCL, straight from the SC — no
  // per-wallet-agnostic mock table. Owned-but-not-equipped/loaned items
  // have no such entry, so they show 'Not stakable' (accurate: we have no
  // real per-item storage figure for those).
  const normalize=(item,entry,price=0)=>{
    const staked=entry?.staked||0,max=entry?.max||0;
    return {...item,quantity:Number(item.balance||1),image:item.media?.[0]?.url||item.url||item.uris?.[0]||'',kind:(item.type||'NFT').replace('NonFungibleESDT','NFT').replace('SemiFungibleESDT','SFT'),gameType:typeOf(item),staked,usd:max&&price?`$${number(staked*price,2)}`:'',tcl:max?`${number(staked)}/${number(max)} TCL`:'Not stakable'};
  };
  const fallbackToken={circulating:'736.002.419',maxSupply:'918.939.087',price:'0,0006 USD',marketCap:'437.218 USD',burnt:'81.060.912',holders:'1.361',transactions:'363.914',source:'cached fallback'};
  const fallbackStats={players:'144.147',web3:'4.368',subscribers:'125.270',staked:'121,155,453 TCL',apr:'45%',emission:'152,388 TCL',rewards:'97,780,010 TCL',referralCodes:'24.918',source:'last observed Lander values'};
  const number=(v,d=0)=>Number(v||0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
  const money=v=>`${number(v<1?v:Math.round(v),v<1?4:0)} USD`;
  const vestingContracts=[['Seed Zero','erd1qqqqqqqqqqqqqpgqk9yf8y32wzwupjy7724j5wm3rk737ph20ufslxuppr'],['Seed','erd1qqqqqqqqqqqqqpgq97axlw2euvr3kenudu6xlch8zwmz2ah50ufspnfks0'],['Private Sale','erd1qqqqqqqqqqqqqpgqc45lurvvvpldzjkgc3lxueyjvp47mju60ufsmw0law'],['Public Sale','erd1qqqqqqqqqqqqqpgq5xu6me8xveumsunfyq9352pa0hpkplsqsyxszfw8sd'],['Marketing','erd1qqqqqqqqqqqqqpgqtmsmg5acqn3etmwf9hrv4fcrsctz0lr20ufsgfk023'],['Team and Advisors','erd1qqqqqqqqqqqqqpgqd245fd2cycl5u4gj5tgv8n4qzqz5x2us0ufsv3y0sp'],['Treasury','erd1qqqqqqqqqqqqqpgqmazld0dz27axdf8acslqkncdcrjrqpav548spxdtm9']];
  const vestingPlans={Marketing:{parts:10,days:90,next:Date.UTC(2026,7,20)},'Team and Advisors':{parts:100,days:30,next:Date.UTC(2026,7,3)}};
  const completedVesting={
    'erd1p9fyv579tfnlagwd02mreuadpjxssgdx7psqe6l32r07guzxdeksfyvjmd':{'Seed Zero':200000}
  };
  const tclFromRaw=value=>Number(value/1000000000000000000n);
  let lastVestingAddress='';
  async function liveVesting(requestedType){
    if(!state.connected)return {purchased:0,claimed:0,locked:0,schedule:[],seed:requestedType,status:'Empty',source:'connect wallet'};
    const autoDetect=state.address!==lastVestingAddress;lastVestingAddress=state.address;
    const walletHex=MultiversXAPI.bech32ToHex(state.address),ordered=[...vestingContracts].sort((a,b)=>Number(b[0]===requestedType)-Number(a[0]===requestedType)),found=[];
    for(const [name,contract] of ordered){try{const [remaining]=await MultiversXAPI.queryContract(contract,'getTokensUnvested',[walletHex]),raw=MultiversXAPI.base64BigInt(remaining);if(raw>0n)found.push({name,contract,raw})}catch(error){console.debug('Vesting contract skipped',contract,error.message)}}
    const position=found.find(x=>x.name===requestedType)||(autoDetect?found[0]:null);if(!position){const claimed=completedVesting[state.address]?.[requestedType]||0;return {purchased:claimed,claimed,locked:0,schedule:[],seed:requestedType,status:claimed?'Claimed':'Empty',source:claimed?'Verified Lander vesting history':'MultiversX vesting contracts · live'}}
    let part=0,start=0;try{const [amount,startTime]=await Promise.all([MultiversXAPI.queryContract(position.contract,'getVestingAmountPart',[walletHex]),MultiversXAPI.queryContract(position.contract,'getVestingStartTimestamp',[walletHex])]);part=tclFromRaw(MultiversXAPI.base64BigInt(amount[0]));start=Number(MultiversXAPI.base64BigInt(startTime[0]))}catch(error){console.debug('Vesting schedule unavailable',error)}
    const locked=tclFromRaw(position.raw),plan=vestingPlans[position.name],count=part?Math.ceil(locked/part):0,purchased=plan&&part?part*plan.parts:locked,claimed=Math.max(0,purchased-locked),interval=(plan?.days||30)*86400000,firstUnlock=plan?.next||start*1000;
    const schedule=Array.from({length:Math.min(count,120)},(_,i)=>({number:i+2,amount:Math.min(part,locked-i*part),unlock:new Date(firstUnlock+i*interval)}));
    if(autoDetect){window.__vestingType=position.name;setTimeout(()=>{const label=document.querySelector('.vesting-type span');if(label)label.textContent=position.name},0)}return {purchased,claimed,locked,schedule,seed:position.name,unvested:locked,status:'Vesting',source:'MultiversX vesting contract · live',contract:position.contract};
  }
  async function liveToken(){
    const t=await MultiversXAPI.getToken();
    return {circulating:number(t.circulatingSupply),maxSupply:number(t.supply),price:money(t.price),marketCap:money(t.marketCap),burnt:number(Number(t.burnt)/10**t.decimals),holders:number(t.accounts),transactions:number(t.transfers),token:t,source:'MultiversX mainnet · live'};
  }
  async function withFallback(live,fallback){try{state.dataMode='live';return await live()}catch(error){console.warn('Live data unavailable; cached fallback used',error);state.dataMode='fallback';return structuredClone(fallback)}}
  window.LanderAPI={
    state,
    getUser:()=>delay({name:'Local User',referralCode:'KAZZTCLAND',guests:30,rewards:'55,853 TCL',rewardsUSD:'$33'}),
    getWallet:()=>delay(state),
    getDashboardData:()=>withFallback(liveToken, fallbackToken),
    getStatistics:()=>withFallback(async()=>{const t=await liveToken();return {...fallbackStats,holders:t.holders,transfers:t.transactions,marketCap:t.marketCap,supply:t.maxSupply,source:'MultiversX live + Lander service values marked separately'}},fallbackStats),
    getVesting:(type='Seed Zero')=>liveVesting(type),
    getNFTs:async()=>{
      if(!state.connected)return {owned:0,equipped:0,loaned:0,ownedItems:[],equippedItems:[],loanedItems:[],source:'connect wallet'};
      const wallet=await MultiversXAPI.getAccountNFTs(state.address);
      const ownedItems=wallet.filter(x=>gameCollections.test(x.identifier||'')).map(x=>normalize(x));
      let equippedItems=[],loanedItems=[],price=0;
      try{
        const [equippedEntries,loanedEntries,priceInfo]=await Promise.all([LanderLive.getEquippedNftEntries(state.address),LanderLive.getLoanedNftEntries(state.address),MultiversXAPI.getToken().catch(()=>null)]);
        price=priceInfo?Number(priceInfo.price)||0:0;
        const [equippedMeta,loanedMeta]=await Promise.all([
          Promise.all(equippedEntries.map(e=>MultiversXAPI.getNFT(e.identifier).catch(()=>null))),
          Promise.all(loanedEntries.map(e=>MultiversXAPI.getNFT(e.identifier).catch(()=>null)))
        ]);
        equippedItems=equippedMeta.map((meta,i)=>meta?normalize(meta,equippedEntries[i],price):null).filter(Boolean);
        loanedItems=loanedMeta.map((meta,i)=>meta?{...normalize(meta,loanedEntries[i],price),borrowed:!!loanedEntries[i].flag}:null).filter(Boolean);
      }catch(e){console.warn('Lander NFT equip/loan data unavailable — showing owned items only',e)}
      return {owned:ownedItems.reduce((n,x)=>n+x.quantity,0),equipped:equippedItems.length,loaned:loanedItems.length,ownedItems,equippedItems,loanedItems,source:'MultiversX mainnet · live'}
    },
    getStakingPositions:async()=>{
      if(!state.connected)return {stake:0,stakeUSD:0,apr:0,daily:0,dailyUSD:0,earned:0,earnedUSD:0,totalStaked:0,totalStakedUSD:0,balanceUSDC:0,balanceTCL:0,autoClaim:0,reinvest:state.reinvest,claimLoan:false,nextClaim:'—',source:'connect wallet'};
      const [live,glob,balanceTCL]=await Promise.all([LanderLive.getInfinityStakingLive(state.address),LanderLive.getGlobalStats().catch(()=>({totalStaked:0,totalStakedUSD:0})),MultiversXAPI.getTCLBalance(state.address)]);
      return {...live,totalStaked:glob.totalStaked,totalStakedUSD:glob.totalStakedUSD,balanceUSDC:0,balanceTCL,autoClaim:live.autoClaimDays,reinvest:state.reinvest,claimLoan:state.claimLoan,nextClaim:'4h 41m 22s',source:'MultiversX getRewardsData · live'};
    },
    getLendingPositions:async()=>{
      if(!state.connected)return {loanDisplay:0,loanDisplayUSD:0,pending:0,pendingUSD:0,source:'connect wallet'};
      return LanderLive.getLendingLive(state.address);
    },
    getTransactions:()=>state.connected?fetch(`${MultiversXAPI.API}/accounts/${state.address}/transactions?from=0&size=25&token=${MultiversXAPI.TOKEN}`).then(r=>r.json()):delay([]),
    getRewards:()=>delay({daily:0,earned:0,source:'staking service unavailable'}),
    connectWallet:async onUri=>{const approved=await LanderWallet.pair(onUri);state.connected=true;state.address=approved.address;localStorage.removeItem('lander:previewAddress');return state},
    connectWalletReadOnly:async address=>{await delay(null,250);if(!MultiversXAPI.validAddress(address))throw new Error('Invalid MultiversX address');await MultiversXAPI.getAccount(address);state.connected=true;state.address=address;localStorage.setItem('lander:previewAddress',address);return state},
    restoreWallet:async()=>{const restored=await LanderWallet.restoreSession().catch(()=>null);if(restored){state.connected=true;state.address=restored.address;localStorage.removeItem('lander:previewAddress')}return state},
    // Another page (Swap, Support, ...) closed the shared xPortal session: mirror it here without
    // calling WalletConnect's disconnect again (the session is already gone).
    forgetWallet:()=>{LanderWallet.forget();state.connected=false;state.address='';localStorage.removeItem('lander:previewAddress');return state},
    disconnectWallet:async()=>{await LanderWallet.disconnect().catch(()=>{});state.connected=false;state.address='';localStorage.removeItem('lander:previewAddress');return state},
    stake:async()=>{throw new Error('Staking a new amount is not wired up yet — only claiming Infinity/Lending rewards is enabled.')},
    claimInfinityRewards:async()=>{const hash=await LanderWallet.callContract('claimInfinityRewards');return hash},
    claimLendingRewards:async()=>{const hash=await LanderWallet.callContract('claimLendingRewards');return hash},
    markClaimedThisEpoch:async(method)=>{const epoch=await MultiversXAPI.getEpochStatus().catch(()=>null);if(epoch){confirmedClaimed.add(`${state.address}_${method}_${epoch.startsAt}`);saveConfirmedClaimed()}},
    setPreference:async(key,value)=>{await delay(null);state[key]=value;return state},simulateFailure:()=>delay(null,450,true)
  };
  const getNFTsWithoutEpoch=window.LanderAPI.getNFTs;
  const getStakingWithoutEpoch=window.LanderAPI.getStakingPositions;
  window.LanderAPI.getNFTs=async()=>{
    const [data,epoch,balanceTCL,lending]=await Promise.all([
      getNFTsWithoutEpoch(),
      MultiversXAPI.getEpochStatus(),
      state.connected?MultiversXAPI.getTCLBalance(state.address):0,
      state.connected?LanderLive.getLendingLive(state.address).catch(()=>({loanDisplay:0,price:0})):{loanDisplay:0,price:0}
    ]);
    window.__epochEndsAt=epoch.endsAt;
    const price=lending.price||0;
    const equippedTCL=data.equippedItems.reduce((n,x)=>n+(x.staked||0),0);
    const loanedTCL=lending.loanDisplay||0;
    return {...data,equippedTCL,equippedUSD:equippedTCL*price,loanedTCL,loanedUSD:loanedTCL*price,balanceTCL,balanceUSD:balanceTCL*price,epochEndsAt:epoch.endsAt};
  };
  window.LanderAPI.getStakingPositions=async()=>{
    const [data,epoch]=await Promise.all([getStakingWithoutEpoch(),MultiversXAPI.getEpochStatus()]);
    window.__epochEndsAt=epoch.endsAt;
    const lastClaimMs=state.connected?await LanderLive.getLastRewardTransferMs(state.address).catch(()=>0):0;
    const known=confirmedClaimed.has(`${state.address}_claimInfinityRewards_${epoch.startsAt}`);
    return {...data,epochEndsAt:epoch.endsAt,epochStartsAt:epoch.startsAt,hasClaimedThisEpoch:known||lastClaimMs>epoch.startsAt};
  };
  const getLendingWithoutEpoch=window.LanderAPI.getLendingPositions;
  window.LanderAPI.getLendingPositions=async()=>{
    const [data,epoch]=await Promise.all([getLendingWithoutEpoch(),MultiversXAPI.getEpochStatus()]);
    const lastClaimMs=state.connected?await LanderLive.getLastRewardTransferMs(state.address).catch(()=>0):0;
    const known=confirmedClaimed.has(`${state.address}_claimLendingRewards_${epoch.startsAt}`);
    return {...data,epochEndsAt:epoch.endsAt,epochStartsAt:epoch.startsAt,hasClaimedThisEpoch:known||lastClaimMs>epoch.startsAt};
  };
})();
