import importlib.util,os,subprocess
spec=importlib.util.spec_from_file_location('asc','/Users/rogan/appDev/schedule/40Evrytime_Reminder/scripts/asc_upload_screenshots.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);key=m.load_env()
cmd=['xcodebuild','-project','ios/PomodoroCage.xcodeproj','-scheme','PomodoroCage','-configuration','Release','-sdk','iphoneos','-destination','generic/platform=iOS','-derivedDataPath','ios/build/DeleteFixNativeDerivedData/active','-authenticationKeyPath',str(key),'-authenticationKeyID',os.environ['ASC_KEY_ID'],'-authenticationKeyIssuerID',os.environ['ASC_ISSUER'],'-allowProvisioningUpdates','-allowProvisioningDeviceRegistration','build']
raise SystemExit(subprocess.call(cmd))
