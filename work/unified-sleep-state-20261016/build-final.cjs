const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{execFileSync}=require('child_process'),asar=require('/Users/rogan/.npm/_npx/4b0e2640fe917ac8/node_modules/@electron/asar/lib/asar.js');
const installed='/Applications/Auto Pomodoro.app',target=path.resolve('dist/unified-sleep-state-final3/Auto Pomodoro.app');
(async()=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pomodoro-sleep-state-'));try{
 if(fs.existsSync(target))throw Error('Target exists');asar.extractAll(installed+'/Contents/Resources/app.asar',tmp);
 for(const f of ['wakeProtection.js','userSleepState.js','userSleepJournal.js'])fs.copyFileSync('main/'+f,tmp+'/main/'+f);
 const mainPath=tmp+'/main/main.js';let main=fs.readFileSync(mainPath,'utf8');
 const marker='    history: retainWakeHistory, changed: () => broadcast(),';if(!main.includes(marker))throw Error('Controller config boundary changed');
 main=main.replace(marker,'    isObserving: () => physicalInputGuardReady,\n'+marker);fs.writeFileSync(mainPath,main);
 for(const lang of ['ko','en','ja','zh']){const p=tmp+'/locales/'+lang+'.json',old=JSON.parse(fs.readFileSync(p)),source=JSON.parse(fs.readFileSync('locales/'+lang+'.json'));old['dash.settings.wakeLockHelp']=source['dash.settings.wakeLockHelp'];fs.writeFileSync(p,JSON.stringify(old,null,2)+'\n');}
 const htmlPath=tmp+'/renderer/dashboard/index.html';let html=fs.readFileSync(htmlPath,'utf8');html=html.replace('연동된 알람 앱이 기상을 알리면 2시간 동안 Pomodoro 휴식 잠금을 적용합니다. 집중 중에는 컴퓨터를 잠그지 않습니다.',JSON.parse(fs.readFileSync('locales/ko.json'))['dash.settings.wakeLockHelp']);fs.writeFileSync(htmlPath,html);
 fs.mkdirSync(path.dirname(target),{recursive:true});execFileSync('ditto',[installed,target]);const archive=target+'/Contents/Resources/app.asar';await asar.createPackage(tmp,archive);
 const hash=crypto.createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');execFileSync('/usr/libexec/PlistBuddy',['-c','Set :ElectronAsarIntegrity:Resources/app.asar:hash '+hash,target+'/Contents/Info.plist']);
 const helper=target+'/Contents/Resources/mac-physical-input-guard';execFileSync('codesign',['--force','--identifier','com.rogan.pomodorocage','--sign','Developer ID Application: GeunHu Kim (V3J8MR637G)','--options','runtime','--timestamp',helper]);execFileSync('codesign',['--force','--sign','Developer ID Application: GeunHu Kim (V3J8MR637G)','--preserve-metadata=entitlements,requirements,flags,runtime','--timestamp',target]);execFileSync('codesign',['--verify','--deep','--strict',target]);console.log(target);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
