'use strict';
const core=require('./userSleepState');
const {randomUUID}=require('crypto');
function createUserSleepJournal({store,account,deviceId=()=> 'mac',now=Date.now}) {
  const owner=()=>String(account() || 'signed-out').toLowerCase();
  const key=()=> 'userSleepEventsV1.'+Buffer.from(owner()).toString('hex');
  const all=()=>store.get(key(),[]);
  function merge(events) {
    const result=core.merge([all(),events],owner(),now());
    if (JSON.stringify(result)!==JSON.stringify(all())) {
      const receiptKey='userSleepReceiptsV1.'+Buffer.from(owner()).toString('hex');
      const receipts=store.get(receiptKey,{});
      for(const event of result)if(!receipts[event.id])receipts[event.id]=now();
      store.set(receiptKey,receipts);
      store.set(key(),result);
    }
    return result;
  }
  function append(kind,at=now(),extra={}) {
    const event={...extra,version:1,id:randomUUID(),owner:owner(),deviceId:deviceId(),kind,at,recordedAt:now(),source:extra.source || 'manual'};
    const saved=merge([event]);
    if(!saved.some(e=>e.id===event.id))throw Error('invalid sleep event');
    return event;
  }
  function ingest(rows) { return merge((rows || []).map(row=>core.fromLegacy(row,owner(),now())).filter(Boolean)); }
  function observe(at) {
    if (!Number.isFinite(at) || at<=0 || at>now() || now()-at>90000) return;
    const last=all().filter(e=>e.kind==='activity' && e.deviceId===deviceId()).at(-1);
    if (!last || at-last.at>=60000) append('activity',at,{source:'human-input'});
  }
  function correct({kind,at,targetId,endAt}) {
    if (!['wakeConfirmed','sleepConfirmed','sleepInterval'].includes(kind) || !Number.isFinite(at)
      || at>now() || now()-at>7*86400000)throw Error('invalid correction');
    if (kind==='sleepInterval' && (!Number.isFinite(endAt) || endAt<=at || endAt>now()))throw Error('invalid interval');
    if (targetId) {
      if(!all().some(e=>e.id===targetId && e.kind!=='correction'))throw Error('unknown correction target');
      return append('correction',at,{targetId,replacementKind:kind,endAt,confirmed:true});
    }
    return append(kind,at,{endAt,confirmed:true});
  }
  return {all,append,merge,ingest,observe,correct,summary:(options={})=>core.reduceConfirmed(all(),{...options,owner:owner(),now:now()})};
}
module.exports={createUserSleepJournal};
