import type { Application } from "express";
import http, { type OutgoingHttpHeaders } from "http";
import type { AddressInfo } from "net";

export interface ChunkedResponse {
    status: number;
    body: string;
}

/** The boundary of the bodies that {@link multipartFile} builds. */
export const MULTIPART_BOUNDARY = "trilium-spec-boundary";

/** A multipart body that carries one file, in chunks, framed as a browser frames it. */
export function multipartFile(
    { field = "upload", fileName, type }: { field?: string; fileName: string; type: string },
    ...content: Buffer[]
): Buffer[] {
    const header = `--${MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name="${field}"; `
        + `filename="${fileName}"\r\nContent-Type: ${type}\r\n\r\n`;
    return [ Buffer.from(header), ...content, Buffer.from(`\r\n--${MULTIPART_BOUNDARY}--\r\n`) ];
}

/** The `Content-Type` of a body that {@link multipartFile} builds. */
export const MULTIPART_CONTENT_TYPE = `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`;

/**
 * Posts `chunks` to `app` without a declared length: Node then sends the body with
 * `Transfer-Encoding: chunked`, so the server learns its size only by reading it.
 */
export async function postChunked(
    app: Application, path: string, headers: OutgoingHttpHeaders, chunks: (string | Buffer)[]
): Promise<ChunkedResponse> {
    const server = app.listen(0);
    try {
        const { port } = server.address() as AddressInfo;
        return await new Promise<ChunkedResponse>((resolve, reject) => {
            const request = http.request({ host: "127.0.0.1", port, method: "POST", path, headers },
                (response) => {
                    let body = "";
                    response.setEncoding("utf8");
                    response.on("data", (chunk: string) => (body += chunk));
                    response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
                    response.on("error", reject);
                });
            request.on("error", reject);
            for (const chunk of chunks) {
                request.write(chunk);
            }
            request.end();
        });
    } finally {
        server.close();
    }
}
