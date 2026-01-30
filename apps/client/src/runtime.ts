import $ from "jquery";

async function loadBootstrap() {
    if (document.body.dir === "rtl") {
        await import("bootstrap/dist/css/bootstrap.rtl.min.css");
    } else {
        await import("bootstrap/dist/css/bootstrap.min.css");
    }
}

// Polyfill removed jQuery methods for autocomplete.js compatibility
($ as any).isArray = Array.isArray;
($ as any).isFunction = function(obj: any) { return typeof obj === 'function'; };
($ as any).isPlainObject = function(obj: any) {
    if (obj == null || typeof obj !== 'object') { return false; }
    const proto = Object.getPrototypeOf(obj);
    if (proto === null) { return true; }
    const Ctor = Object.prototype.hasOwnProperty.call(proto, 'constructor') && proto.constructor;
    return typeof Ctor === 'function' && Ctor === Object;
};

(window as any).$ = $;
(window as any).jQuery = $;
await loadBootstrap();

$("body").show();
