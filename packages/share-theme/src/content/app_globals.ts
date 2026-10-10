// Ahead of the views' own stylesheets, which draw over Bootstrap's tooltips and menus.
import "./bootstrap.scss";
import "@triliumnext/client/src/stylesheets/menus.css";
import "@triliumnext/client/src/stylesheets/theme-next/menus.css";

import $ from "jquery";

Object.assign(window, { $, jQuery: $ });
