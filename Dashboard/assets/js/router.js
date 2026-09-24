(function(){
  const valid=['token','vesting','statistics','referral','nft','staking','governance'];
  const read=()=>{const raw=location.hash.replace(/^#\/?/,'').split('?')[0].toLowerCase();return valid.includes(raw)?raw:'token'};
  window.LanderRouter={current:read,navigate(route){location.hash='#/'+(valid.includes(route)?route:'token')},start(cb){addEventListener('hashchange',()=>cb(read()));cb(read())}};
})();
