import Foundation
import JavaScriptCore
let context = JSContext()!
let source = try String(contentsOfFile: "main/userSleepState.js", encoding: .utf8)
context.evaluateScript(source)
precondition(context.exception == nil, "Core load failed")
let owner="a", t=1792100000000.0, minute=60000.0
func event(_ id:String,_ kind:String,_ at:Double)->[String:Any]{ ["version":1,"id":id,"kind":kind,"at":at,"recordedAt":at,"owner":owner,"source":"manual"] }
let rows=[event("wake","wakeConfirmed",t),event("sleep","sleepConfirmed",t+20*minute),event("resume","activity",t+140*minute)]
let summary=context.objectForKeyedSubscript("UserSleepState")!.objectForKeyedSubscript("reduce")!.call(withArguments:[rows,["owner":owner,"now":t+140*minute,"minutes":120]])!.toDictionary()!
precondition(context.exception == nil, "Core evaluation failed")
precondition(summary["remainingMs"] as? Double == 100*minute)
precondition(summary["confirmedSleepMs"] as? Double == 120*minute)
print("PASS iOS JavaScriptCore engine: same reducer, 100min remaining, 120min confirmed sleep")
