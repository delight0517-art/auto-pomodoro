const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{execFileSync}=require('child_process'),asar=require('/Users/rogan/.npm/_npx/4b0e2640fe917ac8/node_modules/@electron/asar/lib/asar.js');
const installed='/Applications/Auto Pomodoro.app',target=path.resolve('dist/wake-class-clock-repaired/Auto Pomodoro.app');
(async()=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pomodoro-class-clock-'));try{
 if(fs.existsSync(target))throw Error('Target exists');
 asar.extractAll(installed+'/Contents/Resources/app.asar',tmp);
 fs.copyFileSync('main/wakeProtection.js',tmp+'/main/wakeProtection.js');
 const mainPath=tmp+'/main/main.js';let main=fs.readFileSync(mainPath,'utf8');
 const old="    if (Date.now() - remoteHumanActivityAt >= 90_000) {\n      getWakeProtectionController().sleep(Date.now(), 'system-suspend-no-companion-activity');\n      void pullRiseSyncWakeEvent();\n    }\n";
 if(!main.includes(old) && !main.includes('Computer suspend is not user sleep.'))throw Error('Installed suspend block changed');
 fs.writeFileSync(mainPath,main.replace(old,'    // Computer suspend is not user sleep.\n'));

 fs.mkdirSync(path.dirname(target),{recursive:true});execFileSync('ditto',[installed,target]);
 const archive=target+'/Contents/Resources/app.asar';await asar.createPackage(tmp,archive);
 const hash=crypto.createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex');
 execFileSync('/usr/libexec/PlistBuddy',['-c','Set :ElectronAsarIntegrity:Resources/app.asar:hash '+hash,target+'/Contents/Info.plist']);
 execFileSync('codesign',['--force','--sign','Developer ID Application: GeunHu Kim (V3J8MR637G)','--preserve-metadata=entitlements,requirements,flags,runtime','--timestamp',target],{stdio:'inherit'});
 console.log(target);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
