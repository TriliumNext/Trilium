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
