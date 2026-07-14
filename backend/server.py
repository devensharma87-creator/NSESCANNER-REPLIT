# ASGI reverse-proxy shim: uvicorn(:8001) -> Node Express api-server(:8010).
# The real backend is the TypeScript monorepo at /app/artifacts/api-server,
# managed by the `apiserver` supervisor program. Do not add business logic here.
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, JSONResponse

UPSTREAM = "http://127.0.0.1:8055"
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
               "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length"}

app = FastAPI()
client = httpx.AsyncClient(base_url=UPSTREAM, timeout=httpx.Timeout(120.0, connect=5.0))


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy(request: Request, path: str):
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
    body = await request.body()
    try:
        upstream_req = client.build_request(
            request.method, f"/{path}",
            params=request.query_params, headers=headers, content=body,
        )
        upstream_resp = await client.send(upstream_req, stream=True)
    except httpx.ConnectError:
        return JSONResponse(status_code=503, content={
            "error": "API_SERVER_UNAVAILABLE",
            "message": "Node api-server is not reachable on :8010 (starting up or crashed).",
        })
    resp_headers = {k: v for k, v in upstream_resp.headers.items() if k.lower() not in HOP_HEADERS}

    async def stream():
        try:
            async for chunk in upstream_resp.aiter_raw():
                yield chunk
        finally:
            await upstream_resp.aclose()

    return StreamingResponse(stream(), status_code=upstream_resp.status_code, headers=resp_headers)
