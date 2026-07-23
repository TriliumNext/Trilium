import UIKit
import Capacitor
import WebKit
import ObjectiveC.runtime

class ViewController: CAPBridgeViewController {
    // True between keyboardWillShow and keyboardDidShow. During that
    // window we pin the outer WKWebView scroll offset to zero so iOS's
    // auto-scroll-to-focus can't drag the toolbar off-screen.
    private var isKeyboardAnimating = false
    private var scrollOffsetObservation: NSKeyValueObservation?
    // Display link that samples the keyboard's current top edge every
    // render frame while the keyboard is visible or animating. Drives
    // the `--tn-keyboard-gap` CSS variable so the web-side editor toolbar
    // follows the keyboard smoothly during interactive swipe-dismiss.
    private var keyboardFrameTracker: CADisplayLink?
    private var lastKeyboardGap: CGFloat = -1

    override func viewDidLoad() {
        super.viewDidLoad()
        hideKeyboardInputAccessoryView()
        enableInteractiveKeyboardDismiss()
        observeKeyboard()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        scrollOffsetObservation?.invalidate()
        keyboardFrameTracker?.invalidate()
    }

    // Reroute local API requests (/api, /sync, /bootstrap, /search) to the in-page
    // SQLite worker at the WKURLSchemeHandler level. Capacitor registers its
    // WebViewAssetHandler for the capacitor:// scheme before this hook runs and
    // WebKit forbids replacing a registered handler (NSInvalidArgumentException),
    // so re-type the live instance to our subclass instead — the same isa-swizzle
    // pattern as hideKeyboardInputAccessoryView below.
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        if let assetHandler = configuration.urlSchemeHandler(forURLScheme: "capacitor") as? WebViewAssetHandler {
            object_setClass(assetHandler, TriliumAssetHandler.self)
        }
        configuration.userContentController.add(TriliumSchemeBridge.shared, name: "triliumScheme")
        return super.webView(with: frame, configuration: configuration)
    }

    // When a page element receives focus and the keyboard animates in,
    // WKWebView reflexively scrolls its outer UIScrollView upward to keep
    // the focused element visible. Our layout is `body { position: fixed;
    // height: 100vh }` with an internal ScrollingContainer for note
    // content — the outer scroll has nothing useful to scroll, so iOS's
    // auto-scroll just drags the whole layout (toolbar included) off the
    // top of the viewport. We can't disable the scroll view outright
    // because the interactive swipe-down-to-dismiss gesture needs it, so
    // we KVO the contentOffset and revert any non-zero value written
    // during the keyboard animation.
    //
    // Separately, we run a CADisplayLink while the keyboard is present
    // and sample the live keyboard window frame each frame. Keyboard
    // notifications only fire on commit (not per-frame during an
    // interactive drag), and `keyboardLayoutGuide.layoutFrame` only
    // reflects the keyboard's final resting position — neither is
    // sufficient for tracking mid-drag. The keyboard window's frame, by
    // contrast, is updated by UIKit every frame. We push the position
    // into the `--tn-keyboard-gap` CSS variable, which translates the
    // web-side editor toolbar so it follows the keyboard.
    private func observeKeyboard() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(keyboardWillShow),
                       name: UIResponder.keyboardWillShowNotification, object: nil)
        nc.addObserver(self, selector: #selector(keyboardDidShow),
                       name: UIResponder.keyboardDidShowNotification, object: nil)
        nc.addObserver(self, selector: #selector(keyboardDidHide),
                       name: UIResponder.keyboardDidHideNotification, object: nil)

        scrollOffsetObservation = self.webView?.scrollView.observe(\.contentOffset, options: [.new]) { [weak self] scrollView, _ in
            guard let self = self, self.isKeyboardAnimating else { return }
            if scrollView.contentOffset != .zero {
                scrollView.setContentOffset(.zero, animated: false)
            }
        }
    }

    @objc private func keyboardWillShow() {
        isKeyboardAnimating = true
        startKeyboardFrameTracker()
    }

    @objc private func keyboardDidShow() {
        isKeyboardAnimating = false
    }

    @objc private func keyboardDidHide() {
        stopKeyboardFrameTracker()
        setKeyboardGap(0)
    }

    private func startKeyboardFrameTracker() {
        if keyboardFrameTracker != nil { return }
        let link = CADisplayLink(target: self, selector: #selector(onDisplayLinkTick))
        link.add(to: .main, forMode: .common)
        keyboardFrameTracker = link
    }

    private func stopKeyboardFrameTracker() {
        keyboardFrameTracker?.invalidate()
        keyboardFrameTracker = nil
    }

    @objc private func onDisplayLinkTick() {
        guard let webView = self.webView else { return }
        // Gap = how far below the webview's bottom edge the keyboard's
        // top sits. Zero when the keyboard is fully shown (Capacitor's
        // `resize: native` has matched the webview bottom to keyboard
        // top); positive while the user drags the keyboard downward.
        let kbTop = currentKeyboardTopY()
        let gap = max(0, kbTop - webView.frame.maxY)
        if abs(gap - lastKeyboardGap) < 0.5 { return }
        lastKeyboardGap = gap
        setKeyboardGap(gap)
    }

    // Returns the live top edge of the on-screen keyboard in the view's
    // coordinate space. Walks the window hierarchy to find the keyboard
    // window (class name contains "Keyboard" on all recent iOS versions)
    // and measures its hosting subview directly — this tracks per-frame
    // during an interactive drag, unlike `keyboardLayoutGuide.layoutFrame`
    // which only reports the resting position.
    private func currentKeyboardTopY() -> CGFloat {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows
                where NSStringFromClass(type(of: window)).contains("Keyboard") {
                if let kbView = keyboardHostingView(in: window) {
                    return kbView.convert(kbView.bounds, to: view).minY
                }
                return window.convert(window.bounds, to: view).minY
            }
        }
        return view.keyboardLayoutGuide.layoutFrame.minY
    }

    private func keyboardHostingView(in container: UIView) -> UIView? {
        for sub in container.subviews {
            let name = NSStringFromClass(type(of: sub))
            if name.contains("Input") || name.contains("Keyboard") {
                return sub
            }
            if let nested = keyboardHostingView(in: sub) {
                return nested
            }
        }
        return nil
    }

    private func setKeyboardGap(_ gap: CGFloat) {
        lastKeyboardGap = gap
        let js = "document.documentElement.style.setProperty('--tn-keyboard-gap','\(gap)px')"
        self.webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    // Because we hide iOS's input accessory bar (which contains the Done
    // button), the user would otherwise have no native way to dismiss the
    // keyboard. Enable interactive swipe-down dismissal on the web view's
    // scroll view — this is the same gesture Messages, Mail, and most
    // first-party iOS apps use. Dragging the content area downward follows
    // the finger and hides the keyboard when it reaches the bottom.
    private func enableInteractiveKeyboardDismiss() {
        guard let webView = self.webView else { return }
        webView.scrollView.keyboardDismissMode = .interactive
    }

    // The iOS keyboard shows a native "input accessory view" above the
    // software keyboard — the row with Prev/Next arrows and the Done button.
    // Capacitor's `Keyboard.resize: native` resizes the web view above the
    // keyboard itself, but the accessory view sits on top of that and
    // overlaps the editor toolbar. We hide it by dynamically subclassing
    // WebKit's internal WKContentView and overriding `inputAccessoryView`
    // to return nil. This is the canonical way to remove it in WKWebView
    // apps and doesn't depend on the @capacitor/keyboard JS bridge being
    // reachable at call time.
    private func hideKeyboardInputAccessoryView() {
        guard let webView = self.webView else { return }
        guard let contentView = webView.scrollView.subviews.first(where: {
            String(describing: type(of: $0)).contains("WKContent")
        }) else { return }

        let originalClass: AnyClass = type(of: contentView)
        let subclassName = "TriliumNoAccessoryView_\(NSStringFromClass(originalClass))"

        // If we've already generated the subclass on a previous run, reuse it.
        if let existing = NSClassFromString(subclassName) {
            object_setClass(contentView, existing)
            return
        }

        guard let subclass = objc_allocateClassPair(originalClass, subclassName, 0) else {
            return
        }

        let selector = NSSelectorFromString("inputAccessoryView")
        if let method = class_getInstanceMethod(UIView.self, selector) {
            let block: @convention(block) (AnyObject) -> UIView? = { _ in nil }
            let implementation = imp_implementationWithBlock(block)
            class_addMethod(subclass, selector, implementation, method_getTypeEncoding(method))
        }

        objc_registerClassPair(subclass)
        object_setClass(contentView, subclass)
    }
}
