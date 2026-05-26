package org.triliumnotes.trilium;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;

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
        enableEdgeToEdge();
        forwardInsetsToWebView();
        applySystemBarsAppearance();
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
     * Injects system bar insets into the WebView as CSS custom properties,
     * since Android's WebView doesn't populate env(safe-area-inset-*).
     * Also handles IME (keyboard) insets to shrink the viewport instead of scrolling.
     */
    private void forwardInsetsToWebView() {
        View decorView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean isKeyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            float density = getResources().getDisplayMetrics().density;

            int top = Math.round(systemBars.top / density);
            int bottom = Math.round(systemBars.bottom / density);
            int left = Math.round(systemBars.left / density);
            int right = Math.round(systemBars.right / density);
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
