// Ahead of the views' own stylesheets, which draw the bubble over Bootstrap's tooltip.
import "./tooltip.scss";

import $ from "jquery";

Object.assign(window, { $, jQuery: $ });
