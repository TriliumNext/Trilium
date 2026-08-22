/**
 * @trilium-script
 *
 * id: probe
 * type: backend
 * title: Custom handler probe
 * customRequestHandler: probe/(.*)
 */

const req = api.req;
const res = api.res;

if (!req || !res) {
    throw new Error("probe: no req/res — not invoked as a custom request handler");
}

res.status(200).json({
    method: req.method,
    path: req.path,
    pathParams: api.pathParams,
    contentType: req.headers["content-type"] ?? null,
    depth: req.headers["depth"] ?? null,
    authorization: req.headers["authorization"] ?? null,
    bodyType: typeof req.body,
    bodyIsBuffer: Buffer.isBuffer(req.body),
    body: Buffer.isBuffer(req.body)
        ? req.body.toString("utf-8").slice(0, 500)
        : (typeof req.body === "string" ? req.body.slice(0, 500) : req.body ?? null)
});
