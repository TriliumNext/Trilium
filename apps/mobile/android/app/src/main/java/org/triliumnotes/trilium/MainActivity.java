package org.triliumnotes.trilium;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Local API requests answered by the page's SQLite worker (see TriliumRequestBridge),
        // and the streaming HTTP proxy for the sync worker (see TriliumWebViewClient).
        TriliumRequestBridge requestBridge = TriliumRequestBridge.install(getBridge());
        getBridge().setWebViewClient(new TriliumWebViewClient(getBridge(), requestBridge));
        // Binary write channel for downloads and backups (see TriliumFileSink).
        TriliumFileSink.install(getBridge());
        enableEdgeToEdge();
        forwardInsetsToWebView();
        applySystemBarsAppearance();
        handleBackInPage();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemBarsAppearance();
    }

    /**
     * Makes the app draw behind the status and navigation bars
     * with fully transparent system bars.
     */
    private void enableEdgeToEdge() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        WindowCompat.setDecorFitsSystemWindows(window, false);

        View contentView = findViewById(android.R.id.content);
        if (contentView instanceof ViewGroup) {
            disableFitsSystemWindows((ViewGroup) contentView);
        }
    }

    /**
     * Injects system bar and display cutout insets into the WebView as CSS custom properties,
     * since Android's WebView doesn't populate env(safe-area-inset-*).
     * Also handles IME (keyboard) insets to shrink the viewport instead of scrolling.
     */
    private void forwardInsetsToWebView() {
        View decorView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, insets) -> {
            Insets safeArea = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean isKeyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            float density = getResources().getDisplayMetrics().density;

            int top = Math.round(safeArea.top / density);
            int bottom = Math.round(safeArea.bottom / density);
            int left = Math.round(safeArea.left / density);
            int right = Math.round(safeArea.right / density);
            int keyboardHeight = Math.round(ime.bottom / density);

            String js = "document.documentElement.style.setProperty('--safe-area-inset-top', '" + top + "px');"
                    + "document.documentElement.style.setProperty('--safe-area-inset-bottom', '" + bottom + "px');"
                    + "document.documentElement.style.setProperty('--safe-area-inset-left', '" + left + "px');"
                    + "document.documentElement.style.setProperty('--safe-area-inset-right', '" + right + "px');"
                    + "document.documentElement.style.setProperty('--keyboard-height', '" + keyboardHeight + "px');";

            getBridge().getWebView().evaluateJavascript(js, null);

            // Resize the WebView so the CSS viewport shrinks when the keyboard is open
            View webView = getBridge().getWebView();
            if (webView.getLayoutParams() instanceof ViewGroup.MarginLayoutParams) {
                ViewGroup.MarginLayoutParams params = (ViewGroup.MarginLayoutParams) webView.getLayoutParams();
                params.bottomMargin = isKeyboardVisible ? ime.bottom : 0;
                webView.requestLayout();
            }

            return insets;
        });
    }

    /**
     * Hands the system back gesture and button to the page, which closes the menu or dialog on top
     * or steps back toward the note tree; when it has nothing to go back from, the app goes to the
     * background, as at the root of any Android app.
     */
    private void handleBackInPage() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript(
                        "window.__triliumHandleBack ? window.__triliumHandleBack() : false",
                        (handled) -> {
                            if (!"true".equals(handled)) {
                                moveTaskToBack(true);
                            }
                        });
            }
        });
    }

    /**
     * Sets light/dark status and navigation bar icons based on the current theme.
     */
    private void applySystemBarsAppearance() {
        Window window = getWindow();
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());

        boolean isNightMode = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;

        controller.setAppearanceLightStatusBars(!isNightMode);
        controller.setAppearanceLightNavigationBars(!isNightMode);
    }

    private void disableFitsSystemWindows(ViewGroup group) {
        group.setFitsSystemWindows(false);
        for (int i = 0; i < group.getChildCount(); i++) {
            View child = group.getChildAt(i);
            child.setFitsSystemWindows(false);
            if (child instanceof ViewGroup) {
                disableFitsSystemWindows((ViewGroup) child);
            }
        }
    }
}
