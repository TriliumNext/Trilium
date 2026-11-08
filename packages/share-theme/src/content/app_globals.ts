// Ahead of the views' own stylesheets, which draw over Bootstrap's tooltips, menus and buttons.
import "./bootstrap.scss";
import "@triliumnext/client/src/stylesheets/boxicons-compat.css";
import "@triliumnext/client/src/stylesheets/menus.css";
import "@triliumnext/client/src/stylesheets/buttons.css";
import "@triliumnext/client/src/stylesheets/theme-next/buttons.css";
import "@triliumnext/client/src/stylesheets/theme-next/menus.css";

import $ from "jquery";

Object.assign(window, { $, jQuery: $ });
