export class HttpError extends Error {

    statusCode: number;

    constructor(message: string, statusCode: number) {
        super(message);
        this.name = "HttpError";
        this.statusCode = statusCode;
    }

}

export class NotFoundError extends HttpError {

    constructor(message: string) {
        super(message, 404);
        this.name = "NotFoundError";
    }

}

export class ForbiddenError extends HttpError {

    constructor(message: string) {
        super(message, 403);
        this.name = "ForbiddenError";
    }

}

/** The request is well-formed but conflicts with the state it would act on, e.g. an offset that has moved on. */
export class ConflictError extends HttpError {

    constructor(message: string) {
        super(message, 409);
        this.name = "ConflictError";
    }

}

/** A 409 whose answer holds `details`, such as the reason, so that the client can recover. */
export class DetailedConflictError<T extends { reason: string }> extends ConflictError {

    readonly details: T;

    constructor(message: string, details: T) {
        super(message);
        this.name = "DetailedConflictError";
        this.details = details;
    }

}

/**
 * What the request names is gone for good, so asking again will not bring it back.
 *
 * Distinct from a 404 in the one way that matters to a client holding a reference: a 404 may be a
 * mistyped reference to something that never existed, while this is the thing it meant, and the
 * answer is to start over rather than to retry.
 */
export class GoneError extends HttpError {

    constructor(message: string) {
        super(message, 410);
        this.name = "GoneError";
    }

}

export class OpenIdError {
    message: string;

    constructor(message: string) {
        this.message = message;
    }
}

export class ValidationError extends HttpError {

    constructor(message: string) {
        super(message, 400)
        this.name = "ValidationError";
    }

}

/** The content of a note or attachment is not available, such as outside a protected session. */
export class ContentNotAvailableError extends ValidationError {

    constructor(message: string) {
        super(message);
        this.name = "ContentNotAvailableError";
    }

}
