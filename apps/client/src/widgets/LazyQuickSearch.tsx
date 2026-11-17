import "./quick_search.css";

import { t } from "../services/i18n";
import ActionButton from "./react/ActionButton";
import { useLazyModule } from "./react/LazyComponent";

const loadQuickSearch = () => import("./quick_search");

/**
 * The quick search, which `quick_search.tsx` and its search string editor make heavy to load. Until
 * they have loaded, it is drawn as an inert box of the same size, so nothing moves when it is replaced.
 */
export default function LazyQuickSearch() {
    const quickSearch = useLazyModule(loadQuickSearch);
    if (quickSearch) {
        return <quickSearch.default />;
    }

    return (
        <div className="quick-search">
            <div className="quick-search-box">
                <ActionButton
                    className="search-button"
                    icon="bx bx-search"
                    text={t("quick-search.placeholder")}
                    noIconActionClass
                />
                <div className="search-string form-control tn-input-field">
                    <span className="search-string-placeholder">{t("quick-search.placeholder")}</span>
                </div>
            </div>
        </div>
    );
}
