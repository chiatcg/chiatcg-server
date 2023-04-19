export enum StatusCodes {
    ok = 200,

    /**
     *  Missing or incorrect params
     */
    badRequest = 400,

    /**
     * Auth failed
     */
    unauthorized = 401,

    /**
     * Server state is incompatible with request, e.g. leaving a game without being in a game.
     * This could be due to stale state on the client or wrong client logic.
     */
    forbidden = 403, // retry won't help

    /**
     * Resource specified in the request does not exist and it is unknown whether it ever existed
     */
    notFound = 404,

    /**
     * API exists but wrong method was used
     */
    methodNotAllowed = 405,

    /**
     * Request is no longer valid and should start over from handshake.
     */
    timeout = 408,

    /**
     * Request was valid at the time it was received but server state changed since. The request
     * should be retried.
     */
    conflict = 409,

    /**
     * Resource specified in the request did exist at one point but not anymore
     */
    gone = 410,

    /**
     * Slow down
     */
    tooManyRequests = 429,

    /**
     * Uncaught/unhandled server error - should not happen
     */
    internalServerError = 500,

    /**
     * A downstream resource that the server depends on is unavailable
     */
    badGateway = 502, // downstream resource error

    /**
     * Planned outage
     */
    serviceUnavailable = 503,
}

export interface IHttpRequest {
    path: string;
    httpMethod: string;
    headers?: { [header: string]: string; };
    queryStringParameters?: { [header: string]: string; };
    body?: string;
}

export type IHttpRouteHandler = (
    path: string[],
    query: Record<string, string | number>,
    body: Record<string, any>,
    req: IHttpRequest,
) => Promise<[StatusCodes] | [StatusCodes, Record<string, any>] | [StatusCodes, Record<string, any>, Record<string, string>] | undefined>;

export class RouteError extends Error {
    constructor(
        public statusCode: StatusCodes,
        message: string,
    ) {
        super(message);
    }
}