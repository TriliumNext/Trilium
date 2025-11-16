import utils from "./utils.js";

export interface ToastOptions {
    id?: string;
    icon: string;
    title?: string;
    message: string;
    delay?: number;
    autohide?: boolean;
    closeAfter?: number;
}

function toast(options: ToastOptions) {
    const $toast = $(options.title
        ? `\
            <div class="toast" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="toast-header">
                    <strong class="me-auto">
                        <span class="bx bx-${options.icon}"></span>
                        <span class="toast-title"></span>
                    </strong>
                    <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
                <div class="toast-body"></div>
            </div>`
        : `
            <div class="toast" role="alert" aria-live="assertive" aria-atomic="true">
                <div class="toast-icon">
                    <span class="bx bx-${options.icon}"></span>
                </div>
                <div class="toast-body"></div>
                <div class="toast-header">
                    <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>`
    );

    $toast.toggleClass("no-title", !options.title);
    $toast.find(".toast-title").text(options.title ?? "");
    $toast.find(".toast-body").html(options.message);

    if (options.id) {
        $toast.attr("id", `toast-${options.id}`);
    }

    $("#toast-container").append($toast);

    $toast.toast({
        delay: options.delay || 3000,
        autohide: !!options.autohide
    });

    $toast.on("hidden.bs.toast", (e) => e.target.remove());

    $toast.toast("show");

    return $toast;
}

function showPersistent(options: ToastOptions) {
    let $toast = $(`#toast-${options.id}`);

    if ($toast.length > 0) {
        $toast.find(".toast-body").html(options.message);
    } else {
        options.autohide = false;

        $toast = toast(options);
    }

    if (options.closeAfter) {
        setTimeout(() => $toast.remove(), options.closeAfter);
    }
}

function closePersistent(id: string) {
    $(`#toast-${id}`).remove();
}

function showMessage(message: string, delay = 2000, icon = "check") {
    console.debug(utils.now(), "message:", message);

    toast({
        icon,
        message: message,
        autohide: true,
        delay
    });
}

export function showError(message: string, delay = 10000) {
    console.log(utils.now(), "error: ", message);

    toast({
        icon: "alert",
        message: message,
        autohide: true,
        delay
    });
}

function showErrorTitleAndMessage(title: string, message: string, delay = 10000) {
    console.log(utils.now(), "error: ", message);

    toast({
        title: title,
        icon: "alert",
        message: message,
        autohide: true,
        delay
    });
}

export default {
    showMessage,
    showError,
    showErrorTitleAndMessage,
    showPersistent,
    closePersistent
};
