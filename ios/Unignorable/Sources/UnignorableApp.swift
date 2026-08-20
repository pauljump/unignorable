import SwiftUI

@main
struct UnignorableApp: App {
    @StateObject private var model = RouteModel()
    @StateObject private var navigation = AppNavigation()

    var body: some Scene {
        WindowGroup { AppRootView().environmentObject(model).environmentObject(navigation) }
    }
}
