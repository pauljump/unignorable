// Compatibility entrypoint. Curbnote's web and native assets share one vector source.
import Foundation
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
process.arguments = ["python3", root.appendingPathComponent("scripts/build-brand.py").path]
try process.run()
process.waitUntilExit()
exit(process.terminationStatus)
