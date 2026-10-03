import CarPlay
import SwiftUI
import UIKit

/// CarPlay scene lifecycle for the OpenGravel iOS shell.
///
/// This class lives in the OpenGravelNavigation package so the Capacitor app
/// does not need a second navigation implementation. Info.plist references it
/// by its module-qualified class name.
@MainActor
public final class OpenGravelCarPlaySceneDelegate: NSObject, CPTemplateApplicationSceneDelegate {
    private var model: OpenGravelCarPlayModel?

    public func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController,
        to window: CPWindow
    ) {
        guard model == nil else { return }

        let model = OpenGravelCarPlayModel()
        self.model = model

        let controller = UIHostingController(
            rootView: OpenGravelCarPlayNavigationView(model: model)
        )
        window.rootViewController = controller
        window.makeKeyAndVisible()

        let mapTemplate = model.createAndAttachTemplate()
        Task {
            do {
                _ = try await interfaceController.setRootTemplate(
                    mapTemplate,
                    animated: false
                )
            } catch {
                model.disconnect()
                self.model = nil
            }
        }
    }

    public func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnect interfaceController: CPInterfaceController,
        from window: CPWindow
    ) {
        model?.disconnect()
        model = nil
        window.isHidden = true
    }
}
