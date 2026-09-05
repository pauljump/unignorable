import SwiftUI

@main
struct UnignorableApp: App {
    @StateObject private var model = RouteModel()
    @StateObject private var navigation = AppNavigation()

    @StateObject private var account = AccountModel()

    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-curbnote-ui-reset") {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "CurbnoteLocal")
            try? FileManager.default.removeItem(at: directory)
        }
        #endif
    }

    var body: some Scene {
        WindowGroup { AppRootView().environmentObject(account).environmentObject(model).environmentObject(navigation).tint(AppTheme.brand) }
    }
}
