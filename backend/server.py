# ASGI reverse-proxy shim: uvicorn(:8001) -> Node Express api-server(:8055).
# The real backend is the TypeScript monorepo at /app/artifacts/api-server,
# managed by the `apiserver` supervisor program. Do not add business logic here.
#
# SECURITY: uses the raw AsyncHTTPTransport (not AsyncClient) so there is NO
# shared cookie jar — cookies pass through untouched per-request, and multiple
# Set-Cookie response headers are preserved. Never reintroduce httpx.AsyncClient
# here: its default jar leaks sessions across users (multi-tenant auth bypass).
import httpx
from fastapi import FastAPI, Request
from starlette.background import BackgroundTask
from fastapi.responses import StreamingResponse, JSONResponse

UPSTREAM = "http://127.0.0.1:8055"
HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
               "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length"}

app = FastAPI()
transport = httpx.AsyncHTTPTransport(retries=0)


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy(request: Request, path: str):
    fwd_headers = [(k, v) for k, v in request.headers.items() if k.lower() not in HOP_HEADERS]
    body = await request.body()
    url = httpx.URL(f"{UPSTREAM}/{path}", query=request.url.query.encode() or None)
    upstream_req = httpx.Request(request.method, url, headers=fwd_headers, content=body)
    try:
        upstream_resp = await transport.handle_async_request(upstream_req)
    except (httpx.ConnectError, httpx.ConnectTimeout):
        return JSONResponse(status_code=503, content={
            "error": "API_SERVER_UNAVAILABLE",
            "message": "Node api-server is not reachable on :8055 (starting up or crashed).",
        })

    resp = StreamingResponse(
        upstream_resp.aiter_raw(),
        status_code=upstream_resp.status_code,
        background=BackgroundTask(upstream_resp.aclose),
    )
    for k, v in upstream_resp.headers.multi_items():
        lk = k.lower()
        if lk in HOP_HEADERS or lk == "content-length":
            continue
        resp.headers.append(k, v)
    return resp
