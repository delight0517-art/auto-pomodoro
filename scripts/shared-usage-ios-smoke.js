'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, '../ios/PomodoroCage/Sources/Shared/AppGroupStore.swift'), 'utf8');
const code = source.slice(source.indexOf('enum SharedUsageBudgetStore {'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-usage-swift-'));
try {
  fs.writeFileSync(path.join(dir, 'main.swift'), `import Foundation
enum Interval { case daily }
struct AppLimitRule { var id="test"; var intervalType=Interval.daily; var usageGroupID:String?="sns"; var limitMinutes=60; var usageGroupUpdatedAt:Double?=nil; var createdAt:Double=1 }
final class MemoryDefaults {
 var values:[String:Any]=[:]
 func dictionaryRepresentation()->[String:Any]{values}
 func removeObject(forKey key:String){values.removeValue(forKey:key)}
 func set(_ value:Any?,forKey key:String){values[key]=value}
 func string(forKey key:String)->String?{values[key] as? String}
 func data(forKey key:String)->Data?{values[key] as? Data}
}
enum AppGroupStore {
 static let defaults=MemoryDefaults()
 static func loadAppLimitRules()->[AppLimitRule] { [] }
}
${code}
let now=Date().timeIntervalSince1970*1000
func group(_ limit:Int,_ at:Double=now)->[String:Any] { ["id":"sns","name":"sns","limitMinutes":limit,"updatedAt":at,"updatedBy":"phone"] }
func usage(_ device:String,_ minutes:Double,_ date:String=SharedUsageBudgetStore.day)->[String:Any] { ["day":date,"groupId":"sns","deviceId":device,"minutes":minutes,"updatedAt":now,"accuracy":"lower-bound","timeZone":TimeZone.current.identifier] }
func doc(_ rows:[[String:Any]])->[String:Any] { ["groups":["sns":group(60)],"usage":Dictionary(uniqueKeysWithValues:rows.map { (($0["day"] as! String)+"|sns|"+($0["deviceId"] as! String),$0) })] }
SharedUsageBudgetStore.setIdentity(account:"a",deviceID:"phone")
let a=doc([usage("phone",10),usage("mac",20)])
let b=doc([usage("phone",15),usage("mac",12)])
let merged=SharedUsageBudgetStore.merge(a,b)
SharedUsageBudgetStore.save(merged)
let rule=AppLimitRule()
precondition(SharedUsageBudgetStore.localMinutes(for:rule)==15)
precondition(SharedUsageBudgetStore.otherMinutes(for:rule)==20)
precondition(SharedUsageBudgetStore.localThreshold(for:rule)==40)
precondition(SharedUsageBudgetStore.otherMinutes(for:rule)+SharedUsageBudgetStore.localMinutes(for:rule)==35,"duplicate receipts must use max per device")
let reverse=SharedUsageBudgetStore.merge(b,a)
precondition(NSDictionary(dictionary:merged).isEqual(to:reverse),"merge order must not change totals")
let invalid=SharedUsageBudgetStore.merge(merged,doc([usage("bad",-1),usage("future",10,"2099-01-01"),usage("huge",1441)]))
precondition((invalid["usage"] as! [String:Any]).count==2)
let newer=SharedUsageBudgetStore.merge(merged,["groups":["sns":group(30,now+1)]])
SharedUsageBudgetStore.save(newer)
precondition(SharedUsageBudgetStore.localThreshold(for:rule)==10)
SharedUsageBudgetStore.setIdentity(account:"b",deviceID:"phone")
precondition(SharedUsageBudgetStore.localMinutes(for:rule)==0,"account caches must be isolated")
precondition(!SharedUsageBudgetStore.includesPastActivity,"account change must not adopt earlier usage")
SharedUsageBudgetStore.setIdentity(account:"a",deviceID:"phone")
precondition(SharedUsageBudgetStore.localMinutes(for:rule)==15)
AppGroupStore.defaults.set("a",forKey:"usageBudgets.monitorOwner.test")
SharedUsageBudgetStore.record(rule:rule,minutes:25)
SharedUsageBudgetStore.record(rule:rule,minutes:5)
precondition(SharedUsageBudgetStore.localMinutes(for:rule)==25)
SharedUsageBudgetStore.save(newer)
precondition(SharedUsageBudgetStore.localMinutes(for:rule)==25,"stale host cache writes must not erase extension receipts")
SharedUsageBudgetStore.save(SharedUsageBudgetStore.document)
SharedUsageBudgetStore.acknowledgeReceipts(SharedUsageBudgetStore.document)
precondition(SharedUsageBudgetStore.localMinutes(for:rule)==25,"server-acknowledged values survive queue cleanup")
precondition(SharedUsageBudgetStore.validGroupID("sns"))
precondition(!SharedUsageBudgetStore.validGroupID("SNS|x"))
print("PASS Swift usage: per-device max, sums, commutative merge, invalid/future rejection, limit update, account isolation, monotone receipts")
`);
  execFileSync('swift', [path.join(dir, 'main.swift')], { stdio: 'inherit' });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
