import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    // UIKit loads `Main.storyboard` into this window from the scene configuration in Info.plist.
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        openURLContexts(connectionOptions.urlContexts)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        openURLContexts(URLContexts)
    }

    // Under the scene life cycle UIKit no longer calls `application(_:open:options:)`, so URL opens
    // reach Capacitor's App plugin through `ApplicationDelegateProxy` from here.
    private func openURLContexts(_ contexts: Set<UIOpenURLContext>) {
        for context in contexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

}
