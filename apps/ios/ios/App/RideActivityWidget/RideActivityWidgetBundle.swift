import SwiftUI
import WidgetKit

@main
struct RideActivityWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            RideActivityLiveActivity()
        }
    }
}
